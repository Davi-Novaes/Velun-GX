using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ScreenShare.Application.Sfu;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;

namespace ScreenShare.Infrastructure.LiveKit;

/// <summary>
/// Implementação de <see cref="ISfuGateway"/> sobre a API de servidor do LiveKit (Twirp, JSON sobre HTTP).
/// </summary>
public sealed partial class LiveKitGateway(
    HttpClient http,
    LiveKitTokenFactory tokens,
    IOptions<LiveKitOptions> options,
    ILogger<LiveKitGateway> logger) : ISfuGateway
{
    private const string RoomService = "twirp/livekit.RoomService/";
    private static readonly string[] ScreenSources = ["SCREEN_SHARE", "SCREEN_SHARE_AUDIO"];
    private readonly LiveKitOptions _options = options.Value;

    /// <summary>Nome da sala no SFU: o id interno da sala. O código público nunca chega ao SFU.</summary>
    public static string RoomName(Guid roomId) => roomId.ToString("N");

    public async Task EnsureRoomAsync(Guid roomId, int maxParticipants, CancellationToken ct)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxParticipants, 1);
        var name = RoomName(roomId);
        using var response = await CallAsync("CreateRoom", name, new
        {
            name,
            empty_timeout = _options.EmptyTimeoutSeconds,
            departure_timeout = _options.DepartureTimeoutSeconds,
            max_participants = maxParticipants,
        }, ct);
        await EnsureSuccessAsync(response, "CreateRoom", ct);
    }

    public async Task<IReadOnlyList<Guid>> ListActiveRoomIdsAsync(CancellationToken ct)
    {
        using var response = await CallAsync("ListRooms", null, new { }, ct);
        await EnsureSuccessAsync(response, "ListRooms", ct);
        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var rooms = new List<Guid>();
        foreach (var room in doc.RootElement.Array("rooms"))
            if (Guid.TryParseExact(room.Str("name"), "N", out var id)) rooms.Add(id);
        return rooms;
    }

    public async Task<IReadOnlyList<SfuParticipant>> ListParticipantsAsync(Guid roomId, CancellationToken ct)
    {
        var name = RoomName(roomId);
        using var response = await CallAsync("ListParticipants", name, new { room = name }, ct);
        if (await IsNotFoundAsync(response, ct))
            return [];
        await EnsureSuccessAsync(response, "ListParticipants", ct);

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return doc.RootElement.Array("participants").Select(ParseParticipant).ToList();
    }

    public async Task RemoveParticipantAsync(Guid roomId, ParticipantIdentity identity, CancellationToken ct)
    {
        var name = RoomName(roomId);
        using var response = await CallAsync("RemoveParticipant", name, new { room = name, identity = identity.Value }, ct);
        if (await IsNotFoundAsync(response, ct))
            return;
        await EnsureSuccessAsync(response, "RemoveParticipant", ct);
    }

    public SfuAccessToken CreateAccessToken(Guid roomId, ParticipantIdentity identity, string displayName, string role, MediaPolicy policy)
    {
        var (token, expiresAt) = tokens.CreateParticipantToken(RoomName(roomId), identity, displayName, role, policy);
        return new SfuAccessToken(token, _options.PublicUrl, expiresAt);
    }

    public async Task SetPublishingAsync(Guid roomId, ParticipantIdentity identity, bool allowed, CancellationToken ct)
    {
        var name = RoomName(roomId);
        using var response = await CallAsync("UpdateParticipant", name, new
        {
            room = name, identity = identity.Value,
            permission = new { can_subscribe = true, can_publish = allowed, can_publish_data = false, can_update_metadata = true, can_publish_sources = ScreenSources },
        }, ct);
        await EnsureSuccessAsync(response, "UpdateParticipant", ct);
    }

    public async Task<bool> IsHealthyAsync(CancellationToken ct)
    {
        try
        {
            using var response = await http.GetAsync(new Uri(_options.ApiUrl), ct);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            LogUnreachable(logger, ex.Message);
            return false;
        }
    }

    private async Task<HttpResponseMessage> CallAsync(string method, string? roomName, object body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(_options.ApiUrl), RoomService + method))
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.CreateServiceToken(roomName));
        return await http.SendAsync(request, ct);
    }

    private static async Task<bool> IsNotFoundAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.StatusCode == HttpStatusCode.NotFound)
            return true;
        if (response.IsSuccessStatusCode)
            return false;
        var code = await ReadTwirpCodeAsync(response, ct);
        return code == "not_found";
    }

    private async Task EnsureSuccessAsync(HttpResponseMessage response, string method, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode)
            return;
        var body = await response.Content.ReadAsStringAsync(ct);
        LogTwirpError(logger, method, (int)response.StatusCode, body);
        throw new SfuException($"LiveKit {method} falhou com HTTP {(int)response.StatusCode}.");
    }

    private static async Task<string?> ReadTwirpCodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            return doc.RootElement.Str("code");
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static SfuParticipant ParseParticipant(JsonElement p) => new(
        Sid: p.Str("sid") ?? "",
        Identity: p.Str("identity") ?? "",
        Name: p.Str("name") ?? "",
        State: p.EnumValue("state", "joining"),
        JoinedAt: p.UnixSeconds("joinedAt"),
        Tracks: p.Array("tracks").Select(t => new SfuTrack(
            Sid: t.Str("sid") ?? "",
            Source: t.EnumValue("source", "unknown"),
            Kind: t.EnumValue("type", "unknown"),
            Muted: t.Bool("muted"))).ToList(),
        StreamReport: Attribute(p, "screen.report"),
        ReceiveReport: Attribute(p, "screen.rx"));

    private static string? Attribute(JsonElement p, string name) =>
        p.TryGetProperty("attributes", out var attributes) && attributes.ValueKind == JsonValueKind.Object
            && attributes.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    [LoggerMessage(Level = LogLevel.Error, Message = "sfu.api_error {Method} status={StatusCode} body={Body}")]
    private static partial void LogTwirpError(ILogger logger, string method, int statusCode, string body);

    [LoggerMessage(Level = LogLevel.Warning, Message = "sfu.unreachable {Error}")]
    private static partial void LogUnreachable(ILogger logger, string error);
}
