// Alignement du son sur l'image : on mesure dans le WebM l'instant où chaque étape apparaît à l'écran.
//
// Pourquoi ne pas se fier aux horloges (constaté sur l'essai à blanc du 09/11, voir README, « Alignement ») :
//  - le WebM de Playwright commence à la première image peinte, pas à la création de la page ;
//  - quand le poste est chargé, l'image est en retard sur les signaux du front, d'un retard qui varie
//    selon l'étape (de 4,3 à 10,4 s pendant l'essai), et les dernières images peuvent manquer.
// Le seul repère fiable est donc l'image elle-même : la barre de progression de la visite avance d'un cran
// à chaque étape, dans le même tour de boucle que le signal « step » (TourPlayer.goTo : emit() puis onStepStart).
import { spawn, spawnSync } from 'node:child_process';
import { ffmpegBin } from './tools.mjs';

/** Luminance minimale (0-255) d'un pixel de la barre remplie ; le fond du panneau et ses bordures restent en dessous. */
const BAR_LUMA_MIN = 90;
/** Longueur minimale de la barre remplie, en part de la largeur de l'image. */
const BAR_MIN_WIDTH_RATIO = 0.3;
/** Hauteur de la bande mesurée autour de la ligne de la barre (2 px de haut en CSS). */
const BAR_CROP_HEIGHT = 4;
/** Le panneau n'occupe que le bas de l'écran : on ne cherche pas la barre au-dessus. */
const BAR_SEARCH_FROM = 0.6;
/**
 * Le panneau apparaît par un saut franc, au moins égal à un cran de barre (1/N de l'amplitude, N = nombre d'étapes) :
 * on exige les trois quarts d'un cran sur PANEL_RISE_FRAMES images. La lente montée du fond du ciel reste en dessous.
 */
const PANEL_RISE_STEPS = 0.75;
const PANEL_RISE_FRAMES = 15;
/** Écart minimal entre deux crans de la barre, sous lequel la mesure n'a pas de sens. */
const MIN_STEP_DELTA = 2;
/** Fenêtre (s) après l'apparition du panneau où lire le niveau du premier cran, fondu passé. */
const FIRST_LEVEL_WINDOW = [0.4, 1.4];
/**
 * Instants (s avant la fin du WebM) où chercher la barre pleine : la fin, puis de plus en plus tôt.
 * Sur un poste au repos (--headed, 11/11), l'image n'a plus de retard : les 12 s de --end-hold et le générique
 * montrent le ciel sans panneau, et la barre pleine (épilogue) n'est visible qu'entre 15 et 25 s avant la fin.
 */
const TAIL_SAMPLES_S = [1, 6, 12, 15, 18, 21, 24, 27, 30];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Cherche la barre de progression dans une image en niveaux de gris : la ligne du bas de l'écran
 * qui porte la plus longue suite de pixels clairs.
 * @returns {{ y: number, x0: number, x1: number, length: number } | null}
 */
export function findBarRow(gray, width, height) {
  let best = null;
  for (let y = Math.floor(height * BAR_SEARCH_FROM); y < height; y++) {
    let run = 0;
    for (let x = 0; x <= width; x++) {
      if (x < width && gray[y * width + x] >= BAR_LUMA_MIN) {
        run++;
        continue;
      }
      if (run > (best?.length ?? 0)) best = { y, x0: x - run, x1: x - 1, length: run };
      run = 0;
    }
  }
  return best && best.length >= width * BAR_MIN_WIDTH_RATIO ? best : null;
}

/**
 * Bande à mesurer autour de la barre, en valeurs paires : en yuv420, ffmpeg arrondit silencieusement un décalage
 * impair au pair inférieur, ce qui faisait sortir la barre de la bande (y=945 devenait 944).
 */
export function barCrop(bar) {
  return { x: bar.x0 & ~1, y: Math.max(0, bar.y - 1) & ~1, width: bar.length & ~1, height: BAR_CROP_HEIGHT };
}

/** Lit la sortie de « metadata=print:file=- » : une paire de lignes (pts_time, valeur) par image. */
export function parseSeries(text) {
  const series = [];
  const re = /pts_time:([0-9.]+)\s+[^\n]*?=([0-9.]+)/g;
  for (const m of text.matchAll(re)) series.push({ t: Number(m[1]), v: Number(m[2]) });
  return series;
}

