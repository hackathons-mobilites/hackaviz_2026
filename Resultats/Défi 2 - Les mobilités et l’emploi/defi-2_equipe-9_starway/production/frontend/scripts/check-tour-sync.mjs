#!/usr/bin/env node
/**
 * Contrôle de SYNCHRONISATION de la visite guidée (11/11/2026, exigence de Nicolas : la démonstration du jury doit être parfaite).
 *
 *   node scripts/check-tour-sync.mjs <url-de-base> [lea|lea-video|both] [--tol 150] [--out <dossier>]
 *   ex. node scripts/check-tour-sync.mjs http://127.0.0.1:4436 both --out ../smoke-out-sync
 *
 * Joue chaque visite DANS Chromium AVEC la voix (&sound=on&voice=on : l'élément <audio> de la page joue les vrais MP3, sans son
 * de sortie) et mesure, sur l'horloge de l'AUDIO (`currentTime`, la même que celle des sous-titres et des repères) :
 *   1. la VOIX : début de chaque phrase = fin du silence qui la précède dans le MP3 (ffmpeg silencedetect -40 dB, 0,2 s),
 *      appariée dans l'ordre aux marques de ponctuation (même méthode que tools/tour-tts, réimplémentée ici) ;
 *   2. le SOUS-TITRE : instant où le texte de la phrase apparaît à l'écran ;
 *   3. le REPÈRE lumineux : instant où `svg.tour-marks[data-mark]` s'allume pour chaque fragment du script ;
 *   4. l'ÉLÉMENT annoncé : un repère ne s'allume que si sa cible est visible (géométrie non vide) ; l'état de l'écran de l'étape
 *      (panneau, comparaison, halo, plis ouverts, temps de trajet) est relevé au premier mot de la voix.
 * Échoue (code 1) si un écart dépasse la tolérance (150 ms par défaut), si un sous-titre ou un repère arrive AVANT la voix de plus
 * de 50 ms, si un repère n'est jamais allumé (élément absent ou invisible), si un fragment de repère ne commence ni une phrase ni
 * une ponctuation suivie d'un vrai silence (non vérifiable : à déplacer), ou si l'écran n'est pas dans l'état de l'étape au
 * premier mot. À lancer sous le verrou de build, sur un `vite preview` du build de CE dossier.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mp3Silences, phraseAnchors, wordsFor } from './lib/tourWords.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const frontend = resolve(here, '..');
const { chromium } = await import(pathToFileURL(resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs')).href);
const { runnerImport } = await import(pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')).href);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const VALUE_OPTS = new Set(['--tol', '--out']);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.has(args[i - 1])));
// Diagnostic (11/11, reprise de Claude Code) :
//   --static : sans navigateur, vérifie seulement que chaque repère et chaque fin de phrase tombent sur un silence du MP3
//              (premier argument = lea, lea-video ou both ; aucune URL) ;
//   --gpu    : Chromium AVEC fenêtre (headless: false) : seul moyen d'avoir le vrai GPU sur un poste Windows,
//              chrome-headless-shell rendant WebGL en logiciel même sans drapeau SwiftShader (STARWAY_SYNC_GPU=1 : alias) ;
//   --no-sky : WebGL neutralisé, le site affiche son ciel statique (sépare le coût du ciel de celui du reste de la page).
const STATIC = args.includes('--static');
const GPU = args.includes('--gpu') || !!process.env.STARWAY_SYNC_GPU;
const NO_SKY = args.includes('--no-sky');
const base = STATIC ? '' : (positional[0] ?? '').replace(/\/$/, '');
const which = (STATIC ? positional[0] : positional[1]) ?? 'both';
const TOL = Number(opt('--tol', '150'));
const EARLY = 50; // un sous-titre ou un repère ne peut pas précéder la voix de plus de 50 ms
const outDir = resolve(opt('--out', join(frontend, 'smoke-out-sync')));
if (!base && !STATIC) {
  console.error('Usage : node scripts/check-tour-sync.mjs <url-de-base> [lea|lea-video|both] [--tol 150] [--out <dossier>] [--gpu] [--no-sky]\n        node scripts/check-tour-sync.mjs --static [lea|lea-video|both]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
process.chdir(frontend);

const load = async (rel) => (await runnerImport(`./${rel}`, { configFile: false, logLevel: 'error' })).module;
const { lea, leaVideo } = await load('src/tour/tours/lea.tour.ts');
const { fragmentOffset, normalizeSpaces } = await load('src/tour/marks.ts');
const SCRIPTS = { lea, 'lea-video': leaVideo };

/* ------------------------------------------------------------------ silences du MP3 (ffmpeg) */

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
function silences(mp3, noise = '-40dB', minSilence = '0.2') {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', mp3, '-af', `silencedetect=noise=${noise}:d=${minSilence}`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.error) throw new Error(`ffmpeg introuvable (${r.error.message}) : installer ffmpeg ou définir FFMPEG_PATH`);
  const err = r.stderr;
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const totalMs = dur ? ((+dur[1] * 60 + +dur[2]) * 60 + +dur[3]) * 1000 : 0;
  const out = [];
  let start = null;
  for (const line of err.split(/\r?\n/)) {
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

/* ------------------------------------------------------------------ marques de ponctuation du texte résolu et appariement */

const SENTENCE_END = /[.!?…]$/;
/** Jetons du texte normalisé avec leur décalage ; une « marque » est un jeton qui finit par , ; : . ! ? … (le dernier n'en est pas une). */
function marksOf(text) {
  const marks = [];
  const re = /\S+/g;
  let m;
  const tokens = [];
  while ((m = re.exec(text))) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  let letters = 0;
  const totalLetters = text.replace(/[^\p{L}\p{N}]/gu, '').length || 1;
  tokens.forEach((t, i) => {
    letters += t.text.replace(/[^\p{L}\p{N}]/gu, '').length;
    const last = i === tokens.length - 1;
    const trimmed = t.text.replace(/[»"')]+$/, '');
    if (!last && /[,;:]$/.test(trimmed)) marks.push({ kind: 'soft', next: tokens[i + 1].start, frac: letters / totalLetters });
    else if (!last && SENTENCE_END.test(trimmed)) marks.push({ kind: 'sentence', next: tokens[i + 1].start, frac: letters / totalLetters });
    // un deux-points isolé (« : ») est déjà rattaché au mot précédent par l'espace : jeton suivant
  });
  return marks;
}

const SKIP_SOFT_MS = 400;
const SKIP_SILENCE_MS = 400;
const SKIP_SENTENCE_MS = 2500;
const MIN_SENTENCE_SILENCE_MS = 250;

/** Appariement ordonné marques / silences internes (programmation dynamique) ; renvoie, pour chaque marque, le silence ou null. */
function matchMarks(marks, internal, speechStart, speechEnd, minSentenceSilence = MIN_SENTENCE_SILENCE_MS) {
  const P = marks.length;
  const Q = internal.length;
  const pred = marks.map((m) => speechStart + m.frac * (speechEnd - speechStart));
  const mid = internal.map((s) => (s.startMs + s.endMs) / 2);
  const cost = Array.from({ length: P + 1 }, () => new Array(Q + 1).fill(Infinity));
  const from = Array.from({ length: P + 1 }, () => new Array(Q + 1).fill(null));
  cost[0][0] = 0;
  const skipMark = (m) => (m.kind === 'sentence' ? SKIP_SENTENCE_MS : SKIP_SOFT_MS);
  for (let i = 0; i <= P; i++) {
    for (let j = 0; j <= Q; j++) {
      const c = cost[i][j];
      if (c === Infinity) continue;
      if (i < P && c + skipMark(marks[i]) < cost[i + 1][j]) {
        cost[i + 1][j] = c + skipMark(marks[i]);
        from[i + 1][j] = ['mark', i, j];
      }
      if (j < Q && c + SKIP_SILENCE_MS < cost[i][j + 1]) {
        cost[i][j + 1] = c + SKIP_SILENCE_MS;
        from[i][j + 1] = ['silence', i, j];
      }
      if (i < P && j < Q) {
        const long = internal[j].endMs - internal[j].startMs;
        if (marks[i].kind === 'sentence' && long < minSentenceSilence) continue;
        const d = c + Math.abs(pred[i] - mid[j]);
        if (d < cost[i + 1][j + 1]) {
          cost[i + 1][j + 1] = d;
          from[i + 1][j + 1] = ['match', i, j];
        }
      }
    }
  }
  const res = new Array(P).fill(null);
  let i = P;
  let j = Q;
  while (i > 0 || j > 0) {
    const f = from[i][j];
    if (!f) break;
    if (f[0] === 'match') res[f[1]] = internal[f[2]];
    i = f[1];
    j = f[2];
  }
  return res;
}

/** Instants de voix (ms, temps du MP3) du texte d'une étape : début de la parole et début de chaque morceau après une marque appariée. */
function voiceAnchors(text, mp3, noise = '-40dB', minSilence = '0.2', minSentenceSilence = MIN_SENTENCE_SILENCE_MS) {
  // 11/11 : vérité tirée des MOTS RECONNUS de cette prise quand ils existent (tools/tour-tts/words, empreinte du MP3 vérifiée) :
  // l'appariement des silences « dans l'ordre » ci-dessous se trompe d'un silence quand la voix place ses pauses de façon
  // irrégulière (mesuré sur 9 étapes, 0,7 à 2,4 s d'écart), voir scripts/lib/tourWords.mjs
  const w = wordsFor(mp3);
  if (w) {
    const { silences: s12, totalMs: tot } = mp3Silences(mp3);
    const A = phraseAnchors(text, w.words, s12, tot);
    const sentenceStarts = new Set(A.tokens.filter((t) => t.sentence).map((t) => t.start));
    return { anchors: A.anchors, sentenceStarts, speechStart: A.speechStart, speechEnd: A.speechEnd, unmatchedSentence: 0, silenceCount: s12.length, truth: 'mots' };
  }
  const { silences: sil, totalMs } = silences(mp3, noise, minSilence);
  const lead = sil.length && sil[0].startMs <= 30 ? sil[0] : null;
  const trail = sil.length && sil[sil.length - 1].endMs >= totalMs - 30 && sil[sil.length - 1] !== lead ? sil[sil.length - 1] : null;
  const speechStart = lead ? lead.endMs : 0;
  const speechEnd = trail ? trail.startMs : totalMs;
  const internal = sil.filter((s) => s !== lead && s !== trail);
  const marks = marksOf(text);
  const matched = matchMarks(marks, internal, speechStart, speechEnd, minSentenceSilence);
  const anchors = new Map([[0, speechStart]]);
  marks.forEach((m, k) => {
    if (matched[k]) anchors.set(m.next, matched[k].endMs);
  });
  const sentenceStarts = new Set([0, ...marks.filter((m) => m.kind === 'sentence').map((m) => m.next)]);
  const unmatchedSentence = marks.filter((m, k) => m.kind === 'sentence' && !matched[k]).length;
  return { anchors, sentenceStarts, speechStart, speechEnd, unmatchedSentence, silenceCount: internal.length };
}

/* ------------------------------------------------------------------ état attendu de l'écran à chaque étape */

function expectedStates(script) {
  const st = { pole: null, compare: null, halo: null, budget: null };
  return script.steps.map((s) => {
    for (const k of ['pole', 'compare', 'budget']) if (k in s.state) st[k] = s.state[k] ?? null;
    // le halo est propre à l'étape : fermé sauf s'il est demandé (tour/controller.ts, `halo: null, ...state`)
    st.halo = s.state.halo ?? null;
    return { ...st, openFold: s.openFold ?? [] };
  });
}

/* ------------------------------------------------------------------ une visite */

async function playTour(browser, id) {
  const script = SCRIPTS[id];
  const tourDir = join(frontend, 'public', 'tour', id);
  const resolved = JSON.parse(readFileSync(join(tourDir, 'tour.resolved.json'), 'utf8'));
  const files = readdirStep(tourDir, resolved);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((noSky) => {
    window.sessionStorage.setItem('starway.contrast.seen', '1');
    if (noSky) {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest);
      };
    }
    // Images par seconde réelles de la page (qualifie l'essai : une page à 5 images/s retarde tout affichage)
    window.__frames = { n: 0, over50: 0, max: 0, sum: 0 };
    let prev = 0;
    const frame = (t) => {
      if (prev) {
        const d = t - prev;
        const f = window.__frames;
        f.n += 1;
        f.sum += d;
        f.max = Math.max(f.max, d);
        if (d > 50) f.over50 += 1;
        if (d > 250) (f.long ??= []).push({ t: Math.round(t), d: Math.round(d), v: window.__aud ? Math.round(window.__aud.currentTime * 1000) : -1, src: window.__aud?.src?.split('/').pop() ?? '' });
      }
      prev = t;
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
    // Long Animation Frames (Chrome 123+) : le code responsable de chaque image de plus de 250 ms
    try {
      window.__loaf = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration < 250 || window.__loaf.length > 400) continue;
          const v = window.__aud ? Math.round(window.__aud.currentTime * 1000) : -1;
          window.__loaf.push({
            t: Math.round(e.startTime), d: Math.round(e.duration), v, src: window.__aud?.src?.split('/').pop() ?? '',
            render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0),
            scripts: (e.scripts ?? []).map((x) => ({ inv: x.invoker, fn: x.sourceFunctionName, url: (x.sourceURL ?? '').split('/').pop(), pos: x.sourceCharPosition, d: Math.round(x.duration), layout: Math.round(x.forcedStyleAndLayoutDuration ?? 0) })),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch { /* navigateur sans LoAF */ }
    const Orig = window.Audio;
    window.Audio = function (...a) {
      const el = new Orig(...a);
      window.__aud = el;
      return el;
    };
    window.Audio.prototype = Orig.prototype;
    window.__rec = [];
    window.__done = false;
  }, NO_SKY);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?visite=1&tour=${id}&sound=on&voice=on`, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const stepOf = () => {
      const t = q('.tour-step')?.textContent ?? '';
      const m = /(\d+)\s*\/\s*(\d+)/.exec(t);
      return m ? Number(m[1]) - 1 : -1;
    };
    const tick = () => {
      const el = window.__aud;
      const rec = window.__rec;
      const sub = (q('.tour-subtitle')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const mark = q('svg.tour-marks')?.getAttribute('data-mark') ?? '';
      const step = stepOf();
      const src = el && !el.paused && el.src ? el.src.split('/').pop() : '';
      const v = el ? Math.round(el.currentTime * 1000) : -1;
      const nowT = performance.now();
      window.__gap = Math.max(window.__gap || 0, nowT - (window.__lastTick || nowT));
      window.__gaps = (window.__gaps || 0) + 1;
      if (nowT - (window.__lastTick || nowT) > 100) window.__lag = (window.__lag || 0) + 1;
      window.__lastTick = nowT;
      const last = rec[rec.length - 1];
      // l'état de l'écran (panneau, comparaison, halo) compte aussi : son instant d'ouverture est mesuré, pas seulement vu au sous-titre suivant
      const scr = `${!!q('.proof-panel')}${!!q('.pane-head-B')}${!!q('.halo-panel')}`;
      if (!last || last.step !== step || last.sub !== sub || last.mark !== mark || last.src !== src || last.scr !== scr) {
        const dom = {
          proof: !!q('.proof-panel'),
          compare: !!q('.pane-head-B'),
          halo: !!q('.halo-panel'),
          folds: [...document.querySelectorAll('.pf-group details.pf-group-fold[open]')].map((d) => d.closest('.pf-group')?.getAttribute('data-group')),
          // « trajet » n'est pas un pli : c'est la section .pf-transports (tour/foldFocus.ts), affichée ou non
          trajet: (q('.pf-transports')?.getClientRects().length ?? 0) > 0,
          budget: (q('.bar-budget')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        };
        rec.push({ t: Math.round(performance.now()), v, step, src, sub, mark, scr, dom });
      }
      if (el && el.ended && step >= 0 && step === Number(document.querySelector('.tour-step')?.textContent?.match(/\/\s*(\d+)/)?.[1] ?? -9) - 1) window.__done = true;
    };
    window.setInterval(tick, 10);
  });
  const budget = Math.ceil(resolved.steps.reduce((n, s) => n + (s.durationMs ?? 8000), 0) / 1000) + 90;
  const t0 = Date.now();
  while (Date.now() - t0 < budget * 1000) {
    if (await page.evaluate(() => window.__done)) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  const rec = await page.evaluate(() => window.__rec);
  const lag = await page.evaluate(() => ({ maxGapMs: Math.round(window.__gap || 0), ticks: window.__gaps || 0, ticksOver100ms: window.__lag || 0 }));
  console.log(`Retard du fil principal : plus long intervalle ${lag.maxGapMs} ms, ${lag.ticksOver100ms} intervalles de plus de 100 ms sur ${lag.ticks} échantillons`);
  const fr = await page.evaluate(() => window.__frames);
  if (fr) fr.loaf = await page.evaluate(() => window.__loaf ?? []);
  if (fr?.n) console.log(`Images : ${Math.round((1000 * fr.n) / fr.sum)} par seconde en moyenne, ${fr.over50} images de plus de 50 ms sur ${fr.n}, plus longue ${Math.round(fr.max)} ms (${GPU_LABEL})`);
  await ctx.close();
  return { script, resolved, files, rec, frames: fr, errors, timedOut: Date.now() - t0 >= budget * 1000 };
}

function readdirStep(dir, resolved) {
  return resolved.steps.map((s, i) => join(dir, `${String(i + 1).padStart(2, '0')}-${s.id}.mp3`));
}

/* ------------------------------------------------------------------ analyse */

function analyse(id, run) {
  const { script, resolved, files, rec, errors, timedOut } = run;
  const rows = [];
  const fails = [];
  const fail = (m) => fails.push(m);
  if (timedOut) fail('la visite ne s\'est pas terminée dans le délai (voix absente ou visite arrêtée)');
  for (const e of errors) fail(`erreur de page : ${e}`);
  const expect = expectedStates(script);

  resolved.steps.forEach((rs, i) => {
    if (!existsSync(files[i])) return fail(`étape ${i + 1} (${rs.id}) : MP3 absent`);
    const text = normalizeSpaces(rs.text);
    // même second passage que tools/tour-tts quand le premier ne trouve pas assez de silences
    let A = voiceAnchors(text, files[i]);
    if (A.unmatchedSentence) A = voiceAnchors(text, files[i], '-30dB', '0.15', 150);
    if (A.unmatchedSentence) fail(`étape ${i + 1} (${rs.id}) : ${A.unmatchedSentence} fin(s) de phrase sans silence dans le MP3 (${A.silenceCount} silences internes) : la voix ne marque pas la pause de 300 ms`);
    // échantillons de l'étape pendant la lecture de SON audio
    const name = files[i].split(/[\\/]/).pop();
    const samples = rec.filter((r) => r.step === i && r.src === name);
    if (!samples.length) return fail(`étape ${i + 1} (${rs.id}) : aucun échantillon pendant la voix (l'audio n'a pas joué)`);
    const first = samples[0];
    // 1. état de l'écran au premier mot de la voix (premier échantillon dont v >= début de parole)
    // dernier échantillon avant le premier mot + tolérance : un état posé 30 ms après le départ de l'audio, avant le premier
    // son audible (silence initial de moins de 0,2 s, non détecté), n'est pas un échec
    const atVoice = samples.filter((r) => r.v <= A.speechStart + TOL).at(-1) ?? samples.find((r) => r.v >= A.speechStart) ?? first;
    const ex = expect[i];
    const dom = atVoice.dom;
    if (!!ex.pole !== dom.proof) fail(`étape ${i + 1} (${rs.id}) : panneau de preuve ${dom.proof ? 'ouvert' : 'fermé'} au premier mot, attendu ${ex.pole ? 'ouvert' : 'fermé'}`);
    if (!!ex.compare !== dom.compare) fail(`étape ${i + 1} (${rs.id}) : comparaison ${dom.compare ? 'ouverte' : 'fermée'} au premier mot, attendu ${ex.compare ? 'ouverte' : 'fermée'}`);
    if (!!ex.halo !== dom.halo) fail(`étape ${i + 1} (${rs.id}) : halo ${dom.halo ? 'ouvert' : 'fermé'} au premier mot, attendu ${ex.halo ? 'ouvert' : 'fermé'}`);
    for (const f of ex.openFold) if (f === 'trajet' ? !dom.trajet : !dom.folds.includes(f)) fail(`étape ${i + 1} (${rs.id}) : pli « ${f} » fermé au premier mot de la voix`);
    if (ex.budget != null && !dom.budget.includes(String(ex.budget))) fail(`étape ${i + 1} (${rs.id}) : temps de trajet affiché « ${dom.budget} » au premier mot, attendu ${ex.budget} min`);

    // 2. sous-titres : instant (temps de voix) où chaque morceau de texte apparaît
    const seenSub = [];
    for (const r of samples) {
      if (!r.sub) continue;
      if (!seenSub.length || seenSub[seenSub.length - 1].sub !== r.sub) seenSub.push({ sub: r.sub, v: r.v });
    }
    let cursor = 0;
    for (const s of seenSub) {
      const idx = text.indexOf(s.sub.replace(/\.\.\.$/, ''), cursor);
      if (idx < 0) {
        fail(`étape ${i + 1} (${rs.id}) : sous-titre « ${s.sub.slice(0, 40)}… » introuvable dans le texte de l'étape`);
        continue;
      }
      cursor = idx + 1;
      const truth = A.anchors.get(idx);
      if (truth == null) {
        rows.push({ id, step: i + 1, kind: 'sous-titre', what: s.sub.slice(0, 34), voice: null, shown: s.v, d: null, note: 'non ancré (prorata)' });
        continue;
      }
      const d = s.v - truth;
      rows.push({ id, step: i + 1, kind: 'sous-titre', what: s.sub.slice(0, 34), voice: truth, shown: s.v, d });
      if (Math.abs(d) > TOL) fail(`étape ${i + 1} (${rs.id}) : sous-titre « ${s.sub.slice(0, 40)} » à ${d} ms de la voix (tolérance ${TOL})`);
      if (d < -EARLY) fail(`étape ${i + 1} (${rs.id}) : sous-titre « ${s.sub.slice(0, 40)} » AVANT la voix (${d} ms)`);
    }
    // phrases dont aucun sous-titre ne commence : une phrase jamais affichée
    for (const st of A.sentenceStarts) {
      if (!seenSub.some((s) => text.indexOf(s.sub.replace(/\.\.\.$/, '')) <= st && st < text.indexOf(s.sub.replace(/\.\.\.$/, '')) + s.sub.length))
        fail(`étape ${i + 1} (${rs.id}) : la phrase commençant à « ${text.slice(st, st + 30)} » n'est affichée par aucun sous-titre`);
    }

    // 3. repères lumineux : instant d'allumage de chaque fragment du script
    const step = script.steps[i];
    const marks = step.marks ?? [];
    const lit = new Map();
    for (const r of samples) {
      if (!r.mark) continue;
      const mm = /#(\d+)$/.exec(r.mark);
      if (mm && !lit.has(Number(mm[1]))) lit.set(Number(mm[1]), r.v);
    }
    marks.forEach((m, k) => {
      const targets = typeof m.target === 'string' ? [m.target] : m.target;
      const none = targets.length === 1 && targets[0] === 'none';
      const off = fragmentOffset(step.narration, rs.text, m.at);
      if (off == null) return fail(`étape ${i + 1} (${rs.id}) : fragment de repère « ${m.at} » introuvable dans le texte résolu`);
      const truth = A.anchors.get(off);
      if (truth == null) return fail(`étape ${i + 1} (${rs.id}) : fragment « ${m.at} » ne commence ni une phrase ni une ponctuation suivie d'un silence du MP3 : déplacer le repère au début d'une phrase`);
      if (none) return;
      const v = lit.get(k);
      if (v == null) return fail(`étape ${i + 1} (${rs.id}) : repère « ${m.at} » (${targets.join(', ')}) jamais allumé : élément annoncé absent ou invisible`);
      const d = v - truth;
      rows.push({ id, step: i + 1, kind: 'repère', what: m.at.slice(0, 34), voice: truth, shown: v, d });
      if (Math.abs(d) > TOL) fail(`étape ${i + 1} (${rs.id}) : repère « ${m.at} » à ${d} ms du mot désigné (tolérance ${TOL})`);
      if (d < -EARLY) fail(`étape ${i + 1} (${rs.id}) : repère « ${m.at} » AVANT le mot désigné (${d} ms)`);
    });
  });
  return { rows, fails };
}

