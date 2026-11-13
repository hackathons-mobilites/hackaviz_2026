using TourTts;

namespace TourTts.Tests;

public class WebVttTests
{
    [Theory]
    [InlineData(0, "00:00:00.000")]
    [InlineData(1_250, "00:00:01.250")]
    [InlineData(61_005, "00:01:01.005")]
    [InlineData(3_723_456, "01:02:03.456")]
    [InlineData(-5, "00:00:00.000")]
    public void FormatTimestamp_uses_webvtt_format(long ms, string expected) =>
        Assert.Equal(expected, WebVtt.FormatTimestamp(ms));

    [Fact]
    public void BuildCues_respects_line_length_and_line_count()
    {
        var text = "Cette phrase est volontairement plus longue que les autres, afin de vérifier que les sous-titres "
                 + "sont découpés en lignes courtes, deux lignes au plus par carton";
        var tokens = SubtitleAligner.Align(text, [], 10_000);

        var cues = WebVtt.BuildCues(tokens);

        Assert.True(cues.Count >= 2);
        Assert.All(cues, c =>
        {
            Assert.InRange(c.Lines.Count, 1, WebVtt.MaxLines);
            Assert.All(c.Lines, l => Assert.True(l.Length <= WebVtt.MaxLineLength, $"« {l} » fait {l.Length} caractères"));
        });
        Assert.Equal(text, string.Join(" ", cues.SelectMany(c => c.Lines)));
    }

    [Fact]
    public void BuildCues_starts_a_new_cue_after_each_sentence()
    {
        var tokens = SubtitleAligner.Align("Une phrase. Une autre !", [], 2_000);

        var cues = WebVtt.BuildCues(tokens);

        Assert.Equal(2, cues.Count);
        Assert.Equal(["Une phrase."], cues[0].Lines);
        Assert.Equal(["Une autre !"], cues[1].Lines);
    }

    [Fact]
    public void BuildCues_never_overlaps_and_bridges_small_gaps()
    {
        var tokens = new List<TimedToken> { new("Un.", 0, 500), new("Deux.", 900, 1500), new("Trois.", 4000, 4500) };

        var cues = WebVtt.BuildCues(tokens);

        Assert.Equal(900, cues[0].EndMs);   // trou de 400 ms comblé
        Assert.Equal(1500, cues[1].EndMs);  // trou de 2,5 s conservé
        for (var i = 1; i < cues.Count; i++)
            Assert.True(cues[i].StartMs >= cues[i - 1].EndMs);
    }

    [Fact]
    public void BuildCues_opens_a_cue_at_each_silence_anchor_at_the_exact_end_of_the_silence()
    {
        const string text = "Bonjour Léa. Elle part tôt, elle rentre tard. Voilà tout.";
        var silences = new List<Silence> { new(2_000, 2_300), new(4_150, 4_400), new(6_950, 7_300) };
        var aligned = SubtitleAligner.AlignWithSilences(text, silences, 8_800);

        var cues = WebVtt.BuildCues(aligned.Tokens);

        var anchors = aligned.Tokens.Count(t => t.SilenceAfter);
        Assert.Equal(3, anchors);
        Assert.True(cues.Count >= anchors + 1);
        Assert.Equal(["Bonjour Léa.", "Elle part tôt,", "elle rentre tard.", "Voilà tout."],
            cues.Select(c => string.Join(" ", c.Lines)));
        Assert.Equal([0L, 2_300, 4_400, 7_300], cues.Select(c => c.StartMs));
        Assert.Equal(text, string.Join(" ", cues.SelectMany(c => c.Lines)));
        for (var i = 0; i < cues.Count - 1; i++)
        {
            Assert.True(cues[i].EndMs >= silences[i].StartMs);
            Assert.True(cues[i].EndMs <= cues[i + 1].StartMs);
        }
    }

    [Fact]
    public void BuildCues_keeps_cue_starts_untouched_by_smoothing_and_ends_at_the_silence_when_it_is_long()
    {
        const string text = "Un deux, trois quatre.";
        var silences = new List<Silence> { new(1_000, 1_900) };
        var aligned = SubtitleAligner.AlignWithSilences(text, silences, 3_000);

        var cues = WebVtt.BuildCues(aligned.Tokens);

        Assert.Equal(2, cues.Count);
        Assert.Equal(aligned.Tokens[0].StartMs, cues[0].StartMs);
        Assert.Equal(1_900, cues[1].StartMs);
        Assert.Equal(1_000, cues[0].EndMs); // silence de 900 ms : trop long pour être comblé
    }

    [Fact]
    public void BuildCues_still_wraps_long_cues_between_anchors()
    {
        const string text = "Cette phrase est assez longue pour dépasser la limite de deux lignes de quarante-deux caractères, "
                          + "puis une suite. Fin.";
        var aligned = SubtitleAligner.AlignWithSilences(text, [new(8_300, 8_600), new(9_500, 9_800)], 10_000);

        var cues = WebVtt.BuildCues(aligned.Tokens);

        Assert.All(cues, c => Assert.All(c.Lines, l => Assert.True(l.Length <= WebVtt.MaxLineLength)));
        Assert.Equal(text, string.Join(" ", cues.SelectMany(c => c.Lines)));
        Assert.Contains(cues, c => c.StartMs == 8_600);
        Assert.Contains(cues, c => c.StartMs == 9_800);
    }

    [Fact]
    public void Render_writes_a_valid_webvtt_document()
    {
        var cues = new List<VttCue> { new(0, 1_500, ["Ligne une", "R&D <test>"]) };

        var vtt = WebVtt.Render(cues, "note --> test");

        Assert.Equal(
            "WEBVTT\n\nNOTE note -> test\n\n1\n00:00:00.000 --> 00:00:01.500\nLigne une\nR&amp;D &lt;test&gt;\n\n",
            vtt);
    }
}
