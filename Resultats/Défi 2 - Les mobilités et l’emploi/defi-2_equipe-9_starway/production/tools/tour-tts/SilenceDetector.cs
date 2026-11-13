using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;

namespace TourTts;

/// <summary>Silence mesuré dans un MP3 (ms depuis le début du fichier).</summary>
public sealed record Silence(long StartMs, long EndMs);

/// <summary>Silences et durée totale d'un MP3, tels que mesurés par ffmpeg.</summary>
public sealed record SilenceReport(IReadOnlyList<Silence> Silences, long TotalMs);

/// <summary>
/// La voix ne renvoie aucun mot horodaté : on mesure les silences du MP3 avec ffmpeg (silencedetect)
/// pour caler les sous-titres. ParseSilences est pure ; Detect lance ffmpeg.
/// </summary>
public static partial class SilenceDetector
{
    public const string NoiseThreshold = "-40dB";
    public const string MinSilence = "0.2";

    /// <summary>Second passage, seulement si le premier ne trouve pas assez de silences : la pause forcée est parfois absorbée par le bruit de fond de la voix.</summary>
    public const string LooseNoiseThreshold = "-30dB";
    public const string LooseMinSilence = "0.15";

    [GeneratedRegex(@"silence_start:\s*(?<v>-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex StartLine();

    [GeneratedRegex(@"silence_end:\s*(?<v>-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex EndLine();

    [GeneratedRegex(@"Duration:\s*(?<h>\d+):(?<m>\d+):(?<s>\d+(?:\.\d+)?)")]
    private static partial Regex DurationLine();

    /// <summary>Lit les lignes « silence_start » / « silence_end » de ffmpeg. Un silence ouvert en fin de fichier se termine à <paramref name="totalMs"/>.</summary>
    public static IReadOnlyList<Silence> ParseSilences(string ffmpegStderr, long totalMs)
    {
        var silences = new List<Silence>();
        long? open = null;

        foreach (var line in ffmpegStderr.Split('\n'))
        {
            var start = StartLine().Match(line);
            if (start.Success)
            {
                if (open is not null) silences.Add(new Silence(open.Value, Math.Max(open.Value, totalMs)));
                open = Math.Max(0, ToMs(start.Groups["v"].Value));
                continue;
            }

            var end = EndLine().Match(line);
            if (end.Success && open is not null)
            {
                silences.Add(new Silence(open.Value, Math.Max(open.Value, ToMs(end.Groups["v"].Value))));
                open = null;
            }
        }

        if (open is not null) silences.Add(new Silence(open.Value, Math.Max(open.Value, totalMs)));
        return silences;
    }

    /// <summary>Durée de la ligne « Duration: hh:mm:ss.xx » de ffmpeg, ou null.</summary>
    public static long? ParseDurationMs(string ffmpegStderr)
    {
        var m = DurationLine().Match(ffmpegStderr);
        if (!m.Success) return null;
        var seconds = int.Parse(m.Groups["h"].Value, CultureInfo.InvariantCulture) * 3600.0
                    + int.Parse(m.Groups["m"].Value, CultureInfo.InvariantCulture) * 60.0
                    + double.Parse(m.Groups["s"].Value, CultureInfo.InvariantCulture);
        return (long)Math.Round(seconds * 1000);
    }

    /// <summary>
    /// Lance ffmpeg (variable FFMPEG_PATH, sinon « ffmpeg » du PATH). Renvoie null si ffmpeg est introuvable,
    /// échoue ou ne donne pas de durée : l'appelant retombe alors sur le prorata.
    /// </summary>
    public static SilenceReport? Detect(string mp3Path, string noise = NoiseThreshold, string minSilence = MinSilence)
    {
        var exe = Environment.GetEnvironmentVariable("FFMPEG_PATH");
        var info = new ProcessStartInfo(string.IsNullOrWhiteSpace(exe) ? "ffmpeg" : exe)
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in new[] { "-hide_banner", "-nostats", "-i", mp3Path, "-af", $"silencedetect=noise={noise}:d={minSilence}", "-f", "null", "-" })
            info.ArgumentList.Add(a);

        try
        {
            using var process = Process.Start(info);
            if (process is null) return null;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(120_000))
            {
                try { process.Kill(true); } catch (InvalidOperationException) { }
                return null;
            }
            process.WaitForExit();
            stdout.GetAwaiter().GetResult();
            if (process.ExitCode != 0) return null;

            var text = stderr.GetAwaiter().GetResult();
            var total = ParseDurationMs(text);
            return total is null ? null : new SilenceReport(ParseSilences(text, total.Value), total.Value);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or IOException)
        {
            return null;
        }
    }

    private static long ToMs(string seconds) =>
        (long)Math.Round(double.Parse(seconds, NumberStyles.Float, CultureInfo.InvariantCulture) * 1000);
}
