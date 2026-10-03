using ScreenShare.Api.Observability;
using ScreenShare.Application.Sfu;

namespace ScreenShare.Api.Endpoints;

internal static partial class SfuWebhookEndpoints
{
    private const int MaxBodyBytes = 1024 * 1024;

    public static void MapSfuWebhookEndpoints(this IEndpointRouteBuilder api)
    {
        // Chamado só pelo LiveKit pela rede interna; o proxy público não expõe esta rota.
        api.MapPost("/webhooks/livekit", HandleAsync).ExcludeFromDescription();
    }

    private static async Task<IResult> HandleAsync(
        HttpRequest request,
        ISfuWebhookReceiver receiver,
        ISfuEventProcessor processor,
        AppMetrics metrics,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("ScreenShare.Api.SfuWebhook");

        if (request.ContentLength > MaxBodyBytes)
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, ct);
        if (buffer.Length > MaxBodyBytes)
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

        var result = await receiver.ReceiveAsync(request.Headers.Authorization, buffer.GetBuffer().AsMemory(0, (int)buffer.Length));
        switch (result)
        {
            case SfuWebhookResult.Accepted accepted:
                await processor.HandleAsync(accepted.Event, ct);
                metrics.SfuWebhookReceived(accepted.Event.Type, "accepted");
                return Results.Ok();

            case SfuWebhookResult.Rejected rejected:
                LogRejected(logger, rejected.Reason, request.HttpContext.Connection.RemoteIpAddress?.ToString());
                metrics.SfuWebhookReceived("unknown", "rejected");
                return Results.Unauthorized();

            default:
                throw new InvalidOperationException("Resultado de webhook inesperado.");
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "sfu.webhook_rejected {Reason} from={RemoteIp}")]
    private static partial void LogRejected(ILogger logger, string reason, string? remoteIp);
}
