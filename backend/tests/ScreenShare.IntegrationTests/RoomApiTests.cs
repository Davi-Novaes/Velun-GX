using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ScreenShare.Application.Rooms;
using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.IntegrationTests;

public sealed class RoomApiTests(ApiFactory api)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<Guid> RoomIdAsync(string code)
    {
        await using var scope = api.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Rooms.Where(r => r.Code == code).Select(r => r.Id).SingleAsync(Ct);
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>(Ct);

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(code, (await JsonAsync(response)).GetProperty("code").GetString());
    }

    // ---------- sessão ----------

    [Fact]
    public async Task Session_cookie_is_httponly_samesite_strict_and_scoped_to_api()
    {
        using var client = api.CreateClient();

        var response = await client.PostAsync("/api/v1/sessions", null, Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.StartsWith("ss_session=", cookie, StringComparison.Ordinal);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Creating_session_again_keeps_the_same_guest()
    {
        using var guest = await api.NewGuestAsync();
        var first = (await JsonAsync(await guest.GetAsync("/api/v1/sessions/current", Ct))).GetProperty("guestId").GetGuid();

        var again = await guest.PostAsync("/api/v1/sessions", null, Ct);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(first, (await JsonAsync(again)).GetProperty("guestId").GetGuid());
    }

    [Fact]
    public async Task Tampered_session_cookie_is_rejected()
    {
        using var client = api.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/rooms");
        request.Headers.Add("Cookie", "ss_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged");

        await AssertProblemAsync(await client.SendAsync(request, Ct), HttpStatusCode.Unauthorized, "UNAUTHENTICATED");
    }

    // ---------- criação ----------

    [Fact]
    public async Task Creating_room_requires_session()
    {
        using var anonymous = api.CreateClient();
        await AssertProblemAsync(await anonymous.PostAsync("/api/v1/rooms", null, Ct), HttpStatusCode.Unauthorized, "UNAUTHENTICATED");
    }

    [Fact]
    public async Task Created_room_has_unguessable_code_link_and_limit_of_20()
    {
        using var guest = await api.NewGuestAsync();

        var response = await guest.PostAsync("/api/v1/rooms", null, Ct);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonAsync(response);
        var code = body.GetProperty("code").GetString()!;
        Assert.Matches("^[0-9A-HJKMNP-TV-Z]{8}$", code);
        Assert.Equal($"http://localhost/room/{code}", body.GetProperty("url").GetString());
        Assert.Equal(20, body.GetProperty("maxParticipants").GetInt32());
        Assert.DoesNotContain(await RoomIdAsync(code), api.Sfu.Rooms); // sala no SFU só nasce no primeiro join
    }

    [Fact]
    public async Task Room_creation_is_rate_limited_per_session()
    {
        using var guest = await api.NewGuestAsync();
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Created, (await guest.PostAsync("/api/v1/rooms", null, Ct)).StatusCode);

        var sixth = await guest.PostAsync("/api/v1/rooms", null, Ct);

        await AssertProblemAsync(sixth, HttpStatusCode.TooManyRequests, "RATE_LIMITED");
        Assert.True(sixth.Headers.RetryAfter?.Delta > TimeSpan.Zero);
    }

    [Fact]
    public async Task Cross_origin_post_is_rejected()
    {
        using var guest = await api.NewGuestAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/rooms");
        request.Headers.Add("Origin", "https://evil.example");

        await AssertProblemAsync(await guest.SendAsync(request, Ct), HttpStatusCode.Forbidden, "CROSS_ORIGIN_FORBIDDEN");
    }

    // ---------- consulta ----------

    [Theory]
    [InlineData("ZZZZZZZZ")]
    [InlineData("curto")]
    [InlineData("com espaço e símbolos!")]
    public async Task Unknown_room_is_404(string code)
    {
        using var client = api.CreateClient();
        await AssertProblemAsync(await client.GetAsync($"/api/v1/rooms/{Uri.EscapeDataString(code)}", Ct), HttpStatusCode.NotFound, "ROOM_NOT_FOUND");
    }

    [Fact]
    public async Task Room_code_is_case_and_typo_tolerant()
    {
        using var guest = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(guest);
        var typed = code.ToLowerInvariant().Replace('0', 'o').Replace('1', 'l');

        var response = await guest.GetAsync($"/api/v1/rooms/{typed}", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(code, (await JsonAsync(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Expired_room_is_410()
    {
        using var guest = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(guest);
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var past = api.Clock.GetUtcNow().AddMinutes(-1);
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Rooms.Where(r => r.Code == code)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.ExpiresAt, past), Ct);
        }

        await AssertProblemAsync(await guest.GetAsync($"/api/v1/rooms/{code}", Ct), HttpStatusCode.Gone, "ROOM_EXPIRED");
        await AssertProblemAsync(await ApiFactory.JoinAsync(guest, code), HttpStatusCode.Gone, "ROOM_EXPIRED");
    }

    // ---------- entrada ----------

    [Fact]
    public async Task Join_returns_participant_sfu_token_and_media_policy()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);

        var response = await ApiFactory.JoinAsync(owner, code, "  João   da  Silva ");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonAsync(response);
        var participant = body.GetProperty("participant");
        Assert.Equal("João da Silva", participant.GetProperty("displayName").GetString());
        Assert.Equal("owner", participant.GetProperty("role").GetString());
        Assert.StartsWith("p_", participant.GetProperty("identity").GetString(), StringComparison.Ordinal);
        Assert.StartsWith("fake-token:", body.GetProperty("sfu").GetProperty("token").GetString(), StringComparison.Ordinal);
        var policy = body.GetProperty("policy");
        Assert.Equal(20, policy.GetProperty("maxParticipants").GetInt32());
        Assert.Equal(3, policy.GetProperty("maxConcurrentScreenShares").GetInt32());
        Assert.Equal(["screen_share", "screen_share_audio"], policy.GetProperty("allowedSources").EnumerateArray().Select(e => e.GetString()));
        Assert.Contains(await RoomIdAsync(code), api.Sfu.Rooms);
    }

    [Fact]
    public async Task Other_guest_joins_as_member()
    {
        using var owner = await api.NewGuestAsync();
        using var visitor = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);

        var body = await JsonAsync(await ApiFactory.JoinAsync(visitor, code, "Ana"));

        Assert.Equal("member", body.GetProperty("participant").GetProperty("role").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("​\u0007")]
    [InlineData("123456789012345678901234567890123")]
    public async Task Invalid_display_name_is_422(string name)
    {
        using var guest = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(guest);

        await AssertProblemAsync(await ApiFactory.JoinAsync(guest, code, name), (HttpStatusCode)422, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Join_requires_session()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        using var anonymous = api.CreateClient();

        await AssertProblemAsync(await ApiFactory.JoinAsync(anonymous, code), HttpStatusCode.Unauthorized, "UNAUTHENTICATED");
    }

    [Fact]
    public async Task Twenty_first_participant_gets_room_full()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        var roomId = await RoomIdAsync(code);

        for (var i = 1; i <= 20; i++)
        {
            var joined = await JsonAsync(await ApiFactory.JoinAsync(owner, code, $"Pessoa {i}"));
            if (i % 2 == 0) // metade já "conectou" no SFU, metade ainda está só com a reserva
                api.Sfu.Connect(roomId, joined.GetProperty("participant").GetProperty("identity").GetString()!);
        }

        await AssertProblemAsync(await ApiFactory.JoinAsync(owner, code, "Pessoa 21"), HttpStatusCode.Conflict, "ROOM_FULL");
        var info = await JsonAsync(await owner.GetAsync($"/api/v1/rooms/{code}", Ct));
        Assert.Equal(20, info.GetProperty("participantCount").GetInt32());
        Assert.True(info.GetProperty("isFull").GetBoolean());
    }

    [Fact]
    public async Task Concurrent_joins_never_exceed_the_limit()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        var guests = await Task.WhenAll(Enumerable.Range(0, 25).Select(_ => api.NewGuestAsync()));

        var responses = await Task.WhenAll(guests.Select((g, i) => ApiFactory.JoinAsync(g, code, $"Pessoa {i}")));

        Assert.Equal(20, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(5, responses.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        foreach (var g in guests)
            g.Dispose();
    }

    [Fact]
    public async Task Reserved_slot_is_released_after_60s_without_connecting()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        for (var i = 0; i < 20; i++)
            await ApiFactory.JoinAsync(owner, code, $"P{i}");
        await AssertProblemAsync(await ApiFactory.JoinAsync(owner, code, "P21"), HttpStatusCode.Conflict, "ROOM_FULL");

        api.Clock.Advance(Participant.ReservationTtl + TimeSpan.FromSeconds(1));

        Assert.Equal(HttpStatusCode.OK, (await ApiFactory.JoinAsync(owner, code, "P21")).StatusCode);
    }

    [Fact]
    public async Task Rejoin_with_same_participant_reuses_the_slot()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        var roomId = await RoomIdAsync(code);
        JsonElement first = default;
        for (var i = 0; i < 20; i++)
        {
            var joined = await JsonAsync(await ApiFactory.JoinAsync(owner, code, $"P{i}"));
            api.Sfu.Connect(roomId, joined.GetProperty("participant").GetProperty("identity").GetString()!);
            if (i == 0)
                first = joined.GetProperty("participant");
        }

        var rejoin = await ApiFactory.JoinAsync(owner, code, "P0 de volta", first.GetProperty("id").GetGuid());

        Assert.Equal(HttpStatusCode.OK, rejoin.StatusCode);
        var participant = (await JsonAsync(rejoin)).GetProperty("participant");
        Assert.Equal(first.GetProperty("identity").GetString(), participant.GetProperty("identity").GetString());
        Assert.Equal("P0 de volta", participant.GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task Rejoin_with_participant_of_another_guest_is_forbidden()
    {
        using var owner = await api.NewGuestAsync();
        using var attacker = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        var victim = (await JsonAsync(await ApiFactory.JoinAsync(owner, code))).GetProperty("participant").GetProperty("id").GetGuid();

        await AssertProblemAsync(await ApiFactory.JoinAsync(attacker, code, "Eve", victim), HttpStatusCode.Forbidden, "FORBIDDEN");
    }

    [Fact]
    public async Task Sfu_down_returns_503_without_issuing_token()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        api.Sfu.Healthy = false;
        try
        {
            await AssertProblemAsync(await ApiFactory.JoinAsync(owner, code), HttpStatusCode.ServiceUnavailable, "SFU_UNAVAILABLE");
        }
        finally
        {
            api.Sfu.Healthy = true;
        }
    }

    // ---------- saída e manutenção ----------

    [Fact]
    public async Task Leave_before_connecting_releases_the_reservation()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        var participantId = (await JsonAsync(await ApiFactory.JoinAsync(owner, code))).GetProperty("participant").GetProperty("id").GetGuid();

        var leave = await owner.PostAsJsonAsync($"/api/v1/rooms/{code}/leave", new { participantId }, Ct);

        Assert.Equal(HttpStatusCode.NoContent, leave.StatusCode);
        Assert.Equal(0, (await JsonAsync(await owner.GetAsync($"/api/v1/rooms/{code}", Ct))).GetProperty("participantCount").GetInt32());
    }

    [Fact]
    public async Task Maintenance_expires_inactive_rooms_and_clears_ghost_reservations()
    {
        using var owner = await api.NewGuestAsync();
        var code = await ApiFactory.CreateRoomAsync(owner);
        var participantId = (await JsonAsync(await ApiFactory.JoinAsync(owner, code))).GetProperty("participant").GetProperty("id").GetGuid();

        api.Clock.Advance(TimeSpan.FromHours(25));
        await using (var scope = api.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<RoomMaintenance>().RunAsync(Ct);

        await using var check = api.Services.CreateAsyncScope();
        var db = check.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(RoomStatus.Expired, (await db.Rooms.SingleAsync(r => r.Code == code, Ct)).Status);
        var participant = await db.Participants.SingleAsync(p => p.Id == participantId, Ct);
        Assert.Equal(ParticipantStatus.Disconnected, participant.Status);
        Assert.Equal("never_connected", participant.LeaveReason);
    }
}
