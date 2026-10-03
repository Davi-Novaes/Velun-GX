using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ScreenShare.Application.Common;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;

namespace ScreenShare.Application.Sfu;

/// <summary>
/// Aplica os eventos do SFU ao banco: status dos participantes e histórico de tracks.
/// Idempotente: o SFU pode reenviar eventos e eles podem chegar fora de ordem.
/// </summary>
public sealed partial class PersistingSfuEventProcessor(
    IAppDbContext db,
    IUniqueViolationDetector uniqueViolations,
    ILogger<PersistingSfuEventProcessor> logger) : ISfuEventProcessor
{
    private const string DuplicateIdentity = "duplicate_identity";

    public async Task HandleAsync(SfuEvent sfuEvent, CancellationToken ct)
    {
        LogEvent(logger, sfuEvent.Type, sfuEvent.Id, sfuEvent.RoomName, sfuEvent.ParticipantIdentity, sfuEvent.Track?.Source,
            sfuEvent.Track?.Sid, sfuEvent.DisconnectReason);

        switch (sfuEvent.Type)
        {
            case SfuEventTypes.ParticipantJoined:
                await OnParticipantJoinedAsync(sfuEvent, ct);
                break;
            case SfuEventTypes.ParticipantLeft:
                await OnParticipantLeftAsync(sfuEvent, ct);
                break;
            case SfuEventTypes.TrackPublished:
                await OnTrackPublishedAsync(sfuEvent, ct);
                break;
            case SfuEventTypes.TrackUnpublished:
                await OnTrackUnpublishedAsync(sfuEvent, ct);
                break;
            case SfuEventTypes.RoomFinished:
                await OnRoomFinishedAsync(sfuEvent, ct);
                break;
        }
    }

    private async Task OnParticipantJoinedAsync(SfuEvent e, CancellationToken ct)
    {
        if (await FindParticipantAsync(e, ct) is not { } participant || e.ParticipantSid is null)
            return;
        participant.MarkConnected(e.ParticipantSid, e.CreatedAt);
        await db.SaveChangesAsync(ct);
    }

    private async Task OnParticipantLeftAsync(SfuEvent e, CancellationToken ct)
    {
        // a sessão antiga cai porque a mesma identidade reconectou: o participante continua na sala
        if (e.DisconnectReason == DuplicateIdentity)
            return;
        if (await FindParticipantAsync(e, ct) is not { } participant)
            return;
        if (!participant.MarkLeft(e.ParticipantSid, e.DisconnectReason ?? "unknown", e.CreatedAt))
            return;

        var open = await db.StreamSessions.Where(s => s.ParticipantId == participant.Id && s.EndedAt == null).ToListAsync(ct);
        foreach (var stream in open)
            stream.End(e.CreatedAt);
        await db.SaveChangesAsync(ct);
    }

    private async Task OnTrackPublishedAsync(SfuEvent e, CancellationToken ct)
    {
        if (e.Track is not { Sid.Length: > 0 } track || await FindParticipantAsync(e, ct) is not { } participant)
            return;
        if (await db.StreamSessions.AnyAsync(s => s.TrackSid == track.Sid, ct))
            return;

        db.StreamSessions.Add(StreamSession.Start(participant.RoomId, participant.Id, track.Sid, track.Source, track.Kind,
            track.MimeType, track.Width, track.Height, e.CreatedAt));
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (uniqueViolations.IsUniqueViolation(ex))
        {
            // mesmo evento processado em paralelo: já registrado
        }
    }

    private async Task OnTrackUnpublishedAsync(SfuEvent e, CancellationToken ct)
    {
        if (e.Track is not { Sid.Length: > 0 } track)
            return;
        var stream = await db.StreamSessions.SingleOrDefaultAsync(s => s.TrackSid == track.Sid, ct);
        if (stream is null || stream.EndedAt is not null)
            return;
        stream.End(e.CreatedAt);
        await db.SaveChangesAsync(ct);
    }

    private async Task OnRoomFinishedAsync(SfuEvent e, CancellationToken ct)
    {
        if (!Guid.TryParseExact(e.RoomName, "N", out var roomId))
            return;
        var participants = await db.Participants.Where(p => p.RoomId == roomId && p.Status != ParticipantStatus.Disconnected).ToListAsync(ct);
        foreach (var participant in participants)
            participant.MarkLeft(null, "room_finished", e.CreatedAt);
        var streams = await db.StreamSessions.Where(s => s.RoomId == roomId && s.EndedAt == null).ToListAsync(ct);
        foreach (var stream in streams)
            stream.End(e.CreatedAt);
        await db.SaveChangesAsync(ct);
    }

    private async Task<Participant?> FindParticipantAsync(SfuEvent e, CancellationToken ct)
    {
        if (!ParticipantIdentity.TryParse(e.ParticipantIdentity, out var identity))
            return null;
        var id = identity.ParticipantId;
        return await db.Participants.SingleOrDefaultAsync(p => p.Id == id, ct);
    }

    [LoggerMessage(Level = LogLevel.Information,
        Message = "sfu.webhook {EventType} id={WebhookId} room={RoomId} identity={Identity} source={TrackSource} track={TrackSid} reason={DisconnectReason}")]
    private static partial void LogEvent(ILogger logger, string eventType, string webhookId, string? roomId, string? identity,
        string? trackSource, string? trackSid, string? disconnectReason);
}
