using Microsoft.EntityFrameworkCore;
using ScreenShare.Domain.Guests;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;

namespace ScreenShare.Application.Common;

public interface IAppDbContext
{
    DbSet<Guest> Guests { get; }
    DbSet<Room> Rooms { get; }
    DbSet<Participant> Participants { get; }
    DbSet<StreamSession> StreamSessions { get; }
    Task<int> SaveChangesAsync(CancellationToken ct);
}

/// <summary>Lock distribuído (Redis). Usado para serializar entradas na mesma sala.</summary>
public interface IDistributedLock
{
    /// <summary>Tenta adquirir por até <paramref name="wait"/>. Retorna null se não conseguiu.</summary>
    Task<IAsyncDisposable?> TryAcquireAsync(string key, TimeSpan ttl, TimeSpan wait, CancellationToken ct);
}

/// <summary>Detecta violação de unicidade sem acoplar a aplicação ao provedor do banco.</summary>
public interface IUniqueViolationDetector
{
    bool IsUniqueViolation(Exception exception);
}
