using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace ScreenShare.Api.Security;

/// <summary>
/// Acesso administrativo separado das contas do site: um único usuário e senha definidos na configuração do
/// servidor (Admin__Username / Admin__PasswordHash no infra/.env), com cookie próprio que só vale para /api/v1/admin.
/// Nenhuma conta comum vira administradora.
/// </summary>
internal static class AdminAuthentication
{
    public const string Scheme = "Admin";
    public const string Policy = "AdminRequired";
    public const string CookiePath = "/api/v1/admin";
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);
    private const string StampClaim = "admin_stamp";
    /// <summary>Formato do hash: pbkdf2-sha256:iterações:sal-base64:hash-base64 (sem "$", que o Docker Compose interpretaria).</summary>
    private const string Prefix = "pbkdf2-sha256";

    public sealed record Settings(string Username, string PasswordHash)
    {
        public bool Configured => Username.Length > 0 && TryParse(PasswordHash, out _, out _, out _);
        /// <summary>Muda quando o usuário ou a senha mudam: derruba os logins de painel abertos.</summary>
        public string Stamp => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Username.ToUpperInvariant() + "\n" + PasswordHash)))[..32];
    }

    public static Settings Read(IConfiguration configuration) =>
        new((configuration["Admin:Username"] ?? "").Trim(), (configuration["Admin:PasswordHash"] ?? "").Trim());

    /// <summary>Confere usuário e senha em tempo constante (sempre calcula o hash, mesmo com usuário errado).</summary>
    public static bool Verify(Settings settings, string? username, string? password)
    {
        if (!TryParse(settings.PasswordHash, out var iterations, out var salt, out var expected)) return false;
        var candidate = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password ?? ""), salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        var userOk = CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes((username ?? "").Trim().ToUpperInvariant())),
            SHA256.HashData(Encoding.UTF8.GetBytes(settings.Username.ToUpperInvariant())));
        return CryptographicOperations.FixedTimeEquals(candidate, expected) & userOk & settings.Username.Length > 0;
    }

    /// <summary>Gera o hash no formato aceito (usado nos testes; no servidor o script set-admin.sh faz o mesmo em Python).</summary>
    public static string Hash(string password, int iterations = 600_000)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, 32);
        return $"{Prefix}:{iterations.ToString(CultureInfo.InvariantCulture)}:{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    private static bool TryParse(string value, out int iterations, out byte[] salt, out byte[] hash)
    {
        iterations = 0; salt = []; hash = [];
        var parts = value.Split(':');
        if (parts.Length != 4 || parts[0] != Prefix || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out iterations) || iterations is < 100_000 or > 5_000_000) return false;
        try { salt = Convert.FromBase64String(parts[2]); hash = Convert.FromBase64String(parts[3]); }
        catch (FormatException) { return false; }
        return salt.Length >= 16 && hash.Length >= 32;
    }

    public static ClaimsPrincipal Principal(Settings settings) => new(new ClaimsIdentity(
        [new Claim(ClaimTypes.Name, settings.Username), new Claim(StampClaim, settings.Stamp)], Scheme));

    /// <summary>Cookie de painel só vale enquanto usuário e senha configurados forem os mesmos do login.</summary>
    public static Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var settings = Read(context.HttpContext.RequestServices.GetRequiredService<IConfiguration>());
        if (!settings.Configured || context.Principal?.FindFirstValue(StampClaim) != settings.Stamp) context.RejectPrincipal();
        return Task.CompletedTask;
    }
}
