namespace ScreenShare.Domain.Communities;

public sealed class ServerMember
{
    public const string OwnerRole = "owner";
    public const string MemberRole = "member";
    public Guid ServerId { get; private set; }
    public Guid UserId { get; private set; }
    public string Role { get; private set; } = MemberRole;
    public DateTimeOffset JoinedAt { get; private set; }

    private ServerMember() { }

    public static ServerMember Create(Guid serverId, Guid userId, DateTimeOffset now, string role = MemberRole)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(serverId, Guid.Empty);
        ArgumentOutOfRangeException.ThrowIfEqual(userId, Guid.Empty);
        if (role is not OwnerRole and not MemberRole) throw new ArgumentException("Papel inválido.", nameof(role));
        return new ServerMember { ServerId = serverId, UserId = userId, Role = role, JoinedAt = now };
    }
}
