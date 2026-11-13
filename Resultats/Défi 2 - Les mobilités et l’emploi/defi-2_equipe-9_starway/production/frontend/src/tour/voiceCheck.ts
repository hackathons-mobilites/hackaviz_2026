/**
 * Contrôle de la VOIX de la visite (05/11, demande de Nicolas) : pour chaque étape de `tour.resolved.json`, le MP3 et le
 * WebVTT existent, viennent du même texte, et leurs durées s'accordent. Module PUR (les fichiers arrivent par `VoiceFiles`) :
 * utilisé par `npm run tour:voice` (frontend/scripts/check-tour-voice.ts) et par le test `voiceFiles.test.ts`.
 *
 * Règle : AUCUN repli. Une étape sans voix enregistrée est une ERREUR (jamais la voix du navigateur, jamais « sous-titres
 * seuls » en silence) : la visite ne part sur le site que complète. Contrat des fichiers : tools/tour-tts (`NN-<id>.mp3`,
 * `NN-<id>.vtt`, `durationMs` du manifeste écrit après le MP3), voir vtt.ts.
 */
import type { ResolvedTour } from './resolve';
import { ESTIMATED_VTT_MARKER, parseVtt, stepFileStem } from './vtt';

/** Accès aux fichiers du dossier de la visite (public/tour/<id>/) : octets d'un fichier, ou null s'il n'existe pas. */
export interface VoiceFiles {
  read(name: string): Uint8Array | null;
  list(): string[];
}

/**
 * Tolérances (ms). Le MP3 est découpé en trames de 24 ms (576 échantillons à 24 kHz) : 100 ms couvrent l'arrondi du
 * manifeste. Le sous-titre suit les mots prononcés (WordBoundary) : il finit un peu avant la fin du fichier (silence de
 * fin) et ne doit jamais finir après lui.
 */
export const VOICE_TOLERANCE = {
  /** |durée du MP3 − durationMs du manifeste| */
  manifestMs: 100,
  /** la dernière cue ne finit pas plus de … après la fin du MP3 */
  vttAfterAudioMs: 250,
  /** la dernière cue ne finit pas plus de … avant la fin du MP3 (silence de fin normal : un peu moins d'une seconde) */
  vttBeforeAudioMs: 1500,
  /** la première cue démarre dans les … premières ms */
  vttFirstStartMs: 800,
  /** trou maximal entre deux cues consécutives (les trous ≤ 800 ms sont comblés par tools/tour-tts) */
  vttGapMs: 1500,
} as const;

export type VoiceProblemCode =
  | 'no_duration'
  | 'missing_mp3'
  | 'missing_vtt'
  | 'mp3_unreadable'
  | 'vtt_invalid'
  | 'vtt_estimated'
  | 'vtt_text'
  | 'duration_manifest'
  | 'vtt_after_audio'
  | 'vtt_before_audio'
  | 'vtt_first_late'
  | 'vtt_gap';

export interface VoiceProblem {
  code: VoiceProblemCode;
  detail: string;
}

export interface VoiceStepReport {
  index: number;
  id: string;
  stem: string;
  /** durationMs du manifeste, MP3 mesuré, début et fin du WebVTT (ms) ; null si inconnu */
  durationMs: number | null;
  mp3Ms: number | null;
  vttStartMs: number | null;
  vttEndMs: number | null;
  /** fin du WebVTT − durée du MP3 (ms, négatif : le sous-titre finit avant la voix) */
  driftMs: number | null;
  problems: VoiceProblem[];
}

