namespace ScreenShare.Domain.Participants;

/// <summary>
/// Identidade do participante no SFU: <c>p_</c> + id do participante (UUID sem hífens).
/// Reusar a mesma identidade numa reconexão faz o SFU derrubar a sessão antiga,
/// evitando que um "fantasma" ocupe uma vaga da sala.
/// </summary>
public readonly record struct ParticipantIdentity
{
    private const string Prefix = "p_";

    public string Value { get; }

    private ParticipantIdentity(string value) => Value = value;

    public static ParticipantIdentity From(Guid participantId)
    {
        if (participantId == Guid.Empty)
            throw new ArgumentException("Id de participante vazio.", nameof(participantId));
        return new ParticipantIdentity(Prefix + participantId.ToString("N"));
    }

    public static bool TryParse(string? value, out ParticipantIdentity identity)
    {
        identity = default;
        if (value is null || !value.StartsWith(Prefix, StringComparison.Ordinal))
            return false;
        if (!Guid.TryParseExact(value.AsSpan(Prefix.Length), "N", out var id) || id == Guid.Empty)
            return false;
        identity = new ParticipantIdentity(value);
        return true;
    }

    public Guid ParticipantId => Guid.ParseExact(Value.AsSpan(Prefix.Length), "N");

    public override string ToString() => Value;
}
