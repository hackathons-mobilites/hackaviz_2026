import { describe, expect, it } from 'vitest';
import type { ResolvedTour } from './resolve';
import { cueAtTime, hasRecordedVoice, parseTimestamp, parseVtt, stepAudio, stepFileStem } from './vtt';

// Même forme que la sortie de tools/tour-tts (WebVtt.Render) ; texte de test, sans donnée.
const AZURE = `WEBVTT

NOTE Généré par tools/tour-tts, voix test (profil test), processing_version 0.

1
00:00:00.000 --> 00:00:01.250
Première phrase.

2
00:00:01.250 --> 00:00:04.100
Deuxième phrase, coupée sur
deux lignes &amp; un signe.

3
00:00:05.500 --> 00:00:06.000
Fin.
`;

const DRY = `WEBVTT

NOTE Timings estimés (dry-run) (~14 caractères/s), à régénérer avec Azure AI Speech.

1
00:00:00.000 --> 00:00:01.004
Texte.
`;

function tour(steps: ResolvedTour['steps']): ResolvedTour {
  return { id: 't', title: 'T', processing_version: '0', generated_at: '', steps };
}

describe('noms des fichiers de tools/tour-tts', () => {
  it('NN-<stepId>, rang à partir de 01', () => {
    expect(stepFileStem(0, 'prologue')).toBe('01-prologue');
    expect(stepFileStem(9, 'epilogue')).toBe('10-epilogue');
  });
});

describe('manifeste : durationMs de tour.resolved.json', () => {
  const t = tour([
    { id: 'a', act: 'prologue', text: 'Texte A.', durationMs: 4200 },
    { id: 'b', act: 'acte1', text: 'Texte B.' },
  ]);
  it('étape enregistrée et même texte : MP3 et VTT', () => {
    expect(stepAudio(t, 0, 'a', 'Texte A.', '/tour/t/')).toEqual({ mp3: '/tour/t/01-a.mp3', vtt: '/tour/t/01-a.vtt', durationMs: 4200 });
  });
  it('sans durationMs (audio non généré) : aucun fichier demandé', () => {
    expect(stepAudio(t, 1, 'b', 'Texte B.', '/tour/t/')).toBeNull();
  });
  it('texte différent de l’écran : l’audio ne serait pas le bon, on ne le joue pas', () => {
    expect(stepAudio(t, 0, 'a', 'Texte A modifié.', '/tour/t/')).toBeNull();
    expect(stepAudio(t, 0, 'autre', 'Texte A.', '/tour/t/')).toBeNull();
  });
  it('manifeste absent', () => {
    expect(stepAudio(null, 0, 'a', 'Texte A.', '/')).toBeNull();
    expect(hasRecordedVoice(null)).toBe(false);
  });
  it('au moins une étape enregistrée : contrôle « Voix » affiché', () => {
    expect(hasRecordedVoice(t)).toBe(true);
    expect(hasRecordedVoice(tour([{ id: 'b', act: 'acte1', text: 'x' }]))).toBe(false);
  });
});

describe('lecture WebVTT', () => {
  it('horodatages', () => {
    expect(parseTimestamp('00:01:02.345')).toBe(62_345);
    expect(parseTimestamp('01:02.345')).toBe(62_345);
    expect(parseTimestamp('1:00:00.000')).toBe(3_600_000);
    expect(parseTimestamp('n’importe quoi')).toBeNull();
  });
  it('cues de tools/tour-tts : lignes jointes, entités décodées, NOTE ignorée', () => {
    const v = parseVtt(AZURE)!;
    expect(v.estimated).toBe(false);
    expect(v.cues).toEqual([
      { startMs: 0, endMs: 1250, text: 'Première phrase.' },
      { startMs: 1250, endMs: 4100, text: 'Deuxième phrase, coupée sur deux lignes & un signe.' },
      { startMs: 5500, endMs: 6000, text: 'Fin.' },
    ]);
  });
  it('fichier de dry-run : signalé comme estimé', () => {
    expect(parseVtt(DRY)!.estimated).toBe(true);
  });
  it('fins de ligne Windows', () => {
    expect(parseVtt(AZURE.replace(/\n/g, '\r\n'))!.cues).toHaveLength(3);
  });
  it('pas un WebVTT (page HTML de repli) : null', () => {
    expect(parseVtt('<!doctype html><html></html>')).toBeNull();
  });
});

describe('cue affichée selon la position de l’audio', () => {
  const cues = parseVtt(AZURE)!.cues;
  it('dernière cue commencée ; avant la première, la première', () => {
    expect(cueAtTime(cues, 0)).toBe(0);
    expect(cueAtTime(cues, 1249)).toBe(0);
    expect(cueAtTime(cues, 1250)).toBe(1);
  });
  it('dans un trou entre deux cues : la précédente reste affichée', () => {
    expect(cueAtTime(cues, 5000)).toBe(1);
  });
  it('après la fin : la dernière reste (un sous-titre est toujours visible)', () => {
    expect(cueAtTime(cues, 99_000)).toBe(2);
  });
  it('aucune cue', () => {
    expect(cueAtTime([], 10)).toBe(-1);
  });
});