export interface VoiceReport {
  steps: VoiceStepReport[];
  /** Fichiers `NN-id.mp3|vtt` du dossier qui ne correspondent à aucune étape (restes d'une version précédente) */
  orphans: string[];
  /** Aucune étape en erreur (les orphelins sont signalés, pas bloquants) */
  ok: boolean;
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Durée d'un MP3 (ms) par lecture des trames MPEG audio couche III (ID3v2 en tête ignoré, trame Xing / Info non comptée).
 * Précis à une trame près (24 ms à 24 kHz). null si aucune trame valide.
 */
export function mp3DurationMs(bytes: Uint8Array): number | null {
  let pos = 0;
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    pos = 10 + size + ((bytes[5]! & 0x10) !== 0 ? 10 : 0);
  }
  let seconds = 0;
  let frames = 0;
  while (pos + 4 <= bytes.length) {
    const b0 = bytes[pos]!;
    const b1 = bytes[pos + 1]!;
    const b2 = bytes[pos + 2]!;
    const version = (b1 >> 3) & 3;
    const layer = (b1 >> 1) & 3;
    const brIndex = b2 >> 4;
    const srIndex = (b2 >> 2) & 3;
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || brIndex === 0 || brIndex === 15 || srIndex === 3) {
      // Fin du flux (balise ID3v1 « TAG ») ou octet perdu : on cherche la trame suivante
      if (bytes[pos] === 0x54 && bytes[pos + 1] === 0x41 && bytes[pos + 2] === 0x47) break;
      pos++;
      continue;
    }
    const sampleRate = SAMPLE_RATES[version]![srIndex]!;
    const bitrate = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[brIndex]! * 1000;
    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + ((b2 >> 1) & 1);
    if (length < 4) {
      pos++;
      continue;
    }
    const mono = ((bytes[pos + 3]! >> 6) & 3) === 3;
    const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const tagAt = pos + 4 + ((b1 & 1) === 0 ? 2 : 0) + sideInfo;
    const tag = String.fromCharCode(bytes[tagAt] ?? 0, bytes[tagAt + 1] ?? 0, bytes[tagAt + 2] ?? 0, bytes[tagAt + 3] ?? 0);
    if (!(frames === 0 && (tag === 'Xing' || tag === 'Info'))) {
      seconds += samples / sampleRate;
      frames++;
    }
    pos += length;
  }
  return frames > 0 ? Math.round(seconds * 1000) : null;
}

/** Mots du texte, sans ponctuation ni casse ni accents (comparaison texte de l'étape / texte des cues). */
function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const decoder = new TextDecoder('utf-8');

