using Microsoft.Extensions.Logging;
using ScreenShare.Application.Common;
using ScreenShare.Domain.Guests;

namespace ScreenShare.Application.Guests;

public sealed partial class GuestService(IAppDbContext db, TimeProvider clock, ILogger<GuestService> logger)
{
    public async Task<Guest> CreateAsync(CancellationToken ct)
    {
        var guest = Guest.Create(clock.GetUtcNow());
        db.Guests.Add(guest);
        await db.SaveChangesAsync(ct);
        LogCreated(logger, guest.Id);
        return guest;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "session.created guest={GuestId}")]
    private static partial void LogCreated(ILogger logger, Guid guestId);
}
