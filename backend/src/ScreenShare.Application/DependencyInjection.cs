using Microsoft.Extensions.DependencyInjection;
using ScreenShare.Application.Guests;
using ScreenShare.Application.Rooms;
using ScreenShare.Application.Sfu;

namespace ScreenShare.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<ISfuEventProcessor, PersistingSfuEventProcessor>();
        services.AddScoped<GuestService>();
        services.AddScoped<RoomService>();
        services.AddScoped<RoomMaintenance>();
        return services;
    }
}
