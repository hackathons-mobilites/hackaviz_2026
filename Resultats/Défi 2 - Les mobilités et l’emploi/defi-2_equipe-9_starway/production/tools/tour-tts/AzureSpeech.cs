using Microsoft.CognitiveServices.Speech;

namespace TourTts;

public sealed record SynthesisOutput(byte[] Mp3, int DurationMs, IReadOnlyList<SpokenWord> Words);

/// <summary>Synthèse Azure AI Speech en mémoire (MP3 24 kHz 96 kbit/s mono) avec collecte des WordBoundary.</summary>
public sealed class AzureSpeech : IDisposable
{
    private readonly SpeechSynthesizer _synthesizer;
    private readonly List<SpokenWord> _words = [];
    private readonly Lock _lock = new();

    public AzureSpeech(string key, string region)
    {
        var config = SpeechConfig.FromSubscription(key, region);
        config.SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3);

        // AudioConfig null : rien n'est joué sur le haut-parleur, l'audio reste dans result.AudioData.
        _synthesizer = new SpeechSynthesizer(config, null);
        _synthesizer.WordBoundary += OnWordBoundary;
    }

    public async Task<SynthesisOutput> SynthesizeAsync(string ssml)
    {
        lock (_lock) _words.Clear();

        using var result = await _synthesizer.SpeakSsmlAsync(ssml);

        if (result.Reason == ResultReason.Canceled)
        {
            var details = SpeechSynthesisCancellationDetails.FromResult(result);
            throw new InvalidOperationException(
                $"Synthèse annulée ({details.Reason}, {details.ErrorCode}) : {details.ErrorDetails}");
        }
        if (result.Reason != ResultReason.SynthesizingAudioCompleted)
            throw new InvalidOperationException($"Synthèse inattendue : {result.Reason}.");

        List<SpokenWord> words;
        lock (_lock) words = _words.OrderBy(w => w.StartMs).ToList();

        return new SynthesisOutput(result.AudioData, (int)Math.Round(result.AudioDuration.TotalMilliseconds), words);
    }

    private void OnWordBoundary(object? sender, SpeechSynthesisWordBoundaryEventArgs e)
    {
        if (e.BoundaryType != SpeechSynthesisBoundaryType.Word) return;

        // AudioOffset est en ticks (100 ns) : 10 000 ticks = 1 ms.
        var start = (long)((e.AudioOffset + 5_000) / 10_000);
        var end = start + (long)Math.Round(e.Duration.TotalMilliseconds);
        lock (_lock) _words.Add(new SpokenWord(e.Text, start, end));
    }

    public void Dispose()
    {
        _synthesizer.WordBoundary -= OnWordBoundary;
        _synthesizer.Dispose();
    }
}
