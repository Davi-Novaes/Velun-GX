using Microsoft.Extensions.Logging;
using StackExchange.Redis;

namespace ScreenShare.Infrastructure.Redis;

public sealed record RateLimitDecision(bool Allowed, TimeSpan RetryAfter);

public interface IRateLimiter
{
    /// <summary>Janela fixa: no máximo <paramref name="limit"/> chamadas por <paramref name="window"/> para a chave.</summary>
    Task<RateLimitDecision> CheckAsync(string policy, string partition, int limit, TimeSpan window);
}

/// <summary>
/// Rate limit distribuído (vale para todas as réplicas do backend). Se o Redis estiver fora,
/// deixa passar e registra: preferimos não derrubar a entrada nas salas por falha do limitador.
/// </summary>
internal sealed partial class RedisRateLimiter(IConnectionMultiplexer redis, TimeProvider clock, ILogger<RedisRateLimiter> logger) : IRateLimiter
{
    private const string Script = """
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then
          redis.call('PEXPIRE', KEYS[1], ARGV[1])
        end
        return { count, redis.call('PTTL', KEYS[1]) }
        """;

    public async Task<RateLimitDecision> CheckAsync(string policy, string partition, int limit, TimeSpan window)
    {
        var windowMs = (long)window.TotalMilliseconds;
        var bucket = clock.GetUtcNow().ToUnixTimeMilliseconds() / windowMs;
        var key = $"rl:{policy}:{partition}:{bucket}";
        try
        {
            var result = (RedisResult[])(await redis.GetDatabase().ScriptEvaluateAsync(Script, [key], [windowMs]))!;
            var count = (long)result[0];
            var ttlMs = Math.Max(0, (long)result[1]);
            return count <= limit
                ? new RateLimitDecision(true, TimeSpan.Zero)
                : new RateLimitDecision(false, TimeSpan.FromMilliseconds(ttlMs));
        }
        catch (Exception ex) when (ex is RedisException or TimeoutException)
        {
            LogFailOpen(logger, policy, ex.Message);
            return new RateLimitDecision(true, TimeSpan.Zero);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "ratelimit.fail_open policy={Policy} error={Error}")]
    private static partial void LogFailOpen(ILogger logger, string policy, string error);
}
