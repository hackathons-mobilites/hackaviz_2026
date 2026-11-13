#!/usr/bin/env node
/**
 * Mesure la durée de la VIDÉO du dépôt sans la filmer : joue `?tour=<id>&record=1` dans Chromium (sous-titres au rythme de
 * lecture estimé, pas de voix), relève les signaux `starway:record` (ready, step, end) et projette la durée avec la voix
 * à plusieurs débits (caractères par seconde), les transitions du ciel et le générique étant mesurés tels quels.
 *
 *   node scripts/measure-record.mjs <url-de-base> [tour=lea-video]
 *   ex. node scripts/measure-record.mjs http://127.0.0.1:4410 lea-video
 *
 * Durée projetée = (fin - ready) mesurée - somme des créneaux estimés + somme des créneaux à la voix, avec
 * créneau = max(minDurationMs, texte / débit) + pause (même règle que `tour/timing.ts` et `tools/record-tour`).
 * Les débits : 14,6 (le plus rapide mesuré sur les MP3 de la v3.1), 11,5 (moyenne mesurée), 9,5 (lent). La limite du brief
 * IDFM (page 15) : « Possibilité de présentation vidéo (3 minutes max) » = 180 s, sans dérogation.
 * Un seul navigateur, fermé à la fin ; à lancer sous le verrou de build, sur un `vite preview` de CE dossier.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const { chromium } = await import(pathToFileURL(resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs')).href);
const base = (process.argv[2] ?? '').replace(/\/$/, '');
const tourId = process.argv[3] ?? 'lea-video';
if (!base) {
  console.error('Usage : node scripts/measure-record.mjs <url-de-base> [tour]');
  process.exit(2);
}
const LIMIT_S = 180;
const PAUSE_S = 0.9; // tour/timing.ts : STEP_PAUSE_MS
const READ_CPS = 14; // tour/timing.ts : CHARS_PER_SECOND (rythme de lecture sans voix)
const resolved = JSON.parse(readFileSync(resolve(here, `../public/tour/${tourId}/tour.resolved.json`), 'utf-8'));
const steps = resolved.steps;

const [vw, vh] = (process.argv[4] ?? '1920x1080').split('x').map(Number);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu', '--mute-audio'] });
const failures = [];
let events = [];
try {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await page.addInitScript(() => {
    window.__rec = [];
    window.addEventListener('starway:record', (e) => window.__rec.push(e.detail));
  });
  page.on('pageerror', (e) => failures.push(`exception : ${e.message.slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) failures.push(`erreur console : ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${base}/?tour=${tourId}&record=1`, { waitUntil: 'load' });
  const t0 = Date.now();
  while (Date.now() - t0 < 8 * 60 * 1000) {
    await page.waitForTimeout(500);
    events = await page.evaluate(() => window.__rec ?? []);
    if (events.some((e) => e.type === 'end' || e.type === 'abort')) break;
  }
} catch (e) {
  failures.push(String(e).slice(0, 300));
} finally {
  await browser.close();
}
const abort = events.find((e) => e.type === 'abort');
if (abort) failures.push(`enregistrement interrompu : ${abort.reason}`);
const ready = events.find((e) => e.type === 'ready');
const end = events.find((e) => e.type === 'end');
const starts = events.filter((e) => e.type === 'step');
if (!ready || !end || starts.length !== steps.length) failures.push(`signaux incomplets : ready=${!!ready} end=${!!end} étapes=${starts.length}/${steps.length}`);
if (failures.length) {
  console.error(`\nMesure en échec :\n- ${[...new Set(failures)].join('\n- ')}`);
  process.exit(1);
}

const total = (end.t - ready.t) / 1000;
const slot = (s, cps) => Math.max((s.minDurationMs ?? 0) / 1000, s.text.length / cps) + PAUSE_S;
const bounds = [...starts.map((s) => s.t), end.t];
console.log(`Visite « ${tourId} » : ${steps.length} étapes, ${steps.reduce((n, s) => n + s.text.length, 0)} caractères.`);
console.log(`Avant la première étape (ready, titre, révélation du ciel) : ${((starts[0].t - ready.t) / 1000).toFixed(1)} s.`);
console.log('étape                  durée mesurée  créneau estimé  attente du ciel (transition, pose)');
let est = 0;
const overheads = [];
steps.forEach((s, i) => {
  const d = (bounds[i + 1] - bounds[i]) / 1000;
  const e = slot(s, READ_CPS);
  est += e;
  const isLast = i === steps.length - 1;
  overheads.push(d - e);
  console.log(`${s.id.padEnd(22)} ${d.toFixed(1).padStart(8)} s ${e.toFixed(1).padStart(10)} s ${(d - e).toFixed(1).padStart(10)} s${isLast ? '  (dernière : générique de fin compris)' : ''}`);
});
console.log(`\nDurée mesurée de la vidéo, de ready à end, au rythme de lecture de ${READ_CPS} car/s : ${total.toFixed(0)} s.`);
let worst = 0;
for (const cps of [14.6, 11.6, 11.5, 9.5]) {
  const proj = total - est + steps.reduce((n, s) => n + slot(s, cps), 0);
  worst = cps === 9.5 ? proj : worst;
  console.log(`  Projection avec la voix à ${String(cps).padEnd(4)} car/s : ${proj.toFixed(0)} s (${Math.floor(proj / 60)} min ${String(Math.round(proj % 60)).padStart(2, '0')}) ${proj <= LIMIT_S ? 'sous' : 'AU-DESSUS DE'} la limite de ${LIMIT_S} s`);
}
// 11,6 car/s : débit mesuré sur l'échantillon de voix du 06/11 (176 caractères en 15,2 s)
const mid = total - est + steps.reduce((n, s) => n + slot(s, 11.6), 0);
console.log(`\nMarge à 11,6 car/s : ${(LIMIT_S - mid).toFixed(0)} s ; au débit lent (9,5) : ${(LIMIT_S - worst).toFixed(0)} s.`);
process.exit(0);
