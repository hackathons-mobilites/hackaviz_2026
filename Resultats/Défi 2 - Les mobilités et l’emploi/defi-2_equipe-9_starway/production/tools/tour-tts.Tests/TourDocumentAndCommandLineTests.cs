using System.Text.Json.Nodes;
using TourTts;

namespace TourTts.Tests;

public class TourDocumentTests
{
    private const string Json = """
        {
          "id": "demo",
          "title": "Démo",
          "processing_version": "v1",
          "disclaimer": "champ inconnu à conserver",
          "steps": [
            { "id": "a", "act": "prologue", "text": "Texte A.", "minDurationMs": 3000, "state": { "budget": 45 } },
            { "id": "b", "act": "acte1", "text": "Texte B." }
          ]
        }
        """;

    [Fact]
    public void Parse_reads_minimal_fields()
    {
        var tour = TourDocument.Parse(Json).Tour;

        Assert.Equal("demo", tour.Id);
        Assert.Equal("v1", tour.ProcessingVersion);
        Assert.Equal(2, tour.Steps.Count);
        Assert.Equal(3000, tour.Steps[0].MinDurationMs);
        Assert.Null(tour.Steps[1].DurationMs);
    }

    [Fact]
    public void SetDuration_updates_only_durationMs_and_keeps_other_fields()
    {
        var doc = TourDocument.Parse(Json);
        doc.SetDuration(1, 4321);

        var root = JsonNode.Parse(doc.ToJson())!;
        Assert.Equal(4321, (int)root["steps"]![1]!["durationMs"]!);
        Assert.Equal("champ inconnu à conserver", (string)root["disclaimer"]!);
        Assert.Equal(45, (int)root["steps"]![0]!["state"]!["budget"]!);
        Assert.Contains("Démo", doc.ToJson()); // accents non échappés
    }

    [Theory]
    [InlineData("""{ "id": "x", "steps": [] }""")]
    [InlineData("""{ "id": "x", "steps": [ { "id": "a", "text": "" } ] }""")]
    [InlineData("""{ "id": "x", "steps": [ { "id": "a", "text": "t" }, { "id": "a", "text": "u" } ] }""")]
    public void Parse_rejects_invalid_tours(string json) =>
        Assert.Throws<InvalidDataException>(() => TourDocument.Parse(json));

    [Theory]
    [InlineData(0, "intro", "01-intro")]
    [InlineData(11, "acte4", "12-acte4")]
    public void FileStem_is_two_digit_one_based(int index, string id, string expected) =>
        Assert.Equal(expected, TourDocument.FileStem(index, id));
}

public class CommandLineTests
{
    [Fact]
    public void Parse_reads_all_options()
    {
        var o = CommandLine.Parse(["lea", "--dry-run", "--voice", "fr-FR-HenriNeural", "--only", "acte2", "--out", "x"]);

        Assert.Equal(new Options("lea", null, "x", true, "fr-FR-HenriNeural", "acte2"), o);
    }

    [Fact]
    public void Parse_reads_realign_and_rejects_it_with_dry_run()
    {
        Assert.True(CommandLine.Parse(["lea", "--realign", "--only", "acte2"]).Realign);
        Assert.False(CommandLine.Parse(["lea"]).Realign);
        Assert.Throws<ArgumentException>(() => CommandLine.Parse(["lea", "--realign", "--dry-run"]));
    }

    [Fact]
    public void Parse_accepts_input_without_tour_id() =>
        Assert.Equal("f.json", CommandLine.Parse(["--input", "f.json"]).InputPath);

    [Fact]
    public void Parse_requires_tour_id_or_input() =>
        Assert.Throws<ArgumentException>(() => CommandLine.Parse(["--dry-run"]));

    [Theory]
    [InlineData("--voice")]
    [InlineData("lea", "--unknown")]
    [InlineData("../etc")]
    [InlineData("lea", "autre")]
    public void Parse_rejects_bad_arguments(params string[] args) =>
        Assert.Throws<ArgumentException>(() => CommandLine.Parse(args));
}
