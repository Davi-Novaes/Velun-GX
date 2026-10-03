using System.Text;
using ScreenShare.Application.Sfu;
using ScreenShare.Infrastructure.LiveKit;

namespace ScreenShare.UnitTests;

public sealed class LiveKitWebhookReceiverTests
{
    private const string TrackPublishedBody = """
        {
          "event": "track_published",
          "id": "EV_abc",
          "createdAt": "1790683200",
          "room": { "sid": "RM_1", "name": "8f14e45fceea167a5a36dedd4bea2543" },
          "participant": { "sid": "PA_1", "identity": "p_0192a4c17b2e7c3d9e4f5a6b7c8d9e0f", "name": "Maria" },
          "track": { "sid": "TR_1", "type": "VIDEO", "source": "SCREEN_SHARE", "mimeType": "video/VP8", "width": 1920, "height": 1080 }
        }
        """;

    private static LiveKitWebhookReceiver Receiver() => new(TestSupport.Options(), TestSupport.Clock());

    private static Task<SfuWebhookResult> Receive(string? auth, string body) =>
        Receiver().ReceiveAsync(auth, Encoding.UTF8.GetBytes(body));

    [Fact]
    public async Task Valid_webhook_is_accepted_and_normalized()
    {
        var result = await Receive(TestSupport.SignWebhook(TrackPublishedBody, TestSupport.Now), TrackPublishedBody);

        var accepted = Assert.IsType<SfuWebhookResult.Accepted>(result);
        var e = accepted.Event;
        Assert.Equal(SfuEventTypes.TrackPublished, e.Type);
        Assert.Equal("EV_abc", e.Id);
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1790683200), e.CreatedAt);
        Assert.Equal("8f14e45fceea167a5a36dedd4bea2543", e.RoomName);
        Assert.Equal("p_0192a4c17b2e7c3d9e4f5a6b7c8d9e0f", e.ParticipantIdentity);
        Assert.Equal(new SfuEventTrack("TR_1", "screen_share", "video", "video/VP8", 1920, 1080), e.Track);
    }

    [Fact]
    public async Task Bearer_prefix_is_accepted()
    {
        var result = await Receive("Bearer " + TestSupport.SignWebhook(TrackPublishedBody, TestSupport.Now), TrackPublishedBody);
        Assert.IsType<SfuWebhookResult.Accepted>(result);
    }

    [Fact]
    public async Task Snake_case_payload_is_also_understood()
    {
        const string body = """{"event":"participant_left","id":"EV_2","created_at":1790683200,"participant":{"identity":"p_x","disconnect_reason":"CLIENT_INITIATED"}}""";

        var result = await Receive(TestSupport.SignWebhook(body, TestSupport.Now), body);

        var e = Assert.IsType<SfuWebhookResult.Accepted>(result).Event;
        Assert.Equal("p_x", e.ParticipantIdentity);
        Assert.Equal("client_initiated", e.DisconnectReason);
        Assert.Null(e.Track);
    }

    [Theory]
    [InlineData(null, "missing_authorization")]
    [InlineData("", "missing_authorization")]
    [InlineData("not-a-jwt", "invalid_signature")]
    public async Task Missing_or_malformed_authorization_is_rejected(string? auth, string reason)
    {
        var result = await Receive(auth, TrackPublishedBody);
        Assert.Equal(reason, Assert.IsType<SfuWebhookResult.Rejected>(result).Reason);
    }

    [Fact]
    public async Task Tampered_body_is_rejected()
    {
        var auth = TestSupport.SignWebhook(TrackPublishedBody, TestSupport.Now);
        var tampered = TrackPublishedBody.Replace("Maria", "Mallory", StringComparison.Ordinal);

        var result = await Receive(auth, tampered);

        Assert.Equal("body_hash_mismatch", Assert.IsType<SfuWebhookResult.Rejected>(result).Reason);
    }

    [Fact]
    public async Task Webhook_signed_with_wrong_secret_is_rejected()
    {
        var auth = TestSupport.SignWebhook(TrackPublishedBody, TestSupport.Now, secret: "wrong-secret-with-at-least-32-characters!");
        var result = await Receive(auth, TrackPublishedBody);
        Assert.Equal("invalid_signature", Assert.IsType<SfuWebhookResult.Rejected>(result).Reason);
    }

    [Fact]
    public async Task Webhook_from_other_api_key_is_rejected()
    {
        var auth = TestSupport.SignWebhook(TrackPublishedBody, TestSupport.Now, issuer: "other-key");
        var result = await Receive(auth, TrackPublishedBody);
        Assert.Equal("invalid_signature", Assert.IsType<SfuWebhookResult.Rejected>(result).Reason);
    }

    [Fact]
    public async Task Expired_webhook_token_is_rejected()
    {
        var auth = TestSupport.SignWebhook(TrackPublishedBody, TestSupport.Now.AddMinutes(-30));
        var result = await Receive(auth, TrackPublishedBody);
        Assert.Equal("invalid_signature", Assert.IsType<SfuWebhookResult.Rejected>(result).Reason);
    }

    [Fact]
    public async Task Signed_but_unrecognized_payload_is_rejected()
    {
        const string body = """{"hello":"world"}""";
        var result = await Receive(TestSupport.SignWebhook(body, TestSupport.Now), body);
        Assert.Equal("unrecognized_payload", Assert.IsType<SfuWebhookResult.Rejected>(result).Reason);
    }
}
