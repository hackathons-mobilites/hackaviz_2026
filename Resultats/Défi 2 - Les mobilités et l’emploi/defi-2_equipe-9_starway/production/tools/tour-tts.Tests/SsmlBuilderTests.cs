using System.Xml.Linq;
using TourTts;

namespace TourTts.Tests;

public class SsmlBuilderTests
{
    // Le vrai profil versionné : les tests vérifient la configuration validée par l'équipe.
    private static readonly VoiceProfile Profile = VoiceProfile.Load(VoiceProfile.DefaultPath(RepoPaths.FindRoot()));

    [Fact]
    public void Validated_profile_is_marc_standard_rate_plus_8_with_300ms_between_sentences()
    {
        Assert.Equal("marc-standard-r8", Profile.Id);
        Assert.Null(Profile.Style);
        Assert.Equal("+8%", Profile.Rate);
        Assert.Equal(300, Profile.SentenceBreakMs);

        var ssml = SsmlBuilder.Build("Première phrase. Deuxième phrase !", Profile);

        var doc = XDocument.Parse(ssml);
        XNamespace ns = "http://www.w3.org/2001/10/synthesis";
        Assert.Equal("fr-FR-Marc:MAI-Voice-2", doc.Root!.Element(ns + "voice")!.Attribute("name")!.Value);
        // Même structure que l'échantillon validé à l'écoute le 11/11 (P4, +8 %, 300 ms) : lang, puis prosody, sans express-as.
        Assert.Contains("<lang xml:lang=\"fr-FR\"><prosody rate=\"+8%\">Première phrase.<break time=\"300ms\"/>Deuxième phrase !</prosody></lang>", ssml);
        Assert.DoesNotContain("express-as", ssml);
        Assert.DoesNotContain("pitch=", ssml);
    }

    [Fact]
    public void The_300ms_break_is_only_between_two_sentences_never_inside_nor_at_the_ends()
    {
        var ssml = SsmlBuilder.Build("Un seul bloc, avec une virgule : et deux-points.", Profile);
        Assert.DoesNotContain("<break", ssml);

        var three = SsmlBuilder.Build("Un. Deux, trois : quatre. Cinq ?", Profile);
        Assert.Equal(2, System.Text.RegularExpressions.Regex.Matches(three, "<break time=\"300ms\"/>").Count);
        Assert.DoesNotContain("<prosody rate=\"+8%\"><break", three);
        Assert.DoesNotContain("<break time=\"300ms\"/></prosody>", three);
        Assert.Contains("Deux, trois : quatre.<break time=\"300ms\"/>Cinq ?", three);
    }

    [Fact]
    public void Style_without_value_produces_no_express_as_but_a_style_is_still_rendered_when_set()
    {
        var withStyle = SsmlBuilder.Build("Un.", Profile with { Style = "softvoice" });

        Assert.Contains("<mstts:express-as style=\"softvoice\"><prosody rate=\"+8%\">Un.</prosody></mstts:express-as>", withStyle);
        Assert.DoesNotContain("express-as", SsmlBuilder.Build("Un.", Profile with { Style = null }));
    }

    [Fact]
    public void Build_escapes_xml_special_characters()
    {
        var ssml = SsmlBuilder.Build("Vélo & TC < 45 min > rien \"cité\".", Profile);

        XDocument.Parse(ssml); // ne lève pas
        Assert.Contains("Vélo &amp;", ssml);
        Assert.Contains("&lt; 45", ssml);
    }

    [Theory]
    [InlineData("Le RER B arrive.", "<sub alias=\"R E R\">RER</sub> B")]
    [InlineData("En TC, c'est long.", "<sub alias=\"T C\">TC</sub>,")]
    [InlineData("Données INSEE.", "<sub alias=\"Insé\">INSEE</sub>")]
    [InlineData("Selon IDFM.", "<sub alias=\"Ile de France Mobilités\">IDFM</sub>")]
    [InlineData("API PRIM.", "<sub alias=\"Prime\">PRIM</sub>")]
    [InlineData("Les habitants d’Île-de-France.", "<sub alias=\"d&apos;Ile de France\">d&apos;Île-de-France</sub>")]
    [InlineData("Traverser l'Île-de-France.", "<sub alias=\"l&apos;Ile de France\">l&apos;Île-de-France</sub>")]
    [InlineData("En Île-de-France.", "<sub alias=\"Ile de France\">Île-de-France</sub>")]
    public void Build_adds_pronunciation_aliases(string text, string expected) =>
        Assert.Contains(expected, SsmlBuilder.Build(text, Profile));

    [Theory]
    [InlineData("TCHAD et ATC.")]
    [InlineData("Le rer en minuscules.")]
    [InlineData("PRIMAIRE.")]
    public void Build_ignores_acronyms_inside_words_or_lowercase(string text) =>
        Assert.DoesNotContain("<sub", SsmlBuilder.Build(text, Profile));

    [Fact]
    public void Build_straightens_apostrophes()
    {
        var ssml = SsmlBuilder.Build("À l’heure où l’on part.", Profile);

        Assert.DoesNotContain("’", ssml);
        Assert.Contains("l&apos;heure", ssml);
    }

    [Fact]
    public void Optional_prosody_and_breaks_are_rendered_when_a_profile_sets_them()
    {
        var tuned = Profile with { Rate = "-6%", Pitch = null, SentenceBreakMs = 300, Style = null };

        var ssml = SsmlBuilder.Build("Un. Deux.", tuned);

        Assert.Contains("<prosody rate=\"-6%\">", ssml);
        Assert.Contains("<break time=\"300ms\"/>", ssml);
        Assert.DoesNotContain("express-as", ssml);
    }

    [Fact]
    public void SplitSentences_splits_on_terminal_punctuation_and_collapses_whitespace()
    {
        var sentences = SsmlBuilder.SplitSentences("  Un.  Deux ?\nTrois…  Quatre ! ");

        Assert.Equal(["Un.", "Deux ?", "Trois…", "Quatre !"], sentences);
    }
}
