using TourTts;

namespace TourTts.Tests;

public class SubtitleAlignerTests
{
    [Fact]
    public void Tokenize_attaches_isolated_punctuation_to_previous_word()
    {
        var tokens = SubtitleAligner.Tokenize("Voici Léa : elle part ? Oui");

        Assert.Equal(["Voici", "Léa :", "elle", "part ?", "Oui"], tokens);
    }

    [Fact]
    public void Tokenize_keeps_non_breaking_spaces_inside_a_token()
    {
        Assert.Equal(["environ", "12 300", "postes"], SubtitleAligner.Tokenize("environ 12 300 postes"));
    }

    [Fact]
    public void Align_uses_word_boundaries_when_words_match()
    {
        var spoken = new List<SpokenWord> { new("Bonjour", 50, 400), new("Léa", 450, 800) };

        var timed = SubtitleAligner.Align("Bonjour Léa.", spoken, 1000);

        Assert.Equal(new TimedToken("Bonjour", 50, 400), timed[0]);
        Assert.Equal(new TimedToken("Léa.", 450, 800), timed[1]);
    }

    [Fact]
    public void Align_interpolates_unmatched_words_between_anchors()
    {
        // L'alias « R E R » est rapporté en trois mots : « RER » n'a pas d'équivalent exact.
        var spoken = new List<SpokenWord>
        {
            new("Le", 0, 100), new("R", 200, 300), new("E", 300, 400), new("R", 400, 500), new("arrive", 600, 900),
        };

        var timed = SubtitleAligner.Align("Le RER arrive.", spoken, 1000);

        Assert.Equal(new TimedToken("Le", 0, 100), timed[0]);
        Assert.Equal(new TimedToken("RER", 100, 600), timed[1]);
        Assert.Equal(new TimedToken("arrive.", 600, 900), timed[2]);
    }

    [Fact]
    public void Align_without_spoken_words_spreads_text_proportionally()
    {
        var timed = SubtitleAligner.Align("aa bb", [], 1000);

        Assert.Equal(new TimedToken("aa", 0, 500), timed[0]);
        Assert.Equal(new TimedToken("bb", 500, 1000), timed[1]);
    }

    [Fact]
    public void Align_produces_monotonic_times()
    {
        var spoken = new List<SpokenWord> { new("un", 0, 200), new("trois", 900, 1100) };

        var timed = SubtitleAligner.Align("un deux trois quatre", spoken, 1500);

        for (var i = 1; i < timed.Count; i++)
            Assert.True(timed[i].StartMs >= timed[i - 1].EndMs - 1);
        Assert.Equal(1500, timed[^1].EndMs);
    }

    private const string ThreeSentences = "Bonjour Léa. Elle part tôt, elle rentre tard. Voilà tout.";

    private static TimedToken Token(AlignmentResult r, string text) => r.Tokens.Single(t => t.Text == text);

    private static void AssertMonotonic(IReadOnlyList<TimedToken> tokens)
    {
        for (var i = 0; i < tokens.Count; i++)
        {
            Assert.True(tokens[i].EndMs >= tokens[i].StartMs, $"« {tokens[i].Text} » finit avant de commencer");
            if (i > 0) Assert.True(tokens[i].StartMs >= tokens[i - 1].EndMs, $"« {tokens[i].Text} » chevauche le jeton précédent");
        }
    }

    [Fact]
    public void AlignWithSilences_needs_the_looser_threshold_for_short_sentence_pauses()
    {
        var silences = new List<Silence> { new(2_000, 2_180), new(6_950, 7_130) };

        var strict = SubtitleAligner.AlignWithSilences(ThreeSentences, silences, 8_800);
        var loose = SubtitleAligner.AlignWithSilences(ThreeSentences, silences, 8_800, SubtitleAligner.LooseMinSentenceSilenceMs);

        Assert.False(strict.UsedSilences);
        Assert.True(loose.UsedSilences);
        Assert.Equal(2_180, Token(loose, "Elle").StartMs);
        Assert.Equal(7_130, Token(loose, "Voilà").StartMs);
    }

    [Fact]
    public void AlignWithSilences_starts_each_sentence_exactly_at_the_end_of_its_silence()
    {
        var silences = new List<Silence> { new(2_000, 2_300), new(6_950, 7_300) };

        var r = SubtitleAligner.AlignWithSilences(ThreeSentences, silences, 8_800);

        Assert.True(r.UsedSilences);
        Assert.Empty(r.Warnings);
        Assert.Equal(2_000, Token(r, "Léa.").EndMs);
        Assert.Equal(2_300, Token(r, "Elle").StartMs);
        Assert.Equal(6_950, Token(r, "tard.").EndMs);
        Assert.Equal(7_300, Token(r, "Voilà").StartMs);
        Assert.Equal(0, r.Tokens[0].StartMs);
        Assert.Equal(8_800, r.Tokens[^1].EndMs);
        AssertMonotonic(r.Tokens);
    }

