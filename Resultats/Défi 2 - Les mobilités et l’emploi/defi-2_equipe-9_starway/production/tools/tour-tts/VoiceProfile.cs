using System.Text.Json;

namespace TourTts;

/// <summary>Profil de voix validé à l'écoute (tools/tour-tts/voice-profile.json), appliqué à toute génération.</summary>
public sealed record VoiceProfile(
    string Id,
    string Voice,
    string Language,
    string? Style,
    double? StyleDegree,
    string? Rate,
    string? Pitch,
    int SentenceBreakMs,
    bool ForceLanguageTag,
    bool StraightenApostrophes,
    IReadOnlyDictionary<string, string> Aliases)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public static string DefaultPath(string repoRoot) => Path.Combine(repoRoot, "tools", "tour-tts", "voice-profile.json");

    public static VoiceProfile Parse(string json) =>
        JsonSerializer.Deserialize<VoiceProfile>(json, Json)
        ?? throw new InvalidDataException("voice-profile.json vide ou invalide.");

    public static VoiceProfile Load(string path) => Parse(File.ReadAllText(path));
}
