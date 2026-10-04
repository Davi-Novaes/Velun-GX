using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Time.Testing;
using ScreenShare.Application.Sfu;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using Testcontainers.PostgreSql;
using Testcontainers.Redis;

[assembly: AssemblyFixture(typeof(ScreenShare.IntegrationTests.ApiFactory))]

namespace ScreenShare.IntegrationTests;

/// <summary>API completa sobre PostgreSQL e Redis reais (containers descartáveis) e um SFU falso.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string LiveKitKey = "test-key";
    public const string LiveKitSecret = "test-livekit-secret-with-32-characters!";
    public const string AdminUsername = "chefe";
    public const string AdminPassword = "senha-do-painel-de-teste";
    /// <summary>Mesmo formato que o script set-admin.sh grava no servidor (pbkdf2-sha256:iterações:sal:hash).</summary>
    public static readonly string AdminPasswordHash = HashAdminPassword(AdminPassword);

    public static string HashAdminPassword(string password)
    {
        var salt = System.Security.Cryptography.RandomNumberGenerator.GetBytes(16);
        var hash = System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2(System.Text.Encoding.UTF8.GetBytes(password), salt, 100_000, System.Security.Cryptography.HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256:100000:{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18.6-alpine").Build();
    private readonly RedisContainer _redis = new RedisBuilder("redis:8.10.2-alpine").Build();

    public FakeSfuGateway Sfu { get; } = new();
    public FakeTimeProvider Clock { get; } = new(DateTimeOffset.UtcNow);

    public async ValueTask InitializeAsync()
    {
        await Task.WhenAll(_postgres.StartAsync(), _redis.StartAsync());
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
        await _redis.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Postgres", _postgres.GetConnectionString());
        builder.UseSetting("ConnectionStrings:Redis", _redis.GetConnectionString());
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("LiveKit:ApiUrl", "http://livekit.test:7880");
        builder.UseSetting("LiveKit:ApiKey", LiveKitKey);
        builder.UseSetting("LiveKit:ApiSecret", LiveKitSecret);
        builder.UseSetting("Session:SigningKey", "test-session-signing-key-with-32-chars!!");
        builder.UseSetting("Session:SecureCookie", "false");
        builder.UseSetting("Admin:Username", AdminUsername);
        builder.UseSetting("Admin:PasswordHash", AdminPasswordHash);
        // limites por IP altos: todos os testes compartilham o mesmo "IP"
        builder.UseSetting("RateLimits:sessions:Limit", "100000");
        builder.UseSetting("RateLimits:rooms-create-ip:Limit", "100000");
        builder.UseSetting("RateLimits:rooms-get:Limit", "100000");
        builder.UseSetting("RateLimits:auth-register:Limit", "100000");
        builder.UseSetting("RateLimits:auth-login:Limit", "100000");
        builder.UseSetting("RateLimits:community-write:Limit", "100000");

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ISfuGateway>();
            services.AddSingleton<ISfuGateway>(Sfu);
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
            // a manutenção roda explicitamente nos testes
            services.RemoveAll<IHostedService>();
        });
    }

    /// <summary>Cliente com cookies próprios (= um navegador / um convidado), já com sessão criada.</summary>
    public async Task<HttpClient> NewGuestAsync()
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var response = await client.PostAsync("/api/v1/sessions", null);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return client;
    }

    public static async Task<string> CreateRoomAsync(HttpClient guest)
    {
        var response = await guest.PostAsync("/api/v1/rooms", null);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
    }

    public static Task<HttpResponseMessage> JoinAsync(HttpClient guest, string code, string name = "Maria", Guid? participantId = null) =>
        guest.PostAsJsonAsync($"/api/v1/rooms/{code}/join", new { displayName = name, participantId });
}

/// <summary>SFU em memória: salas criadas e participantes "conectados" controlados pelo teste.</summary>
public sealed class FakeSfuGateway : ISfuGateway
{
    public Exception? ActiveRoomsError { get; set; }
    private int _activeRoomLists;
    public int ActiveRoomLists => Volatile.Read(ref _activeRoomLists);
    public Task<IReadOnlyList<Guid>> ListActiveRoomIdsAsync(CancellationToken ct)
    {
        Interlocked.Increment(ref _activeRoomLists);
        if (ActiveRoomsError is { } error) throw error;
        return Task.FromResult<IReadOnlyList<Guid>>(_rooms.Keys.ToList());
    }
    public Task SetPublishingAsync(Guid roomId, ParticipantIdentity identity, bool allowed, CancellationToken ct) => Task.CompletedTask;
    private readonly ConcurrentDictionary<Guid, ConcurrentDictionary<string, byte>> _rooms = new();

    public bool Healthy { get; set; } = true;

    public IReadOnlyCollection<Guid> Rooms => _rooms.Keys.ToList();

    public void Connect(Guid roomId, string identity) => _rooms.GetOrAdd(roomId, _ => new())[identity] = 0;

    public void Disconnect(Guid roomId, string identity) => _rooms.GetOrAdd(roomId, _ => new()).TryRemove(identity, out _);

    public Task EnsureRoomAsync(Guid roomId, int maxParticipants, CancellationToken ct)
    {
        if (!Healthy)
            throw new SfuException("SFU fora do ar (fake).");
        _rooms.GetOrAdd(roomId, _ => new());
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<SfuParticipant>> ListParticipantsAsync(Guid roomId, CancellationToken ct)
    {
        if (!Healthy)
            throw new SfuException("SFU fora do ar (fake).");
        IReadOnlyList<SfuParticipant> list = _rooms.TryGetValue(roomId, out var room)
            ? room.Keys.Select(id => new SfuParticipant("PA_" + id, id, id, "active", null, [])).ToList()
            : [];
        return Task.FromResult(list);
    }

    public Task RemoveParticipantAsync(Guid roomId, ParticipantIdentity identity, CancellationToken ct)
    {
        Disconnect(roomId, identity.Value);
        return Task.CompletedTask;
    }

    public SfuAccessToken CreateAccessToken(Guid roomId, ParticipantIdentity identity, string displayName, string role, MediaPolicy policy) =>
        new($"fake-token:{roomId:N}:{identity.Value}", "", DateTimeOffset.UtcNow.AddMinutes(10));

    public Task<bool> IsHealthyAsync(CancellationToken ct) => Task.FromResult(Healthy);
}
