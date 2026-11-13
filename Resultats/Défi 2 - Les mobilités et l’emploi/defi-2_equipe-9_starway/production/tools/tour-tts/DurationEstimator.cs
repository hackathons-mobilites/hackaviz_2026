namespace TourTts;

public static class DurationEstimator
{
    /// <summary>Débit moyen d'une voix neuronale française à vitesse normale (même hypothèse que le repli du front).</summary>
    public const double CharsPerSecond = 14.0;

    public static int EstimateMs(string text) =>
        (int)Math.Ceiling(text.Trim().Length / CharsPerSecond * 1000);
}
