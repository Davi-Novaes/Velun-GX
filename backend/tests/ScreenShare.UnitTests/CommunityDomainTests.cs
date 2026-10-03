using Microsoft.EntityFrameworkCore;
using ScreenShare.Domain.Accounts;
using ScreenShare.Domain.Communities;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.UnitTests;

public sealed class CommunityDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Account_normalizes_username_and_rotates_stamp_on_password_change()
    {
        var user = UserAccount.Create("  Davi  ", "hash-from-password-hasher", Guid.NewGuid(), Now);
        Assert.Equal("Davi", user.Username);
        Assert.Equal("DAVI", user.NormalizedUsername);
        var stamp = user.SecurityStamp;
        user.ReplacePasswordHash("replacement-hash");
        Assert.NotEqual(stamp, user.SecurityStamp);
        user.RecordLogin(Now.AddMinutes(1));
        Assert.Equal(Now.AddMinutes(1), user.LastLoginAt);
    }

    [Fact]
    public void Session_in_use_renews_after_half_of_its_lifetime_but_never_after_revocation()
    {
        var lifetime = TimeSpan.FromDays(30);
        var session = AccountSession.Create(Guid.NewGuid(), Now, Now + lifetime);
        Assert.False(session.Renew(Now.AddDays(10), lifetime)); // ainda tem mais da metade
        Assert.Equal(Now + lifetime, session.ExpiresAt);
        Assert.True(session.Renew(Now.AddDays(20), lifetime));
        Assert.Equal(Now.AddDays(50), session.ExpiresAt);
        Assert.False(session.Renew(Now.AddDays(51), lifetime)); // vencida não volta
        var revoked = AccountSession.Create(Guid.NewGuid(), Now, Now + lifetime);
        revoked.Revoke(Now.AddDays(1));
        Assert.False(revoked.Renew(Now.AddDays(20), lifetime));
    }

    [Fact]
    public void Nickname_is_shown_instead_of_username_and_can_be_removed()
    {
        var user = UserAccount.Create("davi", "hash", Guid.NewGuid(), Now);
        Assert.Equal("davi", user.ShownName);
        user.SetNickname("  Davi   Rodrigues 🎮 ");
        Assert.Equal("Davi Rodrigues 🎮", user.Nickname);
        Assert.Equal("Davi Rodrigues 🎮", user.ShownName);
        Assert.Equal("davi", user.Username); // o login não muda
        Assert.Throws<ArgumentException>(() => user.SetNickname(new string('x', 33)));
        Assert.Equal("Davi Rodrigues 🎮", user.Nickname);
        user.SetNickname("   ");
        Assert.Null(user.Nickname);
        Assert.Equal("davi", user.ShownName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("ab")]
    [InlineData("nome com espaço")]
    [InlineData("<script>")]
    public void Invalid_username_is_rejected(string name) =>
        Assert.Throws<ArgumentException>(() => UserAccount.Create(name, "hash", Guid.NewGuid(), Now));

    [Fact]
    public void Channel_is_permanent_independently_of_media_room()
    {
        var server = CommunityServer.Create(" Amigos ", Guid.NewGuid(), Now);
        var channel = Channel.Create(server.Id, "Jogos", 0, Now);
        Assert.Equal("Amigos", server.Name);
        Assert.Null(channel.MediaRoomId);
        var room = Guid.NewGuid();
        channel.BindMediaRoom(room);
        Assert.Equal(room, channel.MediaRoomId);
        channel.Reorder(2);
        channel.Rename("Gameplay");
        Assert.Equal(2, channel.Position);
        Assert.Equal("Gameplay", channel.Name);
        Assert.Throws<ArgumentOutOfRangeException>(() => channel.Reorder(-1));
    }

    [Fact]
    public void Invite_enforces_expiry_revocation_and_usage_limit()
    {
        var invite = ServerInvite.Create(Guid.NewGuid(), Guid.NewGuid(), new string('A', 64), Now, Now.AddHours(1), 1);
        Assert.True(invite.CanAccept(Now));
        Assert.False(invite.CanAccept(Now.AddHours(1)));
        invite.RecordUse(Now);
        Assert.False(invite.CanAccept(Now));
        Assert.Throws<InvalidOperationException>(() => invite.RecordUse(Now));
        var unlimited = ServerInvite.Create(Guid.NewGuid(), Guid.NewGuid(), new string('B', 64), Now, Now.AddHours(1));
        unlimited.Revoke(Now);
        Assert.False(unlimited.CanAccept(Now));
    }

    [Fact]
    public void Invite_without_expiry_stays_valid_until_revoked_or_used_up()
    {
        var invite = ServerInvite.Create(Guid.NewGuid(), Guid.NewGuid(), new string('C', 64), Now);
        Assert.Null(invite.ExpiresAt);
        Assert.True(invite.CanAccept(Now.AddYears(5)));
        invite.Revoke(Now.AddYears(5));
        Assert.False(invite.CanAccept(Now.AddYears(5)));

        var limited = ServerInvite.Create(Guid.NewGuid(), Guid.NewGuid(), new string('D', 64), Now, expiresAt: null, maxUses: 1);
        limited.RecordUse(Now.AddYears(1));
        Assert.False(limited.CanAccept(Now.AddYears(1)));
        Assert.Throws<ArgumentOutOfRangeException>(() => ServerInvite.Create(Guid.NewGuid(), Guid.NewGuid(), new string('E', 64), Now, Now.AddMinutes(-1)));
    }

    [Fact]
    public void Membership_roles_are_validated_and_deletion_is_idempotent()
    {
        Assert.Throws<ArgumentException>(() => ServerMember.Create(Guid.NewGuid(), Guid.NewGuid(), Now, "administrator"));
        var server = CommunityServer.Create("Amigos", Guid.NewGuid(), Now);
        server.Delete(Now);
        server.Delete(Now.AddDays(1));
        Assert.Equal(Now, server.DeletedAt);
    }

    [Fact]
    public void Relational_model_enforces_membership_and_media_room_uniqueness()
    {
        using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=model_only")
            .UseSnakeCaseNamingConvention().Options);
        var members = db.Model.FindEntityType(typeof(ServerMember))!;
        Assert.Equal(2, members.FindPrimaryKey()!.Properties.Count);
        var users = db.Model.FindEntityType(typeof(UserAccount))!;
        Assert.Contains(users.GetIndexes(), x => x.IsUnique && x.Properties.Single().Name == nameof(UserAccount.NormalizedUsername));
        var channels = db.Model.FindEntityType(typeof(Channel))!;
        Assert.Contains(channels.GetIndexes(), x => x.IsUnique && x.Properties.Single().Name == nameof(Channel.MediaRoomId));
        Assert.Equal(2, channels.GetForeignKeys().Count());
    }
}
