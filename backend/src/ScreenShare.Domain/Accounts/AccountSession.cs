namespace ScreenShare.Domain.Accounts;

/// <summary>Sessão revogável independente do cookie de convidado.</summary>
public sealed class AccountSession
{
    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }
    private AccountSession() { }

    public static AccountSession Create(Guid userId, DateTimeOffset now, DateTimeOffset expiresAt)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(userId, Guid.Empty);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(expiresAt, now);
        return new AccountSession { Id = Guid.NewGuid(), UserId = userId, CreatedAt = now, ExpiresAt = expiresAt };
    }

    public bool IsValid(DateTimeOffset now) => RevokedAt is null && now < ExpiresAt;
    public void Revoke(DateTimeOffset now) => RevokedAt ??= now;

    /// <summary>
    /// Sessão em uso renova sozinha: passada metade do prazo, volta a valer o prazo inteiro.
    /// Renovar só depois da metade evita uma escrita no banco a cada requisição.
    /// </summary>
    public bool Renew(DateTimeOffset now, TimeSpan lifetime)
    {
        if (!IsValid(now) || ExpiresAt - now > lifetime / 2) return false;
        ExpiresAt = now + lifetime;
        return true;
    }
}
