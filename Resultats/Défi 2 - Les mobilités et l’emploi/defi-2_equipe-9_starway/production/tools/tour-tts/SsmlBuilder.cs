using System.Security;
using System.Text;
using System.Text.RegularExpressions;

namespace TourTts;

/// <summary>Construit le SSML d'une étape à partir du profil de voix. Logique pure, sans dépendance au SDK.</summary>
public static partial class SsmlBuilder
{
    public static string Build(string text, VoiceProfile profile)
    {
        var sentences = SplitSentences(profile.StraightenApostrophes ? StraightApostrophes(text) : text)
            .Select(s => ApplyAliases(s, profile.Aliases));
        // Le profil validé n'insère aucune pause : la voix construit seule l'intonation à partir de la ponctuation.
        var body = profile.SentenceBreakMs > 0
            ? string.Join($"<break time=\"{profile.SentenceBreakMs}ms\"/>", sentences)
            : string.Join(" ", sentences);

        if (profile.Rate is not null || profile.Pitch is not null)
            body = $"<prosody{Attr("rate", profile.Rate)}{Attr("pitch", profile.Pitch)}>{body}</prosody>";
        if (profile.Style is not null)
            body = $"<mstts:express-as style=\"{SecurityElement.Escape(profile.Style)}\"{Attr("styledegree", profile.StyleDegree?.ToString(System.Globalization.CultureInfo.InvariantCulture))}>{body}</mstts:express-as>";
        // <lang> force le français : les voix HD / multilingues devinent sinon la langue du texte.
        if (profile.ForceLanguageTag)
            body = $"<lang xml:lang=\"{profile.Language}\">{body}</lang>";

        var sb = new StringBuilder();
        sb.Append($"<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xmlns:mstts=\"https://www.w3.org/2001/mstts\" xml:lang=\"{profile.Language}\">");
        sb.Append($"<voice name=\"{SecurityElement.Escape(profile.Voice)}\">");
        sb.Append(body);
        sb.Append("</voice></speak>");
        return sb.ToString();
    }

    /// <summary>L'apostrophe typographique (’) fait mal lire les élisions (« l’heure » → « lé-heure ») : on la remplace par '.</summary>
    public static string StraightApostrophes(string text) => text.Replace('’', '\'').Replace('ʼ', '\'');

    public static IReadOnlyList<string> SplitSentences(string text) =>
        SentenceEnd().Split(Normalize(text))
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .ToList();

    /// <summary>
    /// Échappe le texte et remplace chaque terme du dictionnaire (mot entier, sensible à la casse, le plus long d'abord)
    /// par un &lt;sub alias&gt;. Les élisions (« d'Île-de-France ») sont des entrées à part entière : sinon la voix
    /// lit « d' » séparément (« de ile de France »).
    /// </summary>
    public static string ApplyAliases(string rawText, IReadOnlyDictionary<string, string> aliases)
    {
        if (aliases.Count == 0) return SecurityElement.Escape(rawText);
        var pattern = string.Join("|", aliases.Keys.OrderByDescending(k => k.Length).Select(Regex.Escape));
        var regex = new Regex($@"(?<![\p{{L}}\p{{N}}'])(?:{pattern})(?![\p{{L}}\p{{N}}])");

        var sb = new StringBuilder();
        var last = 0;
        foreach (Match m in regex.Matches(rawText))
        {
            sb.Append(SecurityElement.Escape(rawText[last..m.Index]));
            sb.Append($"<sub alias=\"{SecurityElement.Escape(aliases[m.Value])}\">{SecurityElement.Escape(m.Value)}</sub>");
            last = m.Index + m.Length;
        }
        sb.Append(SecurityElement.Escape(rawText[last..]));
        return sb.ToString();
    }

    private static string Attr(string name, string? value) => value is null ? "" : $" {name}=\"{SecurityElement.Escape(value)}\"";

    private static string Normalize(string text) => WhiteSpaceRun().Replace(text.Trim(), " ");

    [GeneratedRegex(@"(?<=[.!?…])\s+")]
    private static partial Regex SentenceEnd();

    [GeneratedRegex(@"[ \t\r\n]+")]
    private static partial Regex WhiteSpaceRun();
}
