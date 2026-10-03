using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ScreenShare.Application.Common;
using ScreenShare.Application.Sfu;
using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;

namespace ScreenShare.Application.Rooms;

public sealed partial class RoomService(
    IAppDbContext db,
    ISfuGateway sfu,
    IDistributedLock locks,
    IUniqueViolationDetector uniqueViolations,
    TimeProvider clock,
    ILogger<RoomService> logger)
{
    private const int CodeGenerationAttempts = 5;
    private static readonly TimeSpan JoinLockTtl = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan JoinLockWait = TimeSpan.FromSeconds(3);

    public async Task<CreatedRoom> CreateAsync(Guid ownerGuestId, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var room = Room.Create(RoomCode.New(), ownerGuestId, clock.GetUtcNow());
            db.Rooms.Add(room);
            try
            {
                await db.SaveChangesAsync(ct);
                LogRoomCreated(logger, room.Id, room.Code, ownerGuestId);
                return new CreatedRoom(room.Code, room.MaxParticipants, room.CreatedAt, room.ExpiresAt);
            }
            catch (DbUpdateException ex) when (uniqueViolations.IsUniqueViolation(ex) && attempt < CodeGenerationAttempts)
            {
                // colisão de código (improvável com 10¹² combinações): gera outro
                db.Rooms.Remove(room);
            }
        }
    }

    public async Task<AppResult<RoomInfo>> GetAsync(string code, CancellationToken ct)
    {
        var lookup = await FindActiveAsync(code, ct);
        if (!lookup.IsSuccess)
            return lookup.Error!;
        var room = lookup.Value!;

        var occupied = await OccupiedIdentitiesAsync(room, ct);
        return new RoomInfo(room.Code, "active", occupied.Count, room.MaxParticipants, occupied.Count >= room.MaxParticipants);
    }

    public async Task<AppResult<JoinedRoom>> JoinAsync(JoinRequest request, CancellationToken ct)
    {
        if (!DisplayName.TryCreate(request.DisplayName, out var name))
            return AppError.Validation($"O nome deve ter entre 1 e {DisplayName.MaxLength} caracteres.");

        var lookup = await FindActiveAsync(request.Code, ct);
        if (!lookup.IsSuccess)
            return lookup.Error!;
        var room = lookup.Value!;

        // Serializa entradas na mesma sala: sem isso, duas entradas simultâneas com 19 pessoas passariam as duas.
        await using var roomLock = await locks.TryAcquireAsync($"lock:room:{room.Id:N}:join", JoinLockTtl, JoinLockWait, ct);
        if (roomLock is null)
            return AppError.RoomBusy();

        var now = clock.GetUtcNow();
        Participant? participant = null;
        if (request.ParticipantId is { } existingId)
        {
            participant = await db.Participants.SingleOrDefaultAsync(p => p.Id == existingId, ct);
            if (participant is null || participant.RoomId != room.Id || participant.GuestId != request.GuestId)
                return AppError.Forbidden("Este participante não pertence à sua sessão nesta sala.");
        }

        try
        {
            await sfu.EnsureRoomAsync(room.Id, room.MaxParticipants, ct);
            var occupied = await OccupiedIdentitiesAsync(room, ct);
            if (participant is not null)
                occupied.Remove(participant.Identity); // reconexão ocupa a mesma vaga
            if (occupied.Count >= room.MaxParticipants)
            {
                LogJoinRejected(logger, room.Id, "room_full", occupied.Count);
                return AppError.RoomFull(room.MaxParticipants);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or SfuException)
        {
            LogSfuFailure(logger, room.Id, ex.Message);
            return AppError.SfuUnavailable();
        }

        var role = room.RoleFor(request.GuestId);
        if (participant is null)
        {
            participant = Participant.Create(room.Id, request.GuestId, name, role, now);
            db.Participants.Add(participant);
        }
        else
        {
            participant.Rejoin(name, now);
        }
        room.Touch(now);
        await db.SaveChangesAsync(ct);

        var token = sfu.CreateAccessToken(room.Id, participant.ParticipantIdentity, participant.DisplayName, role, room.MediaPolicy);
        LogJoinAccepted(logger, room.Id, participant.Id, participant.Identity, participant.ReconnectCount > 0);

        var policy = room.MediaPolicy;
        return new JoinedRoom(
            new JoinedParticipant(participant.Id, participant.Identity, participant.DisplayName, role),
            new SfuConnection(token.Url, token.Token, token.ExpiresAt),
            new JoinPolicy(room.MaxParticipants, policy.AllowedSources, policy.MaxConcurrentScreenShares, policy.Video, policy.Audio));
    }

    /// <summary>Saída informada pelo navegador (melhor esforço). A fonte da verdade é o webhook do SFU.</summary>
    public async Task<AppResult<bool>> LeaveAsync(string code, Guid guestId, Guid participantId, CancellationToken ct)
    {
        if (!RoomCode.TryParse(code, out var roomCode))
            return AppError.RoomNotFound();
        var participant = await db.Participants
            .Join(db.Rooms, p => p.RoomId, r => r.Id, (p, r) => new { p, r.Code })
            .Where(x => x.p.Id == participantId && x.Code == roomCode.Value)
            .Select(x => x.p)
            .SingleOrDefaultAsync(ct);
        if (participant is null || participant.GuestId != guestId)
            return AppError.Forbidden("Este participante não pertence à sua sessão nesta sala.");

        // só encerra reservas que ainda não conectaram; conectados saem pelo webhook participant_left
        if (participant.Status == ParticipantStatus.Joining && participant.MarkLeft(null, "client_leave", clock.GetUtcNow()))
            await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task<AppResult<Room>> FindActiveAsync(string code, CancellationToken ct)
    {
        if (!RoomCode.TryParse(code, out var roomCode))
            return AppError.RoomNotFound();
        var room = await db.Rooms.SingleOrDefaultAsync(r => r.Code == roomCode.Value, ct);
        if (room is null)
            return AppError.RoomNotFound();
        if (room.IsExpired(clock.GetUtcNow()))
            return AppError.RoomExpired();
        return room;
    }

    /// <summary>
    /// Vagas ocupadas = conectados segundo o SFU ∪ tokens emitidos há menos de 60 s que ainda não conectaram.
    /// Só o SFU não basta: quem acabou de receber token ainda não aparece nele.
    /// </summary>
    private async Task<HashSet<string>> OccupiedIdentitiesAsync(Room room, CancellationToken ct)
    {
        var connected = await sfu.ListParticipantsAsync(room.Id, ct);
        var occupied = connected.Where(p => p.State != "disconnected").Select(p => p.Identity).ToHashSet(StringComparer.Ordinal);

        var reservationStart = clock.GetUtcNow() - Participant.ReservationTtl;
        var reserved = await db.Participants
            .Where(p => p.RoomId == room.Id && p.Status == ParticipantStatus.Joining && p.LeftAt == null && p.JoinedAt > reservationStart)
            .Select(p => p.Identity)
            .ToListAsync(ct);
        occupied.UnionWith(reserved);
        return occupied;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "room.created room={RoomId} code={RoomCode} owner={GuestId}")]
    private static partial void LogRoomCreated(ILogger logger, Guid roomId, string roomCode, Guid guestId);

    [LoggerMessage(Level = LogLevel.Information, Message = "participant.join_accepted room={RoomId} participant={ParticipantId} identity={Identity} rejoin={IsRejoin}")]
    private static partial void LogJoinAccepted(ILogger logger, Guid roomId, Guid participantId, string identity, bool isRejoin);

    [LoggerMessage(Level = LogLevel.Information, Message = "participant.join_rejected room={RoomId} reason={Reason} occupied={Occupied}")]
    private static partial void LogJoinRejected(ILogger logger, Guid roomId, string reason, int occupied);

    [LoggerMessage(Level = LogLevel.Error, Message = "sfu.unavailable room={RoomId} error={Error}")]
    private static partial void LogSfuFailure(ILogger logger, Guid roomId, string error);
}
