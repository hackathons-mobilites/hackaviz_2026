#!/usr/bin/env node
/**
 * Mesure des sous-titres de la visite dans Chromium (05/11, demande de Nicolas : « ni trop petits ni trop grands » à 1920,
 * 1280 et 390 px) : pour chaque écran, la taille de police calculée par le CSS, et pour chaque repère de la visite le
 * nombre de lignes que le navigateur lui donne dans la boîte (une cue qui dépasse `maxLines` serait COUPÉE).
 *
 *   node scripts/measure-subtitles.mjs <url-de-base> [tour=lea]
 *   ex. node scripts/measure-subtitles.mjs http://127.0.0.1:4390
 *
 * Lit le jeton `tourSubtitle` (src/theme/tokens.ts) et les mêmes fonctions que `TourOverlay` (src/tour/subtitleSize.ts,
 * src/tour/cues.ts). Échoue (code 1) si la taille calculée sort des bornes de lisibilité du jeton, si elle diffère du
 * calcul du jeton, ou si un repère recoupé à la capacité de l'écran est coupé. Affiche aussi, à titre d'information, ce
 * que donneraient les repères non recoupés (84 caractères). Un seul navigateur, fermé à la fin ; à lancer sous le verrou.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runnerImport } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const { chromium } = await import(pathToFileURL(resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs')).href);
const base = (process.argv[2] ?? '').replace(/\/$/, '');
const tourId = process.argv[3] ?? 'lea';
if (!base) {
  console.error('Usage : node scripts/measure-subtitles.mjs <url-de-base> [tour]');
  process.exit(2);
}
const sizeMod = (await runnerImport(resolve(here, '../src/tour/subtitleSize.ts'), { configFile: false, logLevel: 'error' })).module;
const cuesMod = (await runnerImport(resolve(here, '../src/tour/cues.ts'), { configFile: false, logLevel: 'error' })).module;
const tokMod = (await runnerImport(resolve(here, '../src/theme/tokens.ts'), { configFile: false, logLevel: 'error' })).module;
const T = tokMod.tourSubtitle;
const resolved = JSON.parse(readFileSync(resolve(here, `../public/tour/${tourId}/tour.resolved.json`), 'utf-8'));

const SCREENS = [
  { w: 1920, h: 1080, record: false },
  { w: 1920, h: 1080, record: true },
  { w: 1280, h: 720, record: false },
  { w: 390, h: 844, record: false },
];
const failures = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] });
try {
  for (const s of SCREENS) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
    const query = s.record ? `?record=1&tour=${tourId}` : `?visite=1&o=78358`;
    await page.goto(`${base}/${query}`, { waitUntil: 'load' });
    await page.waitForSelector('.tour-subtitle', { state: 'attached', timeout: 120000 });
    if (!s.record) {
      // Visite lancée : on la met en pause pour que le texte du repère ne bouge plus pendant la mesure
      await page.getByRole('button', { name: 'Pause' }).click({ timeout: 120000 }).catch(() => undefined);
    }
    const expectedPx = sizeMod.subtitleFontPx(s.w, s.record);
    const capacity = Math.min(cuesMod.CUE_MAX_CHARS, sizeMod.subtitleCharsPerLine(s.w, s.record) * T.maxLines);
    const measure = (chunks) =>
      page.evaluate((list) => {
        const el = document.querySelector('.tour-subtitle');
        const cs = getComputedStyle(el);
        const lineHeight = parseFloat(cs.lineHeight);
        const out = [];
        for (const text of list) {
          el.textContent = text;
          out.push({ text, lines: Math.round(el.scrollHeight / lineHeight), clipped: el.scrollHeight > el.clientHeight + 1 });
        }
        return { fontPx: parseFloat(cs.fontSize), boxPx: el.clientWidth, out };
      }, chunks);
    const all = resolved.steps.map((st) => st.text);
    const fit = await measure(all.flatMap((t) => cuesMod.cueChunks(t, capacity)));
    const raw = await measure(all.flatMap((t) => cuesMod.cueChunks(t)));
    const worst = Math.max(...fit.out.map((o) => o.lines));
    const clippedFit = fit.out.filter((o) => o.clipped);
    const clippedRaw = raw.out.filter((o) => o.clipped);
    console.log(
      `${String(s.w).padStart(4)} px${s.record ? ' (vidéo)' : '        '} : police ${fit.fontPx.toFixed(1)} px (jeton ${expectedPx.toFixed(1)}), ` +
        `largeur de texte ${fit.boxPx} px, capacité ${capacity} car. ; ${fit.out.length} repères recoupés, au plus ${worst} ligne(s), ${clippedFit.length} coupé(s) ; ` +
        `non recoupés (84 car.) : ${raw.out.length} repères, ${clippedRaw.length} coupé(s)`,
    );
    if (Math.abs(fit.fontPx - expectedPx) > 0.6) failures.push(`${s.w} px : police ${fit.fontPx} px, le jeton calcule ${expectedPx.toFixed(1)} px`);
    if (fit.fontPx < T.readableMinPx || fit.fontPx > T.readableMaxPx) failures.push(`${s.w} px : police ${fit.fontPx} px hors des bornes ${T.readableMinPx} à ${T.readableMaxPx}`);
    for (const o of clippedFit) failures.push(`${s.w} px : repère coupé (${o.lines} lignes) : « ${o.text} »`);
    // mesure de la largeur moyenne d'un caractère en em, pour le jeton `avgCharEm` (information)
    const longest = fit.out.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    console.log(`        plus long repère recoupé : ${longest.text.length} car., ${longest.lines} ligne(s)`);
    await page.close();
  }
} catch (e) {
  failures.push(String(e).slice(0, 300));
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\nSous-titres en échec :\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nSous-titres : taille lisible et aucun repère coupé aux trois écrans.');
