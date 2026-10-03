using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Api.Http;
using ScreenShare.Api.Security;
using ScreenShare.Domain.Accounts;
using ScreenShare.Infrastructure.Accounts;
using ScreenShare.Infrastructure.Persistence;
using ScreenShare.Infrastructure.Redis;

namespace ScreenShare.Api.Endpoints;

internal static class AccountEndpoints
{
    public static void MapAccountEndpoints(this IEndpointRouteBuilder api)
    {
        var auth = api.MapGroup("/auth");
        auth.MapGet("/csrf", async (HttpContext http, IAntiforgery antiforgery) =>
        {
            await SetAccountPrincipalAsync(http);
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { token = antiforgery.GetAndStoreTokens(http).RequestToken });
        });
        auth.MapGet("/me", MeAsync).RequireAuthorization(AccountAuthentication.Policy);
        auth.MapPost("/register", RegisterAsync).WithRateLimit("auth-register", RateLimitPartition.ClientIp).AddEndpointFilter(ValidateCsrfAsync);
        auth.MapPost("/login", LoginAsync).WithRateLimit("auth-login", RateLimitPartition.ClientIp).AddEndpointFilter(ValidateCsrfAsync);
        auth.MapPatch("/me", UpdateProfileAsync).RequireAuthorization(AccountAuthentication.Policy).WithRateLimit("community-write", RateLimitPartition.ClientIp).AddEndpointFilter(ValidateCsrfAsync);
        auth.MapPost("/logout", LogoutAsync).RequireAuthorization(AccountAuthentication.Policy).AddEndpointFilter(ValidateCsrfAsync);
    }

    internal static async ValueTask<object?> ValidateCsrfAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        await SetAccountPrincipalAsync(context.HttpContext);
        try { await context.HttpContext.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context.HttpContext); }
        catch (AntiforgeryValidationException)
        {
            return Error(403, "CSRF_INVALID", "Requisição inválida. Recarregue a página e tente novamente.");
        }
        return await next(context);
    }

    private static async Task SetAccountPrincipalAsync(HttpContext http)
    {
        var auth = await http.AuthenticateAsync(AccountAuthentication.Scheme);
        http.User = auth.Succeeded ? auth.Principal! : new ClaimsPrincipal(new ClaimsIdentity());
    }

    private static async Task<IResult> RegisterAsync(RegisterBody body, HttpContext http, AccountService accounts, AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        UserAccount? user;
        try { user = await accounts.RegisterAsync(body.Username, body.Password, body.ConfirmPassword, ct); }
        catch (ArgumentException ex) { return Error(400, "VALIDATION_ERROR", ex.Message); }
        if (user is null) return Error(409, "USERNAME_TAKEN", "Este nome de usuário já está em uso.");
        await AccountAuthentication.SignInAsync(http, user, db, clock, ct);
        return Results.Json(Profile(user), statusCode: 201);
    }

    private static async Task<IResult> LoginAsync(LoginBody body, HttpContext http, AccountService accounts, AppDbContext db, TimeProvider clock, IRateLimiter limiter, CancellationToken ct)
    {
        // Limite por conta além do IP; digest não expõe o username em chaves Redis.
        var normalized = (body.Username ?? "").Trim().Normalize(System.Text.NormalizationForm.FormKC).ToUpperInvariant();
        if (normalized.Length > 64) return Error(401, "INVALID_CREDENTIALS", "Usuário ou senha incorretos.");
        var key = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(normalized)));
        var limit = await limiter.CheckAsync("auth-account", key, 20, TimeSpan.FromMinutes(5));
        if (!limit.Allowed)
        {
            http.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(limit.RetryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Error(429, "RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.");
        }
        var user = await accounts.LoginAsync(body.Username!, body.Password, ct);
        if (user is null) return Error(401, "INVALID_CREDENTIALS", "Usuário ou senha incorretos.");
        await AccountAuthentication.SignInAsync(http, user, db, clock, ct);
        return Results.Ok(Profile(user));
    }

    private static async Task<IResult> MeAsync(HttpContext http, AppDbContext db, CancellationToken ct)
    {
        http.Response.Headers.CacheControl = "no-store";
        var id = Guid.Parse(http.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == id, ct);
        return Results.Ok(Profile(user));
    }

    private static async Task<IResult> UpdateProfileAsync(ProfileBody body, HttpContext http, AppDbContext db, CancellationToken ct)
    {
        var id = Guid.Parse(http.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await db.Users.SingleAsync(x => x.Id == id, ct);
        try { user.SetNickname(body.Nickname); }
        catch (ArgumentException ex) { return Error(400, "VALIDATION_ERROR", ex.Message); }
        await db.SaveChangesAsync(ct);
        return Results.Ok(Profile(user));
    }

    private static async Task<IResult> LogoutAsync(HttpContext http, AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var id = Guid.Parse(http.User.FindFirstValue(AccountAuthentication.SessionClaim)!);
        var session = await db.AccountSessions.SingleOrDefaultAsync(x => x.Id == id, ct);
        session?.Revoke(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        await http.SignOutAsync(AccountAuthentication.Scheme);
        return Results.NoContent();
    }

    private static object Profile(UserAccount user) => new { user.Id, user.Username, user.Nickname, Name = user.ShownName, user.Avatar, user.CreatedAt, user.LastLoginAt };
    private static IResult Error(int status, string code, string message) => Results.Problem(Problems.Create(status, code, "Conta", message));
    private sealed record RegisterBody(string Username, string Password, string ConfirmPassword);
    private sealed record LoginBody(string Username, string Password);
    private sealed record ProfileBody(string? Nickname);
}
