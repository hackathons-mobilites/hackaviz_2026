#!/usr/bin/env node
/**
 * Contrôle de la taille des cibles interactives (WCAG 2.5.8, minimum 24 x 24 px CSS) et de la stabilité du ciel.
 *
 *   node scripts/targets.mjs <url-de-base> [dossier-sortie] [--label=avant] [--shots]
 *   ex. node scripts/targets.mjs http://localhost:4281 ./smoke-out --label=apres --shots
 *
 * Joue le ciel par défaut (44 astres) depuis Maisons-Laffitte (78358), sans panneau puis avec le panneau d'un
 * pôle ouvert (feuille du bas au téléphone), à 390, 768 et 1280 px de large. Mesure la boîte (getBoundingClientRect)
 * de chaque cible visible : lien, bouton, champ, onglet, interrupteur, curseur. Échoue (code 1) si l'une est sous
 * la taille minimale (`--target-min` de styles.css, miroir de `targetSize.minPx` de theme/tokens.ts).
 * Écrit aussi `targets-<label>.json` : positions et tailles des zones de frappe des astres (`.pole-hit`), hauteurs
 * `--bar-h` et `--sky-credit-h`, et l'empreinte de l'écran entier en mouvement réduit : deux passes (avant /
 * après) doivent donner les mêmes astres, les mêmes hauteurs et, sur un rendu stable, la même empreinte.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const pwPath = resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pwPath).href);

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const base = (positional[0] ?? '').replace(/\/$/, '');
if (!base) {
  console.error('Usage : node scripts/targets.mjs <url-de-base> [dossier-sortie] [--label=nom] [--shots]');
  process.exit(2);
}
const outDir = resolve(positional[1] ?? join(here, '..', 'smoke-out'));
const label = (args.find((a) => a.startsWith('--label=')) ?? '--label=mesure').slice(8);
const shots = args.includes('--shots');
mkdirSync(outDir, { recursive: true });

const MIN = 24;
const ORIGIN = '78358';
const VIEWPORTS = [
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1280, h: 800 },
];
const poles = await (await fetch(`${base}/data/poles.json`)).json();
const poleId = poles[0]?.id ?? '';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
});
const context = await browser.newContext({ viewport: { width: VIEWPORTS[0].w, height: VIEWPORTS[0].h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage();
const failures = [];
const report = [];

const INTERACTIVE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

function measure(args) {
  const { selector, min } = args;
  const visible = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 48);
    out.push({ tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''), name, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.x), y: Math.round(r.y), small: r.width < min - 0.01 || r.height < min - 0.01, scope: el.closest('.sky-credit') ? 'bande' : el.closest('.counter-block') ? 'compteur' : '' });
  }
  return out;
}

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  for (const [panel, extra] of [['sans-panneau', ''], ['panneau-ouvert', `&p=${poleId}`]]) {
    const name = `${vp.w}-${panel}`;
    await page.goto(`${base}/?o=${ORIGIN}&d=d09&b=45&m=transit${extra}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('.scenario-bar', { timeout: 30000 });
    await page.waitForTimeout(3500);
    const targets = await page.evaluate(measure, { selector: INTERACTIVE, min: MIN });
    const small = targets.filter((t) => t.small);
    // Bloquant : tout le téléphone 390 px sans panneau, et partout la bande du ciel et le compteur (périmètre de la correction)
    const blocking = (t) => t.scope !== '' || (vp.w === 390 && panel === 'sans-panneau');
    for (const t of small) if (blocking(t)) failures.push(`[${name}] ${t.tag} « ${t.name} » ${t.w}x${t.h} sous ${MIN}x${MIN}`);
    const sky = await page.evaluate(() => ({
      barH: getComputedStyle(document.documentElement).getPropertyValue('--bar-h'),
      creditH: getComputedStyle(document.documentElement).getPropertyValue('--sky-credit-h'),
      poleHits: [...document.querySelectorAll('.pole-hit')].map((e) => {
        const r = e.getBoundingClientRect();
        return [e.getAttribute('aria-label') ?? '', Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
      }),
    }));
    // Empreinte de l'écran entier (mouvement réduit : rendu stable d'une passe à l'autre) : avant et après la
    // correction elle doit être identique, la bande, le compteur et le ciel ne bougent pas d'un pixel
    const png = await page.screenshot();
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 16);
    if (shots) await page.screenshot({ path: join(outDir, `cibles-${label}-${name}.png`) });
    report.push({ name, count: targets.length, small: small.length, screenHash: hash, ...sky, scopeTargets: targets.filter((t) => t.scope !== ''), smallTargets: small });
    console.log(`${name}: ${targets.length} cibles, ${small.length} sous ${MIN}x${MIN}, ecran ${hash}`);
    for (const t of small) console.log(`   ${blocking(t) ? 'BLOQUANT' : 'a voir  '} ${t.tag} « ${t.name} » ${t.w}x${t.h} en (${t.x}, ${t.y})`);
  }
}

await browser.close();
writeFileSync(join(outDir, `targets-${label}.json`), JSON.stringify(report, null, 1));
if (failures.length) {
  console.error(`\n${failures.length} cible(s) sous ${MIN}x${MIN} px :\n` + failures.join('\n'));
  process.exit(1);
}
console.log(`\nToutes les cibles visibles mesurent au moins ${MIN}x${MIN} px.`);