/** Contrôle de chaque étape de `resolved` contre les fichiers de `fs`. */
export function checkVoice(resolved: ResolvedTour, fs: VoiceFiles): VoiceReport {
  const names = new Set(fs.list());
  const steps = resolved.steps.map((step, index): VoiceStepReport => {
    const stem = stepFileStem(index, step.id);
    const problems: VoiceProblem[] = [];
    const add = (code: VoiceProblemCode, detail: string) => problems.push({ code, detail });
    const durationMs = typeof step.durationMs === 'number' && Number.isFinite(step.durationMs) && step.durationMs > 0 ? step.durationMs : null;
    if (durationMs == null) add('no_duration', `étape sans voix enregistrée (pas de durationMs dans tour.resolved.json) : ${stem}`);

    const mp3 = fs.read(`${stem}.mp3`);
    if (!mp3) add('missing_mp3', `${stem}.mp3 absent`);
    let mp3Ms: number | null = null;
    if (mp3) {
      mp3Ms = mp3DurationMs(mp3);
      if (mp3Ms == null) add('mp3_unreadable', `${stem}.mp3 : aucune trame MPEG lisible (${mp3.length} octets)`);
    }
    if (mp3Ms != null && durationMs != null && Math.abs(mp3Ms - durationMs) > VOICE_TOLERANCE.manifestMs) {
      add('duration_manifest', `${stem}.mp3 dure ${mp3Ms} ms, le manifeste dit ${durationMs} ms (écart ${mp3Ms - durationMs} ms)`);
    }

    const vttBytes = fs.read(`${stem}.vtt`);
    if (!vttBytes) add('missing_vtt', `${stem}.vtt absent`);
    let vttStartMs: number | null = null;
    let vttEndMs: number | null = null;
    if (vttBytes) {
      const source = decoder.decode(vttBytes);
      const vtt = parseVtt(source);
      if (!vtt || !vtt.cues.length) add('vtt_invalid', `${stem}.vtt : pas un WebVTT lisible ou aucune cue`);
      else {
        if (vtt.estimated || source.includes(ESTIMATED_VTT_MARKER)) add('vtt_estimated', `${stem}.vtt : timings estimés (dry-run), pas ceux d'une voix`);
        vttStartMs = vtt.cues[0]!.startMs;
        vttEndMs = Math.max(...vtt.cues.map((c) => c.endMs));
        if (words(vtt.cues.map((c) => c.text).join(' ')).join(' ') !== words(step.text).join(' ')) {
          add('vtt_text', `${stem}.vtt : les sous-titres ne disent pas le texte de l'étape (fichier d'une version précédente ?)`);
        }
        if (vttStartMs > VOICE_TOLERANCE.vttFirstStartMs) add('vtt_first_late', `${stem}.vtt : première cue à ${vttStartMs} ms (la voix démarre à 0)`);
        for (let i = 1; i < vtt.cues.length; i++) {
          const gap = vtt.cues[i]!.startMs - vtt.cues[i - 1]!.endMs;
          if (gap > VOICE_TOLERANCE.vttGapMs) add('vtt_gap', `${stem}.vtt : ${gap} ms sans sous-titre avant la cue ${i + 1}`);
        }
        if (mp3Ms != null) {
          const drift = vttEndMs - mp3Ms;
          if (drift > VOICE_TOLERANCE.vttAfterAudioMs) add('vtt_after_audio', `${stem}.vtt finit ${drift} ms APRÈS la voix (${vttEndMs} ms contre ${mp3Ms} ms)`);
          if (-drift > VOICE_TOLERANCE.vttBeforeAudioMs) add('vtt_before_audio', `${stem}.vtt finit ${-drift} ms AVANT la fin de la voix (${vttEndMs} ms contre ${mp3Ms} ms)`);
        }
      }
    }
    return {
      index,
      id: step.id,
      stem,
      durationMs,
      mp3Ms,
      vttStartMs,
      vttEndMs,
      driftMs: mp3Ms != null && vttEndMs != null ? vttEndMs - mp3Ms : null,
      problems,
    };
  });
  const stems = new Set(steps.map((s) => s.stem));
  const orphans = [...names].filter((n) => /^\d{2}-.+\.(mp3|vtt)$/.test(n) && !stems.has(n.replace(/\.(mp3|vtt)$/, ''))).sort();
  return { steps, orphans, ok: steps.every((s) => s.problems.length === 0) };
}

/** Lignes lisibles du rapport (une ligne par problème, puis le bilan). */
export function voiceReportLines(report: VoiceReport): string[] {
  const lines: string[] = [];
  for (const s of report.steps) {
    const m = s.mp3Ms != null ? `${(s.mp3Ms / 1000).toFixed(2)} s` : '-';
    const v = s.vttEndMs != null ? `${(s.vttEndMs / 1000).toFixed(2)} s` : '-';
    const d = s.driftMs != null ? `${s.driftMs >= 0 ? '+' : ''}${s.driftMs} ms` : '-';
    lines.push(`${s.problems.length ? 'ERREUR' : 'ok    '} ${s.stem.padEnd(24)} voix ${m.padStart(8)}  sous-titres ${v.padStart(8)}  écart ${d.padStart(8)}`);
    for (const p of s.problems) lines.push(`         - ${p.code} : ${p.detail}`);
  }
  for (const o of report.orphans) lines.push(`ATTENTION fichier orphelin (aucune étape ne l'utilise, à retirer par git rm) : ${o}`);
  const bad = report.steps.filter((s) => s.problems.length).length;
  lines.push(report.ok ? `Voix complète : ${report.steps.length} étapes.` : `VOIX INCOMPLÈTE : ${bad} étape(s) sur ${report.steps.length} en erreur.`);
  return lines;
}
