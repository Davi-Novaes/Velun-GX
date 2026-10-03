using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ScreenShare.Infrastructure.LiveKit;

namespace ScreenShare.UnitTests;

internal static class TestSupport
{
    public const string ApiKey = "test-key";
    public const string ApiSecret = "test-secret-with-at-least-32-characters!!";

    public static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    public static FakeTimeProvider Clock() => new(Now);

    public static IOptions<LiveKitOptions> Options(string secret = ApiSecret) => Microsoft.Extensions.Options.Options.Create(new LiveKitOptions
    {
        ApiUrl = "http://livekit.test:7880",
        PublicUrl = "wss://sfu.example.test",
        ApiKey = ApiKey,
        ApiSecret = secret,
        JoinTokenLifetime = TimeSpan.FromMinutes(10),
    });

    public static TokenValidationParameters Validation(DateTimeOffset now) => new()
    {
        ValidIssuer = ApiKey,
        ValidateAudience = false,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(ApiSecret)),
        LifetimeValidator = (nbf, exp, _, _) => (nbf is null || nbf <= now.UtcDateTime) && (exp is null || exp > now.UtcDateTime),
    };

    /// <summary>Assina um corpo de webhook como o LiveKit faz: JWT com o hash SHA-256 (Base64) do corpo.</summary>
    public static string SignWebhook(string body, DateTimeOffset now, string secret = ApiSecret, string issuer = ApiKey, TimeSpan? lifetime = null) =>
        new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            NotBefore = now.UtcDateTime,
            Expires = (now + (lifetime ?? TimeSpan.FromMinutes(5))).UtcDateTime,
            Claims = new Dictionary<string, object>
            {
                ["sha256"] = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(body))),
            },
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)), SecurityAlgorithms.HmacSha256),
        });
}
