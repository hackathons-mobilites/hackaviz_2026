/**
 * Narration enregistrée de la visite (tools/tour-tts) : noms de fichiers, manifeste et sous-titres WebVTT.
 * Module PUR (testé par vitest), sans DOM.
 *
 * Contrat de tools/tour-tts (Program.cs, TourFile.cs, WebVtt.cs) :
 * - fichiers d'une étape : `NN-<stepId>.mp3` et `NN-<stepId>.vtt`, à côté de tour.resolved.json
 *   (NN = rang de l'étape sur deux chiffres, à partir de 01) ;
 * - `durationMs` n'est écrit dans tour.resolved.json qu'APRÈS l'écriture du MP3 par Azure AI Speech
 *   (jamais en dry-run) : c'est le manifeste. Sans `durationMs`, on ne demande aucun fichier audio ;
 * - un .vtt de dry-run porte la note « Timings estimés (dry-run) » : ses temps ne sont pas ceux d'un audio.
 */
import type { ResolvedTour } from './resolve';

/** Marqueur des .vtt produits sans Azure (tools/tour-tts/Program.cs, EstimatedMarker). */
export const ESTIMATED_VTT_MARKER = 'Timings estimés (dry-run)';

/** Préfixe des fichiers d'une étape : « 01-prologue » (TourDocument.FileStem). */
export function stepFileStem(index: number, stepId: string): string {
  return `${String(index + 1).padStart(2, '0')}-${stepId}`;
}

export interface StepAudio {
  /** URL du MP3 */
  mp3: string;
  /** URL du WebVTT aligné sur l'audio */
  vtt: string;
  /** Durée mesurée par tools/tour-tts (ms) */
  durationMs: number;
}

/**
 * Audio de l'étape `index`, s'il existe pour CE texte : même identifiant d'étape, même texte que celui
 * qui vient d'être résolu à l'écran, `durationMs` écrit par tools/tour-tts. Sinon null (durée estimée).
 * `base` : dossier de la visite, terminé par « / » (ex. « /tour/lea/ »).
 */
export function stepAudio(
  resolved: ResolvedTour | null | undefined,
  index: number,
  stepId: string,
  text: string,
  base: string,
): StepAudio | null {
  const s = resolved?.steps[index];
  if (!s || s.id !== stepId || s.text !== text) return null;
  const d = s.durationMs;
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return null;
  const stem = stepFileStem(index, stepId);
  return { mp3: `${base}${stem}.mp3`, vtt: `${base}${stem}.vtt`, durationMs: d };
}

/** La visite a-t-elle au moins une étape enregistrée ? (affichage du contrôle « Voix ») */
export function hasRecordedVoice(resolved: ResolvedTour | null | undefined): boolean {
  return !!resolved?.steps.some((s) => typeof s.durationMs === 'number' && s.durationMs > 0);
}

export interface TimedCue {
  startMs: number;
  endMs: number;
  /** Lignes de la cue jointes par une espace (le sous-titre se recompose à la largeur de l'écran) */
  text: string;
}

export interface ParsedVtt {
  /** Fichier de dry-run : temps estimés, pas ceux d'un audio */
  estimated: boolean;
  cues: TimedCue[];
}

const TIMESTAMP = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/;

/** « hh:mm:ss.ttt » ou « mm:ss.ttt » → ms ; null si illisible. */
export function parseTimestamp(s: string): number | null {
  const m = TIMESTAMP.exec(s.trim());
  if (!m) return null;
  const [, h = '0', min, sec, ms] = m;
  return ((Number(h) * 60 + Number(min)) * 60 + Number(sec)) * 1000 + Number(ms);
}

function unescapeCue(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Lecture d'un WebVTT simple (celui de tools/tour-tts) : blocs séparés par une ligne vide, ligne de
 * temps « début --> fin », lignes de texte. Les blocs NOTE, STYLE et REGION sont ignorés. Cues triées.
 * Renvoie null si le fichier ne commence pas par « WEBVTT » (ex. page HTML de repli SPA).
 */
export function parseVtt(source: string): ParsedVtt | null {
  const text = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text)) return null;
  const blocks = text.split(/\n{2,}/).slice(1);
  let estimated = false;
  const cues: TimedCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (!lines.length) continue;
    if (/^NOTE(?:\s|$)/.test(lines[0]!)) {
      if (block.includes(ESTIMATED_VTT_MARKER)) estimated = true;
      continue;
    }
    if (/^(STYLE|REGION)(?:\s|$)/.test(lines[0]!)) continue;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti]!.split('-->');
    const startMs = parseTimestamp(a ?? '');
    const endMs = parseTimestamp((b ?? '').trim().split(/\s+/)[0] ?? '');
    if (startMs == null || endMs == null || endMs < startMs) continue;
    const body = unescapeCue(lines.slice(ti + 1).join(' ')).replace(/\s+/g, ' ').trim();
    if (body) cues.push({ startMs, endMs, text: body });
  }
  cues.sort((x, y) => x.startMs - y.startMs);
  return { estimated, cues };
}

/**
 * Cue affichée à l'instant `ms` de l'audio : la dernière commencée. Avant la première, la première
 * (le sous-titre apparaît avec l'étape) ; après la dernière, la dernière (rien ne s'efface avant
 * l'étape suivante) : un sous-titre est toujours visible. -1 si aucune cue.
 */
export function cueAtTime(cues: readonly TimedCue[], ms: number): number {
  if (!cues.length) return -1;
  let found = 0;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i]!.startMs <= ms) found = i;
    else break;
  }
  return found;
}
