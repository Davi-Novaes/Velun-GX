using System.Globalization;
using ScreenShare.Api.Security;
using ScreenShare.Infrastructure.Redis;

namespace ScreenShare.Api.Http;

public sealed class RateLimitRule
{
    public int Limit { get; set; }
    public int WindowSeconds { get; set; }
}

/// <summary>Regras em <c>RateLimits:{política}</c> (appsettings); valores podem ser ajustados por ambiente.</summary>
public sealed class RateLimitOptions : Dictionary<string, RateLimitRule>;

internal enum RateLimitPartition
{
    ClientIp,
    Guest,
}

internal static class RateLimitingExtensions
{
    /// <summary>Aplica a política ao endpoint. Estourou: 429 com Retry-After.</summary>
    public static RouteHandlerBuilder WithRateLimit(this RouteHandlerBuilder builder, string policy, RateLimitPartition partition) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var rules = http.RequestServices.GetRequiredService<Microsoft.Extensions.Options.IOptions<RateLimitOptions>>().Value;
            if (!rules.TryGetValue(policy, out var rule) || rule.Limit <= 0)
                return await next(context);

            var key = partition switch
            {
                RateLimitPartition.Guest when http.User.Identity?.IsAuthenticated == true => "g:" + http.User.GuestId().ToString("N"),
                _ => "ip:" + (http.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
            };

            var limiter = http.RequestServices.GetRequiredService<IRateLimiter>();
            var decision = await limiter.CheckAsync(policy, key, rule.Limit, TimeSpan.FromSeconds(rule.WindowSeconds));
            if (decision.Allowed)
                return await next(context);

            var retryAfter = Math.Max(1, (int)Math.Ceiling(decision.RetryAfter.TotalSeconds));
            http.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
            return Results.Problem(Problems.Create(StatusCodes.Status429TooManyRequests, "RATE_LIMITED", "Muitas tentativas",
                $"Aguarde {retryAfter} s e tente novamente."));
        });
}
