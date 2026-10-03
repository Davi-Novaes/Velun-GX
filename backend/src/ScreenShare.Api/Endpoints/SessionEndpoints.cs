using ScreenShare.Api.Http;
using ScreenShare.Api.Security;
using ScreenShare.Application.Guests;
using ScreenShare.Infrastructure.Sessions;

namespace ScreenShare.Api.Endpoints;

internal static class SessionEndpoints
{
    public static void MapSessionEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPost("/sessions", CreateAsync).WithRateLimit("sessions", RateLimitPartition.ClientIp);
        api.MapGet("/sessions/current", Current).RequireAuthorization();
    }

    /// <summary>Cria a sessão de convidado. Se já existe uma válida, apenas a renova (mesmo guestId).</summary>
    private static async Task<IResult> CreateAsync(HttpContext http, GuestService guests, SessionTokenService sessions, CancellationToken ct)
    {
        Guid guestId;
        var status = StatusCodes.Status200OK;
        if (http.User.Identity?.IsAuthenticated == true)
        {
            guestId = http.User.GuestId();
        }
        else
        {
            guestId = (await guests.CreateAsync(ct)).Id;
            status = StatusCodes.Status201Created;
        }

        var token = sessions.Issue(guestId);
        SessionCookie.Write(http.Response, sessions, token);
        return Results.Json(new SessionResponse(guestId, token.ExpiresAt), statusCode: status);
    }

    private static IResult Current(HttpContext http) => Results.Ok(new { guestId = http.User.GuestId() });

    private sealed record SessionResponse(Guid GuestId, DateTimeOffset ExpiresAt);
}
