using ScreenShare.Api.Http;

namespace ScreenShare.Api.Security;

/// <summary>
/// Defesa contra CSRF somada ao cookie SameSite=Strict: requisições que alteram estado vindas de navegador
/// precisam ter Origin igual ao host da própria API. Clientes sem Origin (ferramentas, testes) passam.
/// </summary>
internal sealed class SameOriginMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        if (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method) || HttpMethods.IsOptions(request.Method)
            || !request.Path.StartsWithSegments("/api"))
            return next(context);

        var origin = request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(origin))
            return next(context);

        if (Uri.TryCreate(origin, UriKind.Absolute, out var originUri)
            && string.Equals(originUri.Scheme, request.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(originUri.Authority, request.Host.Value, StringComparison.OrdinalIgnoreCase))
            return next(context);

        return Problems.Write(context, StatusCodes.Status403Forbidden, "CROSS_ORIGIN_FORBIDDEN", "Origem não permitida",
            "Esta operação só pode ser feita a partir do próprio site.");
    }
}
