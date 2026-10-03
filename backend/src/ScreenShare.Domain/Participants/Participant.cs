namespace ScreenShare.Domain.Participants;

public enum ParticipantStatus
{
    /// <summary>Token emitido, ainda não conectou ao SFU. Reserva uma vaga por <see cref="Participant.ReservationTtl"/>.</summary>
    Joining,
    Connected,
    Disconnected,
}

public sealed class Participant
{
    /// <summary>Quanto tempo um token emitido segura a vaga antes de o participante conectar.</summary>
    public static readonly TimeSpan ReservationTtl = TimeSpan.FromSeconds(60);

    public Guid Id { get; private set; }
    public Guid RoomId { get; private set; }
    public Guid GuestId { get; private set; }
    public string Identity { get; private set; } = "";
    public string DisplayName { get; private set; } = "";
    public string Role { get; private set; } = "";
    public ParticipantStatus Status { get; private set; }

    /// <summary>Sessão atual no SFU. Eventos de uma sessão antiga (ex.: após reconexão) são ignorados.</summary>
    public string? SfuSid { get; private set; }

    public DateTimeOffset JoinedAt { get; private set; }
    public DateTimeOffset? ConnectedAt { get; private set; }
    public DateTimeOffset? LeftAt { get; private set; }
    public string? LeaveReason { get; private set; }
    public int ReconnectCount { get; private set; }
    public DateTimeOffset? PublishingAllowedUntil { get; private set; }
    public Guid? ChannelSessionId { get; private set; }
    public string? ChannelSecurityStamp { get; private set; }
    public void BindAccountSession(Guid? sessionId, string? stamp) { ChannelSessionId = sessionId; ChannelSecurityStamp = stamp; }
    public void SetPublishingLease(DateTimeOffset? until) => PublishingAllowedUntil = until;

    private Participant() { }

    public static Participant Create(Guid roomId, Guid guestId, DisplayName name, string role, DateTimeOffset now)
    {
        var id = Guid.CreateVersion7(now);
        return new Participant
        {
            Id = id,
            RoomId = roomId,
            GuestId = guestId,
            Identity = ParticipantIdentity.From(id).Value,
            DisplayName = name.Value,
            Role = role,
            Status = ParticipantStatus.Joining,
            JoinedAt = now,
        };
    }

    public ParticipantIdentity ParticipantIdentity => ParticipantIdentity.From(Id);

    /// <summary>Nova entrada com a mesma identidade (reconexão): o SFU derruba a sessão anterior.</summary>
    public void Rejoin(DisplayName name, DateTimeOffset now)
    {
        DisplayName = name.Value;
        Status = ParticipantStatus.Joining;
        JoinedAt = now;
        LeftAt = null;
        LeaveReason = null;
        ReconnectCount++;
    }

    /// <summary>Ocupa vaga se está conectado, ou se o token foi emitido há pouco e ainda pode conectar.</summary>
    public bool HoldsReservation(DateTimeOffset now) =>
        Status == ParticipantStatus.Joining && LeftAt is null && now - JoinedAt < ReservationTtl;

    public void MarkConnected(string sfuSid, DateTimeOffset at)
    {
        SfuSid = sfuSid;
        Status = ParticipantStatus.Connected;
        ConnectedAt = at;
        LeftAt = null;
        LeaveReason = null;
    }

    /// <summary>Retorna falso se o evento é de uma sessão do SFU que já foi substituída.</summary>
    public bool MarkLeft(string? sfuSid, string reason, DateTimeOffset at)
    {
        if (sfuSid is not null && SfuSid is not null && sfuSid != SfuSid)
            return false;
        if (Status == ParticipantStatus.Disconnected)
            return false;
        Status = ParticipantStatus.Disconnected;
        LeftAt = at;
        LeaveReason = reason;
        return true;
    }
}
