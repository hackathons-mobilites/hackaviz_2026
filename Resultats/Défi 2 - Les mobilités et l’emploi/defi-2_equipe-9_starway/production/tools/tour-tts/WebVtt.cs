using System.Text;

namespace TourTts;

public sealed record VttCue(long StartMs, long EndMs, IReadOnlyList<string> Lines);

/// <summary>Découpage en cues et écriture WebVTT. Logique pure.</summary>
public static class WebVtt
{
    public const int MaxLineLength = 42;
    public const int MaxLines = 2;

    /// <summary>Écart maximal comblé entre deux cues pour éviter le clignotement.</summary>
    public const long MaxGapBridgedMs = 800;

    public static IReadOnlyList<VttCue> BuildCues(IReadOnlyList<TimedToken> tokens,
        int maxLineLength = MaxLineLength, int maxLines = MaxLines)
    {
        var cues = new List<VttCue>();
        var lines = new List<string>();
        var line = "";
        TimedToken? first = null, last = null;

        void Flush()
        {
            if (line.Length > 0) lines.Add(line);
            if (lines.Count > 0 && first is not null && last is not null)
                cues.Add(new VttCue(first.StartMs, Math.Max(last.EndMs, first.StartMs + 1), lines.ToList()));
            lines.Clear();
            line = "";
            first = last = null;
        }

        foreach (var token in tokens)
        {
            var candidate = line.Length == 0 ? token.Text : line + " " + token.Text;
            if (candidate.Length > maxLineLength && line.Length > 0)
            {
                if (lines.Count + 1 < maxLines)
                {
                    lines.Add(line);
                    line = "";
                }
                else
                {
                    Flush();
                }
                candidate = token.Text;
            }

            line = candidate;
            first ??= token;
            last = token;

            // Chaque marque appariée à un silence ouvre une nouvelle cue : elle commence à la fin du silence,
            // ce que les repères lumineux du front supposent pour un fragment qui ouvre une cue.
            if (token.SilenceAfter || EndsSentence(token.Text)) Flush();
        }
        Flush();

        return Smooth(cues);
    }

    /// <summary>Cues sans chevauchement, petits trous comblés jusqu'à la cue suivante. Ne modifie que les fins : les débuts de cue ne bougent jamais.</summary>
    private static List<VttCue> Smooth(List<VttCue> cues)
    {
        for (var i = 0; i < cues.Count - 1; i++)
        {
            var current = cues[i];
            var nextStart = cues[i + 1].StartMs;
            if (nextStart - current.EndMs <= MaxGapBridgedMs)
                cues[i] = current with { EndMs = Math.Max(nextStart, current.StartMs + 1) };
        }
        return cues;
    }

    private static bool EndsSentence(string token) => token.TrimEnd('»', '"', ')', ' ', ' ') is [.., '.' or '!' or '?' or '…'];

    /// <summary>Format WebVTT « hh:mm:ss.ttt ».</summary>
    public static string FormatTimestamp(long ms)
    {
        if (ms < 0) ms = 0;
        var t = TimeSpan.FromMilliseconds(ms);
        return $"{(int)t.TotalHours:00}:{t.Minutes:00}:{t.Seconds:00}.{t.Milliseconds:000}";
    }

    public static string Render(IReadOnlyList<VttCue> cues, string? note = null)
    {
        var sb = new StringBuilder("WEBVTT\n\n");
        if (!string.IsNullOrWhiteSpace(note))
            sb.Append("NOTE ").Append(note.Replace("-->", "->")).Append("\n\n");

        for (var i = 0; i < cues.Count; i++)
        {
            var cue = cues[i];
            sb.Append(i + 1).Append('\n');
            sb.Append(FormatTimestamp(cue.StartMs)).Append(" --> ").Append(FormatTimestamp(cue.EndMs)).Append('\n');
            foreach (var l in cue.Lines) sb.Append(EscapeCueText(l)).Append('\n');
            sb.Append('\n');
        }
        return sb.ToString();
    }

    private static string EscapeCueText(string text) =>
        text.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
}
