using TourTts;

namespace TourTts.Tests;

public class SilenceDetectorTests
{
    private const string Stderr = """
        Input #0, mp3, from 'x.mp3':
          Duration: 00:00:12.34, start: 0.000000, bitrate: 96 kb/s
        [silencedetect @ 000001] silence_start: 0
        [silencedetect @ 000001] silence_end: 0.25 | silence_duration: 0.25
        [silencedetect @ 000001] silence_start: 3.1234
        [silencedetect @ 000001] silence_end: 3.6 | silence_duration: 0.4766
        """;

    [Fact]
    public void ParseSilences_reads_start_and_end_lines_with_decimal_points()
    {
        var silences = SilenceDetector.ParseSilences(Stderr, 12_340);

        Assert.Equal([new Silence(0, 250), new Silence(3_123, 3_600)], silences);
    }

    [Fact]
    public void ParseSilences_closes_a_trailing_silence_at_total_duration()
    {
        var stderr = "[silencedetect @ 1] silence_start: 11.9\n";

        var silences = SilenceDetector.ParseSilences(stderr, 12_340);

        Assert.Equal([new Silence(11_900, 12_340)], silences);
    }

    [Fact]
    public void ParseSilences_clamps_a_slightly_negative_start_to_zero()
    {
        var silences = SilenceDetector.ParseSilences("silence_start: -0.0069\nsilence_end: 0.3 | silence_duration: 0.3\n", 5_000);

        Assert.Equal([new Silence(0, 300)], silences);
    }

    [Fact]
    public void ParseSilences_without_silence_returns_nothing() =>
        Assert.Empty(SilenceDetector.ParseSilences("Duration: 00:00:01.00\n", 1_000));

    [Theory]
    [InlineData("  Duration: 00:00:12.34, start: 0.000000", 12_340)]
    [InlineData("  Duration: 00:01:02.50, start: 0.000000", 62_500)]
    public void ParseDurationMs_reads_the_duration_line(string line, long expected) =>
        Assert.Equal(expected, SilenceDetector.ParseDurationMs(line));

    [Fact]
    public void ParseDurationMs_returns_null_without_duration_line() =>
        Assert.Null(SilenceDetector.ParseDurationMs("rien"));
}
