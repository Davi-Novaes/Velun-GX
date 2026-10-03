using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ScreenShare.Domain.Accounts;
using ScreenShare.Domain.Guests;
using ScreenShare.Infrastructure.Persistence;

namespace ScreenShare.Infrastructure.Accounts;

public sealed class AccountService(AppDbContext db, IPasswordHasher<UserAccount> hasher, TimeProvider clock)
{
    private static readonly Lazy<string> DummyHash = new(() => new PasswordHasher<UserAccount>(Microsoft.Extensions.Options.Options.Create(
        new PasswordHasherOptions { IterationCount = 210_000 })).HashPassword(null!, Guid.NewGuid().ToString()));

    public async Task<UserAccount?> RegisterAsync(string username, string password, string confirmPassword, CancellationToken ct)
    {
        ValidatePassword(password);
        if (!string.Equals(password, confirmPassword, StringComparison.Ordinal)) throw new ArgumentException("As senhas não coincidem.");
        var now = clock.GetUtcNow();
        var guest = Guest.Create(now);
        // O valor provisório nunca é salvo: o hash final é aplicado antes de adicionar ao contexto.
        var user = UserAccount.Create(username, "pending-hash", guest.Id, now);
        user.ReplacePasswordHash(hasher.HashPassword(user, password));
        user.RecordLogin(now);
        if (await db.Users.AnyAsync(x => x.NormalizedUsername == user.NormalizedUsername, ct)) return null;
        db.Guests.Add(guest);
        db.Users.Add(user);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation })
        {
            return null;
        }
        return user;
    }

    public async Task<UserAccount?> LoginAsync(string username, string password, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(password) || password.Length > 128 || string.IsNullOrWhiteSpace(username) || username.Length > 64) return null;
        var name = username.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
        var user = await db.Users.SingleOrDefaultAsync(x => x.NormalizedUsername == name, ct);
        var result = hasher.VerifyHashedPassword(user!, user?.PasswordHash ?? DummyHash.Value, password);
        if (user is null || result == PasswordVerificationResult.Failed) return null;
        if (result == PasswordVerificationResult.SuccessRehashNeeded) user.ReplacePasswordHash(hasher.HashPassword(user, password));
        user.RecordLogin(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return user;
    }

    private static void ValidatePassword(string password)
    {
        if (string.IsNullOrEmpty(password) || password.Length is < 10 or > 128)
            throw new ArgumentException("Use uma senha de 10 a 128 caracteres.", nameof(password));
    }
}