/* ------------------------------------------------------------------ main */

const ids = which === 'both' ? ['lea-video', 'lea'] : [which];

/* --static : ancrage des repères et des phrases sur les silences du MP3, sans navigateur */
if (STATIC) {
  let missing = 0;
  for (const id of ids) {
    const script = SCRIPTS[id];
    const tourDir = join(frontend, 'public', 'tour', id);
    const resolved = JSON.parse(readFileSync(join(tourDir, 'tour.resolved.json'), 'utf8'));
    const files = readdirStep(tourDir, resolved);
    console.log(`\n=== Visite ${id} : ancrage hors navigateur ===`);
    resolved.steps.forEach((rs, i) => {
      const text = normalizeSpaces(rs.text);
      let A = voiceAnchors(text, files[i]);
      if (A.unmatchedSentence) A = voiceAnchors(text, files[i], '-30dB', '0.15', 150);
      if (A.unmatchedSentence) {
        missing += 1;
        console.log(`  ÉCHEC étape ${i + 1} (${rs.id}) : ${A.unmatchedSentence} fin(s) de phrase sans silence`);
      }
      for (const m of script.steps[i].marks ?? []) {
        const off = fragmentOffset(script.steps[i].narration, rs.text, m.at);
        const t = off == null ? null : A.anchors.get(off);
        if (t == null) missing += 1;
        console.log(`  ${t == null ? 'ÉCHEC' : 'ok   '} étape ${i + 1} (${rs.id}) « ${m.at} » ${t == null ? (off == null ? 'introuvable dans le texte' : 'sans silence devant : à déplacer') : `à ${t} ms`}`);
      }
    });
  }
  console.log(
    missing
      ? `\n${missing} point(s) non ancré(s)`
      : '\nOK : tous les repères et toutes les phrases sont ancrés sur la voix (mots reconnus de la prise quand ils existent, sinon silences du MP3)',
  );
  process.exit(missing ? 1 : 0);
}

