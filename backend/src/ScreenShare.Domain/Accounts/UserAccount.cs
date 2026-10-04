using System.Text;
using ScreenShare.Domain.Participants;

namespace ScreenShare.Domain.Accounts;

/// <summary>Conta permanente; a identidade de convidado é apenas uma ponte interna para a mídia legada.</summary>
public sealed class UserAccount
{
    public Guid Id { get; private set; }
    public Guid GuestId { get; private set; }
    public string Username { get; private set; } = "";
    public string NormalizedUsername { get; private set; } = "";
    public string PasswordHash { get; private set; } = "";
    public string SecurityStamp { get; private set; } = "";
    public string? Avatar { get; private set; }
    /// <summary>Apelido que os outros veem. O login continua sendo o nome de usuário.</summary>
    public string? Nickname { get; private set; }
    /// <summary>Nome exibido: o apelido, ou o nome de usuário quando não há apelido.</summary>
    public string ShownName => Nickname ?? Username;
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? LastLoginAt { get; private set; }
    /// <summary>Última vez com o site ou o app aberto (atualizada no máximo a cada poucos minutos).</summary>
    public DateTimeOffset? LastSeenAt { get; private set; }
    /// <summary>Banida pelo administrador: não entra mais e perde os logins abertos.</summary>
    public DateTimeOffset? BannedAt { get; private set; }
    public string? BanReason { get; private set; }
    public bool IsBanned => BannedAt is not null;
    public const int BanReasonMaxLength = 200;
    /// <summary>Senha definida pelo administrador: a pessoa precisa criar a própria senha ao entrar.</summary>
    public bool MustChangePassword { get; private set; }

    private UserAccount() { }

    public static UserAccount Create(string username, string passwordHash, Guid guestId, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(username);
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);
        ArgumentOutOfRangeException.ThrowIfEqual(guestId, Guid.Empty);
        var name = username.Trim().Normalize(NormalizationForm.FormKC);
        if (name.Length is < 3 or > 32 || name.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not '_' and not '-' and not '.'))
            throw new ArgumentException("Use de 3 a 32 letras, números, ponto, hífen ou sublinhado.", nameof(username));
        return new UserAccount
        {
            Id = Guid.CreateVersion7(now), GuestId = guestId, Username = name,
            NormalizedUsername = name.ToUpperInvariant(), PasswordHash = passwordHash,
            SecurityStamp = Guid.NewGuid().ToString("N"), CreatedAt = now,
        };
    }

    public void RecordLogin(DateTimeOffset now) => LastSeenAt = LastLoginAt = now;

    /// <summary>Vazio remove o apelido (volta a aparecer o nome de usuário).</summary>
    public void SetNickname(string? nickname)
    {
        if (string.IsNullOrWhiteSpace(nickname)) { Nickname = null; return; }
        if (!DisplayName.TryCreate(nickname, out var name))
            throw new ArgumentException($"O apelido deve ter de 1 a {DisplayName.MaxLength} caracteres visíveis.", nameof(nickname));
        Nickname = name.Value;
    }

    /// <summary>Bane e troca o carimbo de segurança: todo login aberto (site e app) deixa de valer na hora.</summary>
    public void Ban(DateTimeOffset now, string? reason)
    {
        var text = reason?.Trim();
        if (text is { Length: > BanReasonMaxLength }) throw new ArgumentException($"O motivo deve ter até {BanReasonMaxLength} caracteres.", nameof(reason));
        BannedAt = now;
        BanReason = string.IsNullOrEmpty(text) ? null : text;
        SecurityStamp = Guid.NewGuid().ToString("N");
    }

    public void Unban()
    {
        BannedAt = null;
        BanReason = null;
    }

    /// <summary>Troca a senha (pela própria pessoa ou pelo administrador): todo login aberto deixa de valer.</summary>
    public void ChangePassword(string passwordHash, bool mustChangeOnNextLogin)
    {
        ReplacePasswordHash(passwordHash);
        MustChangePassword = mustChangeOnNextLogin;
    }

    public void ReplacePasswordHash(string passwordHash)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);
        PasswordHash = passwordHash;
        SecurityStamp = Guid.NewGuid().ToString("N");
    }
}
