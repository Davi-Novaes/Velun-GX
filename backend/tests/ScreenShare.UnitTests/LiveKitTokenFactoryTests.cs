using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Infrastructure.LiveKit;

namespace ScreenShare.UnitTests;

public sealed class LiveKitTokenFactoryTests
{
    [Fact]
    public void Channel_token_cannot_publish_before_backend_approval()
    {
        var (factory, _) = Create();
        var policy = ScreenShare.Domain.Rooms.Room.CreateForChannel(Guid.NewGuid(), TestSupport.Now).MediaPolicy;
        var (token, _) = factory.CreateParticipantToken("channel", Identity, "Maria", "member", policy);
        var grant = ReadVideoGrant(token);
        Assert.False(grant.GetProperty("canPublish").GetBoolean());
        Assert.False(grant.GetProperty("canPublishData").GetBoolean());
        Assert.Equal(["screen_share", "screen_share_audio"], grant.GetProperty("canPublishSources").EnumerateArray().Select(e => e.GetString()!).ToArray());
        Assert.True(grant.GetProperty("canUpdateOwnMetadata").GetBoolean());
    }
    private static readonly Guid ParticipantId = Guid.Parse("0192a4c1-7b2e-7c3d-9e4f-5a6b7c8d9e0f");
    private static readonly ParticipantIdentity Identity = ParticipantIdentity.From(ParticipantId);

    private static (LiveKitTokenFactory Factory, Microsoft.Extensions.Time.Testing.FakeTimeProvider Clock) Create()
    {
        var clock = TestSupport.Clock();
        return (new LiveKitTokenFactory(TestSupport.Options(), clock), clock);
    }

    [Fact]
    public async Task Participant_token_is_signed_with_api_secret_and_issued_by_api_key()
    {
        var (factory, _) = Create();
        var (token, _) = factory.CreateParticipantToken("room1", Identity, "Maria", "member", MediaPolicy.Default);

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, TestSupport.Validation(TestSupport.Now));

        Assert.True(result.IsValid, result.Exception?.Message);
        Assert.Equal(TestSupport.ApiKey, result.Claims["iss"]);
        Assert.Equal(Identity.Value, result.Claims["sub"]);
        Assert.Equal("Maria", result.Claims["name"]);
    }

    [Fact]
    public void Participant_token_grants_only_the_room_and_the_allowed_sources()
    {
        var (factory, _) = Create();
        var (token, _) = factory.CreateParticipantToken("room1", Identity, "Maria", "member", MediaPolicy.Default);

        var video = ReadVideoGrant(token);

        Assert.Equal("room1", video.GetProperty("room").GetString());
        Assert.True(video.GetProperty("roomJoin").GetBoolean());
        Assert.True(video.GetProperty("canSubscribe").GetBoolean());
        Assert.True(video.GetProperty("canPublish").GetBoolean());
        Assert.False(video.GetProperty("canUpdateOwnMetadata").GetBoolean());
        Assert.Equal(["screen_share", "screen_share_audio"],
            video.GetProperty("canPublishSources").EnumerateArray().Select(e => e.GetString()!).ToArray());
        // nenhum poder administrativo no token do navegador
        Assert.False(video.TryGetProperty("roomAdmin", out _));
        Assert.False(video.TryGetProperty("roomCreate", out _));
        Assert.False(video.TryGetProperty("roomList", out _));
    }

    [Fact]
    public void Adding_microphone_to_policy_is_enough_to_allow_voice()
    {
        var (factory, _) = Create();
        var voicePolicy = MediaPolicy.Default with
        {
            AllowedSources = [MediaSource.ScreenShare, MediaSource.ScreenShareAudio, MediaSource.Microphone],
        };

        var (token, _) = factory.CreateParticipantToken("room1", Identity, "Maria", "member", voicePolicy);

        Assert.Contains("microphone", ReadVideoGrant(token).GetProperty("canPublishSources").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public void Participant_token_carries_role_and_participant_id_in_metadata()
    {
        var (factory, _) = Create();
        var (token, _) = factory.CreateParticipantToken("room1", Identity, "Maria", "owner", MediaPolicy.Default);

        var metadata = JsonDocument.Parse(new JsonWebToken(token).GetPayloadValue<string>("metadata")).RootElement;

        Assert.Equal("owner", metadata.GetProperty("role").GetString());
        Assert.Equal(ParticipantId, metadata.GetProperty("participantId").GetGuid());
    }

    [Fact]
    public async Task Participant_token_expires_after_configured_lifetime()
    {
        var (factory, _) = Create();
        var (token, expiresAt) = factory.CreateParticipantToken("room1", Identity, "Maria", "member", MediaPolicy.Default);
        var handler = new JsonWebTokenHandler();

        Assert.Equal(TestSupport.Now.AddMinutes(10), expiresAt);
        Assert.True((await handler.ValidateTokenAsync(token, TestSupport.Validation(TestSupport.Now.AddMinutes(9)))).IsValid);
        Assert.False((await handler.ValidateTokenAsync(token, TestSupport.Validation(TestSupport.Now.AddMinutes(10).AddSeconds(1)))).IsValid);
    }

    [Fact]
    public async Task Token_signed_with_other_secret_is_rejected()
    {
        var other = new LiveKitTokenFactory(TestSupport.Options("another-secret-with-at-least-32-chars!!"), TestSupport.Clock());
        var (token, _) = other.CreateParticipantToken("room1", Identity, "Maria", "member", MediaPolicy.Default);

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, TestSupport.Validation(TestSupport.Now));

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Service_token_has_admin_grants_scoped_to_room_and_short_lifetime()
    {
        var (factory, _) = Create();
        var jwt = new JsonWebToken(factory.CreateServiceToken("room1"));
        var video = JsonDocument.Parse(jwt.GetPayloadValue<JsonElement>("video").GetRawText()).RootElement;

        Assert.True(video.GetProperty("roomAdmin").GetBoolean());
        Assert.True(video.GetProperty("roomCreate").GetBoolean());
        Assert.Equal("room1", video.GetProperty("room").GetString());
        Assert.Equal(TestSupport.Now.AddMinutes(1).UtcDateTime, jwt.ValidTo);
    }

    [Fact]
    public void Blank_display_name_is_rejected()
    {
        var (factory, _) = Create();
        Assert.Throws<ArgumentException>(() => factory.CreateParticipantToken("room1", Identity, " ", "member", MediaPolicy.Default));
    }

    private static JsonElement ReadVideoGrant(string token) =>
        JsonDocument.Parse(new JsonWebToken(token).GetPayloadValue<JsonElement>("video").GetRawText()).RootElement;
}