const GPU_LABEL = `${GPU ? 'Chromium avec fenêtre, GPU réel' : 'chrome-headless-shell, rendu logiciel'}${NO_SKY ? ', sans ciel WebGL' : ''}`;
console.log(`Navigateur : ${GPU_LABEL}`);
const browser = await chromium.launch({
  headless: !GPU,
  args: GPU
    ? // fenêtre cachée par d'autres : sans ces drapeaux, Chromium met la page en veille (images et minuteries arrêtées)
      ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
let bad = 0;
const all = [];
for (const id of ids) {
  console.log(`\n=== Visite ${id} : lecture avec la voix ===`);
  const run = await playTour(browser, id);
  writeFileSync(join(outDir, `echantillons-${id}.json`), JSON.stringify({ rec: run.rec, frames: run.frames }));
  const { rows, fails } = analyse(id, run);
  all.push(...rows);
  console.log('étape | type       | repère ou sous-titre                | voix (ms) | écran (ms) | écart (ms)');
  for (const r of rows)
    console.log(`${String(r.step).padStart(5)} | ${r.kind.padEnd(10)} | ${r.what.padEnd(35)} | ${String(r.voice ?? '-').padStart(9)} | ${String(r.shown).padStart(10)} | ${r.d == null ? r.note : String(r.d).padStart(5)}`);
  const ds = rows.filter((r) => r.d != null).map((r) => r.d);
  if (ds.length) console.log(`écart max ${Math.max(...ds)} ms, min ${Math.min(...ds)} ms, moyenne ${Math.round(ds.reduce((a, b) => a + b, 0) / ds.length)} ms sur ${ds.length} mesures (tolérance ${TOL} ms)`);
  if (fails.length) {
    bad += fails.length;
    console.log(`ÉCHECS (${fails.length}) :`);
    for (const f of fails) console.log(`  - ${f}`);
  } else console.log(`OK : ${id} synchronisée à ${TOL} ms près`);
}
await browser.close();
writeFileSync(join(outDir, 'sync-tableau.json'), JSON.stringify(all, null, 1));
console.log(`\nTableau des écarts : ${join(outDir, 'sync-tableau.json')}`);
process.exit(bad ? 1 : 0);
