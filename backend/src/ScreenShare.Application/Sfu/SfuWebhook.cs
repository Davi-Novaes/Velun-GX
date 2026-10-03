namespace ScreenShare.Application.Sfu;

/// <summary>Valida a assinatura e interpreta os webhooks enviados pelo SFU.</summary>
public interface ISfuWebhookReceiver
{
    Task<SfuWebhookResult> ReceiveAsync(string? authorizationHeader, ReadOnlyMemory<byte> body);
}

public abstract record SfuWebhookResult
{
    public sealed record Accepted(SfuEvent Event) : SfuWebhookResult;
    public sealed record Rejected(string Reason) : SfuWebhookResult;
}

/// <summary>Evento do SFU já normalizado. Campos ausentes no tipo de evento ficam nulos.</summary>
public sealed record SfuEvent
{
    public required string Id { get; init; }
    public required string Type { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public string? RoomName { get; init; }
    public string? RoomSid { get; init; }
    public string? ParticipantIdentity { get; init; }
    public string? ParticipantSid { get; init; }
    public string? ParticipantName { get; init; }
    public string? DisconnectReason { get; init; }
    public SfuEventTrack? Track { get; init; }
}

public sealed record SfuEventTrack(string Sid, string Source, string Kind, string? MimeType, int? Width, int? Height);

public static class SfuEventTypes
{
    public const string RoomStarted = "room_started";
    public const string RoomFinished = "room_finished";
    public const string ParticipantJoined = "participant_joined";
    public const string ParticipantLeft = "participant_left";
    public const string TrackPublished = "track_published";
    public const string TrackUnpublished = "track_unpublished";
}

/// <summary>Processa eventos do SFU (persistência e métricas entram na Fase 2).</summary>
public interface ISfuEventProcessor
{
    Task HandleAsync(SfuEvent sfuEvent, CancellationToken ct);
}
