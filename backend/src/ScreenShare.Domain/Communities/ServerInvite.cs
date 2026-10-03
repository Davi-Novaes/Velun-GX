namespace ScreenShare.Domain.Communities;

/// <summary>Guarda somente digest do segredo; consumo deve ocorrer em transação/lock no serviço.</summary>
public sealed class ServerInvite
{
    public Guid Id { get; private set; }
    public Guid ServerId { get; private set; }
    public Guid CreatedByUserId { get; private set; }
    public string CodeHash { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
    /// <summary>Null = o link não expira (só deixa de valer se for revogado ou esgotar os usos).</summary>
    public DateTimeOffset? ExpiresAt { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }
    public int? MaxUses { get; private set; }
    public int Uses { get; private set; }

    private ServerInvite() { }

    public static ServerInvite Create(Guid serverId, Guid creatorId, string codeHash, DateTimeOffset now, DateTimeOffset? expiresAt = null, int? maxUses = null)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(serverId, Guid.Empty);
        ArgumentOutOfRangeException.ThrowIfEqual(creatorId, Guid.Empty);
        ArgumentException.ThrowIfNullOrWhiteSpace(codeHash);
        if (codeHash.Length != 64 || codeHash.Any(c => !char.IsAsciiHexDigit(c))) throw new ArgumentException("Digest SHA-256 inválido.", nameof(codeHash));
        if (expiresAt is { } expiry && expiry <= now) throw new ArgumentOutOfRangeException(nameof(expiresAt), "O prazo do convite precisa estar no futuro.");
        if (maxUses is <= 0) throw new ArgumentOutOfRangeException(nameof(maxUses));
        return new ServerInvite { Id = Guid.CreateVersion7(now), ServerId = serverId, CreatedByUserId = creatorId, CodeHash = codeHash.ToUpperInvariant(), CreatedAt = now, ExpiresAt = expiresAt, MaxUses = maxUses };
    }

    public bool CanAccept(DateTimeOffset now) => RevokedAt is null && (ExpiresAt is null || now < ExpiresAt) && (MaxUses is null || Uses < MaxUses);
    public void RecordUse(DateTimeOffset now)
    {
        if (!CanAccept(now)) throw new InvalidOperationException("Convite expirado, revogado ou esgotado.");
        Uses = checked(Uses + 1);
    }
    public void Revoke(DateTimeOffset now) => RevokedAt ??= now;
}
