using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ScreenShare.Application.Common;
using ScreenShare.Application.Sfu;
using ScreenShare.Infrastructure.Background;
using ScreenShare.Infrastructure.Health;
using ScreenShare.Infrastructure.LiveKit;
using ScreenShare.Infrastructure.Persistence;
using ScreenShare.Infrastructure.Redis;
using ScreenShare.Infrastructure.Sessions;
using StackExchange.Redis;

namespace ScreenShare.Infrastructure;

public static class DependencyInjection
{
    public const string ReadyTag = "ready";

    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(TimeProvider.System);

        services.AddOptions<LiveKitOptions>()
            .Bind(configuration.GetSection(LiveKitOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();
        services.AddOptions<SessionOptions>()
            .Bind(configuration.GetSection(SessionOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services.AddSingleton<LiveKitTokenFactory>();
        services.AddSingleton<ISfuWebhookReceiver, LiveKitWebhookReceiver>();
        services.AddHttpClient<ISfuGateway, LiveKitGateway>(client => client.Timeout = TimeSpan.FromSeconds(5));
        services.AddSingleton<SessionTokenService>();

        var postgres = configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("ConnectionStrings:Postgres não configurada.");
        services.AddSingleton(_ => NpgsqlDataSource.Create(postgres));
        services.AddDbContext<AppDbContext>((sp, options) => options
            .UseNpgsql(sp.GetRequiredService<NpgsqlDataSource>())
            .UseSnakeCaseNamingConvention());
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());
        services.AddSingleton<IUniqueViolationDetector, PostgresUniqueViolationDetector>();

        var redis = configuration.GetConnectionString("Redis")
            ?? throw new InvalidOperationException("ConnectionStrings:Redis não configurada.");
        services.AddSingleton<IConnectionMultiplexer>(_ =>
        {
            var redisOptions = ConfigurationOptions.Parse(redis);
            redisOptions.AbortOnConnectFail = false; // sobe mesmo se o Redis ainda não estiver pronto; reconecta sozinho
            return ConnectionMultiplexer.Connect(redisOptions);
        });
        services.AddSingleton<IDistributedLock, RedisDistributedLock>();
        services.AddSingleton<IRateLimiter, RedisRateLimiter>();

        services.AddHostedService<RoomMaintenanceService>();

        services.AddHealthChecks()
            .AddCheck<PostgresHealthCheck>("postgres", tags: [ReadyTag], timeout: TimeSpan.FromSeconds(3))
            .AddCheck<RedisHealthCheck>("redis", tags: [ReadyTag], timeout: TimeSpan.FromSeconds(3))
            .AddCheck<SfuHealthCheck>("sfu", tags: [ReadyTag], timeout: TimeSpan.FromSeconds(3));

        return services;
    }

    /// <summary>Aplica migrations pendentes (usado em desenvolvimento; em produção roda como etapa de deploy).</summary>
    public static async Task MigrateDatabaseAsync(this IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync(ct);
    }
}
