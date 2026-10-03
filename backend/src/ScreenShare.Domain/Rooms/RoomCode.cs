using System.Security.Cryptography;

namespace ScreenShare.Domain.Rooms;

/// <summary>
/// Código público da sala: 8 caracteres Crockford Base32 gerados por CSPRNG (32^8 ≈ 1,1 × 10¹²).
/// No MVP o link é a credencial de acesso, então o código precisa ser impossível de adivinhar.
/// A leitura tolera erros de digitação comuns (minúsculas, O→0, I/L→1, hífens).
/// </summary>
public readonly record struct RoomCode
{
    public const int Length = 8;
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public string Value { get; }

    private RoomCode(string value) => Value = value;

    public static RoomCode New()
    {
        Span<char> chars = stackalloc char[Length];
        for (var i = 0; i < Length; i++)
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return new RoomCode(new string(chars));
    }

    public static bool TryParse(string? input, out RoomCode code)
    {
        code = default;
        if (string.IsNullOrWhiteSpace(input) || input.Length > Length * 2)
            return false;

        Span<char> chars = stackalloc char[Length];
        var count = 0;
        foreach (var raw in input)
        {
            if (raw is '-' or ' ')
                continue;
            var c = char.ToUpperInvariant(raw) switch
            {
                'O' => '0',
                'I' or 'L' => '1',
                var other => other,
            };
            if (count == Length || !Alphabet.Contains(c, StringComparison.Ordinal))
                return false;
            chars[count++] = c;
        }
        if (count != Length)
            return false;

        code = new RoomCode(new string(chars));
        return true;
    }

    /// <summary>Reconstrói a partir do valor já persistido (confiável).</summary>
    public static RoomCode FromStorage(string value) =>
        TryParse(value, out var code) ? code : throw new FormatException($"Código de sala inválido no banco: '{value}'.");

    public override string ToString() => Value;
}
