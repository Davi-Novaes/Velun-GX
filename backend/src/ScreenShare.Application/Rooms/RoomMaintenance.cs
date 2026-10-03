using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ScreenShare.Application.Common;
using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;

namespace ScreenShare.Application.Rooms;

/// <summary>Limpeza periódica: expira salas inativas e encerra reservas que nunca conectaram.</summary>
public sealed partial class RoomMaintenance(IAppDbContext db, TimeProvider clock, ILogger<RoomMaintenance> logger)
{
    /// <summary>Reserva sem conexão por mais que isso vira "desconectado" (fantasma).</summary>
    public static readonly TimeSpan StaleJoinAfter = TimeSpan.FromMinutes(5);

    public async Task RunAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();

        var staleBefore = now - StaleJoinAfter;
        var stale = await db.Participants
            .Where(p => p.Status == ParticipantStatus.Joining && p.JoinedAt < staleBefore)
            .ToListAsync(ct);
        foreach (var participant in stale)
            participant.MarkLeft(null, "never_connected", now);

        var expiredRooms = await db.Rooms
            .Where(r => !r.IsPersistent && r.Status == RoomStatus.Active && r.ExpiresAt <= now)
            .Where(r => !db.Participants.Any(p => p.RoomId == r.Id && p.Status == ParticipantStatus.Connected))
            .ToListAsync(ct);
        foreach (var room in expiredRooms)
            room.Expire();

        await db.SaveChangesAsync(ct);
        if (stale.Count > 0 || expiredRooms.Count > 0)
            LogRun(logger, expiredRooms.Count, stale.Count);
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "maintenance.run expired_rooms={ExpiredRooms} stale_participants={StaleParticipants}")]
    private static partial void LogRun(ILogger logger, int expiredRooms, int staleParticipants);
}
