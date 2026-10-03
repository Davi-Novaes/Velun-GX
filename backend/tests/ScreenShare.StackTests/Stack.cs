using System.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ScreenShare.Infrastructure.LiveKit;

namespace ScreenShare.StackTests;

/// <summary>Acesso à stack local do docker compose (infra/), usando os segredos de infra/.env.</summary>
internal sealed class Stack : IDisposable
{
    public const string LiveKitApiUrl = "http://localhost:7880";
    public const string ProxyUrl = "http://localhost";
    public const string LkCliImage = "livekit/livekit-cli:v2.18.8";
    public const string BackendContainer = "screenshare-backend-1";
    public const string Network = "screenshare_app";

    public IReadOnlyDictionary<string, string> Env { get; }
    public IOptions<LiveKitOptions> Options { get; }
    public LiveKitTokenFactory Tokens { get; }
    public LiveKitGateway Gateway { get; }
    public HttpClient Http { get; } = new() { Timeout = TimeSpan.FromSeconds(10) };

    public Stack()
    {
        Env = ReadEnvFile();
        Options = Microsoft.Extensions.Options.Options.Create(new LiveKitOptions
        {
            ApiUrl = LiveKitApiUrl,
            ApiKey = Env["LIVEKIT_API_KEY"],
            ApiSecret = Env["LIVEKIT_API_SECRET"],
        });
        Tokens = new LiveKitTokenFactory(Options, TimeProvider.System);
        Gateway = new LiveKitGateway(Http, Tokens, Options, NullLogger<LiveKitGateway>.Instance);
    }

    public static void SkipUnlessEnabled() =>
        Assert.SkipUnless(Environment.GetEnvironmentVariable("STACK_TESTS") == "1",
            "Defina STACK_TESTS=1 com a stack no ar (docker compose -f infra/docker-compose.yml up -d).");

    public static async Task<(int ExitCode, string Output)> RunAsync(string file, string arguments, TimeSpan timeout)
    {
        using var process = Process.Start(new ProcessStartInfo(file, arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        })!;
        using var cts = new CancellationTokenSource(timeout);
        var stdout = process.StandardOutput.ReadToEndAsync(cts.Token);
        var stderr = process.StandardError.ReadToEndAsync(cts.Token);
        await process.WaitForExitAsync(cts.Token);
        return (process.ExitCode, await stdout + await stderr);
    }

    private static Dictionary<string, string> ReadEnvFile()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "infra", ".env")))
            dir = dir.Parent;
        if (dir is null)
            throw new InvalidOperationException("infra/.env não encontrado. Rode infra/scripts/init-env.ps1.");

        return File.ReadAllLines(Path.Combine(dir.FullName, "infra", ".env"))
            .Where(l => l.Contains('=', StringComparison.Ordinal) && !l.TrimStart().StartsWith('#'))
            .Select(l => l.Split('=', 2))
            .ToDictionary(p => p[0].Trim(), p => p[1].Trim());
    }

    public void Dispose() => Http.Dispose();
}
