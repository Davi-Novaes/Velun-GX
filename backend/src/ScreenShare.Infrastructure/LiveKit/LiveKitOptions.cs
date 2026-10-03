using System.ComponentModel.DataAnnotations;

namespace ScreenShare.Infrastructure.LiveKit;

public sealed class LiveKitOptions
{
    public const string SectionName = "LiveKit";

    /// <summary>URL interna da API do LiveKit (rede Docker), ex.: <c>http://livekit:7880</c>.</summary>
    [Required, Url]
    public string ApiUrl { get; set; } = "";

    /// <summary>
    /// URL que o navegador usa para a sinalização (ws/wss). Vazia = mesma origem da página
    /// (o proxy encaminha <c>/rtc</c> ao LiveKit); o frontend completa com o host atual.
    /// </summary>
    public string PublicUrl { get; set; } = "";

    [Required, MinLength(3)]
    public string ApiKey { get; set; } = "";

    /// <summary>HS256 exige chave de pelo menos 256 bits.</summary>
    [Required, MinLength(32)]
    public string ApiSecret { get; set; } = "";

    /// <summary>Validade do token para conectar. Depois de conectado, o LiveKit renova o token sozinho.</summary>
    [Range(typeof(TimeSpan), "00:01:00", "01:00:00")]
    public TimeSpan JoinTokenLifetime { get; set; } = TimeSpan.FromMinutes(10);

    [Range(10, 3600)]
    public int EmptyTimeoutSeconds { get; set; } = 300;

    [Range(0, 300)]
    public int DepartureTimeoutSeconds { get; set; } = 20;
}
