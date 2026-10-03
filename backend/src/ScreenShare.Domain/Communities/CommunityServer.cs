namespace ScreenShare.Domain.Communities;

public sealed class CommunityServer
{
    public Guid Id { get; private set; }
    public Guid OwnerUserId { get; private set; }
    public string Name { get; private set; } = "";
    public string? Icon { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? DeletedAt { get; private set; }

    private CommunityServer() { }

    public static CommunityServer Create(string name, Guid ownerUserId, DateTimeOffset now)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(ownerUserId, Guid.Empty);
        return new CommunityServer { Id = Guid.CreateVersion7(now), OwnerUserId = ownerUserId, Name = ValidName(name), CreatedAt = now };
    }

    public void Rename(string name) => Name = ValidName(name);
    public void SetIcon(string? icon)
    {
        if (icon is null) { Icon = null; return; }
        const string prefix = "data:image/png;base64,";
        if (!icon.StartsWith(prefix, StringComparison.Ordinal) || icon.Length > 90000) throw new ArgumentException("O ícone deve ser uma imagem PNG pequena.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(icon[prefix.Length..]); } catch (FormatException) { throw new ArgumentException("Ícone inválido."); }
        ReadOnlySpan<byte> signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.Length < 33 || bytes.Length > 65536 || !bytes.AsSpan(0, 8).SequenceEqual(signature)) throw new ArgumentException("Ícone inválido.");
        var width = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
        var height = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
        if (width is < 1 or > 256 || height is < 1 or > 256) throw new ArgumentException("O ícone deve ter até 256 × 256 pixels.");
        Icon = icon;
    }
    public void Delete(DateTimeOffset now) => DeletedAt ??= now;

    internal static string ValidName(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var trimmed = name.Trim();
        if (trimmed.Length > 80 || trimmed.Any(char.IsControl))
            throw new ArgumentException("Nome inválido: use até 80 caracteres, sem controles.", nameof(name));
        return trimmed;
    }
}
