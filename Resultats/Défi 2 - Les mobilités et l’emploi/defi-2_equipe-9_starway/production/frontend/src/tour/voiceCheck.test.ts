import { describe, expect, it } from 'vitest';
import type { ResolvedTour } from './resolve';
import { checkVoice, mp3DurationMs, VOICE_TOLERANCE, voiceReportLines, type VoiceFiles } from './voiceCheck';

/** MP3 synthétique : n trames MPEG-2 couche III, 24 kHz, 96 kbit/s, mono (288 octets, 24 ms chacune), comme tools/tour-tts. */
function mp3(frames: number, withId3 = false): Uint8Array {
  const id3 = withId3 ? [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array<number>(20).fill(0)] : [];
  const out = new Uint8Array(id3.length + frames * 288);
  out.set(id3, 0);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xf3, 0xa4, 0xc0], id3.length + i * 288);
  return out;
}

const vtt = (cues: [string, string, string][]) =>
  new TextEncoder().encode(`WEBVTT\n\n${cues.map(([a, b, t], i) => `${i + 1}\n${a} --> ${b}\n${t}\n`).join('\n')}\n`);

const resolved = (steps: { id: string; text: string; durationMs?: number }[]): ResolvedTour => ({
  id: 't',
  title: 'T',
  processing_version: '0.1.0',
  generated_at: '2026-11-05T00:00:00Z',
  steps: steps.map((s) => ({ act: 'acte1', ...s })),
});

const files = (entries: Record<string, Uint8Array>): VoiceFiles => ({ read: (n) => entries[n] ?? null, list: () => Object.keys(entries) });

describe('durée d’un MP3 (trames MPEG couche III)', () => {
  it('compte les trames : 24 ms chacune à 24 kHz', () => {
    expect(mp3DurationMs(mp3(250))).toBe(6000);
    expect(mp3DurationMs(mp3(1))).toBe(24);
  });
  it('ignore l’en-tête ID3v2 et ne lit pas du bruit', () => {
    expect(mp3DurationMs(mp3(100, true))).toBe(2400);
    expect(mp3DurationMs(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(mp3DurationMs(new Uint8Array())).toBeNull();
  });
});

describe('contrôle de la voix : aucune étape sans MP3 ni WebVTT', () => {
  const text = 'Léa part à 8 heures. Elle arrive.';
  const good = { '01-a.mp3': mp3(250), '01-a.vtt': vtt([['00:00:00.000', '00:00:05.900', 'Léa part à 8 heures.'], ['00:00:03.000', '00:00:05.900', 'Elle arrive.']]) };

  it('étape complète : voix, sous-titres du même texte, durées d’accord', () => {
    const r = checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files(good));
    expect(r.ok).toBe(true);
    expect(r.steps[0]).toMatchObject({ mp3Ms: 6000, vttEndMs: 5900, driftMs: -100, problems: [] });
  });
  it('MP3 absent, WebVTT absent, durationMs absent : trois erreurs, jamais un repli', () => {
    const r = checkVoice(resolved([{ id: 'a', text }]), files({}));
    expect(r.ok).toBe(false);
    expect(r.steps[0]!.problems.map((p) => p.code)).toEqual(['no_duration', 'missing_mp3', 'missing_vtt']);
  });
  it('une seule étape sans voix suffit à échouer', () => {
    const r = checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }, { id: 'b', text: 'Suite.' }]), files(good));
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.problems.length > 0)).toEqual([false, true]);
  });
  it('manifeste qui ne dit pas la durée du MP3', () => {
    const r = checkVoice(resolved([{ id: 'a', text, durationMs: 7000 }]), files(good));
    expect(r.steps[0]!.problems.map((p) => p.code)).toContain('duration_manifest');
  });
  it('WebVTT d’un autre texte (version précédente) ou estimé (dry-run)', () => {
    const old = { ...good, '01-a.vtt': vtt([['00:00:00.000', '00:00:05.900', 'Ça, c’est le calcul.']]) };
    expect(checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files(old)).steps[0]!.problems.map((p) => p.code)).toContain('vtt_text');
    const dry = new TextEncoder().encode('WEBVTT\n\nNOTE Timings estimés (dry-run) (~14 caractères/s)\n\n1\n00:00:00.000 --> 00:00:05.900\nLéa part à 8 heures. Elle arrive.\n');
    expect(checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files({ ...good, '01-a.vtt': dry })).steps[0]!.problems.map((p) => p.code)).toContain('vtt_estimated');
  });
  it('décalage voix / sous-titres : fin après la voix, fin trop tôt, début tardif, trou', () => {
    const after = { ...good, '01-a.vtt': vtt([['00:00:00.000', '00:00:06.500', text]]) };
    expect(checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files(after)).steps[0]!.problems.map((p) => p.code)).toEqual(['vtt_after_audio']);
    const early = { ...good, '01-a.vtt': vtt([['00:00:00.000', '00:00:03.000', text]]) };
    expect(checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files(early)).steps[0]!.problems.map((p) => p.code)).toEqual(['vtt_before_audio']);
    const late = { ...good, '01-a.vtt': vtt([['00:00:01.500', '00:00:05.900', text]]) };
    expect(checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files(late)).steps[0]!.problems.map((p) => p.code)).toEqual(['vtt_first_late']);
    const gap = { ...good, '01-a.vtt': vtt([['00:00:00.000', '00:00:01.000', 'Léa part à 8 heures.'], ['00:00:04.000', '00:00:05.900', 'Elle arrive.']]) };
    expect(checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files(gap)).steps[0]!.problems.map((p) => p.code)).toEqual(['vtt_gap']);
    expect(VOICE_TOLERANCE.vttAfterAudioMs).toBeLessThan(VOICE_TOLERANCE.vttBeforeAudioMs);
  });
  it('fichiers orphelins signalés (restes d’une version précédente), rapport lisible', () => {
    const r = checkVoice(resolved([{ id: 'a', text, durationMs: 6000 }]), files({ ...good, '09-vieux.mp3': mp3(2), '09-vieux.vtt': vtt([]) }));
    expect(r.orphans).toEqual(['09-vieux.mp3', '09-vieux.vtt']);
    expect(r.ok).toBe(true);
    expect(voiceReportLines(r).join('\n')).toMatch(/orphelin.*09-vieux\.mp3[\s\S]*Voix complète : 1 étapes/);
  });
});
