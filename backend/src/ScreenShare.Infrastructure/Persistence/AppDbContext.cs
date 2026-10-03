using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using ScreenShare.Application.Common;
using ScreenShare.Domain.Guests;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Domain.Rooms;
using ScreenShare.Domain.Accounts;
using ScreenShare.Domain.Communities;

namespace ScreenShare.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options), IAppDbContext
{
    private static readonly JsonSerializerOptions PolicyJson = new(JsonSerializerDefaults.Web);

    public DbSet<Guest> Guests => Set<Guest>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Participant> Participants => Set<Participant>();
    public DbSet<StreamSession> StreamSessions => Set<StreamSession>();
    public DbSet<UserAccount> Users => Set<UserAccount>();
    public DbSet<AccountSession> AccountSessions => Set<AccountSession>();
    public DbSet<CommunityServer> Servers => Set<CommunityServer>();
    public DbSet<ServerMember> ServerMembers => Set<ServerMember>();
    public DbSet<Channel> Channels => Set<Channel>();
    public DbSet<ServerInvite> ServerInvites => Set<ServerInvite>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        CommunityModel.Configure(modelBuilder);
        modelBuilder.Entity<Guest>(e =>
        {
            e.ToTable("guests");
            e.HasKey(g => g.Id);
            e.Property(g => g.Id).ValueGeneratedNever();
        });

        modelBuilder.Entity<Room>(e =>
        {
            e.ToTable("rooms", t => t.HasCheckConstraint("ck_rooms_max_participants", "max_participants BETWEEN 1 AND 100"));
            e.HasKey(r => r.Id);
            e.Property(r => r.Id).ValueGeneratedNever();
            e.Property(r => r.Code).HasMaxLength(RoomCode.Length).IsRequired();
            e.HasIndex(r => r.Code).IsUnique();
            e.Property(r => r.Name).HasMaxLength(80);
            e.Property(r => r.Status).HasConversion(LowercaseEnum<RoomStatus>()).HasMaxLength(16);
            e.Property(r => r.MediaPolicy)
                .HasColumnType("jsonb")
                .HasConversion(
                    p => JsonSerializer.Serialize(p, PolicyJson),
                    s => JsonSerializer.Deserialize<MediaPolicy>(s, PolicyJson)!,
                    new ValueComparer<MediaPolicy>((a, b) => JsonSerializer.Serialize(a, PolicyJson) == JsonSerializer.Serialize(b, PolicyJson),
                        p => JsonSerializer.Serialize(p, PolicyJson).GetHashCode(StringComparison.Ordinal),
                        p => p));
            e.HasOne<Guest>().WithMany().HasForeignKey(r => r.OwnerGuestId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(r => new { r.Status, r.ExpiresAt });
        });

        modelBuilder.Entity<Participant>(e =>
        {
            e.ToTable("participants");
            e.HasKey(p => p.Id);
            e.Property(p => p.Id).ValueGeneratedNever();
            e.Property(p => p.Identity).HasMaxLength(40).IsRequired();
            e.HasIndex(p => p.Identity).IsUnique();
            e.Property(p => p.DisplayName).HasMaxLength(DisplayName.MaxLength * 4).IsRequired();
            e.Property(p => p.Role).HasMaxLength(16).IsRequired();
            e.Property(p => p.Status).HasConversion(LowercaseEnum<ParticipantStatus>()).HasMaxLength(16);
            e.Property(p => p.SfuSid).HasMaxLength(64);
            e.Property(p => p.LeaveReason).HasMaxLength(40);
            e.Ignore(p => p.ParticipantIdentity);
            e.HasOne<Room>().WithMany().HasForeignKey(p => p.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Guest>().WithMany().HasForeignKey(p => p.GuestId).OnDelete(DeleteBehavior.Restrict);
            // presentes na sala (e reservas): consulta quente do join
            e.HasIndex(p => new { p.RoomId, p.Status }).HasFilter("left_at IS NULL");
        });

        modelBuilder.Entity<StreamSession>(e =>
        {
            e.ToTable("stream_sessions");
            e.HasKey(s => s.Id);
            e.Property(s => s.Id).ValueGeneratedNever();
            e.Property(s => s.TrackSid).HasMaxLength(64).IsRequired();
            e.HasIndex(s => s.TrackSid).IsUnique();
            e.Property(s => s.Source).HasMaxLength(32).IsRequired();
            e.Property(s => s.Kind).HasMaxLength(16).IsRequired();
            e.Property(s => s.Codec).HasMaxLength(64);
            e.HasOne<Room>().WithMany().HasForeignKey(s => s.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Participant>().WithMany().HasForeignKey(s => s.ParticipantId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(s => new { s.RoomId, s.StartedAt }).IsDescending(false, true);
        });
    }

    Task<int> IAppDbContext.SaveChangesAsync(CancellationToken ct) => SaveChangesAsync(ct);

    private static ValueConverter<TEnum, string> LowercaseEnum<TEnum>() where TEnum : struct, Enum =>
        new(v => v.ToString().ToLowerInvariant(), s => Enum.Parse<TEnum>(s, ignoreCase: true));
}
