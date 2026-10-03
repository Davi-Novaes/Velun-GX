using ScreenShare.Api.Http;
using ScreenShare.Api.Observability;
using ScreenShare.Api.Security;
using ScreenShare.Application.Rooms;

namespace ScreenShare.Api.Endpoints;

internal static class RoomEndpoints
{
    public static void MapRoomEndpoints(this IEndpointRouteBuilder api)
    {
        var rooms = api.MapGroup("/rooms");

        rooms.MapPost("/", CreateAsync).RequireAuthorization()
            .WithRateLimit("rooms-create", RateLimitPartition.Guest)
            .WithRateLimit("rooms-create-ip", RateLimitPartition.ClientIp);

        rooms.MapGet("/{code}", GetAsync).WithRateLimit("rooms-get", RateLimitPartition.ClientIp);

        rooms.MapPost("/{code}/join", JoinAsync).RequireAuthorization()
            .WithRateLimit("rooms-join", RateLimitPartition.Guest);

        rooms.MapPost("/{code}/leave", LeaveAsync).RequireAuthorization()
            .WithRateLimit("rooms-leave", RateLimitPartition.Guest);
    }

    private static async Task<IResult> CreateAsync(HttpContext http, RoomService rooms, AppMetrics metrics, CancellationToken ct)
    {
        var room = await rooms.CreateAsync(http.User.GuestId(), ct);
        metrics.RoomCreated();
        var url = $"{http.Request.Scheme}://{http.Request.Host}/room/{room.Code}";
        return Results.Created(url, new { room.Code, Url = url, room.MaxParticipants, room.CreatedAt, room.ExpiresAt });
    }

    private static async Task<IResult> GetAsync(string code, RoomService rooms, ScreenShare.Infrastructure.Persistence.AppDbContext db, CancellationToken ct) =>
        await IsChannelAsync(code, db, ct) ? Results.NotFound() : (await rooms.GetAsync(code, ct)).ToHttp(Results.Ok);

    private static Task<bool> IsChannelAsync(string code, ScreenShare.Infrastructure.Persistence.AppDbContext db, CancellationToken ct)
    {
        var normalized = code.ToUpperInvariant();
        return Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.AnyAsync(db.Rooms.Where(r => r.Code == normalized), r => r.IsPersistent, ct);
    }

    private static async Task<IResult> JoinAsync(string code, JoinBody? body, HttpContext http, RoomService rooms, AppMetrics metrics, ScreenShare.Infrastructure.Persistence.AppDbContext db, CancellationToken ct)
    {
        if (await IsChannelAsync(code, db, ct)) return Results.Forbid();
        var result = await rooms.JoinAsync(new JoinRequest(code, http.User.GuestId(), body?.DisplayName, body?.ParticipantId), ct);
        metrics.JoinAttempted(result.IsSuccess ? "accepted" : result.Error!.Code.ToLowerInvariant());
        return result.ToHttp(Results.Ok);
    }

    private static async Task<IResult> LeaveAsync(string code, LeaveBody? body, HttpContext http, RoomService rooms, ScreenShare.Infrastructure.Persistence.AppDbContext db, CancellationToken ct)
    {
        if (await IsChannelAsync(code, db, ct)) return Results.Forbid();
        if (body?.ParticipantId is not { } participantId)
            return Problems.From(Application.Common.AppError.Validation("participantId é obrigatório."));
        return (await rooms.LeaveAsync(code, http.User.GuestId(), participantId, ct)).ToHttp(_ => Results.NoContent());
    }

    internal sealed record JoinBody(string? DisplayName, Guid? ParticipantId);

    internal sealed record LeaveBody(Guid? ParticipantId);
}
