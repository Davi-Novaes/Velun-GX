using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Api.Http;
using ScreenShare.Api.Presence;
using ScreenShare.Api.Security;
using ScreenShare.Application.Sfu;
using ScreenShare.Domain.Media;
using ScreenShare.Domain.Participants;
using ScreenShare.Infrastructure.Persistence;
using ScreenShare.Infrastructure.Redis;
using Microsoft.AspNetCore.Authentication;

namespace ScreenShare.Api.Endpoints;

/// <summary>
/// Painel de administração: quem usa o sistema, quem está online, em qual call e transmitindo o quê.
/// Login próprio de administrador (AdminAuthentication), separado das contas do site. Somente leitura.
/// </summary>
internal static partial class AdminEndpoints
{
    /// <summary>Sem heartbeat há mais que isso = fechou o site/app.</summary>
    private static readonly TimeSpan OnlineWindow = TimeSpan.FromSeconds(60);

    public static void MapAdminEndpoints(this IEndpointRouteBuilder api)
    {
        var admin = api.MapGroup("/admin");
        admin.MapPost("/login", LoginAsync).AddEndpointFilter(AccountEndpoints.ValidateCsrfAsync);
        admin.MapPost("/logout", LogoutAsync).AddEndpointFilter(AccountEndpoints.ValidateCsrfAsync);
        admin.MapGet("/me", (HttpContext http) => { http.Response.Headers.CacheControl = "no-store"; return Results.Ok(new { Username = http.User.Identity!.Name }); })
            .RequireAuthorization(AdminAuthentication.Policy);
        admin.MapGet("/overview", OverviewAsync).RequireAuthorization(AdminAuthentication.Policy);
        admin.MapPost("/users/{id:guid}/ban", BanAsync).RequireAuthorization(AdminAuthentication.Policy).AddEndpointFilter(AccountEndpoints.ValidateCsrfAsync);
        admin.MapPost("/users/{id:guid}/password", SetPasswordAsync).RequireAuthorization(AdminAuthentication.Policy).AddEndpointFilter(AccountEndpoints.ValidateCsrfAsync);
        admin.MapPost("/users/{id:guid}/unban", UnbanAsync).RequireAuthorization(AdminAuthentication.Policy).AddEndpointFilter(AccountEndpoints.ValidateCsrfAsync);
    }

    private static async Task<IResult> LoginAsync(AdminLoginBody body, HttpContext http, IConfiguration configuration, IRateLimiter limiter)
    {
        var settings = AdminAuthentication.Read(configuration);
        if (!settings.Configured)
            return Results.Problem(Problems.Create(503, "ADMIN_DISABLED", "Administração", "O acesso administrativo ainda não foi configurado no servidor."));
        // poucas tentativas: por IP e no total (protege contra tentativas espalhadas por vários IPs)
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        foreach (var (policy, key, limit) in new[] { ("admin-login-ip", ip, 8), ("admin-login-all", "all", 40) })
        {
            var decision = await limiter.CheckAsync(policy, key, limit, TimeSpan.FromMinutes(15));
            if (decision.Allowed) continue;
            http.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(decision.RetryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Results.Problem(Problems.Create(429, "RATE_LIMITED", "Administração", "Muitas tentativas. Aguarde alguns minutos."));
        }
        if ((body.Username?.Length ?? 0) > 64 || (body.Password?.Length ?? 0) > 256 || !AdminAuthentication.Verify(settings, body.Username, body.Password))
            return Results.Problem(Problems.Create(401, "INVALID_CREDENTIALS", "Administração", "Usuário ou senha incorretos."));
        await http.SignInAsync(AdminAuthentication.Scheme, AdminAuthentication.Principal(settings), new AuthenticationProperties { IsPersistent = false });
        return Results.Ok(new { settings.Username });
    }

    private static async Task<IResult> LogoutAsync(HttpContext http, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        await http.SignOutAsync(AdminAuthentication.Scheme);
        return Results.NoContent();
    }

    /// <summary>
    /// Bane a conta: troca o carimbo de segurança e revoga os logins (site e app saem na hora) e tira da call agora,
    /// sem esperar a reconciliação de presença. Login com a senha certa passa a responder ACCOUNT_BANNED.
    /// </summary>
    private static async Task<IResult> BanAsync(Guid id, BanBody body, AppDbContext db, ISfuGateway sfu, TimeProvider clock, ILoggerFactory logs, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return Results.Problem(Problems.Create(404, "USER_NOT_FOUND", "Administração", "Conta não encontrada."));
        var now = clock.GetUtcNow();
        try { user.Ban(now, body.Reason); }
        catch (ArgumentException ex) { return Results.Problem(Problems.Create(400, "VALIDATION_ERROR", "Administração", ex.Message)); }
        await db.AccountSessions.Where(s => s.UserId == id && s.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), ct);
        var live = await db.Participants.Where(p => p.GuestId == user.GuestId && (p.Status == ParticipantStatus.Connected || p.Status == ParticipantStatus.Joining)).ToListAsync(ct);
        foreach (var p in live)
        {
            try { if (ParticipantIdentity.TryParse(p.Identity, out var identity)) await sfu.RemoveParticipantAsync(p.RoomId, identity, ct); }
            catch (SfuException) { /* a reconciliação de presença tira em seguida (sessão revogada) */ }
            p.MarkLeft(null, "banned", now); p.SetPublishingLease(null);
        }
        await db.SaveChangesAsync(ct);
        LogBanned(logs.CreateLogger("ScreenShare.Admin"), user.Id, live.Count);
        return Results.NoContent();
    }

