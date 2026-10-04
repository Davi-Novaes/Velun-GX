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
        if (user.IsBanned) return user; // senha certa, mas banida: quem chama recusa com a mensagem de banimento
        if (result == PasswordVerificationResult.SuccessRehashNeeded) user.ReplacePasswordHash(hasher.HashPassword(user, password));
        user.RecordLogin(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return user;
    }

    /// <summary>
    /// A própria pessoa troca a senha: confere a atual, valida a nova e encerra os outros logins (troca o carimbo).
    /// Retorna null se a senha atual estiver errada.
    /// </summary>
    public async Task<UserAccount?> ChangeOwnPasswordAsync(Guid userId, string currentPassword, string newPassword, string confirmPassword, CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, ct);
        if (string.IsNullOrEmpty(currentPassword) || currentPassword.Length > 128 || hasher.VerifyHashedPassword(user, user.PasswordHash, currentPassword) == PasswordVerificationResult.Failed) return null;
        ValidatePassword(newPassword);
        if (!string.Equals(newPassword, confirmPassword, StringComparison.Ordinal)) throw new ArgumentException("As senhas não coincidem.");
        if (string.Equals(newPassword, currentPassword, StringComparison.Ordinal)) throw new ArgumentException("A senha nova precisa ser diferente da atual.");
        user.ChangePassword(hasher.HashPassword(user, newPassword), mustChangeOnNextLogin: false);
        await RevokeSessionsAsync(user.Id, ct);
        await db.SaveChangesAsync(ct);
        return user;
    }

    /// <summary>O administrador define a senha de alguém (esqueceu a senha etc.). Encerra os logins abertos da pessoa.</summary>
    public async Task<UserAccount?> SetPasswordByAdminAsync(Guid userId, string newPassword, bool mustChangeOnNextLogin, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return null;
        ValidatePassword(newPassword);
        user.ChangePassword(hasher.HashPassword(user, newPassword), mustChangeOnNextLogin);
        await RevokeSessionsAsync(user.Id, ct);
        await db.SaveChangesAsync(ct);
        return user;
    }

    private Task<int> RevokeSessionsAsync(Guid userId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        return db.AccountSessions.Where(s => s.UserId == userId && s.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), ct);
    }

    private static void ValidatePassword(string password)
    {
        if (string.IsNullOrEmpty(password) || password.Length is < 10 or > 128)
            throw new ArgumentException("Use uma senha de 10 a 128 caracteres.", nameof(password));
    }
}
