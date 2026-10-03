using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;

namespace ScreenShare.Infrastructure.LiveKit;

/// <summary>
/// Gera os JWT (HS256) aceitos pelo LiveKit: o token de participante (curto, preso a uma sala,
/// uma identidade e às origens de mídia permitidas) e o token de serviço usado nas chamadas Twirp.
/// </summary>
public sealed class LiveKitTokenFactory(IOptions<LiveKitOptions> options, TimeProvider clock)
{
    private static readonly JsonWebTokenHandler Handler = new() { SetDefaultTimesOnTokenCreation = false };
    private static readonly TimeSpan ServiceTokenLifetime = TimeSpan.FromMinutes(1);

    private readonly LiveKitOptions _options = options.Value;
    private readonly SigningCredentials _credentials = new(
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.Value.ApiSecret)), SecurityAlgorithms.HmacSha256);

    public (string Token, DateTimeOffset ExpiresAt) CreateParticipantToken(
        string roomName, ParticipantIdentity identity, string displayName, string role, MediaPolicy policy)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(roomName);
        ArgumentException.ThrowIfNullOrWhiteSpace(displayName);

        var video = new Dictionary<string, object>
        {
            ["room"] = roomName,
            ["roomJoin"] = true,
            ["canSubscribe"] = true,
            ["canPublish"] = !policy.PublishRequiresApproval,
            ["canPublishSources"] = policy.AllowedSources.ToArray(),
            ["canPublishData"] = !policy.PublishRequiresApproval,
            // Somente atributos do próprio participante, usados para qualidade/ping reportados.
            // Autorização continua baseada no banco; metadata nunca concede ownership.
            ["canUpdateOwnMetadata"] = policy.PublishRequiresApproval,
        };
        var metadata = JsonSerializer.Serialize(new { role, participantId = identity.ParticipantId });

        return Create(identity.Value, _options.JoinTokenLifetime, video, new Dictionary<string, object>
        {
            ["name"] = displayName,
            ["metadata"] = metadata,
        });
    }

    /// <summary>Token para a API de servidor (criar sala, listar e remover participantes).</summary>
    public string CreateServiceToken(string? roomName)
    {
        var video = new Dictionary<string, object>
        {
            ["roomCreate"] = true,
            ["roomList"] = true,
            ["roomAdmin"] = true,
        };
        if (roomName is not null)
            video["room"] = roomName;

        return Create(subject: null, ServiceTokenLifetime, video, extraClaims: null).Token;
    }

    private (string Token, DateTimeOffset ExpiresAt) Create(
        string? subject, TimeSpan lifetime, Dictionary<string, object> video, Dictionary<string, object>? extraClaims)
    {
        var now = clock.GetUtcNow();
        var expires = now + lifetime;
        var claims = new Dictionary<string, object> { ["video"] = video };
        if (subject is not null)
            claims[JwtRegisteredClaimNames.Sub] = subject;
        if (extraClaims is not null)
        {
            foreach (var (key, value) in extraClaims)
                claims[key] = value;
        }

        var token = Handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = _options.ApiKey,
            NotBefore = now.UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Expires = expires.UtcDateTime,
            Claims = claims,
            SigningCredentials = _credentials,
        });
        return (token, expires);
    }
}