    private static async Task<IResult> UnbanAsync(Guid id, AppDbContext db, ILoggerFactory logs, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return Results.Problem(Problems.Create(404, "USER_NOT_FOUND", "Administração", "Conta não encontrada."));
        user.Unban();
        await db.SaveChangesAsync(ct);
        LogUnbanned(logs.CreateLogger("ScreenShare.Admin"), user.Id);
        return Results.NoContent();
    }

    /// <summary>Define a senha de uma conta (quem esqueceu a senha). Com mustChange, a pessoa cria a própria senha ao entrar.</summary>
    private static async Task<IResult> SetPasswordAsync(Guid id, SetPasswordBody body, ScreenShare.Infrastructure.Accounts.AccountService accounts, ILoggerFactory logs, CancellationToken ct)
    {
        ScreenShare.Domain.Accounts.UserAccount? user;
        try { user = await accounts.SetPasswordByAdminAsync(id, body.Password ?? "", body.MustChange ?? true, ct); }
        catch (ArgumentException ex) { return Results.Problem(Problems.Create(400, "VALIDATION_ERROR", "Administração", ex.Message)); }
        if (user is null) return Results.Problem(Problems.Create(404, "USER_NOT_FOUND", "Administração", "Conta não encontrada."));
        LogPasswordSet(logs.CreateLogger("ScreenShare.Admin"), user.Id, user.MustChangePassword);
        return Results.NoContent();
    }

    private sealed record SetPasswordBody(string? Password, bool? MustChange);

    [LoggerMessage(Level = LogLevel.Warning, Message = "admin.password_set user={UserId} must_change={MustChange}")]
    private static partial void LogPasswordSet(ILogger logger, Guid userId, bool mustChange);

