using Microsoft.EntityFrameworkCore;
using ScreenShare.Domain.Communities;
using ScreenShare.Domain.Participants;

namespace ScreenShare.Infrastructure.Communities;

public sealed partial class CommunityService
{
    private async Task<(ServerAccess Permissions, int Rank)> RightsAsync(Guid userId, Guid serverId, CancellationToken ct)
    {
        var server = await AccessAsync(userId, serverId, false, ct);
        if (server.OwnerUserId == userId) return (ServerAccess.All, int.MaxValue);
        var member = await db.ServerMembers.SingleAsync(m => m.ServerId == serverId && m.UserId == userId, ct);
        var role = await db.ServerRoles.SingleOrDefaultAsync(r => r.ServerId == serverId && r.Id == member.ServerRoleId, ct);
        return role is null ? (ServerAccess.None, 0) : (role.Permissions, role.Position);
    }
    public async Task RequirePermissionAsync(Guid userId, Guid serverId, ServerAccess permission, CancellationToken ct)
    {
        if (((await RightsAsync(userId, serverId, ct)).Permissions & permission) != permission) throw Denied();
    }
    private async Task ModerateAsync(Guid actorId, Guid serverId, Guid targetId, ServerAccess permission, CancellationToken ct)
    {
        await RequirePermissionAsync(actorId, serverId, permission, ct);
        var actor = await RightsAsync(actorId, serverId, ct);
        var target = await RightsAsync(targetId, serverId, ct);
        if (actorId == targetId || actor.Rank <= target.Rank) throw new CommunityException(403, "A hierarquia não permite esta ação sobre esse membro.");
    }
    public async Task<ServerRole> SaveRoleAsync(Guid actor, Guid server, Guid? id, string name, string color, int position, ServerAccess permissions, CancellationToken ct)
    {
        await using var gate = await LockAsync($"community:server:{server:N}", ct);
        await RequirePermissionAsync(actor, server, ServerAccess.ManageRoles, ct);
        var rights = await RightsAsync(actor, server, ct);
        var role = id is null ? null : await db.ServerRoles.SingleOrDefaultAsync(r => r.Id == id && r.ServerId == server, ct) ?? throw Missing();
        if (position >= rights.Rank || (role is not null && role.Position >= rights.Rank) || (permissions & ~rights.Permissions) != 0) throw Denied();
        if (await db.ServerRoles.AnyAsync(r => r.ServerId == server && r.Id != id && r.Position == position, ct)) throw new CommunityException(409, "Já existe um cargo nessa posição.");
        if (role is null)
        {
            if (await db.ServerRoles.CountAsync(r => r.ServerId == server, ct) >= 30) throw new CommunityException(409, "Limite de 30 cargos por servidor.");
            role = ServerRole.Create(server, name, color, position, permissions); db.ServerRoles.Add(role);
        }
        else role.Update(name, color, position, permissions);
        await db.SaveChangesAsync(ct); return role;
    }
    public async Task DeleteRoleAsync(Guid actor, Guid server, Guid id, CancellationToken ct)
    {
        await using var gate = await LockAsync($"community:server:{server:N}", ct);
        await RequirePermissionAsync(actor, server, ServerAccess.ManageRoles, ct);
        var role = await db.ServerRoles.SingleOrDefaultAsync(r => r.ServerId == server && r.Id == id, ct) ?? throw Missing();
        if (role.Position >= (await RightsAsync(actor, server, ct)).Rank) throw Denied();
        db.ServerRoles.Remove(role); await db.SaveChangesAsync(ct);
    }
    public async Task AssignRoleAsync(Guid actor, Guid server, Guid target, Guid? roleId, CancellationToken ct)
    {
        await using var gate = await LockAsync($"community:server:{server:N}", ct);
        await ModerateAsync(actor, server, target, ServerAccess.ManageRoles, ct);
        var role = roleId is null ? null : await db.ServerRoles.SingleOrDefaultAsync(r => r.ServerId == server && r.Id == roleId, ct) ?? throw Missing();
        var rights = await RightsAsync(actor, server, ct);
        if (role is not null && (role.Position >= rights.Rank || (role.Permissions & ~rights.Permissions) != 0)) throw Denied();
        (await db.ServerMembers.SingleAsync(m => m.ServerId == server && m.UserId == target, ct)).AssignRole(roleId);
        await db.SaveChangesAsync(ct);
    }
    public async Task ModerateChannelAsync(Guid actor, Guid server, Guid target, Guid? destination, CancellationToken ct)
    {
        await using var serverGate = await LockAsync($"community:server:{server:N}", ct);
        await ModerateAsync(actor, server, target, destination is null ? ServerAccess.DisconnectMembers : ServerAccess.MoveMembers, ct);
        await using var userGate = await LockAsync($"community:user:{target:N}", ct);
        if (destination is { } id)
        {
            var channel = await ChannelAsync(target, id, false, ct);
            if (channel.ServerId != server) throw Denied();
            if (channel.MediaRoomId is { } roomId)
            {
                var actual = await sfu.ListParticipantsAsync(roomId, ct);
                var identities = actual.Select(p => p.Identity).ToArray();
                var now = clock.GetUtcNow();
                var reserved = await db.Participants.CountAsync(p => p.RoomId == roomId && p.Status == ParticipantStatus.Joining && p.JoinedAt > now - Participant.ReservationTtl && !identities.Contains(p.Identity), ct);
                if (actual.Count + reserved >= 20) throw new CommunityException(409, "O canal de destino está cheio.");
            }
        }
        await DisconnectUserAsync(target, server, ct);
    }
}
