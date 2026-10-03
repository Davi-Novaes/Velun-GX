using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
using OpenTelemetry.Metrics;
using ScreenShare.Api.Endpoints;
using ScreenShare.Api.Http;
using ScreenShare.Api.Observability;
using ScreenShare.Api.Security;
using ScreenShare.Application;
using ScreenShare.Infrastructure;
using Serilog;
using Serilog.Formatting.Compact;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using ScreenShare.Domain.Accounts;
using ScreenShare.Infrastructure.Accounts;
using ScreenShare.Infrastructure.Communities;
using ScreenShare.Api.Presence;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Services.AddSerilog((services, lc) => lc
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("service", "backend")
        .WriteTo.Console(new RenderedCompactJsonFormatter()));

    // IP real do cliente vem do proxy (Traefik); só confiamos em cabeçalhos vindos das redes configuradas.
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        foreach (var network in builder.Configuration.GetSection("ReverseProxy:TrustedNetworks").Get<string[]>() ?? [])
            options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        options.KnownProxies.Add(IPAddress.Loopback);
    });

    builder.Services.AddProblemDetails();
    builder.Services.AddApplication();
    builder.Services.AddInfrastructure(builder.Configuration);
    builder.Services.AddSingleton<AppMetrics>();
    builder.Services.Configure<RateLimitOptions>(builder.Configuration.GetSection("RateLimits"));

    builder.Services.AddAuthentication(SessionAuthenticationHandler.SchemeName)
        .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, SessionAuthenticationHandler>(
            SessionAuthenticationHandler.SchemeName, null);
    builder.Services.AddAuthorization();
    builder.Services.AddScoped<AccountService>();
    builder.Services.AddScoped<CommunityService>();
    builder.Services.AddSignalR(options => { options.KeepAliveInterval = TimeSpan.FromSeconds(10); options.ClientTimeoutInterval = TimeSpan.FromSeconds(30); });
    builder.Services.AddSingleton<PresenceRegistry>();
    builder.Services.AddHostedService<PresenceWorker>();
    builder.Services.AddScoped<IPasswordHasher<UserAccount>, PasswordHasher<UserAccount>>();
    builder.Services.Configure<PasswordHasherOptions>(options => options.IterationCount = 210_000);
    var secureCookies = builder.Configuration.GetValue("Session:SecureCookie", true);
    builder.Services.AddAuthentication().AddCookie(AccountAuthentication.Scheme, options =>
    {
        options.Cookie.Name = "ss_account";
        options.Cookie.HttpOnly = true;
        options.Cookie.Path = "/api";
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.None;
        options.ExpireTimeSpan = AccountAuthentication.SessionLifetime;
        options.SlidingExpiration = false;
        options.Events.OnValidatePrincipal = AccountAuthentication.ValidateAsync;
        options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
    });
    builder.Services.AddAuthorization(options => options.AddPolicy(AccountAuthentication.Policy, policy =>
        policy.AddAuthenticationSchemes(AccountAuthentication.Scheme).RequireAuthenticatedUser()));
    builder.Services.AddAntiforgery(options =>
    {
        options.HeaderName = "X-CSRF-Token";
        options.Cookie.Name = "ss_csrf";
        options.Cookie.Path = "/api";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.None;
    });
    var protection = builder.Services.AddDataProtection().SetApplicationName("ScreenShare.Accounts");
    var keysPath = builder.Configuration["Account:KeysPath"];
    if (!string.IsNullOrWhiteSpace(keysPath)) protection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));

    builder.Services.AddOpenTelemetry().WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddMeter(AppMetrics.MeterName)
        .AddPrometheusExporter());

    var app = builder.Build();

    if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
        await app.Services.MigrateDatabaseAsync();

    app.UseForwardedHeaders();
    app.UseExceptionHandler();
    app.UseStatusCodePages();
    app.UseSerilogRequestLogging(o =>
        o.GetLevel = (ctx, _, ex) => ex is not null || ctx.Response.StatusCode >= 500
            ? Serilog.Events.LogEventLevel.Error
            : ctx.Request.Path.StartsWithSegments("/health") || ctx.Request.Path.StartsWithSegments("/metrics")
                ? Serilog.Events.LogEventLevel.Verbose
                : Serilog.Events.LogEventLevel.Information);
    app.UseMiddleware<SameOriginMiddleware>();
    app.UseAuthentication();
    app.UseAuthorization();

    app.MapHealthEndpoints();
    app.MapPrometheusScrapingEndpoint("/metrics");
    var api = app.MapGroup("/api/v1");
    api.MapSessionEndpoints();
    api.MapAccountEndpoints();
    api.MapCommunityEndpoints();
    app.MapHub<PresenceHub>("/api/v1/presence");
    api.MapRoomEndpoints();
    api.MapSfuWebhookEndpoints();

    await app.RunAsync();
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "backend.startup_failed");
    throw;
}
finally
{
    await Log.CloseAndFlushAsync();
}

public partial class Program;
