using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;

namespace ScreenShare.UnitTests;

public sealed class ParticipantIdentityTests
{
    [Fact]
    public void Identity_round_trips()
    {
        var id = Guid.NewGuid();
        var identity = ParticipantIdentity.From(id);

        Assert.StartsWith("p_", identity.Value, StringComparison.Ordinal);
        Assert.True(ParticipantIdentity.TryParse(identity.Value, out var parsed));
        Assert.Equal(id, parsed.ParticipantId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("p_")]
    [InlineData("p_not-a-guid")]
    [InlineData("p_00000000000000000000000000000000")]
    [InlineData("x_0192a4c17b2e7c3d9e4f5a6b7c8d9e0f")]
    public void Invalid_identity_is_rejected(string? value) =>
        Assert.False(ParticipantIdentity.TryParse(value, out _));

    [Fact]
    public void Empty_guid_is_rejected() =>
        Assert.Throws<ArgumentException>(() => ParticipantIdentity.From(Guid.Empty));
}

public sealed class MediaPolicyTests
{
    [Fact]
    public void Default_policy_is_screen_share_only_with_three_concurrent_shares()
    {
        var policy = MediaPolicy.Default;

        policy.Validate();
        Assert.Equal(["screen_share", "screen_share_audio"], policy.AllowedSources);
        Assert.Equal(3, policy.MaxConcurrentScreenShares);
        Assert.DoesNotContain(MediaSource.Microphone, policy.AllowedSources);
    }

    [Fact]
    public void Unknown_source_is_rejected() =>
        Assert.Throws<ArgumentException>(() => (MediaPolicy.Default with { AllowedSources = ["screen_share", "hologram"] }).Validate());

    [Theory]
    [InlineData(0)]
    [InlineData(11)]
    public void Concurrent_shares_out_of_range_is_rejected(int value) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => (MediaPolicy.Default with { MaxConcurrentScreenShares = value }).Validate());

    [Fact]
    public void Fps_above_60_is_rejected() =>
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            (MediaPolicy.Default with { Video = MediaPolicy.Default.Video with { MaxFps = 120 } }).Validate());
}