    [Fact]
    public void AlignWithSilences_matches_the_right_silences_when_commas_add_pauses()
    {
        var silences = new List<Silence> { new(2_000, 2_300), new(4_150, 4_400), new(6_950, 7_300) };

        var r = SubtitleAligner.AlignWithSilences(ThreeSentences, silences, 8_800);

        Assert.True(r.UsedSilences);
        Assert.Equal(2_000, Token(r, "Léa.").EndMs);
        Assert.Equal(4_150, Token(r, "tôt,").EndMs);
        Assert.Equal(4_400, Token(r, "elle").StartMs);
        Assert.Equal(6_950, Token(r, "tard.").EndMs);
        Assert.Equal(7_300, Token(r, "Voilà").StartMs);
        Assert.True(Token(r, "Léa.").SilenceAfter);
        Assert.True(Token(r, "tôt,").SilenceAfter);
        AssertMonotonic(r.Tokens);
    }

    [Fact]
    public void AlignWithSilences_ignores_a_pause_without_punctuation_nearby_and_keeps_sentence_ends()
    {
        // Pause au milieu de « rentre » (aucune marque) : le silence reste sans marque, les phrases gardent les leurs.
        var silences = new List<Silence> { new(2_000, 2_300), new(5_450, 5_700), new(6_950, 7_300) };

        var r = SubtitleAligner.AlignWithSilences(ThreeSentences, silences, 8_800);

        Assert.True(r.UsedSilences);
        Assert.Equal(2_300, Token(r, "Elle").StartMs);
        Assert.Equal(7_300, Token(r, "Voilà").StartMs);
        AssertMonotonic(r.Tokens);
    }

    [Fact]
    public void AlignWithSilences_uses_initial_and_final_silences_as_speech_bounds()
    {
        var silences = new List<Silence> { new(0, 250), new(1_000, 1_300), new(2_500, 2_800) };

        var r = SubtitleAligner.AlignWithSilences("Un deux trois. Quatre cinq six.", silences, 2_800);

        Assert.True(r.UsedSilences);
        Assert.Equal(250, r.Tokens[0].StartMs);
        Assert.Equal(1_000, Token(r, "trois.").EndMs);
        Assert.Equal(1_300, Token(r, "Quatre").StartMs);
        Assert.Equal(2_500, r.Tokens[^1].EndMs);
    }

    [Fact]
    public void AlignWithSilences_anchors_a_colon_only_when_a_silence_follows_it()
    {
        const string text = "Voici le résultat : elle part tôt. Elle revient.";

        var both = SubtitleAligner.AlignWithSilences(text, [new(1_450, 1_750), new(2_750, 3_050)], 3_700);
        Assert.True(both.UsedSilences);
        Assert.Equal(1_450, Token(both, "résultat :").EndMs);
        Assert.Equal(1_750, Token(both, "elle").StartMs);
        Assert.Equal(2_750, Token(both, "tôt.").EndMs);

        var sentenceOnly = SubtitleAligner.AlignWithSilences(text, [new(2_750, 3_050)], 3_700);
        Assert.True(sentenceOnly.UsedSilences);
        Assert.False(Token(sentenceOnly, "résultat :").SilenceAfter);
        Assert.Equal(2_750, Token(sentenceOnly, "tôt.").EndMs);
        Assert.Equal(3_050, Token(sentenceOnly, "Elle").StartMs);
        AssertMonotonic(sentenceOnly.Tokens);
    }

    [Fact]
    public void AlignWithSilences_falls_back_to_proportional_with_a_warning_when_a_sentence_end_has_no_silence()
    {
        var r = SubtitleAligner.AlignWithSilences(ThreeSentences, [new(2_000, 2_300)], 8_800);

        Assert.False(r.UsedSilences);
        var warning = Assert.Single(r.Warnings);
        Assert.Contains("1 silence(s)", warning);
        Assert.Contains("3 phrase(s)", warning);
        Assert.Equal(SubtitleAligner.Align(ThreeSentences, [], 8_800), r.Tokens);
    }

    [Fact]
    public void AlignWithSilences_falls_back_when_there_is_no_silence_at_all()
    {
        var r = SubtitleAligner.AlignWithSilences(ThreeSentences, [], 8_800);

        Assert.False(r.UsedSilences);
        Assert.Single(r.Warnings);
        Assert.Equal(SubtitleAligner.Align(ThreeSentences, [], 8_800), r.Tokens);
    }

    [Fact]
    public void AlignWithSilences_never_matches_a_short_silence_to_a_sentence_end()
    {
        var r = SubtitleAligner.AlignWithSilences("Un deux. Trois quatre.", [new(1_000, 1_200)], 2_000);

        Assert.False(r.UsedSilences);
    }

    [Fact]
    public void AlignWithSilences_keeps_times_monotonic_with_many_commas_and_odd_silences()
    {
        const string text = "Un, deux, trois, quatre. Cinq, six : sept. Huit neuf dix, onze douze.";
        var silences = new List<Silence>
        {
            new(0, 120), new(400, 650), new(900, 1_150), new(1_500, 1_900), new(2_300, 2_620),
            new(2_900, 3_200), new(4_000, 4_300), new(5_100, 5_330), new(6_500, 6_900), new(7_900, 8_000),
        };

        var r = SubtitleAligner.AlignWithSilences(text, silences, 8_000);

        Assert.True(r.UsedSilences);
        AssertMonotonic(r.Tokens);
        Assert.Equal(SubtitleAligner.Tokenize(text), r.Tokens.Select(t => t.Text));
    }
}
