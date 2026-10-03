namespace ScreenShare.Application.Common;

/// <summary>Erro de negócio com código estável (vai para o campo <c>code</c> do ProblemDetails).</summary>
public sealed record AppError(string Code, int Status, string Title, string Detail)
{
    public static AppError RoomNotFound() => new("ROOM_NOT_FOUND", 404, "Sala não encontrada", "Confira o link ou o código da sala.");
    public static AppError RoomExpired() => new("ROOM_EXPIRED", 410, "Sala expirada", "Esta sala expirou. Crie uma nova sala.");
    public static AppError RoomFull(int max) => new("ROOM_FULL", 409, "Sala cheia", $"A sala atingiu o limite de {max} participantes.");
    public static AppError RoomBusy() => new("ROOM_BUSY", 503, "Sala ocupada", "Muitas entradas ao mesmo tempo. Tente novamente em instantes.");
    public static AppError Validation(string detail) => new("VALIDATION_FAILED", 422, "Dados inválidos", detail);
    public static AppError Forbidden(string detail) => new("FORBIDDEN", 403, "Acesso negado", detail);
    public static AppError SfuUnavailable() => new("SFU_UNAVAILABLE", 503, "Servidor de mídia indisponível", "Tente novamente em instantes.");
}

public readonly struct AppResult<T>
{
    public T? Value { get; }
    public AppError? Error { get; }
    public bool IsSuccess => Error is null;

    private AppResult(T? value, AppError? error)
    {
        Value = value;
        Error = error;
    }

    public static implicit operator AppResult<T>(T value) => new(value, null);
    public static implicit operator AppResult<T>(AppError error) => new(default, error);
}
