using ScreenShare.Domain.Media;

namespace ScreenShare.Domain.Rooms;

public enum RoomStatus
{
    Active,
    Expired,
    Closed,
}

public sealed class Room
{
    public const int DefaultMaxParticipants = 20;
    public static readonly TimeSpan InactivityLifetime = TimeSpan.FromHours(24);

    public Guid Id { get; private set; }
    public string Code { get; private set; } = "";
    public string? Name { get; private set; }
    public Guid OwnerGuestId { get; private set; }
    public int MaxParticipants { get; private set; }
    public RoomStatus Status { get; private set; }
    public MediaPolicy MediaPolicy { get; private set; } = MediaPolicy.Default;
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset LastActivityAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public bool IsPersistent { get; private set; }

    public static Room CreateForChannel(Guid ownerGuestId, DateTimeOffset now)
    {
        var room = Create(RoomCode.New(), ownerGuestId, now);
        room.IsPersistent = true;
        room.MediaPolicy = MediaPolicy.Default with
        {
            AllowedSources = [MediaSource.ScreenShare, MediaSource.ScreenShareAudio], MaxConcurrentScreenShares = 4,
            PublishRequiresApproval = true,
        };
        return room;
    }

    private Room() { }

    public void EnableChannelAudio()
    {
        if (!IsPersistent) return;
        MediaPolicy = MediaPolicy with { AllowedSources = [MediaSource.ScreenShare, MediaSource.ScreenShareAudio], Audio = MediaPolicy.Audio with { Enabled = true } };
    }

    public static Room Create(RoomCode code, Guid ownerGuestId, DateTimeOffset now, int maxParticipants = DefaultMaxParticipants)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxParticipants, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(maxParticipants, 100);
        return new Room
        {
            Id = Guid.CreateVersion7(now),
            Code = code.Value,
            OwnerGuestId = ownerGuestId,
            MaxParticipants = maxParticipants,
            Status = RoomStatus.Active,
            MediaPolicy = MediaPolicy.Default,
            CreatedAt = now,
            LastActivityAt = now,
            ExpiresAt = now + InactivityLifetime,
        };
    }

    public bool IsExpired(DateTimeOffset now) => Status != RoomStatus.Active || (!IsPersistent && ExpiresAt <= now);

    /// <summary>Qualquer entrada ou evento da sala renova o prazo de 24 h.</summary>
    public void Touch(DateTimeOffset now)
    {
        if (Status != RoomStatus.Active)
            return;
        LastActivityAt = now;
        ExpiresAt = now + InactivityLifetime;
    }

    public void Expire()
    {
        if (Status == RoomStatus.Active && !IsPersistent)
            Status = RoomStatus.Expired;
    }

    public string RoleFor(Guid guestId) => guestId == OwnerGuestId ? ParticipantRoles.Owner : ParticipantRoles.Member;
}

public static class ParticipantRoles
{
    public const string Owner = "owner";
    public const string Member = "member";
}
