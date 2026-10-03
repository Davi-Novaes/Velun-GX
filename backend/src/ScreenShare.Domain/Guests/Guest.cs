namespace ScreenShare.Domain.Guests;

/// <summary>Visitante identificado pelo cookie de sessão. Futuramente pode ser vinculado a uma conta.</summary>
public sealed class Guest
{
    public Guid Id { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset LastSeenAt { get; private set; }
    public Guid? AccountId { get; private set; }

    private Guest() { }

    public static Guest Create(DateTimeOffset now) => new()
    {
        Id = Guid.CreateVersion7(now),
        CreatedAt = now,
        LastSeenAt = now,
    };

    public void Seen(DateTimeOffset now) => LastSeenAt = now;
}
