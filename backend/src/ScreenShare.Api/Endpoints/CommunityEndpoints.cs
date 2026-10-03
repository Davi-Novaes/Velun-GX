using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Api.Http;
using ScreenShare.Api.Security;
using ScreenShare.Infrastructure.Communities;

namespace ScreenShare.Api.Endpoints;

internal static class CommunityEndpoints
{
    private static Guid User(HttpContext http) => Guid.Parse(http.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    public static void MapCommunityEndpoints(this IEndpointRouteBuilder api)
    {
        var product = api.MapGroup("").RequireAuthorization(AccountAuthentication.Policy);
        product.AddEndpointFilter(async (ctx, next) =>
        {
            ctx.HttpContext.Response.Headers.CacheControl = "no-store";
            try
            {
                if (!HttpMethods.IsGet(ctx.HttpContext.Request.Method)) return await AccountEndpoints.ValidateCsrfAsync(ctx, next);
                return await next(ctx);
            }
            catch (CommunityException ex) { return Results.Problem(Problems.Create(ex.Status, "COMMUNITY_ERROR", "Servidor", ex.Message)); }
            catch (ArgumentException ex) { return Results.Problem(Problems.Create(400, "VALIDATION_ERROR", "Dados inválidos", ex.Message)); }
            catch (ScreenShare.Application.Sfu.SfuException) { return Results.Problem(Problems.Create(503, "SFU_UNAVAILABLE", "Mídia indisponível", "Não foi possível conectar ao servidor de mídia. Tente novamente.")); }
        });
        product.MapGet("/servers", async (HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(await s.ListAsync(User(h), ct)));
        product.MapPost("/servers", async (NameBody b, HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(await s.CreateAsync(User(h), b.Name, ct, b.Icon))).WithRateLimit("community-write", RateLimitPartition.ClientIp);
        product.MapPut("/servers/{id:guid}/icon", async (Guid id, IconBody b, HttpContext h, CommunityService s, CancellationToken ct) => { await s.SetIconAsync(User(h), id, b.Icon, ct); return Results.NoContent(); });
        product.MapGet("/servers/{id:guid}", async (Guid id, HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(await s.DetailsAsync(User(h), id, ct)));
        product.MapPatch("/servers/{id:guid}", async (Guid id, NameBody b, HttpContext h, CommunityService s, CancellationToken ct) => { await s.RenameAsync(User(h), id, b.Name, ct); return Results.NoContent(); });
        product.MapDelete("/servers/{id:guid}", async (Guid id, HttpContext h, CommunityService s, CancellationToken ct) => { await s.DeleteServerAsync(User(h), id, ct); return Results.NoContent(); });
        product.MapPost("/servers/{id:guid}/leave", async (Guid id, HttpContext h, CommunityService s, CancellationToken ct) => { await s.RemoveMemberAsync(User(h), id, User(h), ct); return Results.NoContent(); });
        product.MapDelete("/servers/{id:guid}/members/{target:guid}", async (Guid id, Guid target, HttpContext h, CommunityService s, CancellationToken ct) => { await s.RemoveMemberAsync(User(h), id, target, ct); return Results.NoContent(); });
        product.MapPost("/servers/{id:guid}/channels", async (Guid id, NameBody b, HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(await s.CreateChannelAsync(User(h), id, b.Name, ct)));
        product.MapPatch("/channels/{id:guid}", async (Guid id, NameBody b, HttpContext h, CommunityService s, CancellationToken ct) => { await s.RenameChannelAsync(User(h), id, b.Name, ct); return Results.NoContent(); });
        product.MapDelete("/channels/{id:guid}", async (Guid id, HttpContext h, CommunityService s, CancellationToken ct) => { await s.DeleteChannelAsync(User(h), id, ct); return Results.NoContent(); });
        product.MapPut("/servers/{id:guid}/channels/order", async (Guid id, OrderBody b, HttpContext h, CommunityService s, CancellationToken ct) => { await s.ReorderAsync(User(h), id, b.Ids, ct); return Results.NoContent(); });
        product.MapPost("/servers/{id:guid}/invites", async (Guid id, InviteBody b, HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(await s.InviteAsync(User(h), id, b.MaxUses, ct))).WithRateLimit("community-write", RateLimitPartition.ClientIp);
        product.MapGet("/servers/{id:guid}/invites", async (Guid id, HttpContext h, CommunityService s, ScreenShare.Infrastructure.Persistence.AppDbContext db, CancellationToken ct) =>
        {
            await s.AccessAsync(User(h), id, true, ct);
            return Results.Ok(await db.ServerInvites.Where(i => i.ServerId == id).OrderByDescending(i => i.CreatedAt).Select(i => new { i.Id, i.CreatedAt, i.ExpiresAt, i.RevokedAt, i.Uses, i.MaxUses }).ToListAsync(ct));
        });
        product.MapDelete("/servers/{id:guid}/invites/{invite:guid}", async (Guid id, Guid invite, HttpContext h, CommunityService s, CancellationToken ct) => { await s.RevokeInviteAsync(User(h), id, invite, ct); return Results.NoContent(); });
        product.MapPost("/invites/{code}/accept", async (string code, HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(new { serverId = await s.AcceptInviteAsync(User(h), code, ct) }));
        product.MapGet("/servers/{id:guid}/presence", async (Guid id, HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(await s.PresenceAsync(User(h), id, ct)));
        product.MapPost("/channels/{id:guid}/join", async (Guid id, HttpContext h, CommunityService s, CancellationToken ct) => Results.Ok(await s.JoinAsync(User(h), id, ct, Guid.Parse(h.User.FindFirstValue(AccountAuthentication.SessionClaim)!), h.User.FindFirstValue("security_stamp")))).WithRateLimit("community-write", RateLimitPartition.ClientIp);
        product.MapPost("/channels/{id:guid}/leave", async (Guid id, HttpContext h, CommunityService s, CancellationToken ct) => { await s.LeaveChannelAsync(User(h), id, ct); return Results.NoContent(); });
        product.MapPost("/channels/{id:guid}/broadcast", async (Guid id, PublishBody b, HttpContext h, CommunityService s, CancellationToken ct) => { await s.PublishAsync(User(h), id, b.Enabled, ct); return Results.NoContent(); });
        api.MapGet("/invites/{code}", async (string code, CommunityService s, CancellationToken ct) =>
        {
            try { return Results.Ok(await s.PreviewInviteAsync(code, ct)); }
            catch (CommunityException ex) { return Results.Problem(Problems.Create(ex.Status, "INVITE_INVALID", "Convite", ex.Message)); }
        }).WithRateLimit("rooms-get", RateLimitPartition.ClientIp);
    }
    private sealed record NameBody(string Name, string? Icon);
    private sealed record IconBody(string? Icon);
    private sealed record OrderBody(Guid[] Ids);
    private sealed record InviteBody(int? MaxUses);
    private sealed record PublishBody(bool Enabled);
}
