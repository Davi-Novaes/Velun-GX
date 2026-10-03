using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using ScreenShare.Api.Http;
using ScreenShare.Infrastructure.Sessions;

namespace ScreenShare.Api.Security;

/// <summary>Autentica o convidado pelo cookie de sessão (JWT HttpOnly). Renova o cookie quando passa da metade da validade.</summary>
internal sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    SessionTokenService sessions) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Session";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var cookie = Request.Cookies[sessions.Options.CookieName];
        if (string.IsNullOrEmpty(cookie))
            return AuthenticateResult.NoResult();

        var session = await sessions.ValidateAsync(cookie);
        if (session is null)
            return AuthenticateResult.Fail("Sessão inválida ou expirada.");

        if (sessions.ShouldRenew(session))
            SessionCookie.Write(Response, sessions, sessions.Issue(session.GuestId));

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, session.GuestId.ToString())], SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties) =>
        Problems.Write(Context, StatusCodes.Status401Unauthorized, "UNAUTHENTICATED", "Sessão necessária",
            "Crie uma sessão (POST /api/v1/sessions) antes de continuar.");

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) =>
        Problems.Write(Context, StatusCodes.Status403Forbidden, "FORBIDDEN", "Acesso negado", "Operação não permitida.");
}

internal static class SessionCookie
{
    public static void Write(HttpResponse response, SessionTokenService sessions, SessionToken token) =>
        response.Cookies.Append(sessions.Options.CookieName, token.Value, new CookieOptions
        {
            HttpOnly = true,
            Secure = sessions.Options.SecureCookie,
            SameSite = SameSiteMode.Strict,
            Path = "/api",
            Expires = token.ExpiresAt,
            IsEssential = true,
        });
}

internal static class GuestPrincipal
{
    public static Guid GuestId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("Usuário sem sessão."));
}
