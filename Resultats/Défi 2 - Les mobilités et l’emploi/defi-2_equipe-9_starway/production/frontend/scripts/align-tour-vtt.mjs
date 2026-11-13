#!/usr/bin/env node
/**
 * Sous-titres de la visite calés sur les MOTS RECONNUS (11/11/2026), à lancer APRÈS `tools/tour-tts` (qui écrit les MP3 et
 * des .vtt calés sur les seuls silences, fautifs quand la voix place ses pauses de façon irrégulière : voir lib/tourWords.mjs).
 *
 *   SPEECH_KEY=... node scripts/align-tour-vtt.mjs <lea|lea-video> [étape...]
 *
 * Pour chaque étape (ou celles nommées) : mots horodatés de la reconnaissance vocale Azure (ressource Speech de l'équipe,
 * `transcribe-step.mjs`), gardés dans tools/tour-tts/words/<tour>/<NN-étape>.json avec l'empreinte du MP3 (rien n'est
 * redemandé tant que la prise ne change pas ; sans clé, seuls les fichiers de mots existants servent) ; puis réécrit
 * public/tour/<tour>/<NN-étape>.vtt : une cue par phrase ou proposition (coupée après , ; : . ! ? …, et en deux si elle
 * dépasse deux lignes de 42 caractères), qui commence quand la voix la commence. Le texte des cues est celui de
 * tour.resolved.json, mot pour mot, espaces insécables des nombres comprises (un nombre n'est jamais coupé entre deux
 * lignes ou deux cues) ; la dernière cue finit au plus tard à `durationMs` ; ni le MP3 ni `durationMs` ne changent.
 * Échoue (code 1) si une prise a perdu des mots (moins de 85 % des mots de 4 lettres ou plus retrouvés : prise à refaire)
 * ou si une étape n'a pas de mots (pas de clé et pas de fichier).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mp3Silences, phraseAnchors, sha256, WORDS_DIR, wordsFor } from './lib/tourWords.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const frontend = resolve(here, '..');
const [tour, ...only] = process.argv.slice(2);
if (!tour) {
  console.error('Usage : SPEECH_KEY=... node scripts/align-tour-vtt.mjs <lea|lea-video> [étape...]');
  process.exit(2);
}
const dir = join(frontend, 'public', 'tour', tour);
const resolved = JSON.parse(readFileSync(join(dir, 'tour.resolved.json'), 'utf8'));
const LINE = 42;
const MIN_COVERAGE = 0.85;
// Espace insécable (U+00A0) et fine insécable (U+202F) des nombres (« 47 000 ») : gardées telles quelles dans les cues,
// jamais un point de coupe (ni entre deux lignes, ni entre deux cues)
const NBSP = new RegExp(`[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`, 'g');
const isNbsp = (c) => c === String.fromCharCode(0xa0) || c === String.fromCharCode(0x202f);
const plainSpaces = (s) => s.replace(/[ \t\r\n]+/g, ' ').trim();

const ts = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
};
/** Deux lignes de 42 caractères au plus, coupées aux espaces simples seulement (jamais à l'insécable d'un nombre) */
function wrap(text) {
  const lines = [];
  let line = '';
  for (const w of text.split(' ')) {
    if (line && `${line} ${w}`.length > LINE) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

let failed = 0;
const steps = resolved.steps.map((s, i) => ({ s, stem: `${String(i + 1).padStart(2, '0')}-${s.id}` })).filter(({ s }) => !only.length || only.includes(s.id));
for (const { s, stem } of steps) {
  const mp3 = join(dir, `${stem}.mp3`);
  if (!existsSync(mp3)) {
    console.log(`${stem} : pas de MP3, ignorée`);
    continue;
  }
  let w = wordsFor(mp3);
  if (!w) {
    if (!process.env.SPEECH_KEY) {
      console.log(`ÉCHEC ${stem} : aucun fichier de mots pour cette prise et pas de SPEECH_KEY`);
      failed += 1;
      continue;
    }
    const r = spawnSync('node', [join(here, 'transcribe-step.mjs'), mp3, '--json'], { encoding: 'utf8', env: process.env });
    if (r.status !== 0) {
      console.log(`ÉCHEC ${stem} : reconnaissance vocale en échec`);
      failed += 1;
      continue;
    }
    const j = JSON.parse(r.stdout);
    w = {
      tour,
      stem,
      mp3Sha256: sha256(mp3),
      text: s.text,
      source: 'Azure AI Speech, reconnaissance fr-FR (REST, wordLevelTimestamps), ressource Speech de l’équipe',
      recognized: j.display,
      words: j.words,
    };
    mkdirSync(join(WORDS_DIR, tour), { recursive: true });
    writeFileSync(join(WORDS_DIR, tour, `${stem}.json`), `${JSON.stringify(w, null, 1)}\n`);
  }
  // `raw` garde les insécables ; `text` (même longueur, insécables en espaces simples) sert à dater : mêmes décalages
  const raw = plainSpaces(s.text);
  const text = raw.replace(NBSP, ' ');
  const glued = (t) => isNbsp(raw[t.start - 1] ?? '');
  const slice = (part) => raw.slice(part[0].start, part.at(-1).start + part.at(-1).text.length);
  const { silences, totalMs } = mp3Silences(mp3);
  const A = phraseAnchors(text, w.words, silences, totalMs);
  if (A.coverage < MIN_COVERAGE) {
    console.log(`ÉCHEC ${stem} : ${Math.round(A.coverage * 100)} % des mots retrouvés (prise à refaire) ; entendu : « ${w.recognized} »`);
    failed += 1;
    continue;
  }
  // Morceaux : du début de chaque proposition au suivant ; un morceau de plus de deux lignes est coupé à un mot, daté par ce mot
  const startsIdx = A.tokens.map((t, i) => (t.phrase ? i : -1)).filter((i) => i >= 0);
  const cues = [];
  startsIdx.forEach((ti, k) => {
    const until = startsIdx[k + 1] ?? A.tokens.length;
    let part = [];
    let partStart = A.anchors.get(A.tokens[ti].start);
    const flush = (nextStartMs) => {
      if (part.length) cues.push({ startMs: partStart, text: slice(part) });
      part = [];
      partStart = nextStartMs;
    };
    for (let i = ti; i < until; i++) {
      const t = A.tokens[i];
      const candidate = [...part, t].map((x) => x.text).join(' ');
      if (part.length && candidate.length > 2 * LINE - 4 && !glued(t)) {
        const m = A.match[i];
        const prev = part.at(-1);
        const pm = A.match[A.tokens.indexOf(prev)];
        const at = m >= 0 ? w.words[m].startMs - 40 : pm >= 0 ? w.words[pm].endMs + 20 : null;
        if (at != null) flush(Math.round(at));
      }
      part.push(t);
    }
    flush(null);
  });
  // La dernière cue ne dépasse jamais la durée de l'étape (`durationMs` du manifeste), ni le MP3
  const endMs = Math.floor(Math.min(totalMs, Math.round(A.speechEnd), s.durationMs ?? Infinity));
  const body = cues
    .map((c, i) => `${i + 1}\n${ts(i === 0 ? 0 : c.startMs)} --> ${ts(Math.max((cues[i + 1]?.startMs ?? endMs), c.startMs + 1))}\n${wrap(c.text)}`)
    .join('\n\n');
  const old = existsSync(join(dir, `${stem}.vtt`)) ? readFileSync(join(dir, `${stem}.vtt`), 'utf8') : '';
  const note = (/^NOTE (.*)$/m.exec(old)?.[1] ?? '').replace(/ Aligné sur .*$/, '');
  writeFileSync(
    join(dir, `${stem}.vtt`),
    `WEBVTT\n\nNOTE ${note ? `${note} ` : ''}Aligné sur les mots reconnus (Azure AI Speech, scripts/align-tour-vtt.mjs) et la fin du silence qui précède chaque proposition (ffmpeg silencedetect -40 dB, 0,12 s).\n\n${body}\n`,
  );
  const noSil = A.detail.filter((d) => !d.silence).length;
  console.log(`ok ${stem} : ${cues.length} cues, ${Math.round(A.coverage * 100)} % des mots retrouvés, ${A.detail.length - noSil}/${A.detail.length} propositions calées sur un silence`);
}
process.exit(failed ? 1 : 0);
