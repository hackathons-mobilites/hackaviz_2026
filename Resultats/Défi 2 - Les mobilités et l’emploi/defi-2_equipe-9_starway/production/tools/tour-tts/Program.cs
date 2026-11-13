using System.Text;
using Microsoft.Extensions.Configuration;
using TourTts;

const int TourBudgetMs = 165_000; // 2 min 45 : la visite doit tenir dans la vidéo de 3 min.
const string EstimatedMarker = "Timings estimés (dry-run)";

Console.OutputEncoding = Encoding.UTF8;

if (args.Length == 0 || args.Any(a => a is "-h" or "--help"))
{
    Console.WriteLine(CommandLine.Usage);
    return args.Length == 0 ? 2 : 0;
}

Options options;
try
{
    options = CommandLine.Parse(args);
}
catch (ArgumentException ex)
{
    Console.Error.WriteLine(ex.Message);
    Console.Error.WriteLine();
    Console.Error.WriteLine(CommandLine.Usage);
    return 2;
}

try
{
    return await RunAsync(options);
}
catch (Exception ex) when (ex is InvalidDataException or InvalidOperationException or IOException or System.Text.Json.JsonException)
{
    Console.Error.WriteLine($"Erreur : {ex.Message}");
    return 1;
}

static async Task<int> RunAsync(Options options)
{
    var repoRoot = RepoPaths.FindRoot();
    var inputPath = options.InputPath is not null
        ? RepoPaths.ResolveInput(repoRoot, options.InputPath)
        : RepoPaths.TourFile(repoRoot, options.TourId!);

    if (!File.Exists(inputPath))
    {
        Console.Error.WriteLine($"Fichier introuvable : {inputPath}");
        Console.Error.WriteLine("Générez-le d'abord avec « npm run tour:resolve <tourId> » dans frontend/.");
        return 1;
    }

    var document = TourDocument.Parse(await File.ReadAllTextAsync(inputPath));
    var tour = document.Tour;
    if (options.TourId is not null && options.TourId != tour.Id)
        Console.Error.WriteLine($"Attention : le fichier décrit le tour « {tour.Id} », pas « {options.TourId} ».");

    var outputDir = Path.GetFullPath(options.OutputDir ?? Path.GetDirectoryName(inputPath)!);
    Directory.CreateDirectory(outputDir);

    // Le profil validé à l'écoute fait foi ; --voice ne sert qu'aux essais.
    var profile = VoiceProfile.Load(VoiceProfile.DefaultPath(repoRoot));
    if (options.Voice is not null) profile = profile with { Voice = options.Voice };
    if (tour.Voice is not null && tour.Voice != profile.Voice)
        Console.Error.WriteLine($"Attention : le tour demande la voix « {tour.Voice} », le profil « {profile.Id} » impose « {profile.Voice} ».");
    var indices = Enumerable.Range(0, tour.Steps.Count)
        .Where(i => options.OnlyStepId is null || tour.Steps[i].Id == options.OnlyStepId)
        .ToList();
    if (indices.Count == 0)
    {
        Console.Error.WriteLine($"Étape « {options.OnlyStepId} » absente du tour.");
        return 1;
    }

    Console.WriteLine($"Tour « {tour.Id} » - {tour.Title}");
    Console.WriteLine($"Source : {inputPath}");
    Console.WriteLine($"Sortie : {outputDir}");
    Console.WriteLine($"Voix : {profile.Voice} (profil {profile.Id}) · processing_version : {tour.ProcessingVersion ?? "(absente)"}");
    Console.WriteLine(options.Realign ? "Mode : recalage des .vtt sur les silences des .mp3 (aucun appel Azure)"
        : options.DryRun ? "Mode : dry-run (aucun appel Azure)" : "Mode : synthèse Azure AI Speech");
    Console.WriteLine();

    if (options.Realign) return Realign(tour, indices, outputDir, profile);

    using var speech = options.DryRun ? null : CreateSpeech();
    if (!options.DryRun && speech is null) return 1;

    long totalMs = 0;
    foreach (var i in indices)
    {
        var step = tour.Steps[i];
        var stem = TourDocument.FileStem(i, step.Id);
        var ssml = SsmlBuilder.Build(step.Text, profile);

        int durationMs;
        IReadOnlyList<SpokenWord> words;
        string? note;
        IReadOnlyList<TimedToken>? mp3Tokens = null;
        if (speech is null)
        {
            durationMs = DurationEstimator.EstimateMs(step.Text);
            words = [];
            note = $"{EstimatedMarker} (~{DurationEstimator.CharsPerSecond} caractères/s), à régénérer avec Azure AI Speech.";
            Console.WriteLine($"[{stem}] ~{durationMs / 1000.0:0.0} s estimées");
            Console.WriteLine(ssml);
        }
        else
        {
            Console.Write($"[{stem}] synthèse… ");
            var mp3Path = Path.Combine(outputDir, stem + ".mp3");
            var output = await speech.SynthesizeAsync(ssml);
            await File.WriteAllBytesAsync(mp3Path, output.Mp3);
            durationMs = output.DurationMs;
            words = output.Words;
            document.SetDuration(i, durationMs);
            await File.WriteAllTextAsync(inputPath, document.ToJson());
            Console.WriteLine($"{durationMs / 1000.0:0.0} s, {words.Count} mots horodatés");

            var (tokens, anchored) = AlignFromReport(stem, step.Text, mp3Path, SilenceDetector.Detect(mp3Path), durationMs, words);
            mp3Tokens = tokens;
            note = GeneratedNote(profile, tour) + " " + AlignmentNote(anchored);
        }

        var vttPath = Path.Combine(outputDir, stem + ".vtt");
        if (speech is null && File.Exists(vttPath) && !File.ReadAllText(vttPath).Contains(EstimatedMarker))
        {
            Console.WriteLine($"{stem}.vtt existe déjà (généré avec Azure) : conservé.");
        }
        else
        {
            var cues = WebVtt.BuildCues(mp3Tokens ?? SubtitleAligner.Align(step.Text, words, durationMs));
            await File.WriteAllTextAsync(vttPath, WebVtt.Render(cues, note));
        }

        totalMs += Math.Max(durationMs, step.MinDurationMs ?? 0);
        Console.WriteLine();
    }

    if (speech is not null)
        Console.WriteLine($"durationMs mis à jour dans {inputPath}");

    var label = options.DryRun ? "estimée" : "mesurée";
    Console.WriteLine($"Durée {label} ({indices.Count} étape(s), hors transitions) : {totalMs / 1000.0:0.0} s");
    if (options.OnlyStepId is null && totalMs > TourBudgetMs)
        Console.WriteLine($"Attention : au-delà de {TourBudgetMs / 1000} s, la visite ne tiendra pas dans la vidéo de 3 min.");
    return 0;
}

