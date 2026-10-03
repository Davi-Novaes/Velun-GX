using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace ScreenShare.Infrastructure.Persistence;

/// <summary>Usado só pelo <c>dotnet ef</c> para gerar migrations (não conecta ao banco).</summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql("Host=localhost;Database=screenshare")
        .UseSnakeCaseNamingConvention()
        .Options);
}
