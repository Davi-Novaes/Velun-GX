using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ScreenShare.StackTests;

/// <summary>Critério de saída da Fase 2 contra a stack real (Traefik → backend → Postgres/Redis/LiveKit).</summary>
public sealed class Phase2StackTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static HttpClient NewBrowser() =>
        new(new HttpClientHandler { CookieContainer = new CookieContainer(), UseCookies = true })
        {
            BaseAddress = new Uri(Stack.ProxyUrl),
            Timeout = TimeSpan.FromSeconds(15),
        };

    [Fact]
    public async Task Spa_is_served_for_room_links()
    {
        Stack.SkipUnlessEnabled();
        using var browser = NewBrowser();

        foreach (var path in new[] { "/", "/room/K7F3QX9M", "/s/K7F3QX9M" })
        {
            var html = await browser.GetStringAsync(path, Ct);
            Assert.Contains("<div id=\"root\"></div>", html, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Twenty_join_and_the_twenty_first_is_told_the_room_is_full()
    {
        Stack.SkipUnlessEnabled();
        using var browser = NewBrowser();
        Assert.Equal(HttpStatusCode.Created, (await browser.PostAsync("/api/v1/sessions", null, Ct)).StatusCode);

        var created = await browser.PostAsync("/api/v1/rooms", null, Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var code = (await created.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("code").GetString()!;

        for (var i = 1; i <= 20; i++)
        {
            var join = await browser.PostAsJsonAsync($"/api/v1/rooms/{code}/join", new { displayName = $"Pessoa {i}" }, Ct);
            Assert.True(join.StatusCode == HttpStatusCode.OK, $"join {i}: {(int)join.StatusCode} {await join.Content.ReadAsStringAsync(Ct)}");
        }

        var full = await browser.PostAsJsonAsync($"/api/v1/rooms/{code}/join", new { displayName = "Pessoa 21" }, Ct);
        Assert.Equal(HttpStatusCode.Conflict, full.StatusCode);
        Assert.Equal("ROOM_FULL", (await full.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("code").GetString());

        var info = await browser.GetFromJsonAsync<JsonElement>($"/api/v1/rooms/{code}", Ct);
        Assert.True(info.GetProperty("isFull").GetBoolean());
    }

    [Fact]
    public async Task Join_token_is_accepted_by_the_real_sfu()
    {
        Stack.SkipUnlessEnabled();
        using var browser = NewBrowser();
        await browser.PostAsync("/api/v1/sessions", null, Ct);
        var code = (await (await browser.PostAsync("/api/v1/rooms", null, Ct)).Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("code").GetString()!;

        var joined = await (await browser.PostAsJsonAsync($"/api/v1/rooms/{code}/join", new { displayName = "Ana" }, Ct))
            .Content.ReadFromJsonAsync<JsonElement>(Ct);
        var token = joined.GetProperty("sfu").GetProperty("token").GetString();

        // mesmo caminho do navegador: sinalização via Traefik em /rtc
        using var validate = await browser.GetAsync($"/rtc/validate?access_token={token}", Ct);
        Assert.Equal(HttpStatusCode.OK, validate.StatusCode);
    }
}
