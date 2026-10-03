using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Domain.Accounts;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.Api.Security;

internal static class AccountAuthentication
{
    public const string Scheme = "Account";
    public const string Policy = "AccountRequired";
    public const string SessionClaim = "account_session";
    /// <summary>Validade do login; renovada enquanto a pessoa usa (quem entra ao menos a cada 15 dias não precisa logar de novo).</summary>
    public static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);

    public static async Task SignInAsync(HttpContext http, UserAccount user, AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var session = AccountSession.Create(user.Id, now, now + SessionLifetime);
        db.AccountSessions.Add(session);
        await db.SaveChangesAsync(ct);
        var identity = new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Name, user.Username),
            new Claim(SessionClaim, session.Id.ToString()), new Claim("security_stamp", user.SecurityStamp),
        ], Scheme);
        await http.SignInAsync(Scheme, new ClaimsPrincipal(identity), new AuthenticationProperties
        { IsPersistent = true, IssuedUtc = now, ExpiresUtc = session.ExpiresAt });
    }

    public static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var userId = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var sessionId = context.Principal?.FindFirstValue(SessionClaim);
        var stamp = context.Principal?.FindFirstValue("security_stamp");
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var now = context.HttpContext.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow();
        var ct = context.HttpContext.RequestAborted;
        AccountSession? session = null;
        if (Guid.TryParse(userId, out var uid) && Guid.TryParse(sessionId, out var sid))
            session = await db.AccountSessions.SingleOrDefaultAsync(x => x.Id == sid && x.UserId == uid, ct);
        if (session is null || !session.IsValid(now) || !await db.Users.AnyAsync(u => u.Id == uid && u.SecurityStamp == stamp, ct))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(Scheme);
            return;
        }
        if (session.Renew(now, SessionLifetime))
        {
            await db.SaveChangesAsync(ct);
            context.Properties.IssuedUtc = now;
            context.Properties.ExpiresUtc = session.ExpiresAt;
            context.ShouldRenew = true; // o cookie acompanha a nova validade
        }
    }
}
