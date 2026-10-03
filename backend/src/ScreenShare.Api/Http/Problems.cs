using Microsoft.AspNetCore.Mvc;
using ScreenShare.Application.Common;

namespace ScreenShare.Api.Http;

/// <summary>Erros no formato RFC 7807 com o campo <c>code</c> estável que o frontend usa.</summary>
internal static class Problems
{
    public static IResult From(AppError error) =>
        Results.Problem(Create(error.Status, error.Code, error.Title, error.Detail));

    public static Task Write(HttpContext context, int status, string code, string title, string detail)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(Create(status, code, title, detail), options: null, contentType: "application/problem+json");
    }

    public static ProblemDetails Create(int status, string code, string title, string detail) => new()
    {
        Type = "about:blank#" + code.ToLowerInvariant().Replace('_', '-'),
        Title = title,
        Status = status,
        Detail = detail,
        Extensions = { ["code"] = code },
    };

    public static IResult ToHttp<T>(this AppResult<T> result, Func<T, IResult> onSuccess) =>
        result.IsSuccess ? onSuccess(result.Value!) : From(result.Error!);
}
