using System.Text;

namespace TourTts;

/// <summary>Mot prononcé, tel que rapporté par l'événement WordBoundary (temps en ms).</summary>
public sealed record SpokenWord(string Text, long StartMs, long EndMs);

/// <summary>
/// Mot du texte affiché, avec ses temps de début et de fin (ms).
/// <paramref name="SilenceAfter"/> : la marque de ponctuation du mot est appariée à un silence mesuré (le mot suivant commence à sa fin).
/// </summary>
public sealed record TimedToken(string Text, long StartMs, long EndMs, bool SilenceAfter = false);

/// <summary>Résultat d'un calage : jetons horodatés, calage sur les silences effectif ou non, avertissements.</summary>
public sealed record AlignmentResult(IReadOnlyList<TimedToken> Tokens, bool UsedSilences, IReadOnlyList<string> Warnings);

/// <summary>
/// Cale les mots du texte affiché sur les mots prononcés.
/// Les mots reconnus à l'identique servent d'ancres ; les autres (sigles lus via alias,
/// nombres découpés, élisions) sont répartis entre les ancres au prorata de leur longueur.
/// Sans aucun mot prononcé (dry-run), tout le texte est réparti sur [0, totalMs].
/// </summary>
public static class SubtitleAligner
{
    private const int LookAhead = 4;

