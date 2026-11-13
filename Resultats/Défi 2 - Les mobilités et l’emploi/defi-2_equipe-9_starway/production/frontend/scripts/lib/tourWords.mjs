/**
 * Ancrage de la narration sur les MOTS RECONNUS (11/11/2026). La voix `marc-standard-r8` ne renvoie aucun mot horodaté et place
 * ses pauses de façon irrégulière (0,2 à 2,2 s, parfois aucune à une virgule) : apparier les silences du MP3 aux ponctuations
 * « dans l'ordre, au prorata des caractères » (tools/tour-tts `SubtitleAligner`, ancienne vérité de check-tour-sync) se trompe
 * alors d'un silence et décale des sous-titres de 0,7 à 2,4 s (mesuré le 11/11 sur 9 étapes). Ici, chaque début de phrase ou
 * de proposition (après , ; : . ! ? …) est daté par la reconnaissance vocale Azure (mots horodatés, `transcribe-step.mjs`),
 * puis calé sur la fin du silence qui précède ce mot, s'il y en a un.
 * Utilisé par `align-tour-vtt.mjs` (écrit les .vtt) et `check-tour-sync.mjs` (vérité de la voix). Module sans dépendance.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
/** Mots reconnus, versionnés avec le dépôt : tools/tour-tts/words/<tour>/<NN-étape>.json */
export const WORDS_DIR = resolve(here, '../../../tools/tour-tts/words');

export const normWord = (w) =>
  w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]/g, '');
const isNum = (w) => /^[0-9]/.test(w);
const same = (a, b) => !!a && !!b && !isNum(a) && !isNum(b) && (a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)));
const weight = (a) => (a.length >= 4 ? 3 : 1);

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Fichier de mots d'un MP3 de public/tour/<tour>/ ; null s'il manque ou ne correspond plus au MP3 (autre prise). */
export function wordsFor(mp3) {
  const p = join(WORDS_DIR, basename(dirname(mp3)), basename(mp3).replace(/\.mp3$/, '.json'));
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return j.mp3Sha256 === sha256(mp3) ? j : null;
}

/** Silences du MP3 (ffmpeg silencedetect) et durée totale, en ms. */
export function mp3Silences(mp3, noise = '-40dB', minSilence = '0.12') {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', mp3, '-af', `silencedetect=noise=${noise}:d=${minSilence}`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.error) throw new Error(`ffmpeg introuvable (${r.error.message})`);
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  const totalMs = dur ? ((+dur[1] * 60 + +dur[2]) * 60 + +dur[3]) * 1000 : 0;
  const out = [];
  let start = null;
  for (const line of r.stderr.split(/\r?\n/)) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]) * 1000);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start != null) {
      out.push({ startMs: start, endMs: Number(e[1]) * 1000 });
      start = null;
    }
  }
  if (start != null) out.push({ startMs: start, endMs: totalMs });
  return { silences: out, totalMs };
}

/** Jetons du texte (séparés par des espaces) avec leur décalage ; `phrase` : le jeton ouvre une phrase ou suit une ponctuation. */
export function textTokens(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) tokens.push({ text: m[0], start: m.index, n: normWord(m[0]) });
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1]?.text.replace(/[»"')]+$/, '');
    t.phrase = i === 0 || /[,;:.!?…]$/.test(prev ?? '');
    t.sentence = i === 0 || /[.!?…]$/.test(prev ?? '');
  });
  return tokens;
}

/** Appariement pondéré (plus longue sous-suite commune, mots de 4 lettres ou plus : poids 3) jetons du texte / mots reconnus. */
export function alignTokens(tokens, words) {
  const sw = words.map((w) => normWord(w.word));
  const N = tokens.length;
  const M = sw.length;
  const S = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
  for (let i = N - 1; i >= 0; i--)
    for (let j = M - 1; j >= 0; j--) S[i][j] = Math.max(S[i + 1][j], S[i][j + 1], same(tokens[i].n, sw[j]) ? weight(tokens[i].n) + S[i + 1][j + 1] : -1);
  const match = new Array(N).fill(-1);
  for (let i = 0, j = 0; i < N && j < M; ) {
    if (same(tokens[i].n, sw[j]) && S[i][j] === weight(tokens[i].n) + S[i + 1][j + 1]) {
      match[i] = j;
      i++;
      j++;
    } else if (S[i + 1][j] >= S[i][j + 1]) i++;
    else j++;
  }
  return match;
}

/**
 * Instant (ms) où la voix commence chaque phrase ou proposition. Pour un jeton qui ouvre une proposition : le premier mot
 * reconnu de la proposition (`first`) et la fin du dernier mot reconnu avant elle (`prevEnd`) encadrent le passage ; le
 * premier silence qui commence après `prevEnd` (à 150 ms près) et finit avant `first` (à 200 ms près : le début de mot reconnu précède d'environ 80 ms la fin du silence mesurée) donne l'instant
 * (fin du silence) ; sans silence, le mot lui-même (ou `prevEnd` si le premier mot est un nombre, écrit en chiffres).
 * Renvoie aussi la part des mots longs du texte retrouvés (une prise qui saute ou déforme des mots descend sous 0,85).
 */
export function phraseAnchors(text, words, silences, totalMs) {
  const tokens = textTokens(text);
  const match = alignTokens(tokens, words);
  const long = tokens.filter((t) => t.n.length >= 4 && !isNum(t.n));
  const found = long.filter((t) => match[tokens.indexOf(t)] >= 0).length;
  const lead = silences.length && silences[0].startMs <= 30 ? silences[0] : null;
  const firstWord = words[0];
  const speechStart = lead ? lead.endMs : firstWord ? Math.max(0, firstWord.startMs - 40) : 0;
  const lastWord = words[words.length - 1];
  const trail = silences.length && silences[silences.length - 1].endMs >= totalMs - 30 ? silences[silences.length - 1] : null;
  const speechEnd = Math.max(lastWord?.endMs ?? 0, trail ? trail.startMs : totalMs);
  const anchors = new Map([[0, 0]]);
  const detail = [];
  const starts = tokens.map((t, i) => (t.phrase ? i : -1)).filter((i) => i >= 0);
  starts.forEach((ti, k) => {
    if (ti === 0) return;
    const until = starts[k + 1] ?? tokens.length;
    let fi = -1;
    for (let i = ti; i < until; i++)
      if (match[i] >= 0) {
        fi = i;
        break;
      }
    let pi = -1;
    for (let i = ti - 1; i >= 0; i--)
      if (match[i] >= 0) {
        pi = i;
        break;
      }
    const prevEnd = pi >= 0 ? words[match[pi]].endMs : speechStart;
    const first = fi >= 0 ? words[match[fi]].startMs : null;
    const sil = silences.find((s) => s.startMs >= prevEnd - 150 && s.endMs <= (first ?? prevEnd + 1500) + 200 && s !== trail);
    let ms;
    if (sil) ms = sil.endMs;
    else if (first != null && fi === ti) ms = Math.max(prevEnd, first - 40);
    else ms = prevEnd + 20;
    ms = Math.round(ms);
    anchors.set(tokens[ti].start, ms);
    detail.push({ offset: tokens[ti].start, token: tokens[ti].text, sentence: tokens[ti].sentence, ms, prevEnd, first, silence: !!sil, firstIsToken: fi === ti });
  });
  return { tokens, match, anchors, detail, speechStart, speechEnd, coverage: long.length ? found / long.length : 1 };
}
