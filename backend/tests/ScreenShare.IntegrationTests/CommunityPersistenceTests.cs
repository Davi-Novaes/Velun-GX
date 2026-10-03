using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ScreenShare.Domain.Accounts;
using ScreenShare.Domain.Communities;
using ScreenShare.Domain.Guests;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.IntegrationTests;

/// <summary>Exige PostgreSQL real descartável do ApiFactory; não altera o banco publicado.</summary>
public sealed class CommunityPersistenceTests(ApiFactory api)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task New_hierarchy_round_trips_and_survives_new_context()
    {
        var now = DateTimeOffset.UtcNow;
        Guid userId, serverId, channelId;
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var guest = Guest.Create(now);
            var user = UserAccount.Create(Guid.NewGuid().ToString("N")[..20], "test-hash-not-a-password", guest.Id, now);
            var server = CommunityServer.Create("Amigos", user.Id, now);
            var channel = Channel.Create(server.Id, "Jogos", 0, now);
            db.Guests.Add(guest);
            db.Users.Add(user);
            db.Servers.Add(server);
            db.ServerMembers.Add(ServerMember.Create(server.Id, user.Id, now, ServerMember.OwnerRole));
            db.Channels.Add(channel);
            db.ServerInvites.Add(ServerInvite.Create(server.Id, user.Id, Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)), now, now.AddDays(1)));
            await db.SaveChangesAsync(Ct);
            userId = user.Id; serverId = server.Id; channelId = channel.Id;
        }
        await using var fresh = api.Services.CreateAsyncScope();
        var reloaded = fresh.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal("Amigos", (await reloaded.Servers.SingleAsync(x => x.Id == serverId, Ct)).Name);
        Assert.Null((await reloaded.Channels.SingleAsync(x => x.Id == channelId, Ct)).MediaRoomId);
        Assert.Equal(ServerMember.OwnerRole, (await reloaded.ServerMembers.SingleAsync(x => x.ServerId == serverId && x.UserId == userId, Ct)).Role);
        Assert.True(await reloaded.ServerInvites.AnyAsync(x => x.ServerId == serverId, Ct));
    }

    [Fact]
    public async Task Database_rejects_case_insensitive_duplicate_account()
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTimeOffset.UtcNow;
        var name = "Test" + Guid.NewGuid().ToString("N")[..20];
        var first = Guest.Create(now);
        var second = Guest.Create(now);
        db.Guests.AddRange(first, second);
        db.Users.Add(UserAccount.Create(name, "test-hash", first.Id, now));
        await db.SaveChangesAsync(Ct);
        db.Users.Add(UserAccount.Create(name.ToLowerInvariant(), "test-hash", second.Id, now));
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync(Ct));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, Assert.IsType<PostgresException>(error.InnerException).SqlState);
    }
}
