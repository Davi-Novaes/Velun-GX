namespace ScreenShare.Domain.Media;

/// <summary>Uma track publicada no SFU. Áudio e vídeo do mesmo compartilhamento são linhas separadas.</summary>
public sealed class StreamSession
{
    public Guid Id { get; private set; }
    public Guid RoomId { get; private set; }
    public Guid ParticipantId { get; private set; }
    public string TrackSid { get; private set; } = "";
    public string Source { get; private set; } = "";
    public string Kind { get; private set; } = "";
    public string? Codec { get; private set; }
    public int? Width { get; private set; }
    public int? Height { get; private set; }
    public DateTimeOffset StartedAt { get; private set; }
    public DateTimeOffset? EndedAt { get; private set; }

    private StreamSession() { }

    public static StreamSession Start(Guid roomId, Guid participantId, string trackSid, string source, string kind,
        string? codec, int? width, int? height, DateTimeOffset at) => new()
    {
        Id = Guid.CreateVersion7(at),
        RoomId = roomId,
        ParticipantId = participantId,
        TrackSid = trackSid,
        Source = source,
        Kind = kind,
        Codec = codec,
        Width = width,
        Height = height,
        StartedAt = at,
    };

    public void End(DateTimeOffset at) => EndedAt ??= at;
}