    private sealed record BanBody(string? Reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "admin.user_banned user={UserId} removed_from_calls={Calls}")]
    private static partial void LogBanned(ILogger logger, Guid userId, int calls);

    [LoggerMessage(Level = LogLevel.Warning, Message = "admin.user_unbanned user={UserId}")]
    private static partial void LogUnbanned(ILogger logger, Guid userId);

    private sealed record AdminLoginBody(string? Username, string? Password);

    private static async Task<IResult> OverviewAsync(HttpContext http, AppDbContext db, ISfuGateway sfu, PresenceRegistry registry, TimeProvider clock, CancellationToken ct)
    {
        http.Response.Headers.CacheControl = "no-store";
        var now = clock.GetUtcNow();
        var users = await db.Users.AsNoTracking()
            .Select(u => new { u.Id, u.GuestId, u.Username, u.Nickname, u.CreatedAt, u.LastLoginAt, u.LastSeenAt, u.BannedAt, u.BanReason, u.MustChangePassword })
            .ToListAsync(ct);
        var sessions = await db.AccountSessions.Where(s => s.RevokedAt == null && s.ExpiresAt > now)
            .GroupBy(s => s.UserId).Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.UserId, x => x.Count, ct);
        var servers = await db.Servers.AsNoTracking().Where(s => s.DeletedAt == null)
            .Select(s => new { s.Id, s.Name, s.OwnerUserId }).ToListAsync(ct);
        var serverIds = servers.Select(s => s.Id).ToList();
        var members = await db.ServerMembers.AsNoTracking().Where(m => serverIds.Contains(m.ServerId))
            .Select(m => new { m.ServerId, m.UserId }).ToListAsync(ct);
        var channels = await db.Channels.AsNoTracking().Where(c => c.DeletedAt == null && serverIds.Contains(c.ServerId))
            .Select(c => new { c.Id, c.Name, c.ServerId, c.MediaRoomId }).ToListAsync(ct);

        // Quem está numa call agora: a lista real do servidor de vídeo (não o que a página diz).
        var calls = new Dictionary<Guid, CallView>();
        var sfuAvailable = true;
        try
        {
            var active = (await sfu.ListActiveRoomIdsAsync(ct)).ToHashSet();
            var guests = users.ToDictionary(u => u.GuestId, u => u.Id);
            foreach (var channel in channels.Where(c => c.MediaRoomId is { } room && active.Contains(room)))
            {
                var roomId = channel.MediaRoomId!.Value;
                var identities = await db.Participants.AsNoTracking().Where(p => p.RoomId == roomId)
                    .Select(p => new { p.Identity, p.GuestId }).ToListAsync(ct);
                var serverName = servers.Find(s => s.Id == channel.ServerId)?.Name ?? "";
                var roomParticipants = await sfu.ListParticipantsAsync(roomId, ct);
                var shown = roomParticipants.ToDictionary(p => p.Identity, p => identities.Find(i => i.Identity == p.Identity) is { } known && guests.TryGetValue(known.GuestId, out var uid)
                    ? users.Find(u => u.Id == uid) is { } u ? u.Nickname ?? u.Username : p.Name : p.Name);
                foreach (var p in roomParticipants)
                {
                    if (p.State == "disconnected") continue;
                    var guest = identities.Find(i => i.Identity == p.Identity)?.GuestId;
                    if (guest is null || !guests.TryGetValue(guest.Value, out var userId)) continue;
                    var streaming = p.Tracks.Any(t => t.Source == MediaSource.ScreenShare);
                    calls[userId] = new CallView(channel.ServerId, serverName, channel.Id, channel.Name, streaming, p.JoinedAt,
                        streaming ? ReadStream(p.StreamReport) : null, ReadReceiving(p.ReceiveReport, shown));
                }
            }
        }
        catch (SfuException) { sfuAvailable = false; }

        var online = registry.Subscriptions.Values.Where(s => now - s.HeartbeatAt <= OnlineWindow)
            .GroupBy(s => s.UserId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(s => s.HeartbeatAt).Select(s => DescribeClient(s.Client)).Distinct().ToList());
        var names = users.ToDictionary(u => u.Id, u => u.Nickname ?? u.Username);

        var people = users.Select(u => new
        {
            u.Id, u.Username, u.Nickname, Name = u.Nickname ?? u.Username, u.CreatedAt, u.LastLoginAt, u.BannedAt, u.BanReason, u.MustChangePassword,
            LastSeenAt = online.ContainsKey(u.Id) ? now : u.LastSeenAt,
            Online = online.ContainsKey(u.Id) || calls.ContainsKey(u.Id),
            Clients = online.GetValueOrDefault(u.Id) ?? [],
            Sessions = sessions.GetValueOrDefault(u.Id),
            Servers = members.Where(m => m.UserId == u.Id).Select(m => servers.Find(s => s.Id == m.ServerId)!.Name).Order().ToList(),
            Call = calls.GetValueOrDefault(u.Id),
        }).ToList();

        return Results.Ok(new
        {
            GeneratedAt = now,
            SfuAvailable = sfuAvailable,
            Totals = new
            {
                Users = users.Count,
                Online = people.Count(p => p.Online),
                InCall = calls.Count,
                Streaming = calls.Values.Count(c => c.Streaming),
                Servers = servers.Count,
                ActiveToday = people.Count(p => p.LastSeenAt >= now.AddDays(-1)),
                Banned = users.Count(u => u.BannedAt != null),
            },
            Users = people,
            Servers = servers.Select(s => new
            {
                s.Id, s.Name,
                Owner = names.GetValueOrDefault(s.OwnerUserId) ?? "",
                Members = members.Count(m => m.ServerId == s.Id),
                Channels = channels.Count(c => c.ServerId == s.Id),
                InCall = calls.Values.Count(c => c.ServerId == s.Id),
                Streaming = calls.Values.Count(c => c.ServerId == s.Id && c.Streaming),
            }).OrderByDescending(s => s.InCall).ThenByDescending(s => s.Members).ToList(),
        });
    }

    internal sealed record CallView(Guid ServerId, string Server, Guid ChannelId, string Channel, bool Streaming, DateTimeOffset? Since, StreamView? Stream, IReadOnlyList<ReceiveView> Receiving);
    /// <summary>Como quem assiste está recebendo a transmissão de alguém: fps, travadas no último minuto e perda.</summary>
    internal sealed record ReceiveView(string From, double? Fps, int? FreezesPerMinute, double? LossPercent);

    /// <summary>Lê o "screen.rx" de quem assiste ({identidade: {f, z, l}}), só para transmissões ainda na sala.</summary>
    internal static IReadOnlyList<ReceiveView> ReadReceiving(string? report, IReadOnlyDictionary<string, string> names)
    {
        if (string.IsNullOrEmpty(report) || report.Length > 1500) return [];
        try
        {
            using var doc = JsonDocument.Parse(report);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return [];
            var list = new List<ReceiveView>();
            foreach (var entry in doc.RootElement.EnumerateObject())
            {
                if (!names.TryGetValue(entry.Name, out var from) || entry.Value.ValueKind != JsonValueKind.Object) continue;
                double? Number(string name, double max) => entry.Value.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.GetDouble() is var d && d >= 0 && d <= max ? d : null;
                list.Add(new ReceiveView(from, Number("f", 240), (int?)Number("z", 10_000), Number("l", 100)));
                if (list.Count == 8) break;
            }
            return list;
        }
        catch (JsonException) { return []; }
    }
    internal sealed record StreamView(int? Width, int? Height, double? Fps, string? Codec, bool? Hardware, string? Limitation, double? Mbps);

    /// <summary>Lê o relatório que o emissor publica. Dados do próprio cliente: só exibidos, nunca usados para decidir nada.</summary>
    internal static StreamView? ReadStream(string? report)
    {
        if (string.IsNullOrEmpty(report) || report.Length > 1500) return null;
        try
        {
            using var doc = JsonDocument.Parse(report);
            var r = doc.RootElement;
            if (r.ValueKind != JsonValueKind.Object) return null;
            double? Number(string name, double max) => r.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.GetDouble() is var d && d >= 0 && d <= max ? d : null;
            string? Text(string name, int max) => r.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { } s && s.Length <= max ? s : null;
            var codec = Text("codec", 20);
            return new StreamView((int?)Number("sendWidth", 16384), (int?)Number("sendHeight", 16384), Number("fps", 240),
                codec?.Replace("video/", "", StringComparison.OrdinalIgnoreCase).ToUpperInvariant(),
                r.TryGetProperty("hw", out var hw) && hw.ValueKind is JsonValueKind.True or JsonValueKind.False ? hw.GetBoolean() : null,
                Text("limitation", 20), Number("mbps", 1000) is { } mbps ? Math.Round(mbps, 1) : null);
        }
        catch (JsonException) { return null; }
    }

    /// <summary>"App Velun Gx 0.2.9 · Windows" / "Chrome · Android".</summary>
    internal static string DescribeClient(string agent)
    {
        if (string.IsNullOrWhiteSpace(agent)) return "Desconhecido";
        var os = agent.Contains("Windows", StringComparison.Ordinal) ? "Windows"
            : agent.Contains("Android", StringComparison.Ordinal) ? "Android"
            : agent.Contains("iPhone", StringComparison.Ordinal) || agent.Contains("iPad", StringComparison.Ordinal) ? "iOS"
            : agent.Contains("Mac OS X", StringComparison.Ordinal) ? "macOS"
            : agent.Contains("Linux", StringComparison.Ordinal) ? "Linux" : null;
        var app = VelunAgent().Match(agent);
        var client = app.Success ? $"App Velun Gx {app.Groups[1].Value}"
            : agent.Contains("Edg/", StringComparison.Ordinal) ? "Edge"
            : agent.Contains("OPR/", StringComparison.Ordinal) ? "Opera"
            : agent.Contains("Firefox/", StringComparison.Ordinal) ? "Firefox"
            : agent.Contains("Chrome/", StringComparison.Ordinal) ? "Chrome"
            : agent.Contains("Safari/", StringComparison.Ordinal) ? "Safari" : "Navegador";
        return os is null ? client : $"{client} · {os}";
    }

    [GeneratedRegex(@"velun-gx/(\d+\.\d+\.\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex VelunAgent();
}
