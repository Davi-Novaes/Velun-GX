using System.Globalization;
using System.Text.Json;

namespace ScreenShare.Infrastructure.LiveKit;

/// <summary>
/// Leitura tolerante do JSON gerado pelo LiveKit (protojson): aceita nomes em camelCase ou snake_case,
/// int64 como string ou número e enums como string. Evita quebrar se o formato variar entre versões.
/// </summary>
internal static class ProtoJson
{
    public static JsonElement? Prop(this JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;
        if (element.TryGetProperty(name, out var exact))
            return exact;
        foreach (var property in element.EnumerateObject())
        {
            if (SameName(property.Name, name))
                return property.Value;
        }
        return null;
    }

    public static string? Str(this JsonElement element, string name)
    {
        var value = element.Prop(name);
        return value?.ValueKind switch
        {
            JsonValueKind.String => value.Value.GetString() is { Length: > 0 } s ? s : null,
            JsonValueKind.Number => value.Value.GetRawText(),
            _ => null,
        };
    }

    public static long? Int64(this JsonElement element, string name)
    {
        var value = element.Prop(name);
        return value?.ValueKind switch
        {
            JsonValueKind.Number when value.Value.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(value.Value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static bool Bool(this JsonElement element, string name) =>
        element.Prop(name)?.ValueKind == JsonValueKind.True;

    public static IEnumerable<JsonElement> Array(this JsonElement element, string name)
    {
        var value = element.Prop(name);
        return value?.ValueKind == JsonValueKind.Array ? value.Value.EnumerateArray() : [];
    }

    /// <summary>Enum do protobuf ("SCREEN_SHARE", "VIDEO") → forma usada pela aplicação ("screen_share", "video").</summary>
    public static string EnumValue(this JsonElement element, string name, string fallback) =>
        element.Str(name)?.ToLowerInvariant() ?? fallback;

    public static DateTimeOffset? UnixSeconds(this JsonElement element, string name) =>
        element.Int64(name) is { } seconds and > 0 ? DateTimeOffset.FromUnixTimeSeconds(seconds) : null;

    private static bool SameName(string candidate, string wanted)
    {
        int i = 0, j = 0;
        while (i < candidate.Length && j < wanted.Length)
        {
            if (candidate[i] == '_') { i++; continue; }
            if (wanted[j] == '_') { j++; continue; }
            if (char.ToLowerInvariant(candidate[i]) != char.ToLowerInvariant(wanted[j]))
                return false;
            i++;
            j++;
        }
        while (i < candidate.Length && candidate[i] == '_') i++;
        while (j < wanted.Length && wanted[j] == '_') j++;
        return i == candidate.Length && j == wanted.Length;
    }
}