/**
 * Trouve, dans la luminance de la barre image par image, l'instant de chaque cran.
 * Niveaux attendus : premier cran (étape 1), puis un écart constant par étape jusqu'à la barre pleine.
 * Le prologue n'a pas de cran : le panneau apparaît déjà à son niveau, marker[0] vaut donc null.
 * On garde le premier franchissement de chaque seuil : sous charge, un cran peut s'afficher une image,
 * revenir en arrière, puis s'installer (constaté à l'étape 8 de l'essai).
 * @param {{ t: number, v: number }[]} series
 * @returns {{ ok: boolean, markers: (number|null)[], reason?: string, delta?: number }}
 */
export function detectStepJumps(series, stepCount) {
  const empty = Array(stepCount).fill(null);
  if (stepCount < 2) return { ok: false, markers: empty, reason: 'il faut au moins deux étapes' };
  if (series.length < 10) return { ok: false, markers: empty, reason: 'mesure trop courte' };
  const smooth = series.map((_, i) => median(series.slice(Math.max(0, i - 2), i + 3).map((s) => s.v)));
  const base = median(smooth.slice(0, 5));
  const rise = ((Math.max(...smooth) - base) * PANEL_RISE_STEPS) / stepCount;
  // Le fond du ciel monte doucement pendant le chargement : on attend un saut, pas un simple seuil.
  const panelIndex = smooth.findIndex((v, i) => rise > 0 && v - smooth[Math.max(0, i - PANEL_RISE_FRAMES)] >= rise);
  if (panelIndex < 0) return { ok: false, markers: empty, reason: 'aucun panneau de visite visible' };
  const panelAt = series[panelIndex].t;
  const window = series.filter((s) => s.t >= panelAt + FIRST_LEVEL_WINDOW[0] && s.t <= panelAt + FIRST_LEVEL_WINDOW[1]);
  if (!window.length) return { ok: false, markers: empty, reason: 'panneau visible trop peu de temps' };
  const first = median(window.map((s) => s.v));
  const full = Math.max(...smooth.slice(panelIndex));
  const delta = (full - first) / (stepCount - 1);
  if (delta < MIN_STEP_DELTA) return { ok: false, markers: empty, reason: 'la barre de progression n\'avance pas', delta };

  const markers = [null];
  let from = panelIndex;
  for (let step = 1; step < stepCount; step++) {
    const threshold = first + (step - 0.5) * delta;
    const at = series.findIndex((s, i) => i > from && s.v >= threshold);
    if (at < 0) return { ok: false, markers: [...markers, ...Array(stepCount - step).fill(null)], reason: `cran de l'étape ${step + 1} introuvable`, delta };
    markers.push(series[at].t);
    from = at;
  }
  return { ok: true, markers, delta };
}

function grayFrameAt(rawPath, secondsBeforeEnd, width, height) {
  const r = spawnSync(
    ffmpegBin,
    ['-hide_banner', '-v', 'error', '-sseof', `-${secondsBeforeEnd}`, '-i', rawPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: width * height * 2 },
  );
  if (r.error || r.status !== 0 || r.stdout.length < width * height) return null;
  return r.stdout;
}

function captureStdout(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-hide_banner', '-nostats', ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg a échoué (code ${code}) pendant la mesure de la barre.`))));
  });
}

/**
 * Mesure dans le WebM l'instant (ms) où chaque étape apparaît. Décode toute la vidéo : compter plusieurs minutes
 * sur un poste chargé.
 * @returns {Promise<{ ok: boolean, markers: (number|null)[], reason?: string, bar?: object }>}
 */
export async function measureStepMarkers({ rawPath, stepCount, viewport }) {
  const { width, height } = viewport;
  let bar = null;
  for (const s of TAIL_SAMPLES_S) {
    const frame = grayFrameAt(rawPath, s, width, height);
    bar = frame && findBarRow(frame, width, height);
    if (bar) break;
  }
  if (!bar) return { ok: false, markers: Array(stepCount).fill(null), reason: 'barre de progression introuvable à la fin du WebM' };
  const crop = barCrop(bar);
  const text = await captureStdout([
    '-i', rawPath, '-an',
    '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    '-f', 'null', '-',
  ]);
  const found = detectStepJumps(parseSeries(text), stepCount);
  return {
    ...found,
    bar,
    markers: found.markers.map((t) => (t === null ? null : Math.round(t * 1000))),
  };
}
