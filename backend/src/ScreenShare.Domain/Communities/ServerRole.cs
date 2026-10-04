namespace ScreenShare.Domain.Communities;

[Flags]
public enum ServerAccess { None = 0, ManageChannels = 1, Invite = 2, MoveMembers = 4, DisconnectMembers = 8, KickMembers = 16, ManageRoles = 32, ManageServer = 64, All = 127 }

public sealed class ServerRole
{
    public Guid Id { get; private set; }
    public Guid ServerId { get; private set; }
    public string Name { get; private set; } = "";
    public string Color { get; private set; } = "#9b87f5";
    public int Position { get; private set; }
    public ServerAccess Permissions { get; private set; }
    private ServerRole() { }
    public static ServerRole Create(Guid serverId, string name, string color, int position, ServerAccess permissions)
    {
        var role = new ServerRole { Id = Guid.NewGuid(), ServerId = serverId };
        role.Update(name, color, position, permissions);
        return role;
    }
    public void Update(string name, string color, int position, ServerAccess permissions)
    {
        name = name.Trim();
        if (name.Length is < 1 or > 40 || name.Any(char.IsControl)) throw new ArgumentException("Nome do cargo: use entre 1 e 40 caracteres.");
        if (color.Length != 7 || color[0] != '#' || !color.AsSpan(1).ToString().All(Uri.IsHexDigit)) throw new ArgumentException("Cor inválida.");
        if (position is < 1 or > 1000 || (permissions & ~ServerAccess.All) != 0) throw new ArgumentException("Hierarquia ou permissões inválidas.");
        Name = name; Color = color; Position = position; Permissions = permissions;
    }
}
