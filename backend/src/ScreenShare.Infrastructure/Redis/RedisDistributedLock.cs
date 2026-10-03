using ScreenShare.Application.Common;
using StackExchange.Redis;

namespace ScreenShare.Infrastructure.Redis;

/// <summary>
/// Lock simples de instância única: SET NX PX com token aleatório; libera só se o token ainda for o nosso
/// (se o TTL venceu e outro processo pegou o lock, não o removemos).
/// </summary>
internal sealed class RedisDistributedLock(IConnectionMultiplexer redis) : IDistributedLock
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(25);

    private const string ReleaseScript = """
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('del', KEYS[1])
        end
        return 0
        """;

    public async Task<IAsyncDisposable?> TryAcquireAsync(string key, TimeSpan ttl, TimeSpan wait, CancellationToken ct)
    {
        var db = redis.GetDatabase();
        var token = Guid.NewGuid().ToString("N");
        var deadline = DateTime.UtcNow + wait;
        while (true)
        {
            if (await db.StringSetAsync(key, token, ttl, When.NotExists))
                return new Releaser(db, key, token);
            if (DateTime.UtcNow >= deadline)
                return null;
            await Task.Delay(RetryDelay, ct);
        }
    }

    private sealed class Releaser(IDatabase db, string key, string token) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync() =>
            await db.ScriptEvaluateAsync(ReleaseScript, [key], [token]);
    }
}