    /// <summary>Découpe sur les espaces ordinaires ; la ponctuation isolée (« : », « ? ») est rattachée au mot précédent.</summary>
    public static IReadOnlyList<string> Tokenize(string text)
    {
        var tokens = new List<string>();
        foreach (var raw in text.Split([' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            if (tokens.Count > 0 && Normalize(raw).Length == 0)
                tokens[^1] += " " + raw;
            else
                tokens.Add(raw);
        }
        return tokens;
    }

    public static IReadOnlyList<TimedToken> Align(string text, IReadOnlyList<SpokenWord> spoken, long totalMs)
    {
        var tokens = Tokenize(text);
        var starts = new long?[tokens.Count];
        var ends = new long?[tokens.Count];

        var next = 0;
        for (var i = 0; i < tokens.Count && next < spoken.Count; i++)
        {
            var key = Normalize(tokens[i]);
            for (var j = next; j < Math.Min(next + LookAhead, spoken.Count); j++)
            {
                if (key.Length > 0 && key == Normalize(spoken[j].Text))
                {
                    starts[i] = spoken[j].StartMs;
                    ends[i] = Math.Max(spoken[j].EndMs, spoken[j].StartMs);
                    next = j + 1;
                    break;
                }
            }
        }

        FillGaps(tokens, starts, ends, totalMs);
        return tokens.Select((t, i) => new TimedToken(t, starts[i]!.Value, ends[i]!.Value)).ToList();
    }

    private static void FillGaps(IReadOnlyList<string> tokens, long?[] starts, long?[] ends, long totalMs)
    {
        var i = 0;
        while (i < tokens.Count)
        {
            if (starts[i] is not null) { i++; continue; }

            var first = i;
            while (i < tokens.Count && starts[i] is null) i++;
            var last = i - 1;

            var from = first > 0 ? ends[first - 1]!.Value : 0;
            var to = i < tokens.Count ? starts[i]!.Value : Math.Max(totalMs, from);
            Spread(tokens, first, last, from, to, starts, ends);
        }
    }

    /// <summary>Répartit les jetons first..last sur [from, to] au prorata de leur longueur.</summary>
    private static void Spread(IReadOnlyList<string> tokens, int first, int last, long from, long to, long?[] starts, long?[] ends)
    {
        if (to < from) to = from;
        var weights = Enumerable.Range(first, last - first + 1).Select(k => (double)Math.Max(1, tokens[k].Length)).ToList();
        var sum = weights.Sum();
        var cursor = (double)from;
        for (var k = first; k <= last; k++)
        {
            var span = (to - from) * weights[k - first] / sum;
            starts[k] = (long)Math.Round(cursor);
            cursor += span;
            ends[k] = (long)Math.Round(cursor);
        }
        ends[last] = to;
    }

    /// <summary>Un silence plus court ne peut marquer qu'une virgule ou un deux-points : la pause forcée de 300 ms (SsmlBuilder) donne aux fins de phrase au moins ~300 ms.</summary>
    public const long MinSentenceSilenceMs = 250;

    /// <summary>Seuil du second passage (silencedetect -30 dB, 0,15 s).</summary>
    public const long LooseMinSentenceSilenceMs = 150;

    /// <summary>Coût (écart en ms) d'un silence interne sans marque, ou d'une marque facultative (virgule, point-virgule, deux-points) sans silence.</summary>
    public const long UnmatchedCostMs = 400;

    /// <summary>Coût d'une fin de phrase sans silence : assez haut pour que chaque fin de phrase prenne un silence dès qu'il y en a assez.</summary>
    public const long UnmatchedSentenceCostMs = 2_500;

    /// <summary>Un silence qui touche le début (ou la fin) du fichier à cette tolérance près est le silence initial (ou final), pas une pause interne.</summary>
    public const long EdgeToleranceMs = 100;

    private sealed record Mark(int TokenIndex, bool Mandatory, double PredictedMs);

    /// <summary>
    /// Cale les jetons sur les silences réels du MP3. La parole va de la fin du silence initial au début du silence final ;
    /// les marques de ponctuation (fins de phrase obligatoires, virgules et deux-points facultatifs) sont appariées dans l'ordre
    /// aux silences internes par programmation dynamique (coût : écart entre le temps prédit au prorata des lettres et le milieu du silence).
    /// Le jeton qui porte la marque finit au début du silence, le suivant commence à sa fin.
    /// Repli au prorata (UsedSilences = false, avec avertissement) si une fin de phrase reste sans silence.
    /// </summary>
    public static AlignmentResult AlignWithSilences(string text, IReadOnlyList<Silence> silences, long totalMs, long minSentenceSilenceMs = MinSentenceSilenceMs)
    {
        var tokens = Tokenize(text);
        if (tokens.Count == 0) return new AlignmentResult([], false, []);

        AlignmentResult Fallback(string warning) => new(Align(text, [], totalMs), false, [warning]);

        var sentenceCount = 1 + tokens.Take(tokens.Count - 1).Count(t => IsSentenceEnd(t));
        if (silences.Count == 0)
            return Fallback($"Aucun silence mesuré pour {sentenceCount} phrase(s) : sous-titres répartis au prorata.");

        var internals = silences.Where(s => s.EndMs > s.StartMs).OrderBy(s => s.StartMs).ToList();
        long speechStart = 0, speechEnd = totalMs;
        if (internals.Count > 0 && internals[0].StartMs <= EdgeToleranceMs)
        {
            speechStart = internals[0].EndMs;
            internals.RemoveAt(0);
        }
        if (internals.Count > 0 && internals[^1].EndMs >= totalMs - EdgeToleranceMs)
        {
            speechEnd = internals[^1].StartMs;
            internals.RemoveAt(internals.Count - 1);
        }
        if (speechEnd <= speechStart)
            return Fallback("Le MP3 ne contient pas de parole mesurable : sous-titres répartis au prorata.");
        internals = internals.Where(s => s.StartMs >= speechStart && s.EndMs <= speechEnd).ToList();

        var marks = FindMarks(tokens, speechStart, speechEnd);
        var pairs = Match(marks, internals, minSentenceSilenceMs);

        var unmatched = marks.Where(m => m.Mandatory && !pairs.ContainsKey(m)).ToList();
        if (unmatched.Count > 0)
            return Fallback($"{internals.Count} silence(s) interne(s) mesuré(s) pour {sentenceCount} phrase(s) "
                          + $"(il en faut au moins {sentenceCount - 1}) : sous-titres répartis au prorata.");

        var starts = new long?[tokens.Count];
        var ends = new long?[tokens.Count];
        var from = speechStart;
        var first = 0;
        foreach (var (mark, silence) in pairs.OrderBy(p => p.Key.TokenIndex).Select(p => (p.Key, p.Value)))
        {
            Spread(tokens, first, mark.TokenIndex, from, silence.StartMs, starts, ends);
            first = mark.TokenIndex + 1;
            from = silence.EndMs;
        }
        Spread(tokens, first, tokens.Count - 1, from, speechEnd, starts, ends);

        var anchored = pairs.Keys.Select(m => m.TokenIndex).ToHashSet();
        var timed = tokens.Select((t, i) => new TimedToken(t, starts[i]!.Value, ends[i]!.Value, anchored.Contains(i))).ToList();
        return new AlignmentResult(timed, true, []);
    }

    private static List<Mark> FindMarks(IReadOnlyList<string> tokens, long speechStart, long speechEnd)
    {
        var letters = tokens.Select(t => Math.Max(1, Normalize(t).Length)).ToList();
        var total = (double)letters.Sum();
        var marks = new List<Mark>();
        var cumulative = 0;
        for (var i = 0; i < tokens.Count - 1; i++)
        {
            cumulative += letters[i];
            var sentenceEnd = IsSentenceEnd(tokens[i]);
            if (sentenceEnd || tokens[i][^1] is ',' or ';' or ':')
                marks.Add(new Mark(i, sentenceEnd, speechStart + (speechEnd - speechStart) * cumulative / total));
        }
        return marks;
    }

    private static bool IsSentenceEnd(string token) => token[^1] is '.' or '!' or '?' or '…';

    /// <summary>Appariement ordonné marques / silences internes de coût minimal.</summary>
    private static Dictionary<Mark, Silence> Match(IReadOnlyList<Mark> marks, IReadOnlyList<Silence> silences, long minSentenceSilenceMs)
    {
        int n = marks.Count, k = silences.Count;
        var cost = new long[n + 1, k + 1];
        for (var i = 1; i <= n; i++) cost[i, 0] = cost[i - 1, 0] + SkipCost(marks[i - 1]);
        for (var j = 1; j <= k; j++) cost[0, j] = cost[0, j - 1] + UnmatchedCostMs;

        for (var i = 1; i <= n; i++)
        {
            for (var j = 1; j <= k; j++)
            {
                var best = Math.Min(cost[i - 1, j] + SkipCost(marks[i - 1]), cost[i, j - 1] + UnmatchedCostMs);
                if (CanMatch(marks[i - 1], silences[j - 1], minSentenceSilenceMs))
                    best = Math.Min(best, cost[i - 1, j - 1] + MatchCost(marks[i - 1], silences[j - 1]));
                cost[i, j] = best;
            }
        }

        var pairs = new Dictionary<Mark, Silence>();
        int a = n, b = k;
        while (a > 0 && b > 0)
        {
            if (CanMatch(marks[a - 1], silences[b - 1], minSentenceSilenceMs)
                && cost[a, b] == cost[a - 1, b - 1] + MatchCost(marks[a - 1], silences[b - 1]))
            {
                pairs[marks[a - 1]] = silences[b - 1];
                a--; b--;
            }
            else if (cost[a, b] == cost[a - 1, b] + SkipCost(marks[a - 1])) a--;
            else b--;
        }
        return pairs;
    }

    private static long SkipCost(Mark mark) => mark.Mandatory ? UnmatchedSentenceCostMs : UnmatchedCostMs;

    private static bool CanMatch(Mark mark, Silence silence, long minSentenceSilenceMs) =>
        !mark.Mandatory || silence.EndMs - silence.StartMs >= minSentenceSilenceMs;

    private static long MatchCost(Mark mark, Silence silence) =>
        (long)Math.Round(Math.Abs(mark.PredictedMs - (silence.StartMs + silence.EndMs) / 2.0));

    /// <summary>Minuscules, lettres et chiffres seulement (« l’aller, » → « laller »).</summary>
    public static string Normalize(string word)
    {
        var sb = new StringBuilder(word.Length);
        foreach (var c in word)
            if (char.IsLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
        return sb.ToString();
    }
}
