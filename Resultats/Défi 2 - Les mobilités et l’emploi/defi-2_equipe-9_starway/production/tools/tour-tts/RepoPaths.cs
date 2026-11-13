namespace TourTts;

public static class RepoPaths
{
    /// <summary>Racine du dépôt : premier dossier parent contenant tools/tour-tts/TourTts.csproj.</summary>
    public static string FindRoot()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                if (File.Exists(Path.Combine(dir.FullName, "tools", "tour-tts", "TourTts.csproj")))
                    return dir.FullName;
            }
        }
        throw new DirectoryNotFoundException("Racine du dépôt STARWAY introuvable (tools/tour-tts/TourTts.csproj).");
    }

    public static string TourFile(string repoRoot, string tourId) =>
        Path.Combine(repoRoot, "frontend", "public", "tour", tourId, "tour.resolved.json");

    /// <summary>Chemin --input : relatif au dossier courant, sinon à la racine du dépôt.</summary>
    public static string ResolveInput(string repoRoot, string path)
    {
        if (Path.IsPathRooted(path)) return path;
        var fromCwd = Path.GetFullPath(path);
        return File.Exists(fromCwd) ? fromCwd : Path.GetFullPath(Path.Combine(repoRoot, path));
    }
}
