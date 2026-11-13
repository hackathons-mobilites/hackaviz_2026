namespace TourTts;

public sealed record Options(
    string? TourId,
    string? InputPath,
    string? OutputDir,
    bool DryRun,
    string? Voice,
    string? OnlyStepId,
    bool Realign = false);

public static class CommandLine
{
    public const string Usage = """
        Usage : dotnet run --project tools/tour-tts -- <tourId> [options]

          <tourId>            lit frontend/public/tour/<tourId>/tour.resolved.json
          --input <chemin>    lit ce fichier à la place (ex. tools/tour-tts/samples/tour.resolved.sample.json)
          --out <dossier>     dossier de sortie des .mp3/.vtt (défaut : dossier du fichier lu)
          --dry-run           n'appelle pas Azure : affiche le SSML, estime les durées, écrit des .vtt estimés
          --voice <nom>       voix Azure (défaut : champ « voice » du tour, sinon fr-FR-DeniseNeural)
          --only <stepId>     ne traite qu'une étape
          --realign           sans appel Azure : relit les .mp3 déjà présents, mesure leurs silences (ffmpeg)
                              et réécrit uniquement les .vtt ; ni .mp3 ni durationMs ne sont touchés

        ffmpeg doit être dans le PATH (ou FFMPEG_PATH) pour caler les sous-titres sur les silences ;
        sans lui, les sous-titres sont répartis au prorata avec un avertissement.

        Identifiants (hors dépôt) : dotnet user-secrets (Speech:Key, Speech:Region)
        ou variables d'environnement SPEECH_KEY / SPEECH_REGION.
        """;

    public static Options Parse(IReadOnlyList<string> args)
    {
        string? tourId = null, input = null, output = null, voice = null, only = null;
        var dryRun = false;
        var realign = false;

        for (var i = 0; i < args.Count; i++)
        {
            var arg = args[i];
            switch (arg)
            {
                case "--dry-run": dryRun = true; break;
                case "--realign": realign = true; break;
                case "--input": input = ValueOf(args, ref i); break;
                case "--out": output = ValueOf(args, ref i); break;
                case "--voice": voice = ValueOf(args, ref i); break;
                case "--only": only = ValueOf(args, ref i); break;
                default:
                    if (arg.StartsWith('-')) throw new ArgumentException($"Option inconnue : {arg}");
                    if (tourId is not null) throw new ArgumentException($"Argument en trop : {arg}");
                    tourId = arg;
                    break;
            }
        }

        if (tourId is null && input is null)
            throw new ArgumentException("Indiquez un <tourId> ou --input <chemin>.");
        if (tourId is not null && !IsSafeId(tourId))
            throw new ArgumentException($"<tourId> invalide : {tourId} (lettres, chiffres, - et _ uniquement).");

        if (realign && dryRun)
            throw new ArgumentException("--realign et --dry-run s'excluent : --realign relit les .mp3 existants.");

        return new Options(tourId, input, output, dryRun, voice, only, realign);
    }

    private static string ValueOf(IReadOnlyList<string> args, ref int i)
    {
        if (i + 1 >= args.Count || args[i + 1].StartsWith("--"))
            throw new ArgumentException($"L'option {args[i]} attend une valeur.");
        return args[++i];
    }

    private static bool IsSafeId(string id) => id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
}
