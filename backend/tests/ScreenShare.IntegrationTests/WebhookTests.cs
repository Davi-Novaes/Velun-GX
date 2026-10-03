using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ScreenShare.Domain.Participants;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.IntegrationTests;

/// <summary>Webhooks do SFU atualizam o estado dos participantes e o histórico de tracks.</summary>
public sealed class WebhookTests(ApiFactory api)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private long _eventSeq;

    private async Task<HttpResponseMessage> SendAsync(object payload, string? secret = null)
    {
        var body = JsonSerializer.Serialize(payload);
        var now = api.Clock.GetUtcNow();
        var token = new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = ApiFactory.LiveKitKey,
            NotBefore = now.UtcDateTime,
            Expires = now.AddMinutes(5).UtcDateTime,
            Claims = new Dictionary<string, object> { ["sha256"] = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(body))) },
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret ?? ApiFactory.LiveKitSecret)), SecurityAlgorithms.HmacSha256),
        });
        using var client = api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/livekit")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/webhook+json"),
        };
        request.Headers.TryAddWithoutValidation("Authorization", token);
        return await client.SendAsync(request, Ct);
    }

    private object Event(string type, Guid roomId, string identity, string sid, object? track = null, string? reason = null) => new
    {
        @event = type,
        id = $"EV_{Interlocked.Increment(ref _eventSeq)}_{Guid.NewGuid():N}",
        createdAt = api.Clock.GetUtcNow().ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture),
        room = new { sid = "RM_1", name = roomId.ToString("N") },
        participant = new { sid, identity, name = "x", disconnectReason = reason },
        track,
    };

    private async Task<(Guid RoomId, Guid ParticipantId, string Identity)> JoinedAsync()
    {
        var guest = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(guest);
        var joined = await (await ApiFactory.JoinAsync(guest, code)).Content.ReadFromJsonAsync<JsonElement>(Ct);
        var participant = joined.GetProperty("participant");
        await using var scope = api.Services.CreateAsyncScope();
        var roomId = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Rooms.Where(r => r.Code == code).Select(r => r.Id).SingleAsync(Ct);
        return (roomId, participant.GetProperty("id").GetGuid(), participant.GetProperty("identity").GetString()!);
    }

    private async Task<Participant> ParticipantAsync(Guid id)
    {
        await using var scope = api.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Participants.AsNoTracking().SingleAsync(p => p.Id == id, Ct);
    }

    [Fact]
    public async Task Unsigned_or_wrongly_signed_webhook_is_401()
    {
        var response = await SendAsync(new { @event = "room_started", id = "EV_x" }, secret: "wrong-secret-with-at-least-32-characters!!");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Participant_lifecycle_is_persisted()
    {
        var (roomId, participantId, identity) = await JoinedAsync();

        Assert.Equal(HttpStatusCode.OK, (await SendAsync(Event("participant_joined", roomId, identity, "PA_1"))).StatusCode);
        var connected = await ParticipantAsync(participantId);
        Assert.Equal(ParticipantStatus.Connected, connected.Status);
        Assert.Equal("PA_1", connected.SfuSid);

        await SendAsync(Event("participant_left", roomId, identity, "PA_1", reason: "CLIENT_INITIATED"));
        var left = await ParticipantAsync(participantId);
        Assert.Equal(ParticipantStatus.Disconnected, left.Status);
        Assert.Equal("client_initiated", left.LeaveReason);
    }

    [Fact]
    public async Task Leave_of_replaced_session_is_ignored_after_reconnect()
    {
        var (roomId, participantId, identity) = await JoinedAsync();
        await SendAsync(Event("participant_joined", roomId, identity, "PA_old"));
        await SendAsync(Event("participant_joined", roomId, identity, "PA_new")); // reconectou com a mesma identidade

        await SendAsync(Event("participant_left", roomId, identity, "PA_old", reason: "DUPLICATE_IDENTITY"));
        await SendAsync(Event("participant_left", roomId, identity, "PA_old", reason: "SIGNAL_CLOSE")); // atrasado, sessão velha

        var participant = await ParticipantAsync(participantId);
        Assert.Equal(ParticipantStatus.Connected, participant.Status);
        Assert.Equal("PA_new", participant.SfuSid);
    }

    [Fact]
    public async Task Audio_and_video_tracks_are_recorded_separately_and_idempotently()
    {
        var (roomId, participantId, identity) = await JoinedAsync();
        await SendAsync(Event("participant_joined", roomId, identity, "PA_1"));
        var video = new { sid = "TR_v_" + participantId.ToString("N"), type = "VIDEO", source = "SCREEN_SHARE", mimeType = "video/VP8", width = 1920, height = 1080 };
        var audio = new { sid = "TR_a_" + participantId.ToString("N"), type = "AUDIO", source = "SCREEN_SHARE_AUDIO", mimeType = "audio/opus" };

        await SendAsync(Event("track_published", roomId, identity, "PA_1", video));
        await SendAsync(Event("track_published", roomId, identity, "PA_1", video)); // reenvio
        await SendAsync(Event("track_published", roomId, identity, "PA_1", audio));
        await SendAsync(Event("track_unpublished", roomId, identity, "PA_1", audio));

        await using var scope = api.Services.CreateAsyncScope();
        var streams = await scope.ServiceProvider.GetRequiredService<AppDbContext>().StreamSessions.AsNoTracking()
            .Where(s => s.ParticipantId == participantId).OrderBy(s => s.Kind).ToListAsync(Ct);
        Assert.Equal(2, streams.Count);
        Assert.Equal(("audio", "screen_share_audio"), (streams[0].Kind, streams[0].Source));
        Assert.NotNull(streams[0].EndedAt);
        Assert.Equal(("video", "screen_share", 1920), (streams[1].Kind, streams[1].Source, streams[1].Width ?? 0));
        Assert.Null(streams[1].EndedAt);
    }
}
