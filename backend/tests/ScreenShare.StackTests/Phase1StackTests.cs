using System.Net;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Infrastructure.LiveKit;

namespace ScreenShare.StackTests;

/// <summary>
/// Critério de saída da Fase 1: backend gera tokens aceitos pelo SFU, o SFU recebe mídia WebRTC real,
/// o backend enxerga os participantes e recebe webhooks assinados, e o proxy não expõe rotas internas.
/// </summary>
public sealed class Phase1StackTests : IDisposable
{
    private readonly Stack _stack = new();

    public void Dispose() => _stack.Dispose();

    private async Task<HttpStatusCode> ValidateAsync(string token)
    {
        using var response = await _stack.Http.GetAsync(new Uri($"{Stack.LiveKitApiUrl}/rtc/validate?access_token={token}"), TestContext.Current.CancellationToken);
        return response.StatusCode;
    }

    [Fact]
    public async Task Sfu_rejects_token_for_room_not_created_by_backend()
    {
        Stack.SkipUnlessEnabled();
        var token = _stack.Gateway.CreateAccessToken(Guid.NewGuid(), ParticipantIdentity.From(Guid.NewGuid()), "Ana", "member", MediaPolicy.Default);

        Assert.Equal(HttpStatusCode.NotFound, await ValidateAsync(token.Token));
    }

    [Fact]
    public async Task Sfu_accepts_backend_token_after_room_is_ensured()
    {
        Stack.SkipUnlessEnabled();
        var roomId = Guid.NewGuid();
        await _stack.Gateway.EnsureRoomAsync(roomId, 20, TestContext.Current.CancellationToken);
        await _stack.Gateway.EnsureRoomAsync(roomId, 20, TestContext.Current.CancellationToken); // idempotente

        var token = _stack.Gateway.CreateAccessToken(roomId, ParticipantIdentity.From(Guid.NewGuid()), "Ana", "member", MediaPolicy.Default);

        Assert.Equal(HttpStatusCode.OK, await ValidateAsync(token.Token));
    }

    [Fact]
    public async Task Sfu_rejects_token_signed_with_another_secret()
    {
        Stack.SkipUnlessEnabled();
        var roomId = Guid.NewGuid();
        await _stack.Gateway.EnsureRoomAsync(roomId, 20, TestContext.Current.CancellationToken);
        var forged = new LiveKitTokenFactory(Microsoft.Extensions.Options.Options.Create(new LiveKitOptions
        {
            ApiUrl = Stack.LiveKitApiUrl,
            ApiKey = _stack.Env["LIVEKIT_API_KEY"],
            ApiSecret = "forged-secret-with-at-least-32-characters!!",
        }), TimeProvider.System);

        var (token, _) = forged.CreateParticipantToken(LiveKitGateway.RoomName(roomId), ParticipantIdentity.From(Guid.NewGuid()), "Eve", "member", MediaPolicy.Default);

        Assert.Equal(HttpStatusCode.Unauthorized, await ValidateAsync(token));
    }

    [Fact]
    public async Task Webrtc_publisher_reaches_sfu_and_backend_receives_signed_webhooks()
    {
        Stack.SkipUnlessEnabled();
        var ct = TestContext.Current.CancellationToken;
        var roomId = Guid.NewGuid();
        var roomName = LiveKitGateway.RoomName(roomId);
        await _stack.Gateway.EnsureRoomAsync(roomId, 20, ct);
        var botIdentity = ParticipantIdentity.From(Guid.NewGuid());
        var container = "lk-phase1-" + roomName[..8];

        // Cliente WebRTC real (Go/Pion) publicando vídeo: ICE → DTLS → SRTP até o SFU.
        var (startCode, startOutput) = await Stack.RunAsync("docker",
            $"run -d --rm --name {container} --network {Stack.Network} {Stack.LkCliImage} room join " +
            $"--url ws://livekit:7880 --api-key {_stack.Env["LIVEKIT_API_KEY"]} --api-secret {_stack.Env["LIVEKIT_API_SECRET"]} " +
            $"--identity {botIdentity.Value} --publish-demo {roomName}", TimeSpan.FromSeconds(30));
        Assert.True(startCode == 0, startOutput);

        try
        {
            var published = await WaitForAsync(async () =>
            {
                var participants = await _stack.Gateway.ListParticipantsAsync(roomId, ct);
                var bot = participants.SingleOrDefault(p => p.Identity == botIdentity.Value);
                return bot is { State: "active" } && bot.Tracks.Any(t => t.Kind == "video");
            }, TimeSpan.FromSeconds(30));
            Assert.True(published, "O publicador não ficou ativo com track de vídeo no SFU em 30 s.");

            await _stack.Gateway.RemoveParticipantAsync(roomId, botIdentity, ct);
            var removed = await WaitForAsync(async () =>
                (await _stack.Gateway.ListParticipantsAsync(roomId, ct)).All(p => p.Identity != botIdentity.Value), TimeSpan.FromSeconds(15));
            Assert.True(removed, "RemoveParticipant não tirou o participante da sala.");

            var webhooksSeen = await WaitForAsync(async () =>
            {
                var (_, logs) = await Stack.RunAsync("docker", $"logs --since 2m {Stack.BackendContainer}", TimeSpan.FromSeconds(15));
                var forRoom = logs.Split('\n').Where(l => l.Contains(roomName, StringComparison.Ordinal)).ToList();
                return forRoom.Any(l => l.Contains("participant_joined", StringComparison.Ordinal))
                    && forRoom.Any(l => l.Contains("track_published", StringComparison.Ordinal))
                    && forRoom.Any(l => l.Contains("participant_left", StringComparison.Ordinal));
            }, TimeSpan.FromSeconds(20));
            Assert.True(webhooksSeen, "O backend não registrou participant_joined, track_published e participant_left para a sala.");
        }
        finally
        {
            await Stack.RunAsync("docker", $"rm -f {container}", TimeSpan.FromSeconds(15));
        }
    }

    [Theory]
    [InlineData("/health/ready")]
    [InlineData("/metrics")]
    [InlineData("/api/v1/webhooks/livekit")]
    public async Task Proxy_does_not_expose_internal_routes(string path)
    {
        Stack.SkipUnlessEnabled();
        var ct = TestContext.Current.CancellationToken;

        // GET cai na SPA (nginx), nunca no backend: nada de relatório de saúde ou métricas
        var body = await _stack.Http.GetStringAsync(new Uri(Stack.ProxyUrl + path), ct);
        Assert.Contains("<div id=\"root\"></div>", body, StringComparison.Ordinal);
        Assert.DoesNotContain("Healthy", body, StringComparison.Ordinal);
        Assert.DoesNotContain("# HELP", body, StringComparison.Ordinal);

        // POST também não alcança o backend (o backend responderia 401 no webhook sem assinatura)
        using var post = await _stack.Http.PostAsync(new Uri(Stack.ProxyUrl + path), content: null, ct);
        Assert.Contains(post.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }

    [Fact]
    public async Task Proxy_routes_signaling_path_to_sfu()
    {
        Stack.SkipUnlessEnabled();
        using var response = await _stack.Http.GetAsync(new Uri(Stack.ProxyUrl + "/rtc/validate?access_token=invalid"), TestContext.Current.CancellationToken);
        // resposta vem do LiveKit (token inválido), não 404 do proxy
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static async Task<bool> WaitForAsync(Func<Task<bool>> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await condition())
                return true;
            await Task.Delay(500);
        }
        return false;
    }
}
