using System.ComponentModel.DataAnnotations;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace ScreenShare.Infrastructure.Sessions;

public sealed class SessionOptions
{
    public const string SectionName = "Session";
    public const string Issuer = "screenshare";

    /// <summary>Chave HS256 da sessão de convidado (independente da chave do SFU).</summary>
    [Required, MinLength(32)]
    public string SigningKey { get; set; } = "";

    [Range(typeof(TimeSpan), "00:10:00", "7.00:00:00")]
    public TimeSpan Lifetime { get; set; } = TimeSpan.FromHours(12);

    public string CookieName { get; set; } = "ss_session";

    /// <summary>Em produção sempre true. Em desenvolvimento pode ser false para testar por HTTP na rede local.</summary>
    public bool SecureCookie { get; set; } = true;
}

public sealed record SessionToken(string Value, DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt);

public sealed record ValidatedSession(Guid GuestId, DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt);

/// <summary>Emite e valida o JWT da sessão de convidado guardado no cookie HttpOnly.</summary>
public sealed class SessionTokenService
{
    private static readonly JsonWebTokenHandler Handler = new() { SetDefaultTimesOnTokenCreation = false };

    private readonly SessionOptions _options;
    private readonly TimeProvider _clock;
    private readonly SigningCredentials _credentials;
    private readonly TokenValidationParameters _validation;

    public SessionTokenService(IOptions<SessionOptions> options, TimeProvider clock)
    {
        _options = options.Value;
        _clock = clock;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        _credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        _validation = new TokenValidationParameters
        {
            ValidIssuer = SessionOptions.Issuer,
            ValidAudience = SessionOptions.Issuer,
            IssuerSigningKey = key,
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            RequireExpirationTime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            LifetimeValidator = (nbf, exp, _, p) =>
            {
                var now = _clock.GetUtcNow().UtcDateTime;
                return exp is not null && exp.Value > now - p.ClockSkew && (nbf is null || nbf.Value <= now + p.ClockSkew);
            },
        };
    }

    public SessionOptions Options => _options;

    public SessionToken Issue(Guid guestId)
    {
        var now = _clock.GetUtcNow();
        var expires = now + _options.Lifetime;
        var token = Handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = SessionOptions.Issuer,
            Audience = SessionOptions.Issuer,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expires.UtcDateTime,
            Claims = new Dictionary<string, object> { [JwtRegisteredClaimNames.Sub] = guestId.ToString() },
            SigningCredentials = _credentials,
        });
        return new SessionToken(token, now, expires);
    }

    public async Task<ValidatedSession?> ValidateAsync(string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 4096)
            return null;
        var result = await Handler.ValidateTokenAsync(token, _validation);
        if (!result.IsValid || result.SecurityToken is not JsonWebToken jwt || !Guid.TryParse(jwt.Subject, out var guestId))
            return null;
        return new ValidatedSession(guestId, jwt.IssuedAt, jwt.ValidTo);
    }

    /// <summary>Sessão deslizante: renova quando já passou da metade da validade.</summary>
    public bool ShouldRenew(ValidatedSession session) =>
        session.ExpiresAt - _clock.GetUtcNow() < _options.Lifetime / 2;
}
