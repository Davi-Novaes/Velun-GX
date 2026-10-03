namespace ScreenShare.Domain.Communities;

/// <summary>Recurso permanente; uma sala de mídia temporária pode ser vinculada sob lock.</summary>
public sealed class Channel
{
    public Guid Id { get; private set; }
    public Guid ServerId { get; private set; }
    public Guid? MediaRoomId { get; private set; }
    public string Name { get; private set; } = "";
    public int Position { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? DeletedAt { get; private set; }

    private Channel() { }

    public static Channel Create(Guid serverId, string name, int position, DateTimeOffset now)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(serverId, Guid.Empty);
        ArgumentOutOfRangeException.ThrowIfNegative(position);
        return new Channel { Id = Guid.CreateVersion7(now), ServerId = serverId, Name = CommunityServer.ValidName(name), Position = position, CreatedAt = now };
    }

    public void Rename(string name) => Name = CommunityServer.ValidName(name);
    public void Reorder(int position) { ArgumentOutOfRangeException.ThrowIfNegative(position); Position = position; }
    public void BindMediaRoom(Guid roomId) { ArgumentOutOfRangeException.ThrowIfEqual(roomId, Guid.Empty); MediaRoomId = roomId; }
    public void Delete(DateTimeOffset now) => DeletedAt ??= now;
}
