using ScreenShare.Domain.Media;

namespace ScreenShare.Application.Rooms;

public sealed record CreatedRoom(string Code, int MaxParticipants, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt);

public sealed record RoomInfo(string Code, string Status, int ParticipantCount, int MaxParticipants, bool IsFull);

public sealed record JoinRequest(string Code, Guid GuestId, string? DisplayName, Guid? ParticipantId);

public sealed record JoinedRoom(JoinedParticipant Participant, SfuConnection Sfu, JoinPolicy Policy);

public sealed record JoinedParticipant(Guid Id, string Identity, string DisplayName, string Role);

public sealed record SfuConnection(string Url, string Token, DateTimeOffset ExpiresAt);

public sealed record JoinPolicy(
    int MaxParticipants,
    IReadOnlyList<string> AllowedSources,
    int MaxConcurrentScreenShares,
    VideoPolicy Video,
    AudioPolicy Audio);
