using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Application.Common;
using ScreenShare.Application.Rooms;
using ScreenShare.Application.Sfu;
using ScreenShare.Domain.Accounts;
using ScreenShare.Domain.Communities;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.Infrastructure.Communities;

public sealed class CommunityException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed record ServerView(Guid Id, string Name, string? Icon, Guid OwnerUserId, string Role, int MemberCount);
public sealed record ChannelView(Guid Id, string Name, int Position);
public sealed record MemberView(Guid Id, string Username, string Name, string Role);
public sealed record PresenceView(Guid UserId, string Identity, string Name, bool IsSharing);
public sealed record ChannelPresence(Guid Id, string Name, IReadOnlyList<PresenceView> Participants);

/// <summary>Recursos permanentes e autorização de mídia. Nenhuma permissão vem do cliente.</summary>
public sealed class CommunityService(AppDbContext db, IDistributedLock locks, ISfuGateway sfu, RoomService rooms, TimeProvider clock)
{
    private static CommunityException Denied() => new(403, "Você não possui acesso a este servidor.");
    private static CommunityException Missing() => new(404, "Servidor ou canal não encontrado.");
    private async Task<IAsyncDisposable> LockAsync(string key, CancellationToken ct) =>
        await locks.TryAcquireAsync(key, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(5), ct) ?? throw new CommunityException(503, "Operação em andamento. Tente novamente.");

