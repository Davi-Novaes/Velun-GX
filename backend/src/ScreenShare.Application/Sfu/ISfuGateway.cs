using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;

namespace ScreenShare.Application.Sfu;

/// <summary>
/// Tudo o que o backend precisa do SFU. Isola o LiveKit do resto do código:
/// trocar de SFU significa reimplementar esta interface e o <c>RoomClient</c> do frontend.
/// </summary>
public interface ISfuGateway
{
    /// <summary>Cria a sala no SFU se ainda não existir (idempotente).</summary>
    Task EnsureRoomAsync(Guid roomId, int maxParticipants, CancellationToken ct);

    Task<IReadOnlyList<Guid>> ListActiveRoomIdsAsync(CancellationToken ct);

    Task<IReadOnlyList<SfuParticipant>> ListParticipantsAsync(Guid roomId, CancellationToken ct);

    /// <summary>Remove o participante da sala no SFU. Não falha se ele já saiu.</summary>
    Task RemoveParticipantAsync(Guid roomId, ParticipantIdentity identity, CancellationToken ct);
    Task SetPublishingAsync(Guid roomId, ParticipantIdentity identity, bool allowed, CancellationToken ct);

    /// <summary>Gera o token curto que o navegador usa para conectar ao SFU.</summary>
    SfuAccessToken CreateAccessToken(Guid roomId, ParticipantIdentity identity, string displayName, string role, MediaPolicy policy);

    /// <summary>Verifica se o SFU responde (usado no readiness).</summary>
    Task<bool> IsHealthyAsync(CancellationToken ct);
}

/// <param name="ReceiveReport">Atributo "screen.rx" de quem assiste: fps recebido, travadas por minuto e perda, por transmissão. Só informativo.</param>
/// <param name="StreamReport">Atributo "screen.report" que o próprio emissor publica (resolução, fps, formato). Só informativo.</param>
public sealed record SfuParticipant(string Sid, string Identity, string Name, string State, DateTimeOffset? JoinedAt, IReadOnlyList<SfuTrack> Tracks, string? StreamReport = null, string? ReceiveReport = null);

public sealed record SfuTrack(string Sid, string Source, string Kind, bool Muted);

public sealed record SfuAccessToken(string Token, string Url, DateTimeOffset ExpiresAt);

/// <summary>Falha ao falar com o SFU.</summary>
public sealed class SfuException(string message) : Exception(message);
