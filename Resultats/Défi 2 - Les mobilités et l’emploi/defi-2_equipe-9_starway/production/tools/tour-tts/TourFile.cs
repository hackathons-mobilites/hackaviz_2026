using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace TourTts;

/// <summary>Contenu minimal de tour.resolved.json lu par l'outil (les autres champs sont conservés tels quels).</summary>
public sealed record TourFile(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("voice")] string? Voice,
    [property: JsonPropertyName("processing_version")] string? ProcessingVersion,
    [property: JsonPropertyName("steps")] IReadOnlyList<TourStep> Steps);

public sealed record TourStep(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("act")] string? Act,
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("minDurationMs")] int? MinDurationMs,
    [property: JsonPropertyName("durationMs")] int? DurationMs);

/// <summary>
/// Garde le document JSON d'origine pour ne réécrire que <c>durationMs</c>,
/// sans perdre les champs ajoutés par le front (state, disclaimer…).
/// </summary>
public sealed class TourDocument
{
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly JsonObject _root;

    private TourDocument(JsonObject root, TourFile tour)
    {
        _root = root;
        Tour = tour;
    }

    public TourFile Tour { get; }

    public static TourDocument Parse(string json)
    {
        var root = JsonNode.Parse(json) as JsonObject
            ?? throw new InvalidDataException("tour.resolved.json doit contenir un objet JSON.");
        var tour = root.Deserialize<TourFile>()
            ?? throw new InvalidDataException("tour.resolved.json est vide.");

        if (string.IsNullOrWhiteSpace(tour.Id))
            throw new InvalidDataException("Champ « id » manquant.");
        if (tour.Steps is null || tour.Steps.Count == 0)
            throw new InvalidDataException("Aucune étape dans « steps ».");

        var seen = new HashSet<string>();
        foreach (var step in tour.Steps)
        {
            if (string.IsNullOrWhiteSpace(step.Id))
                throw new InvalidDataException("Une étape n'a pas d'« id ».");
            if (!seen.Add(step.Id))
                throw new InvalidDataException($"Identifiant d'étape en double : {step.Id}.");
            if (string.IsNullOrWhiteSpace(step.Text))
                throw new InvalidDataException($"Étape « {step.Id} » : « text » est vide.");
        }

        return new TourDocument(root, tour);
    }

    public void SetDuration(int stepIndex, int durationMs) =>
        _root["steps"]!.AsArray()[stepIndex]!.AsObject()["durationMs"] = durationMs;

    public string ToJson() => _root.ToJsonString(WriteOptions) + Environment.NewLine;

    /// <summary>Préfixe des fichiers d'une étape : « 01-prologue ».</summary>
    public static string FileStem(int stepIndex, string stepId) => $"{stepIndex + 1:D2}-{stepId}";
}
