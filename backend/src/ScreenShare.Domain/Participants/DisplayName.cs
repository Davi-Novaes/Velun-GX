using System.Globalization;
using System.Text;

namespace ScreenShare.Domain.Participants;

/// <summary>
/// Apelido exibido na sala: normalizado (NFC), sem caracteres de controle/formatação,
/// espaços colapsados, de 1 a 32 caracteres visíveis.
/// </summary>
public readonly record struct DisplayName
{
    public const int MaxLength = 32;

    public string Value { get; }

    private DisplayName(string value) => Value = value;

    private static readonly Rune ZeroWidthJoiner = new(0x200D);

    public static bool TryCreate(string? input, out DisplayName name)
    {
        name = default;
        if (input is null || input.Length > MaxLength * 4)
            return false;

        var builder = new StringBuilder(input.Length);
        var pendingSpace = false;
        foreach (var rune in input.Normalize(NormalizationForm.FormC).EnumerateRunes())
        {
            // ZWJ une emojis compostos (👩‍💻); só é mantido entre dois caracteres visíveis
            if (rune == ZeroWidthJoiner)
            {
                if (builder.Length > 0 && !pendingSpace)
                    builder.Append(rune.ToString());
                continue;
            }

            var category = Rune.GetUnicodeCategory(rune);
            if (category is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.Surrogate
                or UnicodeCategory.PrivateUse or UnicodeCategory.OtherNotAssigned
                or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
                continue;
            if (Rune.IsWhiteSpace(rune))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }
            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }
            builder.Append(rune.ToString());
        }

        var value = builder.ToString().TrimEnd((char)ZeroWidthJoiner.Value);
        var visible = new StringInfo(value).LengthInTextElements;
        if (visible is 0 or > MaxLength)
            return false;

        name = new DisplayName(value);
        return true;
    }

    public override string ToString() => Value;
}
