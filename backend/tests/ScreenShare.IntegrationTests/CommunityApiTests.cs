using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.IntegrationTests;

public sealed class CommunityApiTests(ApiFactory api)
{
    [Fact]
    public async Task Custom_roles_enforce_hierarchy_scope_and_delegated_permissions()
    {
        using var owner = await Account(); using var moderator = await Account(); using var member = await Account(); using var equal = await Account();
        var (server, channel) = await Create(owner);
        await JoinServer(owner, moderator, server); await JoinServer(owner, member, server); await JoinServer(owner, equal, server);
        var moderatorId = (await moderator.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct)).GetProperty("id").GetString()!;
        var memberId = (await member.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct)).GetProperty("id").GetString()!;
        var equalId = (await equal.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct)).GetProperty("id").GetString()!;
        var role = await Json(await Send(owner, $"/servers/{server}/roles", new { name = "Moderador", color = "#ab87ef", position = 50, permissions = 63 }));
        var roleId = role.GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}/members/{moderatorId}/role", new { roleId }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}/members/{equalId}/role", new { roleId }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member, $"/servers/{server}/roles", new { name = "Admin", color = "#ffffff", position = 99, permissions = 127 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(moderator, $"/servers/{server}/roles", new { name = "Acima", color = "#ffffff", position = 50, permissions = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(moderator, $"/servers/{server}/roles", new { name = "Escalada", color = "#ffffff", position = 10, permissions = 64 })).StatusCode);
        var lower = await Json(await Send(moderator, $"/servers/{server}/roles", new { name = "Ajudante", color = "#ffffff", position = 10, permissions = 4 }));
        var lowerId = lower.GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await Send(moderator, $"/servers/{server}/members/{memberId}/role", new { roleId = lowerId }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(moderator, $"/servers/{server}/members/{moderatorId}/role", new { roleId = lowerId }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(moderator, $"/servers/{server}/members/{equalId}", method: "DELETE")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member, $"/channels/{channel}", new { name = "Sem acesso" }, "PATCH")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(moderator, $"/channels/{channel}", new { name = "Jogos" }, "PATCH")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(moderator, $"/servers/{server}/invites", new { })).StatusCode);
        var (otherServer, _) = await Create(owner);
        var foreign = await Json(await Send(owner, $"/servers/{otherServer}/roles", new { name = "Outro", color = "#ffffff", position = 5, permissions = 0 }));
        Assert.Equal(HttpStatusCode.NotFound, (await Send(owner, $"/servers/{server}/members/{memberId}/role", new { roleId = foreign.GetProperty("id").GetString() }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}/roles/{lowerId}", method: "DELETE")).StatusCode);
        var members = (await owner.GetFromJsonAsync<JsonElement>($"/api/v1/servers/{server}", Ct)).GetProperty("members");
        Assert.Equal(JsonValueKind.Null, members.EnumerateArray().Single(m => m.GetProperty("id").GetString() == memberId).GetProperty("serverRoleId").ValueKind);
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static async Task<HttpResponseMessage> Send(HttpClient client, string path, object? body = null, string method = "POST")
    {
        var csrf = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/csrf", Ct);
        using var request = new HttpRequestMessage(new HttpMethod(method), "/api/v1" + path) { Content = body is null ? null : JsonContent.Create(body) };
        request.Headers.Add("X-CSRF-Token", csrf.GetProperty("token").GetString());
        return await client.SendAsync(request, Ct);
    }
    private async Task<HttpClient> Account()
    {
        var client = api.CreateClient();
        var username = "c" + Guid.NewGuid().ToString("N")[..20];
        var response = await Send(client, "/auth/register", new { username, password = "senha-segura-comunidade-2026", confirmPassword = "senha-segura-comunidade-2026" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return client;
    }
    private static async Task<JsonElement> Json(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    { Assert.Equal(expected, response.StatusCode); return await response.Content.ReadFromJsonAsync<JsonElement>(Ct); }
    private static async Task<(string Server, string Channel)> Create(HttpClient owner)
    {
        var server = (await Json(await Send(owner, "/servers", new { name = "Amigos" }))).GetProperty("id").GetString()!;
        var details = await owner.GetFromJsonAsync<JsonElement>($"/api/v1/servers/{server}", Ct);
        return (server, details.GetProperty("channels")[0].GetProperty("id").GetString()!);
    }
    private static async Task JoinServer(HttpClient owner, HttpClient member, string server)
    {
        var invite = await Json(await Send(owner, $"/servers/{server}/invites", new { maxUses = (int?)null }));
        Assert.Equal(HttpStatusCode.OK, (await Send(member, $"/invites/{invite.GetProperty("code").GetString()}/accept")).StatusCode);
    }

    [Fact]
    public async Task Server_membership_is_persistent_and_privileged_mutations_are_owner_only()
    {
        using var owner = await Account(); using var member = await Account(); using var outsider = await Account();
        var (server, _) = await Create(owner);
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.GetAsync($"/api/v1/servers/{server}", Ct)).StatusCode);
        await JoinServer(owner, member, server);
        var list = await member.GetFromJsonAsync<JsonElement>("/api/v1/servers", Ct);
        Assert.Single(list.EnumerateArray());
        Assert.Equal("member", list[0].GetProperty("role").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member, $"/servers/{server}", new { name = "Invadido" }, "PATCH")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member, $"/servers/{server}/channels", new { name = "Invadido" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(member, $"/servers/{server}/invites", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(owner, $"/servers/{server}/leave")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(member, $"/servers/{server}/leave")).StatusCode);
        Assert.Empty((await member.GetFromJsonAsync<JsonElement>("/api/v1/servers", Ct)).EnumerateArray());
    }

    [Fact]
    public async Task Channels_rename_reorder_delete_and_server_soft_delete_reject_access()
    {
        using var owner = await Account(); var (server, channel) = await Create(owner);
        var second = (await Json(await Send(owner, $"/servers/{server}/channels", new { name = "Jogos" }))).GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/channels/{second}", new { name = "Games" }, "PATCH")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(owner, $"/servers/{server}/channels/order", new { ids = new[] { second, second } }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}/channels/order", new { ids = new[] { second, channel } }, "PUT")).StatusCode);
        var details = await owner.GetFromJsonAsync<JsonElement>($"/api/v1/servers/{server}", Ct);
        Assert.Equal("Games", details.GetProperty("channels")[0].GetProperty("name").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/channels/{second}", method: "DELETE")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(owner, $"/channels/{second}/join")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}", method: "DELETE")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/v1/servers/{server}", Ct)).StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<JsonElement>("/api/v1/servers", Ct)).EnumerateArray());
    }

    [Fact]
    public async Task Invites_are_hashed_limited_revocable_and_idempotent()
    {
        using var owner = await Account(); using var member = await Account(); using var other = await Account();
        var (server, _) = await Create(owner);
        var invite = await Json(await Send(owner, $"/servers/{server}/invites", new { maxUses = 1 }));
        var code = invite.GetProperty("code").GetString()!;
        await using var scope = api.Services.CreateAsyncScope();
        var stored = await scope.ServiceProvider.GetRequiredService<AppDbContext>().ServerInvites.SingleAsync(x => x.Id == invite.GetProperty("id").GetGuid(), Ct);
        Assert.NotEqual(code, stored.CodeHash);
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync($"/api/v1/invites/{code}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(member, $"/invites/{code}/accept")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(member, $"/invites/{code}/accept")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await Send(other, $"/invites/{code}/accept")).StatusCode);
        var revoke = await Json(await Send(owner, $"/servers/{server}/invites", new { }));
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}/invites/{revoke.GetProperty("id").GetString()}", method: "DELETE")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await Send(other, $"/invites/{revoke.GetProperty("code").GetString()}/accept")).StatusCode);
    }

    [Fact]
    public async Task Nickname_is_what_others_see_while_login_keeps_the_username()
    {
        using var owner = await Account(); using var member = await Account();
        var (server, channel) = await Create(owner);
        await JoinServer(owner, member, server);
        var username = (await member.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct)).GetProperty("username").GetString()!;

        // sem CSRF não muda; apelido inválido é recusado
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PatchAsJsonAsync("/api/v1/auth/me", new { nickname = "Sem token" }, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(member, "/auth/me", new { nickname = new string('x', 33) }, "PATCH")).StatusCode);

        var profile = await Json(await Send(member, "/auth/me", new { nickname = "  Neguin  🎮 " }, "PATCH"));
        Assert.Equal("Neguin 🎮", profile.GetProperty("nickname").GetString());
        Assert.Equal("Neguin 🎮", profile.GetProperty("name").GetString());
        Assert.Equal(username, profile.GetProperty("username").GetString());

        var members = (await owner.GetFromJsonAsync<JsonElement>($"/api/v1/servers/{server}", Ct)).GetProperty("members").EnumerateArray();
        Assert.Contains(members, m => m.GetProperty("name").GetString() == "Neguin 🎮" && m.GetProperty("username").GetString() == username);
        var joined = await Json(await Send(member, $"/channels/{channel}/join"));
        Assert.Equal("Neguin 🎮", joined.GetProperty("participant").GetProperty("displayName").GetString());

        // vazio volta ao nome de usuário
        var cleared = await Json(await Send(member, "/auth/me", new { nickname = "" }, "PATCH"));
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("nickname").ValueKind);
        Assert.Equal(username, cleared.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Join_uses_account_identity_and_switch_removes_previous_media_connection()
    {
        using var owner = await Account(); var (server, channel) = await Create(owner);
        var joined = await Json(await Send(owner, $"/channels/{channel}/join"));
        Assert.Equal(4, joined.GetProperty("policy").GetProperty("maxConcurrentScreenShares").GetInt32());
        Assert.True(joined.GetProperty("policy").GetProperty("audio").GetProperty("enabled").GetBoolean());
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var roomId = (await db.Channels.SingleAsync(c => c.Id == Guid.Parse(channel), Ct)).MediaRoomId!.Value;
        var identity = joined.GetProperty("participant").GetProperty("identity").GetString()!;
        api.Sfu.Connect(roomId, identity);
        var presence = await owner.GetFromJsonAsync<JsonElement>($"/api/v1/servers/{server}/presence", Ct);
        Assert.Single(presence[0].GetProperty("participants").EnumerateArray());
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/channels/{channel}/broadcast", new { enabled = true })).StatusCode);
        var second = (await Json(await Send(owner, $"/servers/{server}/channels", new { name = "Segundo" }))).GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await Send(owner, $"/channels/{second}/join")).StatusCode);
        Assert.Empty(await api.Sfu.ListParticipantsAsync(roomId, Ct));
        using var guest = await api.NewGuestAsync();
        var room = await db.Rooms.SingleAsync(r => r.Id == roomId, Ct);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync($"/api/v1/rooms/{room.Code}", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ApiFactory.JoinAsync(guest, room.Code)).StatusCode);
    }

    [Fact]
    public async Task Broadcast_authorization_has_atomic_limit_of_four()
    {
        using var owner = await Account(); var (server, channel) = await Create(owner);
        var clients = new List<HttpClient> { owner };
        try
        {
            for (var i = 0; i < 4; i++) { var member = await Account(); clients.Add(member); await JoinServer(owner, member, server); }
            await using var scope = api.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            foreach (var client in clients)
            {
                var joined = await Json(await Send(client, $"/channels/{channel}/join"));
                var roomId = await db.Channels.Where(c => c.Id == Guid.Parse(channel)).Select(c => c.MediaRoomId!.Value).SingleAsync(Ct);
                api.Sfu.Connect(roomId, joined.GetProperty("participant").GetProperty("identity").GetString()!);
            }
            var results = await Task.WhenAll(clients.Select(client => Send(client, $"/channels/{channel}/broadcast", new { enabled = true })));
            Assert.Equal(4, results.Count(r => r.StatusCode == HttpStatusCode.NoContent));
            Assert.Single(results, r => r.StatusCode == HttpStatusCode.Conflict);
            var grantedIndex = Array.FindIndex(results, r => r.StatusCode == HttpStatusCode.NoContent);
            var deniedIndex = Array.FindIndex(results, r => r.StatusCode == HttpStatusCode.Conflict);
            Assert.Equal(HttpStatusCode.NoContent, (await Send(clients[grantedIndex], $"/channels/{channel}/broadcast", new { enabled = false })).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await Send(clients[deniedIndex], $"/channels/{channel}/broadcast", new { enabled = true })).StatusCode);
        }
        finally { foreach (var client in clients.Skip(1)) client.Dispose(); }
    }

    [Fact]
    public async Task Guest_and_missing_csrf_cannot_mutate_communities()
    {
        using var guest = await api.NewGuestAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync("/api/v1/servers", Ct)).StatusCode);
        using var owner = await Account();
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsJsonAsync("/api/v1/servers", new { name = "Sem CSRF" }, Ct)).StatusCode);
    }

    [Fact]
    public async Task Channel_caps_twenty_users_and_refresh_reuses_reservation()
    {
        using var owner = await Account(); var (_, channel) = await Create(owner);
        var clients = new List<HttpClient>();
        try
        {
            var first = await Json(await Send(owner, $"/channels/{channel}/join"));
            for (var i = 0; i < 20; i++)
            {
                var client = await Account(); clients.Add(client);
                // Usa a associação do servidor, sem inventar autorização só porque conhece o channelId.
                await using var scope = api.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var serverId = await db.Channels.Where(c => c.Id == Guid.Parse(channel)).Select(c => c.ServerId).SingleAsync(Ct);
                await JoinServer(owner, client, serverId.ToString());
                var result = await Send(client, $"/channels/{channel}/join");
                Assert.Equal(i < 19 ? HttpStatusCode.OK : HttpStatusCode.Conflict, result.StatusCode);
            }
            var refresh = await Json(await Send(owner, $"/channels/{channel}/join"));
            Assert.Equal(first.GetProperty("participant").GetProperty("id").GetGuid(), refresh.GetProperty("participant").GetProperty("id").GetGuid());
        }
        finally { foreach (var client in clients) client.Dispose(); }
    }

    [Fact]
    public async Task Server_icons_are_persistent_validated_and_owner_only()
    {
        using var owner = await Account(); using var other = await Account(); var (server, _) = await Create(owner);
        const string png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6S9sAAAAASUVORK5CYII=";
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}/icon", new { icon = png }, "PUT")).StatusCode);
        var details = await owner.GetFromJsonAsync<JsonElement>($"/api/v1/servers/{server}", Ct);
        Assert.Equal(png, details.GetProperty("icon").GetString());
        await JoinServer(owner, other, server);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(other, $"/servers/{server}/icon", new { icon = png }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(owner, $"/servers/{server}/icon", new { icon = "data:image/svg+xml,<svg/>" }, "PUT")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(owner, $"/servers/{server}/icon", new { icon = (string?)null }, "PUT")).StatusCode);
    }
}
