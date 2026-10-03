using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using ScreenShare.Application.Sfu;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Infrastructure.LiveKit;

namespace ScreenShare.UnitTests;

public sealed class LiveKitGatewayTests
{
    [Fact]
    public async Task Active_rooms_are_parsed_without_accepting_foreign_names()
    {
        var (gateway, handler) = Create((_, _) => Json(HttpStatusCode.OK, "{\"rooms\":[{\"name\":\"" + RoomName + "\"},{\"name\":\"foreign\"}]}"));
        Assert.Equal(RoomId, Assert.Single(await gateway.ListActiveRoomIdsAsync(TestContext.Current.CancellationToken)));
        Assert.EndsWith("ListRooms", Assert.Single(handler.Calls).Request.RequestUri!.ToString(), StringComparison.Ordinal);
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Publishing_permission_allows_screen_and_optional_audio_but_not_microphone(bool allowed)
    {
        var (gateway, handler) = Create((_, _) => Json(HttpStatusCode.OK, "{}"));
        var identity = ParticipantIdentity.From(Guid.NewGuid());
        await gateway.SetPublishingAsync(RoomId, identity, allowed, TestContext.Current.CancellationToken);
        var call = Assert.Single(handler.Calls);
        Assert.EndsWith("UpdateParticipant", call.Request.RequestUri!.ToString(), StringComparison.Ordinal);
        var body = JsonDocument.Parse(call.Body).RootElement;
        Assert.Equal(identity.Value, body.GetProperty("identity").GetString());
        var permission = body.GetProperty("permission");
        Assert.Equal(allowed, permission.GetProperty("can_publish").GetBoolean());
        Assert.True(permission.GetProperty("can_subscribe").GetBoolean());
        Assert.False(permission.GetProperty("can_publish_data").GetBoolean());
        Assert.Equal("SCREEN_SHARE", permission.GetProperty("can_publish_sources")[0].GetString());
        Assert.Equal("SCREEN_SHARE_AUDIO", permission.GetProperty("can_publish_sources")[1].GetString());
        Assert.Equal(2, permission.GetProperty("can_publish_sources").GetArrayLength());
        Assert.True(permission.GetProperty("can_update_metadata").GetBoolean());
    }
    private static readonly Guid RoomId = Guid.Parse("8f14e45f-ceea-167a-5a36-dedd4bea2543");
    private const string RoomName = "8f14e45fceea167a5a36dedd4bea2543";

    private sealed class FakeHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            Calls.Add((request, body));
            return respond(request, body);
        }
    }

    private static (LiveKitGateway Gateway, FakeHandler Handler) Create(Func<HttpRequestMessage, string, HttpResponseMessage> respond)
    {
        var handler = new FakeHandler(respond);
        var options = TestSupport.Options();
        var gateway = new LiveKitGateway(new HttpClient(handler), new LiveKitTokenFactory(options, TestSupport.Clock()), options,
            NullLogger<LiveKitGateway>.Instance);
        return (gateway, handler);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    [Fact]
    public async Task EnsureRoom_calls_CreateRoom_with_limit_and_timeouts_and_service_token()
    {
        var (gateway, handler) = Create((_, _) => Json(HttpStatusCode.OK, "{}"));

        await gateway.EnsureRoomAsync(RoomId, 20, CancellationToken.None);

        var (request, body) = Assert.Single(handler.Calls);
        Assert.Equal("http://livekit.test:7880/twirp/livekit.RoomService/CreateRoom", request.RequestUri!.ToString());
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        var json = JsonDocument.Parse(body).RootElement;
        Assert.Equal(RoomName, json.GetProperty("name").GetString());
        Assert.Equal(20, json.GetProperty("max_participants").GetInt32());
        Assert.Equal(300, json.GetProperty("empty_timeout").GetInt32());
        Assert.Equal(20, json.GetProperty("departure_timeout").GetInt32());
    }

    [Fact]
    public async Task EnsureRoom_throws_on_server_error()
    {
        var (gateway, _) = Create((_, _) => Json(HttpStatusCode.InternalServerError, """{"code":"internal","msg":"boom"}"""));
        await Assert.ThrowsAsync<SfuException>(() => gateway.EnsureRoomAsync(RoomId, 20, CancellationToken.None));
    }

    [Fact]
    public async Task ListParticipants_parses_protojson_response()
    {
        const string response = """
            {"participants":[{"sid":"PA_1","identity":"p_abc","name":"Maria","state":"ACTIVE","joined_at":"1790683200",
              "tracks":[{"sid":"TR_1","type":"VIDEO","source":"SCREEN_SHARE","muted":false},
                        {"sid":"TR_2","type":"AUDIO","source":"SCREEN_SHARE_AUDIO","muted":true}]}]}
            """;
        var (gateway, _) = Create((_, _) => Json(HttpStatusCode.OK, response));

        var participants = await gateway.ListParticipantsAsync(RoomId, CancellationToken.None);

        var p = Assert.Single(participants);
        Assert.Equal("p_abc", p.Identity);
        Assert.Equal("active", p.State);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1790683200), p.JoinedAt);
        Assert.Equal(2, p.Tracks.Count);
        Assert.Equal(("screen_share_audio", "audio", true), (p.Tracks[1].Source, p.Tracks[1].Kind, p.Tracks[1].Muted));
    }

    [Fact]
    public async Task ListParticipants_of_missing_room_is_empty()
    {
        var (gateway, _) = Create((_, _) => Json(HttpStatusCode.NotFound, """{"code":"not_found","msg":"room not found"}"""));
        Assert.Empty(await gateway.ListParticipantsAsync(RoomId, CancellationToken.None));
    }

    [Fact]
    public async Task RemoveParticipant_ignores_participant_already_gone()
    {
        var (gateway, handler) = Create((_, _) => Json(HttpStatusCode.NotFound, """{"code":"not_found","msg":"participant not found"}"""));

        await gateway.RemoveParticipantAsync(RoomId, ParticipantIdentity.From(Guid.NewGuid()), CancellationToken.None);

        Assert.EndsWith("/RemoveParticipant", Assert.Single(handler.Calls).Request.RequestUri!.AbsolutePath, StringComparison.Ordinal);
    }

    [Fact]
    public void CreateAccessToken_returns_public_url_for_the_browser()
    {
        var (gateway, _) = Create((_, _) => throw new InvalidOperationException("sem chamadas HTTP"));

        var token = gateway.CreateAccessToken(RoomId, ParticipantIdentity.From(Guid.NewGuid()), "Maria", "member", MediaPolicy.Default);

        Assert.Equal("wss://sfu.example.test", token.Url);
        Assert.Equal(TestSupport.Now.AddMinutes(10), token.ExpiresAt);
    }
}
