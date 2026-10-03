using Npgsql;
using ScreenShare.Application.Common;

namespace ScreenShare.Infrastructure.Persistence;

internal sealed class PostgresUniqueViolationDetector : IUniqueViolationDetector
{
    public bool IsUniqueViolation(Exception exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
}