static string GeneratedNote(VoiceProfile profile, TourFile tour) =>
    $"Généré par tools/tour-tts, voix {profile.Voice} (profil {profile.Id}), processing_version {tour.ProcessingVersion ?? "?"}.";

static string AlignmentNote(bool anchored) =>
    anchored ? "Aligné sur les silences du MP3 (ffmpeg silencedetect -40 dB, 0,2 s)." : "Répartition au prorata.";

/// <summary>Mesure les silences du MP3 et cale le texte dessus ; sinon prorata (ou mots horodatés) avec un avertissement.</summary>
static (IReadOnlyList<TimedToken> Tokens, bool Anchored) AlignFromReport(
    string stem, string text, string mp3Path, SilenceReport? report, long fallbackMs, IReadOnlyList<SpokenWord> words)
{
    if (report is null)
    {
        Console.Error.WriteLine($"Attention : ffmpeg introuvable ou en échec sur {stem}.mp3 : sous-titres répartis au prorata.");
        Console.WriteLine("  prorata (ffmpeg indisponible)");
        return (SubtitleAligner.Align(text, words, fallbackMs), false);
    }

    var sentences = SsmlBuilder.SplitSentences(text).Count;
    var result = SubtitleAligner.AlignWithSilences(text, report.Silences, report.TotalMs);
    if (result.UsedSilences)
    {
        Console.WriteLine($"  {report.Silences.Count} silences, {sentences} phrases : ancré sur les silences");
        return (result.Tokens, true);
    }

    var loose = SilenceDetector.Detect(mp3Path, SilenceDetector.LooseNoiseThreshold, SilenceDetector.LooseMinSilence);
    if (loose is not null)
    {
        var retry = SubtitleAligner.AlignWithSilences(text, loose.Silences, loose.TotalMs, SubtitleAligner.LooseMinSentenceSilenceMs);
        if (retry.UsedSilences)
        {
            Console.WriteLine($"  {loose.Silences.Count} silences (second passage -30 dB, 0,15 s), {sentences} phrases : ancré sur les silences");
            return (retry.Tokens, true);
        }
    }

    foreach (var warning in result.Warnings) Console.Error.WriteLine($"Attention : {stem} : {warning}");
    Console.WriteLine($"  {report.Silences.Count} silences, {sentences} phrases : prorata");
    return (SubtitleAligner.Align(text, words, fallbackMs), false);
}

