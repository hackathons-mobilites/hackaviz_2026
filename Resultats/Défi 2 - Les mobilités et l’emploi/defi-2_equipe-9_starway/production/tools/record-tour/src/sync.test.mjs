// Tests de l'alignement image/son. Mesures réelles de l'essai à blanc du 09/11 (MP3 de silence), dans
// samples/essai-2026-11-09/ : barre-yavg.txt (luminance de la barre de progression, extraits du WebM) et timeline.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseArgs } from 'node:util';
import { joinNegativeValues } from './args.mjs';
import { AV_TOLERANCE_MS, buildPlan, checkOutput } from './assemble.mjs';
import { TOOL_DIR } from './paths.mjs';
import { barCrop, detectStepJumps, findBarRow, parseSeries } from './sync.mjs';

const dir = path.join(TOOL_DIR, 'samples', 'essai-2026-11-09');
const series = readFileSync(path.join(dir, 'barre-yavg.txt'), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((l) => {
    const [t, v] = l.split(' ').map(Number);
    return { t, v };
  });
const timeline = JSON.parse(readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
const AUDIO_MS = [7786, 16429, 12786, 10715, 8000, 9429, 6929, 10929, 4358];
const steps = timeline.events
  .filter((e) => e.type === 'step')
  .map((e, i) => ({ id: e.id, stem: `${i}`, durationMs: AUDIO_MS[i], cues: [] }));
const RAW_MS = 156433;
const MARKERS_S = [null, 29.967, 51.3, 77.8, 92.267, 108.5, 126.533, 136.233, 149.867];
const markersMs = MARKERS_S.map((t) => (t === null ? null : Math.round(t * 1000)));

test('les crans de la barre donnent les instants réels de chaque étape', () => {
  const found = detectStepJumps(series, 9);
  assert.equal(found.ok, true);
  assert.deepEqual(found.markers, MARKERS_S);
});

test('un cran affiché une seule image reste le premier repère (étape 8 de l\'essai)', () => {
  const found = detectStepJumps(series, 9);
  assert.equal(found.markers[7], 136.233);
});

test('sans panneau de visite, la mesure échoue au lieu d\'inventer des repères', () => {
  const flat = Array.from({ length: 200 }, (_, i) => ({ t: i / 30, v: 28 }));
  const found = detectStepJumps(flat, 9);
  assert.equal(found.ok, false);
  assert.match(found.reason, /panneau/);
});

test('une barre qui n\'avance pas est refusée', () => {
  const flat = Array.from({ length: 400 }, (_, i) => ({ t: i / 30, v: i < 60 ? 28 : 66 }));
  const found = detectStepJumps(flat, 9);
  assert.equal(found.ok, false);
  assert.match(found.reason, /n'avance pas/);
});

test('parseSeries lit la sortie de metadata=print', () => {
  const text = 'frame:0    pts:0       pts_time:0\r\nlavfi.signalstats.YAVG=28\r\nframe:1    pts:33      pts_time:0.033\r\nlavfi.signalstats.YAVG=28.5\r\n';
  assert.deepEqual(parseSeries(text), [
    { t: 0, v: 28 },
    { t: 0.033, v: 28.5 },
  ]);
});

test('findBarRow trouve la plus longue ligne claire du bas de l\'image', () => {
  const width = 100;
  const height = 50;
  const gray = new Uint8Array(width * height).fill(20);
  for (let x = 20; x < 70; x++) gray[40 * width + x] = 200;
  // Ligne claire plus longue mais hors de la zone de recherche : ignorée.
  for (let x = 0; x < 90; x++) gray[5 * width + x] = 200;
  assert.deepEqual(findBarRow(gray, width, height), { y: 40, x0: 20, x1: 69, length: 50 });
  assert.equal(findBarRow(new Uint8Array(width * height).fill(20), width, height), null);
});

test('plan aligné sur l\'image : coupe au plus petit retard, écran-titre conservé, son dans l\'image', () => {
  const plan = buildPlan({ timeline, steps, markers: markersMs, rawMs: RAW_MS });
  assert.equal(plan.ok, true);
  // Plus petit retard observé : étape 5 (92,267 s du WebM pour un signal à 87,934 s après « ready »).
  assert.equal(plan.trimStartMs, 4333);
  // Le titre disparaît à 6,5 s du WebM : il reste plus de 2 s visibles après la coupe.
  assert.ok(6500 - plan.trimStartMs > 2000);
  // Chaque MP3 repéré est posé exactement sur l'image de son étape.
  plan.placed.forEach((p, i) => {
    if (i > 0) assert.equal(p.offsetMs, markersMs[i] - plan.trimStartMs);
  });
  // Le prologue, sans repère, garde son écart de signaux avec l'étape 2.
  assert.equal(plan.placed[0].offsetMs, plan.placed[1].offsetMs - Math.round(plan.placed[1].signalMs - plan.placed[0].signalMs));
  assert.equal(plan.durationMs, RAW_MS - plan.trimStartMs);
  assert.ok(plan.warnings.some((w) => /générique/.test(w)));
  const lastAudioEnd = plan.placed.at(-1).offsetMs + plan.placed.at(-1).audioMs;
  assert.ok(lastAudioEnd <= plan.durationMs, 'la narration tient dans l\'image');
  assert.deepEqual(plan.warnings.filter((w) => /chevauche/.test(w)), []);
});

test('la bande mesurée reste sur des valeurs paires et contient la barre', () => {
  // Valeurs réelles de l'essai : barre repérée en y=946, x de 543 à 1376.
  assert.deepEqual(barCrop({ y: 946, x0: 543, x1: 1376, length: 834 }), { x: 542, y: 944, width: 834, height: 4 });
  for (const y of [946, 947]) {
    const c = barCrop({ y, x0: 543, x1: 1376, length: 834 });
    assert.equal(c.y % 2, 0);
    assert.ok(c.y <= y && y + 1 < c.y + c.height, `ligne ${y} hors de la bande`);
  }
});

test('sans repères, le plan reste aux horloges (fixtures)', () => {
  const plan = buildPlan({ timeline, steps });
  assert.equal(plan.trimStartMs, timeline.events[0].t - timeline.videoStartedAt);
  assert.equal(plan.durationMs, timeline.events.at(-1).t - timeline.events[0].t);
});

test('--av-offset-ms décale tout le son, dans les deux sens', () => {
  const base = buildPlan({ timeline, steps, markers: markersMs, rawMs: RAW_MS });
  const later = buildPlan({ timeline, steps, markers: markersMs, rawMs: RAW_MS, avOffsetMs: 250 });
  const earlier = buildPlan({ timeline, steps, markers: markersMs, rawMs: RAW_MS, avOffsetMs: -250 });
  assert.equal(later.placed[3].offsetMs, base.placed[3].offsetMs + 250);
  assert.equal(earlier.placed[3].offsetMs, base.placed[3].offsetMs - 250);
});

test('le contrôle final échoue sur le MP4 de l\'essai (146,8 s d\'image, 156,8 s de son)', () => {
  const c = checkOutput({ videoMs: 146767, audioMs: 156785, formatMs: 156785 }, { expectedMs: 156785 });
  assert.equal(c.ok, false);
  assert.match(c.errors[0], /écart de 10018 ms/);
});

test('le contrôle final accepte un écart dans la tolérance et affiche la durée mesurée', () => {
  const c = checkOutput({ videoMs: 152100, audioMs: 152100 + AV_TOLERANCE_MS, formatMs: 152200 }, { expectedMs: 152100 });
  assert.equal(c.ok, true);
  assert.equal(c.finalMs, 152200);
  assert.deepEqual(c.warnings, []);
});

test('le contrôle final avertit au-delà de 180 s sans échouer', () => {
  const c = checkOutput({ videoMs: 181000, audioMs: 181000, formatMs: 181000 }, { expectedMs: 181000 });
  assert.equal(c.ok, true);
  assert.equal(c.finalMs, 181000);
  assert.match(c.warnings[0], /180 s/);
});

test('le contrôle final échoue si ffprobe ne lit pas les durées', () => {
  assert.equal(checkOutput(null, { expectedMs: 1000 }).ok, false);
  assert.equal(checkOutput({ videoMs: null, audioMs: 1000, formatMs: 1000 }, { expectedMs: 1000 }).ok, false);
});

test('--av-offset-ms accepte une valeur négative séparée par un espace', () => {
  assert.deepEqual(joinNegativeValues(['lea', '--av-offset-ms', '-10071', '--preset', 'fast']), ['lea', '--av-offset-ms=-10071', '--preset', 'fast']);
  assert.deepEqual(joinNegativeValues(['--av-offset-ms=-10071']), ['--av-offset-ms=-10071']);
  assert.deepEqual(joinNegativeValues(['--av-offset-ms', '120']), ['--av-offset-ms', '120']);
  const { values } = parseArgs({
    args: joinNegativeValues(['--av-offset-ms', '-10071']),
    options: { 'av-offset-ms': { type: 'string' } },
  });
  assert.equal(values['av-offset-ms'], '-10071');
});
