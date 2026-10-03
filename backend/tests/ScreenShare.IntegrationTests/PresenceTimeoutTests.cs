using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using ScreenShare.Application.Sfu;

namespace ScreenShare.IntegrationTests;

public sealed class PresenceTimeoutTests(ApiFactory factory)
{
    [Fact]
    public async Task Sfu_http_timeout_does_not_stop_presence_worker_or_api()
    {
        var sfu = new FakeSfuGateway { ActiveRoomsError = new TaskCanceledException("HttpClient.Timeout") };
        using var isolated = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ISfuGateway>(); services.AddSingleton<ISfuGateway>(sfu);
        }));
        using var client = isolated.CreateClient();
        var type = typeof(Program).Assembly.GetType("ScreenShare.Api.Presence.PresenceWorker", throwOnError: true)!;
        using var worker = (BackgroundService)ActivatorUtilities.CreateInstance(isolated.Services, type);
        await worker.StartAsync(TestContext.Current.CancellationToken);
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            while (sfu.ActiveRoomLists < 2) await Task.Delay(100, timeout.Token);
            Assert.False(worker.ExecuteTask!.IsCompleted);
            var response = await client.GetAsync("/api/v1/auth/me", timeout.Token);
            Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.False(isolated.Services.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping.IsCancellationRequested);
        }
        finally { await worker.StopAsync(CancellationToken.None); }
    }
}
