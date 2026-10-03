using System.Diagnostics.Metrics;

namespace ScreenShare.Api.Observability;

/// <summary>Métricas da aplicação exportadas em /metrics (prefixo <c>screenshare_</c>).</summary>
public sealed class AppMetrics
{
    public const string MeterName = "ScreenShare";

    private readonly Counter<long> _sfuWebhooks;
    private readonly Counter<long> _roomsCreated;
    private readonly Counter<long> _joins;

    public AppMetrics(IMeterFactory meterFactory)
    {
        var meter = meterFactory.Create(MeterName);
        _sfuWebhooks = meter.CreateCounter<long>("screenshare_sfu_webhooks", description: "Webhooks recebidos do SFU, por tipo e resultado.");
        _roomsCreated = meter.CreateCounter<long>("screenshare_rooms_created", description: "Salas criadas.");
        _joins = meter.CreateCounter<long>("screenshare_room_joins", description: "Tentativas de entrada em sala, por resultado.");
    }

    public void SfuWebhookReceived(string eventType, string outcome) =>
        _sfuWebhooks.Add(1, new KeyValuePair<string, object?>("event", eventType), new KeyValuePair<string, object?>("outcome", outcome));

    public void RoomCreated() => _roomsCreated.Add(1);

    public void JoinAttempted(string result) => _joins.Add(1, new KeyValuePair<string, object?>("result", result));
}
