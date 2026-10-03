using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Application.Sfu;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Infrastructure.Communities;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.Api.Presence;

/// <summary>Reconcilia a autoridade SFU; um heartbeat de interface nunca inventa uma transmissão ativa.</summary>
internal sealed partial class PresenceWorker(IServiceScopeFactory scopes, PresenceRegistry registry, IHubContext<PresenceHub> hub, ILogger<PresenceWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var sfu = scope.ServiceProvider.GetRequiredService<ISfuGateway>();
                var clock = scope.ServiceProvider.GetRequiredService<TimeProvider>();
                var service = scope.ServiceProvider.GetRequiredService<CommunityService>();
                var now = clock.GetUtcNow();
                // Não consultar para sempre cada canal histórico vazio. A lista real do SFU
                // também cobre reuso de tokens antigos, mesmo sem presença ativa no banco.
                var activeRooms = (await sfu.ListActiveRoomIdsAsync(stoppingToken)).ToArray();
                var reservationCutoff = now - Participant.ReservationTtl;
                var channels = await db.Channels.Where(c => c.MediaRoomId != null &&
                    (activeRooms.Contains(c.MediaRoomId.Value) || db.Participants.Any(p => p.RoomId == c.MediaRoomId &&
                        (p.Status == ParticipantStatus.Connected || (p.Status == ParticipantStatus.Joining && p.JoinedAt > reservationCutoff) || p.PublishingAllowedUntil > now))))
                    .ToListAsync(stoppingToken);
                foreach (var channel in channels)
                {
                    var roomId = channel.MediaRoomId!.Value;
                    await using var mediaGate = await scope.ServiceProvider.GetRequiredService<ScreenShare.Application.Common.IDistributedLock>().TryAcquireAsync($"community:publish:{roomId:N}", TimeSpan.FromSeconds(30), TimeSpan.FromMilliseconds(50), stoppingToken);
                    if (mediaGate is null) continue;
                    var actual = await sfu.ListParticipantsAsync(roomId, stoppingToken);
                    var known = await db.Participants.Where(p => p.RoomId == roomId).ToListAsync(stoppingToken);
                    var open = channel.DeletedAt is null && await db.Servers.AnyAsync(s => s.Id == channel.ServerId && s.DeletedAt == null, stoppingToken);
                    var transmitting = 0;
                    foreach (var remote in actual.Where(p => p.State != "disconnected"))
                    {
                        var p = known.Find(p => p.Identity == remote.Identity);
                        var uid = p is null ? (Guid?)null : await db.Users.Where(u => u.GuestId == p.GuestId).Select(u => (Guid?)u.Id).SingleOrDefaultAsync(stoppingToken);
                        var tracks = remote.Tracks.Count(t => t.Source == MediaSource.ScreenShare);
                        var sessionValid = p is not null && await db.AccountSessions.AnyAsync(s => s.Id == p.ChannelSessionId && s.UserId == uid && s.RevokedAt == null && s.ExpiresAt > now && db.Users.Any(u => u.Id == s.UserId && u.SecurityStamp == p.ChannelSecurityStamp), stoppingToken);
                        if (!open || p is null || uid is null || !sessionValid || p.Status == ParticipantStatus.Disconnected || !await db.ServerMembers.AnyAsync(m => m.ServerId == channel.ServerId && m.UserId == uid, stoppingToken) || tracks > 1 || (tracks > 0 && ++transmitting > 4))
                        {
                            if (ParticipantIdentity.TryParse(remote.Identity, out var identity)) await sfu.RemoveParticipantAsync(roomId, identity, stoppingToken);
                            p?.MarkLeft(null, "access_revoked", now); p?.SetPublishingLease(null);
                            continue;
                        }
                        p.MarkConnected(remote.Sid, now);
                        if (tracks > 0) p.SetPublishingLease(now.AddSeconds(45));
                        else if (p.PublishingAllowedUntil is { } expiry && expiry <= now)
                        {
                            await sfu.SetPublishingAsync(roomId, p.ParticipantIdentity, false, stoppingToken); p.SetPublishingLease(null);
                        }
                    }
                    foreach (var p in known.Where(p => p.Status == ParticipantStatus.Connected && !actual.Any(a => a.Identity == p.Identity)))
                    { p.MarkLeft(null, "sfu_reconciled", now); p.SetPublishingLease(null); }
                    await db.SaveChangesAsync(stoppingToken);
                }
                await db.SaveChangesAsync(stoppingToken);
                foreach (var group in registry.Subscriptions.ToArray().GroupBy(x => x.Value.ServerId))
                {
                    var valid = new List<string>();
                    Guid? representative = null;
                    foreach (var (connection, subscription) in group)
                    {
                        var reason = subscription.HeartbeatAt < now.AddSeconds(-60) ? "heartbeat"
                            : !await db.AccountSessions.AnyAsync(s => s.Id == subscription.SessionId && s.UserId == subscription.UserId && s.RevokedAt == null && s.ExpiresAt > now && db.Users.Any(u => u.Id == s.UserId && u.SecurityStamp == subscription.SecurityStamp), stoppingToken) ? "session"
                            : !await db.ServerMembers.AnyAsync(m => m.ServerId == subscription.ServerId && m.UserId == subscription.UserId, stoppingToken) ? "membership"
                            : !await db.Servers.AnyAsync(s => s.Id == subscription.ServerId && s.DeletedAt == null, stoppingToken) ? "server_deleted"
                            : null;
                        if (reason is not null)
                        {
                            registry.Subscriptions.TryRemove(connection, out _);
                            LogAccessRemoved(logger, reason, subscription.UserId, subscription.ServerId, (now - subscription.HeartbeatAt).TotalSeconds);
                            // Heartbeat atrasado (pausa do servidor, rede instável, aba em segundo plano) não é perda de acesso:
                            // a página só precisa se registrar de novo. Os demais motivos encerram o acesso de fato.
                            if (reason == "heartbeat") await hub.Clients.Client(connection).SendAsync("PresenceExpired", subscription.ServerId, stoppingToken);
                            else await hub.Clients.Client(connection).SendAsync("AccessRemoved", subscription.ServerId, reason, stoppingToken);
                            continue;
                        }
                        representative = subscription.UserId; valid.Add(connection);
                    }
                    if (representative is { } user && valid.Count > 0)
                    {
                        var details = await service.DetailsAsync(user, group.Key, stoppingToken);
                        var presence = await service.PresenceAsync(user, group.Key, stoppingToken);
                        await hub.Clients.Clients(valid).SendAsync("Snapshot", new { serverId = group.Key, details, channels = presence }, stoppingToken);
                    }
                }
            }
            // Timeout de HttpClient também é OperationCanceledException, mas não
            // significa shutdown. Uma falha transitória do SFU não pode matar a API.
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            { LogFailed(logger, ex.GetType().Name); }
        }
    }
    [LoggerMessage(Level = LogLevel.Warning, Message = "presence.access_removed reason={Reason} user={UserId} server={ServerId} heartbeat_age_s={HeartbeatAgeSeconds}")]
    private static partial void LogAccessRemoved(ILogger logger, string reason, Guid userId, Guid serverId, double heartbeatAgeSeconds);

    [LoggerMessage(Level = LogLevel.Warning, Message = "presence.reconcile_failed type={Type}")]
    private static partial void LogFailed(ILogger logger, string type);
}