/// <summary>--realign : réécrit uniquement les .vtt à partir des .mp3 déjà présents (ni .mp3 ni durationMs ne sont touchés).</summary>
static int Realign(TourFile tour, IReadOnlyList<int> indices, string outputDir, VoiceProfile profile)
{
    var done = 0;
    foreach (var i in indices)
    {
        var step = tour.Steps[i];
        var stem = TourDocument.FileStem(i, step.Id);
        var mp3Path = Path.Combine(outputDir, stem + ".mp3");
        Console.WriteLine($"[{stem}]");
        if (!File.Exists(mp3Path))
        {
            Console.Error.WriteLine($"Attention : {stem}.mp3 absent de {outputDir} : étape ignorée.");
            Console.WriteLine();
            continue;
        }

        var fallbackMs = step.DurationMs ?? 0;
        var report = SilenceDetector.Detect(mp3Path);
        if (report is null && fallbackMs == 0)
        {
            Console.Error.WriteLine($"Attention : ffmpeg indisponible et pas de durationMs pour {stem} : étape ignorée.");
            Console.WriteLine();
            continue;
        }

        var (tokens, anchored) = AlignFromReport(stem, step.Text, mp3Path, report, report?.TotalMs ?? fallbackMs, []);
        var cues = WebVtt.BuildCues(tokens);
        File.WriteAllText(Path.Combine(outputDir, stem + ".vtt"),
            WebVtt.Render(cues, GeneratedNote(profile, tour) + " " + AlignmentNote(anchored)));
        done++;
        Console.WriteLine($"  {stem}.vtt réécrit ({cues.Count} cues)");
        Console.WriteLine();
    }

    Console.WriteLine($"{done} fichier(s) .vtt réécrit(s) sur {indices.Count} étape(s).");
    return 0;
}

static AzureSpeech? CreateSpeech()
{
    var config = new ConfigurationBuilder()
        .AddUserSecrets(typeof(Program).Assembly, optional: true)
        .AddEnvironmentVariables()
        .Build();

    var key = FirstNonEmpty(config["SPEECH_KEY"], config["Speech:Key"]);
    var region = FirstNonEmpty(config["SPEECH_REGION"], config["Speech:Region"]);
    if (key is null || region is null)
    {
        Console.Error.WriteLine("""
            Identifiants Azure AI Speech absents. Au choix :
              dotnet user-secrets --project tools/tour-tts set "Speech:Key" "<clé>"
              dotnet user-secrets --project tools/tour-tts set "Speech:Region" "francecentral"
            ou les variables d'environnement SPEECH_KEY et SPEECH_REGION.
            Pour tester sans clé : ajoutez --dry-run.
            """);
        return null;
    }
    return new AzureSpeech(key, region);
}

static string? FirstNonEmpty(params string?[] values) => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
