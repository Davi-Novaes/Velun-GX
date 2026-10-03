namespace ScreenShare.Domain.Media;

/// <summary>
/// Origem de uma track. Áudio e vídeo são sempre tracks separadas, cada uma com sua origem,
/// para que possam ser publicadas, silenciadas ou removidas individualmente.
/// Os valores coincidem com os nomes usados pelo SFU no grant <c>canPublishSources</c>.
/// </summary>
public static class MediaSource
{
    public const string ScreenShare = "screen_share";
    public const string ScreenShareAudio = "screen_share_audio";
    public const string Microphone = "microphone";
    public const string Camera = "camera";

    public static readonly IReadOnlySet<string> All =
        new HashSet<string>(StringComparer.Ordinal) { ScreenShare, ScreenShareAudio, Microphone, Camera };

    public static bool IsKnown(string source) => All.Contains(source);
}
