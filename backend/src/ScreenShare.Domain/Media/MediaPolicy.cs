namespace ScreenShare.Domain.Media;

/// <summary>
/// O que os participantes de uma sala podem publicar e com que teto de qualidade.
/// Devolvida ao frontend no join e usada para montar os grants do token do SFU.
/// </summary>
public sealed record MediaPolicy
{
    public const int DefaultMaxConcurrentScreenShares = 3;

    public required IReadOnlyList<string> AllowedSources { get; init; }
    public required int MaxConcurrentScreenShares { get; init; }
    public required VideoPolicy Video { get; init; }
    public required AudioPolicy Audio { get; init; }
    public bool PublishRequiresApproval { get; init; }

    /// <summary>Política do MVP: só compartilhamento de tela (vídeo + áudio opcional), até 3 simultâneos.</summary>
    public static MediaPolicy Default { get; } = new()
    {
        AllowedSources = [MediaSource.ScreenShare, MediaSource.ScreenShareAudio],
        MaxConcurrentScreenShares = DefaultMaxConcurrentScreenShares,
        Video = new VideoPolicy
        {
            MaxWidth = 3840,
            MaxHeight = 2160,
            MaxFps = 60,
            MaxBitrateKbps = 16_000,
            PreferredCodec = "vp8",
            AllowHardwareH264 = true,
        },
        Audio = new AudioPolicy { Enabled = true, MaxBitrateKbps = 96 },
    };

    public void Validate()
    {
        if (AllowedSources.Count == 0)
            throw new ArgumentException("A política precisa permitir ao menos uma origem de mídia.");
        foreach (var source in AllowedSources)
        {
            if (!MediaSource.IsKnown(source))
                throw new ArgumentException($"Origem de mídia desconhecida: '{source}'.");
        }
        if (MaxConcurrentScreenShares is < 1 or > 10)
            throw new ArgumentOutOfRangeException(nameof(MaxConcurrentScreenShares), MaxConcurrentScreenShares, "Esperado entre 1 e 10.");
        Video.Validate();
        Audio.Validate();
    }
}

public sealed record VideoPolicy
{
    public required int MaxWidth { get; init; }
    public required int MaxHeight { get; init; }
    public required int MaxFps { get; init; }
    public required int MaxBitrateKbps { get; init; }
    public required string PreferredCodec { get; init; }
    public required bool AllowHardwareH264 { get; init; }

    internal void Validate()
    {
        if (MaxWidth is < 320 or > 7680 || MaxHeight is < 180 or > 4320)
            throw new ArgumentOutOfRangeException(nameof(MaxWidth), $"{MaxWidth}x{MaxHeight}", "Resolução máxima fora do intervalo suportado.");
        if (MaxFps is < 5 or > 60)
            throw new ArgumentOutOfRangeException(nameof(MaxFps), MaxFps, "Esperado entre 5 e 60.");
        if (MaxBitrateKbps is < 100 or > 50_000)
            throw new ArgumentOutOfRangeException(nameof(MaxBitrateKbps), MaxBitrateKbps, "Esperado entre 100 e 50000.");
        if (PreferredCodec is not ("vp8" or "h264" or "vp9" or "av1"))
            throw new ArgumentException($"Codec não suportado: '{PreferredCodec}'.");
    }
}

public sealed record AudioPolicy
{
    public required bool Enabled { get; init; }
    public required int MaxBitrateKbps { get; init; }

    internal void Validate()
    {
        if (MaxBitrateKbps is < 16 or > 510)
            throw new ArgumentOutOfRangeException(nameof(MaxBitrateKbps), MaxBitrateKbps, "Esperado entre 16 e 510 (limites do Opus).");
    }
}
