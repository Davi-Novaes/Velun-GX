using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ScreenShare.Domain.Accounts;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.IntegrationTests;

public sealed class AccountApiTests(ApiFactory api)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private const string Password = "senha-teste-segura-2026";
    private static string Username() => "u" + Guid.NewGuid().ToString("N")[..20];

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string path, object body)
    {
        var token = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/csrf", Ct);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/" + path) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-CSRF-Token", token.GetProperty("token").GetString());
        return await client.SendAsync(request, Ct);
    }

    [Fact]
    public async Task Register_hashes_password_and_cookie_restores_account()
    {
        using var client = api.CreateClient();
        var name = Username();
        using var response = await PostAsync(client, "register", new { username = name, password = Password, confirmPassword = Password });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var cookie = response.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("ss_account=", StringComparison.Ordinal));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("expires=", cookie, StringComparison.OrdinalIgnoreCase);
        var profile = await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
        Assert.False(profile.TryGetProperty("passwordHash", out _));
        Assert.False(profile.TryGetProperty("guestId", out _));
        var me = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct);
        Assert.Equal(name, me.GetProperty("username").GetString());
        using var secondBrowser = api.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await secondBrowser.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(x => x.Username == name, Ct);
        Assert.NotEqual(Password, user.PasswordHash);
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<UserAccount>>();
        Assert.NotEqual(PasswordVerificationResult.Failed, hasher.VerifyHashedPassword(user, user.PasswordHash, Password));
        Assert.Single(await db.AccountSessions.Where(x => x.UserId == user.Id).ToListAsync(Ct));
    }

    [Fact]
    public async Task Session_in_use_renews_itself_and_unused_session_expires()
    {
        using var active = api.CreateClient();
        using var idle = api.CreateClient();
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(active, "register", new { username = Username(), password = Password, confirmPassword = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(idle, "register", new { username = Username(), password = Password, confirmPassword = Password })).StatusCode);

        // passada metade dos 30 dias, usar o app renova o login (e o cookie)
        api.Clock.Advance(TimeSpan.FromDays(20));
        using (var renewed = await active.GetAsync("/api/v1/auth/me", Ct))
        {
            Assert.Equal(HttpStatusCode.OK, renewed.StatusCode);
            Assert.Contains(renewed.Headers.GetValues("Set-Cookie"), x => x.StartsWith("ss_account=", StringComparison.Ordinal));
        }

        // 35 dias depois do login: quem usou continua entrando; quem não usou precisa entrar de novo
        api.Clock.Advance(TimeSpan.FromDays(15));
        Assert.Equal(HttpStatusCode.OK, (await active.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await idle.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
    }

    [Fact]
    public async Task Login_is_case_insensitive_and_logout_invalidates_replayed_cookie_only()
    {
        using var client = api.CreateClient();
        using var other = api.CreateClient();
        var name = Username();
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(client, "register", new { username = name, password = Password, confirmPassword = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(other, "login", new { username = name.ToUpperInvariant(), password = Password })).StatusCode);
        using var login = await PostAsync(client, "login", new { username = name, password = Password });
        var savedCookie = login.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("ss_account=", StringComparison.Ordinal)).Split(';')[0];
        Assert.Equal(HttpStatusCode.NoContent, (await PostAsync(client, "logout", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        using var replay = api.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { HandleCookies = false });
        replay.DefaultRequestHeaders.Add("Cookie", savedCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await replay.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
    }

    [Fact]
    public async Task Invalid_credentials_duplicate_and_mismatched_passwords_are_rejected()
    {
        using var client = api.CreateClient();
        var name = Username();
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "register", new { username = name, password = Password, confirmPassword = "different" })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostAsync(client, "register", new { username = name, password = Password, confirmPassword = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await PostAsync(client, "register", new { username = name.ToUpperInvariant(), password = Password, confirmPassword = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "login", new { username = name, password = "wrong-password" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "login", new { username = Username(), password = Password })).StatusCode);
    }

    [Fact]
    public async Task Csrf_cross_origin_and_guest_bypass_are_rejected()
    {
        using var guest = await api.NewGuestAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        var body = new { username = Username(), password = Password };
        Assert.Equal(HttpStatusCode.Forbidden, (await guest.PostAsJsonAsync("/api/v1/auth/login", body, Ct)).StatusCode);
        guest.DefaultRequestHeaders.Add("Origin", "http://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await PostAsync(guest, "login", body)).StatusCode);
    }

    [Fact]
    public async Task Expired_session_is_rejected_by_database_even_with_valid_cookie()
    {
        using var client = api.CreateClient();
        var name = Username();
        await PostAsync(client, "register", new { username = name, password = Password, confirmPassword = Password });
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = await db.Users.Where(x => x.Username == name).Select(x => x.Id).SingleAsync(Ct);
        await db.AccountSessions.Where(x => x.UserId == userId).ExecuteUpdateAsync(x => x.SetProperty(s => s.ExpiresAt, api.Clock.GetUtcNow().AddDays(-1)), Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
    }

    [Fact]
    public async Task Changing_password_stamp_invalidates_existing_sessions()
    {
        using var client = api.CreateClient();
        var name = Username();
        await PostAsync(client, "register", new { username = name, password = Password, confirmPassword = Password });
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(x => x.Username == name, Ct);
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<UserAccount>>();
        user.ReplacePasswordHash(hasher.HashPassword(user, "nova-senha-segura-2026"));
        await db.SaveChangesAsync(Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
    }

    [Fact]
    public async Task Repeated_login_attempts_are_limited_per_account()
    {
        using var client = api.CreateClient();
        var name = Username();
        for (var attempt = 0; attempt < 20; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "login", new { username = name, password = Password })).StatusCode);
        using var blocked = await PostAsync(client, "login", new { username = name.ToUpperInvariant(), password = Password });
        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
        Assert.True(blocked.Headers.Contains("Retry-After"));
    }
}
