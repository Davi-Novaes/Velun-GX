using ScreenShare.Domain.Accounts;

namespace ScreenShare.UnitTests;

public sealed class AccountSessionTests
{
    [Fact]
    public void Session_expires_and_revocation_is_idempotent()
    {
        var now = DateTimeOffset.UtcNow;
        var session = AccountSession.Create(Guid.NewGuid(), now, now.AddDays(7));
        Assert.True(session.IsValid(now));
        Assert.False(session.IsValid(now.AddDays(7)));
        session.Revoke(now.AddHours(1));
        session.Revoke(now.AddHours(2));
        Assert.False(session.IsValid(now.AddHours(1)));
        Assert.Equal(now.AddHours(1), session.RevokedAt);
    }

    [Fact]
    public void Invalid_session_dates_are_rejected()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Throws<ArgumentOutOfRangeException>(() => AccountSession.Create(Guid.NewGuid(), now, now));
        Assert.Throws<ArgumentOutOfRangeException>(() => AccountSession.Create(Guid.Empty, now, now.AddDays(1)));
    }
}
