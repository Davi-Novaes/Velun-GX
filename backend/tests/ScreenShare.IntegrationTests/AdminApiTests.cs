using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ScreenShare.IntegrationTests;

public sealed class AdminApiTests(ApiFactory api)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private const string Password = "senha-teste-segura-2026";

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string path, object body)
    {
        var token = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/csrf", Ct);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1" + path) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-CSRF-Token", token.GetProperty("token").GetString());
        return await client.SendAsync(request, Ct);
    }

    [Fact]
    public async Task Panel_has_its_own_login_separate_from_site_accounts()
    {
        // uma conta comum do site, mesmo com o mesmo nome do administrador, não abre o painel
        using var account = api.CreateClient();
        var name = "a" + Guid.NewGuid().ToString("N")[..20];
        using (var r = await PostAsync(account, "/auth/register", new { username = name, password = Password, confirmPassword = Password })) Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        using (await PostAsync(account, "/servers", new { name = "Servidor do painel" })) { }
        Assert.Equal(HttpStatusCode.Unauthorized, (await account.GetAsync("/api/v1/admin/overview", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await account.GetAsync("/api/v1/admin/me", Ct)).StatusCode);
        Assert.False((await account.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct)).TryGetProperty("isAdmin", out _));

        using var admin = api.CreateClient();
        using (var wrong = await PostAsync(admin, "/admin/login", new { username = ApiFactory.AdminUsername, password = "senha-errada-123" }))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
            Assert.Equal("INVALID_CREDENTIALS", (await wrong.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("code").GetString());
        }
        using (var wrongUser = await PostAsync(admin, "/admin/login", new { username = name, password = ApiFactory.AdminPassword }))
            Assert.Equal(HttpStatusCode.Unauthorized, wrongUser.StatusCode);
        using (var ok = await PostAsync(admin, "/admin/login", new { username = "CHEFE", password = ApiFactory.AdminPassword }))
        {
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
            var cookie = ok.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("ss_admin=", StringComparison.Ordinal));
            Assert.Contains("path=/api/v1/admin", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        }
        // o login de painel não é uma conta do site
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        Assert.Equal(ApiFactory.AdminUsername, (await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/me", Ct)).GetProperty("username").GetString());

        var overview = await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/overview", Ct);
        var listed = overview.GetProperty("users").EnumerateArray().Single(u => u.GetProperty("username").GetString() == name);
        Assert.Contains("Servidor do painel", listed.GetProperty("servers").EnumerateArray().Select(s => s.GetString()));
        Assert.Equal(1, listed.GetProperty("sessions").GetInt32());
        Assert.False(listed.TryGetProperty("passwordHash", out _));
        Assert.False(listed.TryGetProperty("guestId", out _));
        Assert.Contains(overview.GetProperty("servers").EnumerateArray(), s => s.GetProperty("name").GetString() == "Servidor do painel" && s.GetProperty("members").GetInt32() == 1);

        using (var bye = await PostAsync(admin, "/admin/logout", new { })) Assert.Equal(HttpStatusCode.NoContent, bye.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/api/v1/admin/overview", Ct)).StatusCode);
    }

    [Fact]
    public async Task Login_without_csrf_is_rejected()
    {
        using var client = api.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/v1/admin/login", new { username = ApiFactory.AdminUsername, password = ApiFactory.AdminPassword }, Ct);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Ban_logs_the_account_out_everywhere_blocks_login_and_unban_restores_it()
    {
        using var victim = api.CreateClient();
        var name = "b" + Guid.NewGuid().ToString("N")[..20];
        using (var r = await PostAsync(victim, "/auth/register", new { username = name, password = Password, confirmPassword = Password })) Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        using var secondDevice = api.CreateClient();
        using (var r = await PostAsync(secondDevice, "/auth/login", new { username = name, password = Password })) Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        using var admin = api.CreateClient();
        using (var r = await PostAsync(admin, "/admin/login", new { username = ApiFactory.AdminUsername, password = ApiFactory.AdminPassword })) Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var id = (await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/overview", Ct)).GetProperty("users").EnumerateArray()
            .Single(u => u.GetProperty("username").GetString() == name).GetProperty("id").GetString();

        // conta do site não consegue banir ninguém
        using (var r = await PostAsync(victim, $"/admin/users/{id}/ban", new { reason = "x" })) Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        using (var r = await PostAsync(admin, $"/admin/users/{id}/ban", new { reason = new string('x', 201) })) Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        using (var r = await PostAsync(admin, $"/admin/users/{id}/ban", new { reason = "Spam no canal" })) Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);

        // os dois logins abertos caem na hora
        Assert.Equal(HttpStatusCode.Unauthorized, (await victim.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await secondDevice.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        using (var r = await PostAsync(victim, "/auth/login", new { username = name, password = Password }))
        {
            Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
            var problem = await r.Content.ReadFromJsonAsync<JsonElement>(Ct);
            Assert.Equal("ACCOUNT_BANNED", problem.GetProperty("code").GetString());
            Assert.Contains("Spam no canal", problem.GetProperty("detail").GetString());
        }
        // senha errada continua sendo só "senha incorreta" (não revela que a conta existe e está banida)
        using (var r = await PostAsync(victim, "/auth/login", new { username = name, password = "outra-senha-qualquer" })) Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);

        var overview = await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/overview", Ct);
        var listed = overview.GetProperty("users").EnumerateArray().Single(u => u.GetProperty("id").GetString() == id);
        Assert.Equal(JsonValueKind.String, listed.GetProperty("bannedAt").ValueKind);
        Assert.Equal("Spam no canal", listed.GetProperty("banReason").GetString());
        Assert.Equal(0, listed.GetProperty("sessions").GetInt32());
        Assert.True(overview.GetProperty("totals").GetProperty("banned").GetInt32() >= 1);

        using (var r = await PostAsync(admin, $"/admin/users/{id}/unban", new { })) Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        using (var r = await PostAsync(victim, "/auth/login", new { username = name, password = Password })) Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await victim.GetAsync("/api/v1/auth/me", Ct)).StatusCode);
        using (var r = await PostAsync(admin, $"/admin/users/{Guid.NewGuid()}/ban", new { })) Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public void Viewer_reports_are_read_safely_and_only_for_streams_in_the_room()
    {
        var names = new Dictionary<string, string> { ["p_bifas"] = "bifas", ["p_bolas"] = "bolas" };
        var list = ScreenShare.Api.Endpoints.AdminEndpoints.ReadReceiving("""{"p_bifas":{"f":57,"z":2,"l":0.3},"p_saiu":{"f":60},"p_bolas":{"f":-5,"z":"x"}}""", names);
        Assert.Equal(2, list.Count);
        Assert.Equal(new ScreenShare.Api.Endpoints.AdminEndpoints.ReceiveView("bifas", 57, 2, 0.3), list[0]);
        Assert.Equal(new ScreenShare.Api.Endpoints.AdminEndpoints.ReceiveView("bolas", null, null, null), list[1]);
        Assert.Empty(ScreenShare.Api.Endpoints.AdminEndpoints.ReadReceiving("não é json", names));
        Assert.Empty(ScreenShare.Api.Endpoints.AdminEndpoints.ReadReceiving(null, names));
        Assert.Equal("App Velun Gx 0.2.9 · Windows", ScreenShare.Api.Endpoints.AdminEndpoints.DescribeClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) velun-gx/0.2.9 Chrome/142.0 Electron/39.0 Safari/537.36"));
        Assert.Equal("Chrome · Android", ScreenShare.Api.Endpoints.AdminEndpoints.DescribeClient("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36"));
    }

    [Fact]
    public async Task User_changes_own_password_and_other_devices_are_logged_out()
    {
        using var pc = api.CreateClient();
        var name = "s" + Guid.NewGuid().ToString("N")[..20];
        using (var r = await PostAsync(pc, "/auth/register", new { username = name, password = Password, confirmPassword = Password })) Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        using var phone = api.CreateClient();
        using (var r = await PostAsync(phone, "/auth/login", new { username = name, password = Password })) Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        using (var r = await PostAsync(pc, "/auth/password", new { currentPassword = "senha-errada-123", newPassword = "senha-nova-segura-2026", confirmPassword = "senha-nova-segura-2026" }))
        {
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
            Assert.Equal("INVALID_CURRENT_PASSWORD", (await r.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("code").GetString());
        }
        using (var r = await PostAsync(pc, "/auth/password", new { currentPassword = Password, newPassword = "senha-nova-segura-2026", confirmPassword = "outra-coisa-2026" })) Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        using (var r = await PostAsync(pc, "/auth/password", new { currentPassword = Password, newPassword = "curta", confirmPassword = "curta" })) Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        using (var r = await PostAsync(pc, "/auth/password", new { currentPassword = Password, newPassword = "senha-nova-segura-2026", confirmPassword = "senha-nova-segura-2026" })) Assert.Equal(HttpStatusCode.OK, r.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await pc.GetAsync("/api/v1/auth/me", Ct)).StatusCode);       // quem trocou continua dentro
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/v1/auth/me", Ct)).StatusCode); // os outros saem
        using var fresh = api.CreateClient();
        using (var r = await PostAsync(fresh, "/auth/login", new { username = name, password = Password })) Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        using (var r = await PostAsync(fresh, "/auth/login", new { username = name, password = "senha-nova-segura-2026" })) Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Admin_sets_a_password_and_the_person_must_choose_their_own_on_next_login()
    {
        using var person = api.CreateClient();
        var name = "e" + Guid.NewGuid().ToString("N")[..20];
        using (var r = await PostAsync(person, "/auth/register", new { username = name, password = Password, confirmPassword = Password })) Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        using var admin = api.CreateClient();
        using (var r = await PostAsync(admin, "/admin/login", new { username = ApiFactory.AdminUsername, password = ApiFactory.AdminPassword })) Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var id = (await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/overview", Ct)).GetProperty("users").EnumerateArray()
            .Single(u => u.GetProperty("username").GetString() == name).GetProperty("id").GetString();

        using (var r = await PostAsync(person, $"/admin/users/{id}/password", new { password = "tomada-de-conta-1" })) Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        using (var r = await PostAsync(admin, $"/admin/users/{id}/password", new { password = "curta" })) Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        using (var r = await PostAsync(admin, $"/admin/users/{id}/password", new { password = "provisoria-2026", mustChange = true })) Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await person.GetAsync("/api/v1/auth/me", Ct)).StatusCode);

        using (var r = await PostAsync(person, "/auth/login", new { username = name, password = Password })) Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
        using (var r = await PostAsync(person, "/auth/login", new { username = name, password = "provisoria-2026" }))
        {
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            Assert.True((await r.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("mustChangePassword").GetBoolean());
        }
        Assert.True((await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/overview", Ct)).GetProperty("users").EnumerateArray()
            .Single(u => u.GetProperty("id").GetString() == id).GetProperty("mustChangePassword").GetBoolean());
        using (var r = await PostAsync(person, "/auth/password", new { currentPassword = "provisoria-2026", newPassword = "minha-senha-nova-2026", confirmPassword = "minha-senha-nova-2026" }))
        {
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            Assert.False((await r.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("mustChangePassword").GetBoolean());
        }
        using (var r = await PostAsync(admin, $"/admin/users/{Guid.NewGuid()}/password", new { password = "provisoria-2026" })) Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}