    public async Task<UserAccount> UserAsync(Guid userId, CancellationToken ct) =>
        await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct) ?? throw Denied();

    public async Task<CommunityServer> AccessAsync(Guid userId, Guid serverId, bool owner, CancellationToken ct)
    {
        var server = await db.Servers.SingleOrDefaultAsync(s => s.Id == serverId && s.DeletedAt == null, ct) ?? throw Missing();
        if (!await db.ServerMembers.AnyAsync(m => m.ServerId == serverId && m.UserId == userId, ct) || (owner && server.OwnerUserId != userId)) throw Denied();
        return server;
    }

    public async Task<IReadOnlyList<ServerView>> ListAsync(Guid userId, CancellationToken ct) =>
        await db.ServerMembers.Where(m => m.UserId == userId)
            .Join(db.Servers.Where(s => s.DeletedAt == null), m => m.ServerId, s => s.Id, (m, s) => new { s.Id, s.Name, s.Icon, s.OwnerUserId, m.Role, MemberCount = db.ServerMembers.Count(x => x.ServerId == s.Id) })
            .OrderBy(s => s.Name).Select(s => new ServerView(s.Id, s.Name, s.Icon, s.OwnerUserId, s.Role, s.MemberCount)).ToListAsync(ct);

    public async Task<ServerView> CreateAsync(Guid userId, string name, CancellationToken ct, string? icon = null)
    {
        await using var gate = await LockAsync($"community:create:{userId:N}", ct);
        if (await db.ServerMembers.CountAsync(m => m.UserId == userId, ct) >= 50) throw new CommunityException(409, "Limite de 50 servidores por conta.");
        var server = CommunityServer.Create(name, userId, clock.GetUtcNow());
        server.SetIcon(icon);
        db.Servers.Add(server);
        db.ServerMembers.Add(ServerMember.Create(server.Id, userId, clock.GetUtcNow(), ServerMember.OwnerRole));
        db.Channels.Add(Channel.Create(server.Id, "Geral", 0, clock.GetUtcNow()));
        await db.SaveChangesAsync(ct);
        return new ServerView(server.Id, server.Name, server.Icon, userId, ServerMember.OwnerRole, 1);
    }

    public async Task<object> DetailsAsync(Guid userId, Guid serverId, CancellationToken ct)
    {
        var server = await AccessAsync(userId, serverId, false, ct);
        var channels = await db.Channels.Where(c => c.ServerId == serverId && c.DeletedAt == null).OrderBy(c => c.Position).ThenBy(c => c.CreatedAt).Select(c => new ChannelView(c.Id, c.Name, c.Position)).ToListAsync(ct);
        var members = await db.ServerMembers.Where(m => m.ServerId == serverId).Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { u.Id, u.Username, Name = u.Nickname ?? u.Username, m.Role }).OrderBy(m => m.Name).Select(m => new MemberView(m.Id, m.Username, m.Name, m.Role)).ToListAsync(ct);
        return new { server.Id, server.Name, server.Icon, server.OwnerUserId, Channels = channels, Members = members };
    }

    public async Task RenameAsync(Guid userId, Guid serverId, string name, CancellationToken ct)
    {
        (await AccessAsync(userId, serverId, true, ct)).Rename(name);
        await db.SaveChangesAsync(ct);
    }
    public async Task SetIconAsync(Guid userId, Guid serverId, string? icon, CancellationToken ct)
    {
        (await AccessAsync(userId, serverId, true, ct)).SetIcon(icon);
        await db.SaveChangesAsync(ct);
    }

    public async Task<ChannelView> CreateChannelAsync(Guid userId, Guid serverId, string name, CancellationToken ct)
    {
        await using var gate = await LockAsync($"community:server:{serverId:N}", ct);
        await AccessAsync(userId, serverId, true, ct);
        var count = await db.Channels.CountAsync(c => c.ServerId == serverId && c.DeletedAt == null, ct);
        if (count >= 30) throw new CommunityException(409, "Limite de 30 canais por servidor.");
        var position = (await db.Channels.Where(c => c.ServerId == serverId).MaxAsync(c => (int?)c.Position, ct) ?? -1) + 1;
        var channel = Channel.Create(serverId, name, position, clock.GetUtcNow());
        db.Channels.Add(channel); await db.SaveChangesAsync(ct);
        return new ChannelView(channel.Id, channel.Name, channel.Position);
    }

    public async Task<Channel> ChannelAsync(Guid userId, Guid channelId, bool owner, CancellationToken ct)
    {
        var channel = await db.Channels.SingleOrDefaultAsync(c => c.Id == channelId && c.DeletedAt == null, ct) ?? throw Missing();
        await AccessAsync(userId, channel.ServerId, owner, ct);
        return channel;
    }

    public async Task RenameChannelAsync(Guid userId, Guid channelId, string name, CancellationToken ct)
    {
        (await ChannelAsync(userId, channelId, true, ct)).Rename(name);
        await db.SaveChangesAsync(ct);
    }

    public async Task ReorderAsync(Guid userId, Guid serverId, Guid[] ids, CancellationToken ct)
    {
        await using var gate = await LockAsync($"community:server:{serverId:N}", ct);
        await AccessAsync(userId, serverId, true, ct);
        var channels = await db.Channels.Where(c => c.ServerId == serverId && c.DeletedAt == null).ToListAsync(ct);
        if (ids.Length != channels.Count || ids.Distinct().Count() != ids.Length || channels.Any(c => !ids.Contains(c.Id))) throw new CommunityException(400, "Informe todos os canais exatamente uma vez.");
        foreach (var channel in channels) channel.Reorder(Array.IndexOf(ids, channel.Id));
        await db.SaveChangesAsync(ct);
    }

    public async Task<object> InviteAsync(Guid userId, Guid serverId, int? maxUses, CancellationToken ct)
    {
        await AccessAsync(userId, serverId, true, ct);
        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        // convite sem prazo: vale até ser revogado pelo dono ou esgotar o limite de usos (se houver)
        var invite = ServerInvite.Create(serverId, userId, Hash(code), clock.GetUtcNow(), expiresAt: null, maxUses);
        db.ServerInvites.Add(invite); await db.SaveChangesAsync(ct);
        return new { invite.Id, Code = code, invite.ExpiresAt };
    }

    private static string Hash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
    private async Task<ServerInvite> FindInviteAsync(string code, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(code) || code.Length != 32) throw new CommunityException(404, "Convite inválido.");
        var digest = Hash(code);
        var invite = await db.ServerInvites.SingleOrDefaultAsync(i => i.CodeHash == digest, ct);
        if (invite is null || !invite.CanAccept(clock.GetUtcNow()) || !await db.Servers.AnyAsync(s => s.Id == invite.ServerId && s.DeletedAt == null, ct)) throw new CommunityException(410, "Convite expirado, revogado ou esgotado.");
        return invite;
    }

    public async Task<object> PreviewInviteAsync(string code, CancellationToken ct)
    {
        var invite = await FindInviteAsync(code, ct);
        var server = await db.Servers.SingleAsync(s => s.Id == invite.ServerId, ct);
        var creator = await db.Users.Where(u => u.Id == invite.CreatedByUserId).Select(u => u.Nickname ?? u.Username).SingleAsync(ct);
        return new { ServerId = server.Id, server.Name, server.Icon, InvitedBy = creator, MemberCount = await db.ServerMembers.CountAsync(m => m.ServerId == server.Id, ct) };
    }

    public async Task<Guid> AcceptInviteAsync(Guid userId, string code, CancellationToken ct)
    {
        await using var gate = await LockAsync($"community:invite:{Hash(code)}", ct);
        // Uma associação existente não consome outra utilização nem depende de o limite já estar esgotado.
        var digest = Hash(code);
        var existing = await db.ServerInvites.SingleOrDefaultAsync(i => i.CodeHash == digest, ct);
        if (existing is not null && await db.ServerMembers.AnyAsync(m => m.ServerId == existing.ServerId && m.UserId == userId, ct) && await db.Servers.AnyAsync(s => s.Id == existing.ServerId && s.DeletedAt == null, ct)) return existing.ServerId;
        var invite = await FindInviteAsync(code, ct);
        await using var serverGate = await LockAsync($"community:server:{invite.ServerId:N}", ct);
        if (await db.ServerMembers.AnyAsync(m => m.ServerId == invite.ServerId && m.UserId == userId, ct)) return invite.ServerId;
        if (await db.ServerMembers.CountAsync(m => m.UserId == userId, ct) >= 50) throw new CommunityException(409, "Limite de servidores atingido.");
        invite.RecordUse(clock.GetUtcNow());
        db.ServerMembers.Add(ServerMember.Create(invite.ServerId, userId, clock.GetUtcNow()));
        await db.SaveChangesAsync(ct);
        return invite.ServerId;
    }

    public async Task RevokeInviteAsync(Guid userId, Guid serverId, Guid inviteId, CancellationToken ct)
    {
        await AccessAsync(userId, serverId, true, ct);
        var invite = await db.ServerInvites.SingleOrDefaultAsync(i => i.Id == inviteId && i.ServerId == serverId, ct) ?? throw Missing();
        invite.Revoke(clock.GetUtcNow()); await db.SaveChangesAsync(ct);
    }

    public async Task RemoveMemberAsync(Guid actorId, Guid serverId, Guid targetId, CancellationToken ct)
    {
        var server = await AccessAsync(actorId, serverId, actorId != targetId, ct);
        if (server.OwnerUserId == targetId) throw new CommunityException(409, "O proprietário deve excluir o servidor antes de sair.");
        await using var userGate = await LockAsync($"community:user:{targetId:N}", ct);
        var member = await db.ServerMembers.SingleOrDefaultAsync(m => m.ServerId == serverId && m.UserId == targetId, ct);
        if (member is null) return;
        db.ServerMembers.Remove(member); await db.SaveChangesAsync(ct);
        await DisconnectUserAsync(targetId, serverId, ct);
    }

    public async Task DeleteServerAsync(Guid userId, Guid serverId, CancellationToken ct)
    {
        var server = await AccessAsync(userId, serverId, true, ct);
        server.Delete(clock.GetUtcNow()); await db.SaveChangesAsync(ct);
        foreach (var channel in await db.Channels.Where(c => c.ServerId == serverId && c.MediaRoomId != null).ToListAsync(ct)) await EmptyRoomAsync(channel.MediaRoomId!.Value, ct);
    }

    public async Task DeleteChannelAsync(Guid userId, Guid channelId, CancellationToken ct)
    {
        var channel = await ChannelAsync(userId, channelId, true, ct);
        channel.Delete(clock.GetUtcNow()); await db.SaveChangesAsync(ct);
        if (channel.MediaRoomId is { } roomId) await EmptyRoomAsync(roomId, ct);
    }

    private async Task EmptyRoomAsync(Guid roomId, CancellationToken ct)
    {
        foreach (var p in await sfu.ListParticipantsAsync(roomId, ct))
            if (ParticipantIdentity.TryParse(p.Identity, out var identity)) await sfu.RemoveParticipantAsync(roomId, identity, ct);
    }

    private async Task DisconnectUserAsync(Guid userId, Guid? serverId, CancellationToken ct)
    {
        var user = await UserAsync(userId, ct);
        var ids = await db.Channels.Where(c => serverId == null || c.ServerId == serverId).Where(c => c.MediaRoomId != null).Select(c => c.MediaRoomId!.Value).ToListAsync(ct);
        var participants = await db.Participants.Where(p => p.GuestId == user.GuestId && ids.Contains(p.RoomId) && p.Status != ParticipantStatus.Disconnected).ToListAsync(ct);
        foreach (var participant in participants)
        {
            await sfu.RemoveParticipantAsync(participant.RoomId, participant.ParticipantIdentity, ct);
            participant.SetPublishingLease(null); participant.MarkLeft(null, "channel_leave", clock.GetUtcNow());
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task<JoinedRoom> JoinAsync(Guid userId, Guid channelId, CancellationToken ct, Guid? sessionId = null, string? stamp = null)
    {
        await using var userGate = await LockAsync($"community:user:{userId:N}", ct);
        var user = await UserAsync(userId, ct);
        var channel = await ChannelAsync(userId, channelId, false, ct);
        await using var channelGate = await LockAsync($"community:channel:{channelId:N}", ct);
        if (channel.MediaRoomId is null)
        {
            var ownerGuest = await db.Users.Where(u => u.Id == db.Servers.Where(s => s.Id == channel.ServerId).Select(s => s.OwnerUserId).First()).Select(u => u.GuestId).SingleAsync(ct);
            var room = Room.CreateForChannel(ownerGuest, clock.GetUtcNow());
            db.Rooms.Add(room); channel.BindMediaRoom(room.Id); await db.SaveChangesAsync(ct);
        }
        // Atualiza também canais existentes, sem recriar salas ou perder participantes.
        var mediaRoom = await db.Rooms.SingleAsync(r => r.Id == channel.MediaRoomId, ct);
        if (!mediaRoom.MediaPolicy.Audio.Enabled) { mediaRoom.EnableChannelAudio(); await db.SaveChangesAsync(ct); }
        // Um usuário permanece em um canal por vez; a mesma identidade permite refresh sem duplicar vaga.
        var previous = await db.Participants.Where(p => p.GuestId == user.GuestId && p.RoomId == channel.MediaRoomId).OrderByDescending(p => p.JoinedAt).FirstOrDefaultAsync(ct);
        var otherChannels = await db.Channels.Where(c => c.MediaRoomId != null && c.MediaRoomId != channel.MediaRoomId).Select(c => c.MediaRoomId!.Value).ToListAsync(ct);
        foreach (var p in await db.Participants.Where(p => p.GuestId == user.GuestId && otherChannels.Contains(p.RoomId) && p.Status != ParticipantStatus.Disconnected).ToListAsync(ct))
        {
            await sfu.RemoveParticipantAsync(p.RoomId, p.ParticipantIdentity, ct); p.SetPublishingLease(null); p.MarkLeft(null, "channel_switch", clock.GetUtcNow());
        }
        await db.SaveChangesAsync(ct);
        var code = await db.Rooms.Where(r => r.Id == channel.MediaRoomId).Select(r => r.Code).SingleAsync(ct);
        var result = await rooms.JoinAsync(new JoinRequest(code, user.GuestId, user.ShownName, previous?.Id), ct);
        if (!result.IsSuccess) throw new CommunityException(result.Error!.Status, result.Error.Detail);
        var joined = await db.Participants.SingleAsync(p => p.Id == result.Value!.Participant.Id, ct);
        joined.BindAccountSession(sessionId, stamp); joined.SetPublishingLease(null);
        await db.SaveChangesAsync(ct);
        return result.Value!;
    }

    public async Task LeaveChannelAsync(Guid userId, Guid channelId, CancellationToken ct)
    {
        await using var userGate = await LockAsync($"community:user:{userId:N}", ct);
        var channel = await ChannelAsync(userId, channelId, false, ct);
        if (channel.MediaRoomId is not { } roomId) return;
        var user = await UserAsync(userId, ct);
        foreach (var p in await db.Participants.Where(p => p.GuestId == user.GuestId && p.RoomId == roomId && p.Status != ParticipantStatus.Disconnected).ToListAsync(ct))
        {
            await sfu.RemoveParticipantAsync(roomId, p.ParticipantIdentity, ct); p.SetPublishingLease(null); p.MarkLeft(null, "channel_leave", clock.GetUtcNow());
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task PublishAsync(Guid userId, Guid channelId, bool allowed, CancellationToken ct)
    {
        var channel = await ChannelAsync(userId, channelId, false, ct);
        if (channel.MediaRoomId is not { } roomId) throw new CommunityException(409, "Entre no canal primeiro.");
        await using var gate = await LockAsync($"community:publish:{roomId:N}", ct);
        var user = await UserAsync(userId, ct);
        var connected = await sfu.ListParticipantsAsync(roomId, ct);
        var p = await db.Participants.Where(p => p.GuestId == user.GuestId && p.RoomId == roomId).OrderByDescending(p => p.JoinedAt).FirstOrDefaultAsync(ct) ?? throw Denied();
        if (!connected.Any(x => x.Identity == p.Identity)) throw new CommunityException(409, "A conexão com o canal ainda não está pronta.");
        var now = clock.GetUtcNow();
        if (allowed)
        {
            // Revoga concessões vencidas antes de reutilizar as vagas, sob o mesmo lock.
            foreach (var expired in await db.Participants.Where(x => x.RoomId == roomId && x.PublishingAllowedUntil <= now).ToListAsync(ct))
            {
                if (!connected.Any(x => x.Identity == expired.Identity && x.Tracks.Any(t => t.Source == MediaSource.ScreenShare)))
                { if (connected.Any(x => x.Identity == expired.Identity)) await sfu.SetPublishingAsync(roomId, expired.ParticipantIdentity, false, ct); expired.SetPublishingLease(null); }
            }
            var active = connected.Where(x => x.Tracks.Any(t => t.Source == MediaSource.ScreenShare)).Select(x => x.Identity).ToHashSet(StringComparer.Ordinal);
            active.UnionWith(await db.Participants.Where(x => x.RoomId == roomId && x.PublishingAllowedUntil > now).Select(x => x.Identity).ToListAsync(ct));
            active.Remove(p.Identity);
            if (active.Count >= 4) throw new CommunityException(409, "Este canal já possui quatro transmissores.");
        }
        p.SetPublishingLease(allowed ? now.AddSeconds(45) : null);
        await db.SaveChangesAsync(ct);
        await sfu.SetPublishingAsync(roomId, p.ParticipantIdentity, allowed, ct);
    }

    public async Task<IReadOnlyList<ChannelPresence>> PresenceAsync(Guid userId, Guid serverId, CancellationToken ct)
    {
        await AccessAsync(userId, serverId, false, ct);
        var channels = await db.Channels.Where(c => c.ServerId == serverId && c.DeletedAt == null).OrderBy(c => c.Position).ToListAsync(ct);
        var result = new List<ChannelPresence>();
        foreach (var channel in channels)
        {
            var participants = new List<PresenceView>();
            if (channel.MediaRoomId is { } roomId)
            {
                var actual = await sfu.ListParticipantsAsync(roomId, ct);
                var accounts = await db.Participants.Where(p => p.RoomId == roomId).Join(db.Users, p => p.GuestId, u => u.GuestId, (p, u) => new { p.Identity, u.Id, Name = u.Nickname ?? u.Username }).ToListAsync(ct);
                foreach (var p in actual.Where(p => p.State != "disconnected"))
                {
                    var account = accounts.Find(a => a.Identity == p.Identity);
                    if (account is not null && await db.ServerMembers.AnyAsync(m => m.ServerId == serverId && m.UserId == account.Id, ct)) participants.Add(new PresenceView(account.Id, p.Identity, account.Name, p.Tracks.Any(t => t.Source == MediaSource.ScreenShare)));
                }
            }
            result.Add(new ChannelPresence(channel.Id, channel.Name, participants));
        }
        return result;
    }
}
