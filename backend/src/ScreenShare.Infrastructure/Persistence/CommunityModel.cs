using Microsoft.EntityFrameworkCore;
using ScreenShare.Domain.Accounts;
using ScreenShare.Domain.Communities;
using ScreenShare.Domain.Guests;
using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;

namespace ScreenShare.Infrastructure.Persistence;

internal static class CommunityModel
{
    public static void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ScreenShare.Domain.Participants.Participant>(e =>
        {
            e.Property(x => x.ChannelSecurityStamp).HasMaxLength(32);
            e.HasOne<AccountSession>().WithMany().HasForeignKey(x => x.ChannelSessionId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<AccountSession>(e =>
        {
            e.ToTable("account_sessions");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.UserId, x.ExpiresAt });
        });
        modelBuilder.Entity<UserAccount>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Username).HasMaxLength(32).IsRequired();
            e.Property(x => x.NormalizedUsername).HasMaxLength(32).IsRequired();
            e.HasIndex(x => x.NormalizedUsername).IsUnique();
            e.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();
            e.Property(x => x.SecurityStamp).HasMaxLength(32).IsRequired();
            e.Property(x => x.Avatar).HasMaxLength(256);
            e.Property(x => x.Nickname).HasMaxLength(DisplayName.MaxLength * 4);
            e.Ignore(x => x.ShownName);
            e.Ignore(x => x.IsBanned);
            e.Property(x => x.BanReason).HasMaxLength(UserAccount.BanReasonMaxLength * 4);
            e.HasIndex(x => x.GuestId).IsUnique();
            e.HasOne<Guest>().WithMany().HasForeignKey(x => x.GuestId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<CommunityServer>(e =>
        {
            e.ToTable("community_servers");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Name).HasMaxLength(80).IsRequired();
            e.Property(x => x.Icon).HasMaxLength(90000);
            e.HasOne<UserAccount>().WithMany().HasForeignKey(x => x.OwnerUserId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<ServerMember>(e =>
        {
            e.ToTable("server_members");
            e.HasKey(x => new { x.ServerId, x.UserId });
            e.Property(x => x.Role).HasMaxLength(32).IsRequired();
            e.HasOne<ServerRole>().WithMany().HasForeignKey(x => x.ServerRoleId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => new { x.UserId, x.ServerId });
            e.HasOne<CommunityServer>().WithMany().HasForeignKey(x => x.ServerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<ServerRole>(e =>
        {
            e.ToTable("server_roles");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Name).HasMaxLength(40).IsRequired();
            e.Property(x => x.Color).HasMaxLength(7).IsRequired();
            e.HasIndex(x => new { x.ServerId, x.Position });
            e.HasOne<CommunityServer>().WithMany().HasForeignKey(x => x.ServerId).OnDelete(DeleteBehavior.Cascade);
        });
        modelBuilder.Entity<Channel>(e =>
        {
            e.ToTable("channels", t => t.HasCheckConstraint("ck_channels_position", "position >= 0"));
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Name).HasMaxLength(80).IsRequired();
            e.HasIndex(x => new { x.ServerId, x.Position });
            e.HasIndex(x => x.MediaRoomId).IsUnique().HasFilter("media_room_id IS NOT NULL");
            e.HasOne<CommunityServer>().WithMany().HasForeignKey(x => x.ServerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Room>().WithMany().HasForeignKey(x => x.MediaRoomId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<ServerInvite>(e =>
        {
            e.ToTable("server_invites", t =>
            {
                t.HasCheckConstraint("ck_invites_uses", "uses >= 0 AND (max_uses IS NULL OR (max_uses > 0 AND uses <= max_uses))");
                t.HasCheckConstraint("ck_invites_expiry", "expires_at > created_at");
            });
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.CodeHash).HasMaxLength(64).IsRequired();
            e.HasIndex(x => x.CodeHash).IsUnique();
            e.HasIndex(x => new { x.ServerId, x.ExpiresAt });
            e.Property(x => x.Uses).IsConcurrencyToken();
            e.HasOne<CommunityServer>().WithMany().HasForeignKey(x => x.ServerId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<UserAccount>().WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
