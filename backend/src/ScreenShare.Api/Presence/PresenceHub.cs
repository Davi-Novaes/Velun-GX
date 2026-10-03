using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Api.Security;
using ScreenShare.Infrastructure.Communities;
using ScreenShare.Infrastructure.Persistence;
using StackExchange.Redis;

namespace ScreenShare.Api.Presence;

public sealed record PresenceSubscription(Guid UserId, Guid SessionId, Guid ServerId, string SecurityStamp, DateTimeOffset HeartbeatAt);
public sealed class PresenceRegistry
{
    public ConcurrentDictionary<string, PresenceSubscription> Subscriptions { get; } = new(StringComparer.Ordinal);
}

[Authorize(Policy = AccountAuthentication.Policy)]
public sealed partial class PresenceHub(CommunityService communities, AppDbContext db, PresenceRegistry registry, IConnectionMultiplexer redis, TimeProvider clock, ILogger<PresenceHub> logger) : Hub
{
    public Task Ping() => Task.CompletedTask;
    public override async Task OnConnectedAsync()
    {
        var http = Context.GetHttpContext()!;
        var origin = http.Request.Headers.Origin.ToString();
        var scheme = http.Request.Scheme switch { "ws" => "http", "wss" => "https", var value => value };
        if (origin.Length > 0 && (!Uri.TryCreate(origin, UriKind.Absolute, out var parsed) || !string.Equals(parsed.Authority, http.Request.Host.Value, StringComparison.OrdinalIgnoreCase) || parsed.Scheme != scheme)) { LogOrigin(logger, http.Request.Host.Value, scheme); Context.Abort(); return; }
        await base.OnConnectedAsync();
    }
    public async Task Watch(string serverId)
    {
        if (!Guid.TryParse(serverId, out var id)) throw new HubException("Servidor inválido.");
        var user = Guid.Parse(Context.User!.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var sid = Guid.Parse(Context.User!.FindFirstValue(AccountAuthentication.SessionClaim)!);
        await communities.AccessAsync(user, id, false, Context.ConnectionAborted);
        registry.Subscriptions[Context.ConnectionId] = new PresenceSubscription(user, sid, id, Context.User!.FindFirstValue("security_stamp")!, clock.GetUtcNow());
        await Heartbeat();
        await Clients.Caller.SendAsync("Presence", new { serverId = id, channels = await communities.PresenceAsync(user, id, Context.ConnectionAborted) });
    }

    public async Task Heartbeat()
    {
        if (!registry.Subscriptions.TryGetValue(Context.ConnectionId, out var subscription)) return;
        var now = clock.GetUtcNow();
        if (!await db.AccountSessions.AnyAsync(s => s.Id == subscription.SessionId && s.UserId == subscription.UserId && s.RevokedAt == null && s.ExpiresAt > now && db.Users.Any(u => u.Id == s.UserId && u.SecurityStamp == subscription.SecurityStamp), Context.ConnectionAborted)) { Context.Abort(); return; }
        registry.Subscriptions[Context.ConnectionId] = subscription with { HeartbeatAt = now };
        await redis.GetDatabase().StringSetAsync("presence:app:" + Context.ConnectionId, subscription.UserId.ToString(), TimeSpan.FromSeconds(60));
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        registry.Subscriptions.TryRemove(Context.ConnectionId, out _);
        await redis.GetDatabase().KeyDeleteAsync("presence:app:" + Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
    [LoggerMessage(Level = LogLevel.Warning, Message = "presence.origin_rejected host={Host} scheme={Scheme}")]
    private static partial void LogOrigin(ILogger logger, string? host, string scheme);
}
