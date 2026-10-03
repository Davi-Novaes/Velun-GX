using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ScreenShare.Application.Sfu;

namespace ScreenShare.Infrastructure.LiveKit;

/// <summary>
/// Valida webhooks do LiveKit: o header <c>Authorization</c> é um JWT assinado com o segredo da API
/// cujo claim <c>sha256</c> é o hash (Base64) do corpo. Qualquer divergência rejeita o evento.
/// </summary>
public sealed class LiveKitWebhookReceiver : ISfuWebhookReceiver
{
    private static readonly JsonWebTokenHandler Handler = new();
    private readonly TokenValidationParameters _validation;

    public LiveKitWebhookReceiver(IOptions<LiveKitOptions> options, TimeProvider clock)
    {
        var o = options.Value;
        _validation = new TokenValidationParameters
        {
            ValidIssuer = o.ApiKey,
            ValidateIssuer = true,
            ValidateAudience = false,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.ApiSecret)),
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            ValidateLifetime = true,
            RequireExpirationTime = false,
            ClockSkew = TimeSpan.FromMinutes(1),
            LifetimeValidator = (notBefore, expires, _, p) =>
            {
                var now = clock.GetUtcNow().UtcDateTime;
                return (notBefore is null || notBefore.Value <= now + p.ClockSkew)
                    && (expires is null || expires.Value >= now - p.ClockSkew);
            },
        };
    }

    public async Task<SfuWebhookResult> ReceiveAsync(string? authorizationHeader, ReadOnlyMemory<byte> body)
    {
        var token = authorizationHeader?.Trim();
        if (token is not null && token.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            token = token["Bearer ".Length..].Trim();
        if (string.IsNullOrEmpty(token))
            return new SfuWebhookResult.Rejected("missing_authorization");

        var result = await Handler.ValidateTokenAsync(token, _validation);
        if (!result.IsValid)
            return new SfuWebhookResult.Rejected("invalid_signature");

        if (!result.Claims.TryGetValue("sha256", out var claimed) || claimed is not string claimedHash)
            return new SfuWebhookResult.Rejected("missing_body_hash");

        var actualHash = Convert.ToBase64String(SHA256.HashData(body.Span));
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actualHash), Encoding.ASCII.GetBytes(claimedHash)))
            return new SfuWebhookResult.Rejected("body_hash_mismatch");

        try
        {
            using var doc = JsonDocument.Parse(body);
            return Parse(doc.RootElement) is { } sfuEvent
                ? new SfuWebhookResult.Accepted(sfuEvent)
                : new SfuWebhookResult.Rejected("unrecognized_payload");
        }
        catch (JsonException)
        {
            return new SfuWebhookResult.Rejected("invalid_json");
        }
    }

    internal static SfuEvent? Parse(JsonElement root)
    {
        var type = root.Str("event");
        var id = root.Str("id");
        if (type is null || id is null)
            return null;

        var room = root.Prop("room");
        var participant = root.Prop("participant");
        var track = root.Prop("track");

        return new SfuEvent
        {
            Id = id,
            Type = type,
            CreatedAt = root.UnixSeconds("createdAt") ?? DateTimeOffset.UtcNow,
            RoomName = room?.Str("name"),
            RoomSid = room?.Str("sid"),
            ParticipantIdentity = participant?.Str("identity"),
            ParticipantSid = participant?.Str("sid"),
            ParticipantName = participant?.Str("name"),
            DisconnectReason = participant?.Str("disconnectReason")?.ToLowerInvariant(),
            Track = track is { ValueKind: JsonValueKind.Object } t
                ? new SfuEventTrack(
                    Sid: t.Str("sid") ?? "",
                    Source: t.EnumValue("source", "unknown"),
                    Kind: t.EnumValue("type", "unknown"),
                    MimeType: t.Str("mimeType"),
                    Width: (int?)t.Int64("width"),
                    Height: (int?)t.Int64("height"))
                : null,
        };
    }
}
