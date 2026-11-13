#!/usr/bin/env node
/**
 * Captures de l'aide : joue chaque scénario de `src/components/guide/guide.manifest.ts` dans un vrai navigateur et écrit une image webp
 * par capture dans `public/assets/guide/`, puis `src/components/guide/guide.captures.ts` (dimensions).
 *
 *   node scripts/capture-guide.mjs                 démarre un serveur vite puis l'arrête (par PID)
 *   node scripts/capture-guide.mjs --url <base>    utilise un serveur déjà lancé
 *   node scripts/capture-guide.mjs --only a,b      ne refait que ces captures (noms de fichiers)
 *   node scripts/capture-guide.mjs --partial       écrit les captures réussies même si d'autres échouent (mise au point, code de sortie 1 quand même)
 *
 * Échoue (code 1) sans rien écrire si un sélecteur du manifeste n'existe plus : un changement d'interface se voit tout de suite.
 * Fenêtre neuve pour chaque capture (rien ne reste d'un réglage à l'autre), mouvement réduit (aucune image prise au milieu d'une animation).
 * À lancer sous le verrou de build. Playwright : celui de tools/record-tour, comme smoke.mjs. Webp : encodé par le navigateur, aucune
 * dépendance ajoutée.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runnerImport } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const frontend = resolve(here, '..');
const pwPath = resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pwPath).href);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const only = opt('--only')?.split(',').filter(Boolean) ?? null;
const partial = args.includes('--partial');
let base = opt('--url')?.replace(/\/$/, '') ?? null;

// Chemins relatifs à frontend/ (comme resolve-tour.mjs), quel que soit le dossier de lancement
process.chdir(frontend);
const load = async (rel) => (await runnerImport(`./${rel}`, { configFile: false, logLevel: 'error' })).module;
const { GUIDE_ENTRIES } = await load('src/components/guide/guide.manifest.ts');
const { aidePage, color } = await load('src/theme/tokens.ts');
const capturesFile = resolve(frontend, 'src/components/guide/guide.captures.ts');
const outDir = resolve(frontend, 'public/assets/guide');

const TIMEOUT = 60000;
const GOTO_TIMEOUT = 120000;
const SETTLE_MS = 2500;
const PORT = 4393;

// Serveur vite lancé ici : arrêté par son PID, jamais par nom
let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
process.on('exit', stopServer);
process.on('SIGINT', () => process.exit(130));

if (!base) {
  base = `http://localhost:${PORT}`;
  const vite = resolve(frontend, 'node_modules/vite/bin/vite.js');
  server = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], { cwd: frontend, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    up = await fetch(`${base}/data/meta.json`).then((r) => r.ok, () => false);
  }
  if (!up) {
    console.error(`vite ne répond pas sur ${base}`);
    process.exit(1);
  }
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] });
const encoder = await (await browser.newContext()).newPage();

/** PNG du navigateur vers webp, encodé par le canvas : sans dépendance */
async function toWebp(png) {
  const url = await encoder.evaluate(
    async ([b64, q]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', q);
    },
    [png.toString('base64'), aidePage.capture.webpQuality],
  );
  if (!url.startsWith('data:image/webp')) throw new Error('encodage webp indisponible dans ce navigateur');
  return Buffer.from(url.split(',')[1], 'base64');
}

class Missing extends Error {}

/** Élément exigé par le manifeste : son absence arrête la capture */
async function need(page, sel, state = 'visible') {
  const loc = page.locator(sel).first();
  try {
    await loc.waitFor({ state, timeout: TIMEOUT });
  } catch {
    throw new Missing(`sélecteur introuvable : ${sel}`);
  }
  return loc;
}

async function runStep(page, step) {
  switch (step.do) {
    case 'click':
      await (await need(page, step.sel)).click();
      break;
    case 'fill':
      await (await need(page, step.sel)).fill(step.value);
      break;
    case 'focus':
      await (await need(page, step.sel, 'attached')).focus();
      break;
    case 'hover':
      await (await need(page, step.sel)).hover();
      break;
    case 'open':
      await (await need(page, step.sel, 'attached')).evaluate((d) => (d.open = true));
      break;
    case 'press':
      await page.keyboard.press(step.key);
      break;
    case 'waitFor':
      await need(page, step.sel);
      break;
    case 'wait':
      await page.waitForTimeout(step.ms);
      break;
    default:
      throw new Error(`étape inconnue : ${JSON.stringify(step)}`);
  }
}

/** Dessine un trait autour d'un élément, dans la page, le temps de la capture */
async function ring(page, sel) {
  await need(page, sel, 'attached');
  await page.evaluate(
    ([s, c, px]) => {
      const el = document.querySelector(s);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = document.createElement('div');
      d.setAttribute('data-capture-ring', '');
      Object.assign(d.style, {
        position: 'fixed',
        left: `${r.left - px - 2}px`,
        top: `${r.top - px - 2}px`,
        width: `${r.width + 2 * px + 4}px`,
        height: `${r.height + 2 * px + 4}px`,
        border: `${px}px solid ${c}`,
        borderRadius: '8px',
        zIndex: '2147483647',
        pointerEvents: 'none',
      });
      document.body.appendChild(d);
    },
    [sel, color.accent, aidePage.capture.ringPx],
  );
}

async function capture(entry, shot) {
  const kind = shot.viewport ?? 'desktop';
  const vp = aidePage.capture[kind];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: kind === 'phone' ? aidePage.capture.phoneScale : 1, reducedMotion: 'reduce' });
  // Carte « contraste du jour » écartée : elle n'apparaît qu'une fois par session et couvrirait le ciel
  await context.addInitScript(() => window.sessionStorage.setItem('starway.contrast.seen', '1'));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message.slice(0, 160)));
  try {
    // Poste chargé : un chargement trop lent n'est pas un sélecteur disparu, on le retente une fois
    await page.goto(`${base}${shot.url}`, { waitUntil: 'load', timeout: GOTO_TIMEOUT }).catch(() => page.goto(`${base}${shot.url}`, { waitUntil: 'load', timeout: GOTO_TIMEOUT }));
    await need(page, shot.ready ?? '.scenario-bar', 'attached');
    await page.waitForTimeout(SETTLE_MS);
    for (const step of shot.steps ?? []) await runStep(page, step);
    const targets = [];
    for (const sel of shot.show) targets.push(await need(page, sel));
    await page.waitForTimeout(200);
    for (const sel of shot.highlight ?? []) await ring(page, sel);
    let clip;
    if (shot.frame !== 'page') {
      await targets[0].scrollIntoViewIfNeeded().catch(() => undefined);
      const boxes = [];
      for (const t of targets) {
        const b = await t.boundingBox();
        if (b) boxes.push(b);
      }
      if (!boxes.length) throw new Missing(`élément sans boîte : ${shot.show.join(', ')}`);
      const p = aidePage.capture.padPx;
      // Élément dans une zone qui défile (panneau, tiroir) : la capture ne déborde pas sur ce qui est autour de cette zone
      const area = await targets[0].evaluate((el) => {
        for (let a = el.parentElement; a; a = a.parentElement) {
          const o = getComputedStyle(a).overflowY;
          if ((o === 'auto' || o === 'scroll') && a.scrollHeight > a.clientHeight) {
            const r = a.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          }
        }
        return null;
      });
      const x = Math.max(area?.left ?? 0, Math.min(...boxes.map((b) => b.x)) - p);
      const y = Math.max(area?.top ?? 0, Math.min(...boxes.map((b) => b.y)) - p);
      const right = Math.min(area?.right ?? vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + p);
      const bottom = Math.min(area?.bottom ?? vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + p);
      clip = { x, y, width: right - x, height: bottom - y };
    }
    const png = await page.screenshot({ type: 'png', ...(clip ? { clip } : {}) });
    const webp = await toWebp(png);
    const scale = kind === 'phone' ? aidePage.capture.phoneScale : 1;
    const size = clip ? { w: Math.round(clip.width * scale), h: Math.round(clip.height * scale) } : { w: vp.width * scale, h: vp.height * scale };
    return { webp, size, problems };
  } finally {
    await context.close();
  }
}

const allShots = GUIDE_ENTRIES.flatMap((entry) => entry.shots.map((shot) => ({ entry, shot })));
const selected = only ? allShots.filter(({ shot }) => only.includes(shot.file)) : allShots;
if (only && selected.length !== only.length) console.error(`Certains noms de --only n'existent pas dans le manifeste : ${only.join(', ')}`);

const results = new Map();
const failures = [];
for (const { entry, shot } of selected) {
  try {
    const r = await capture(entry, shot);
    results.set(shot.file, r);
    console.log(`ok  ${shot.file} (${Math.round(r.webp.length / 1024)} Ko)${r.problems.length ? ` | erreur de page : ${r.problems[0]}` : ''}`);
  } catch (e) {
    failures.push(`[${entry.id}/${shot.file}] ${e.message.split('\n')[0]}`);
    console.log(`KO  ${shot.file}`);
  }
}

await browser.close();
stopServer();

if (failures.length) {
  console.error(`\n${failures.length} capture(s) en échec${partial ? ', les captures réussies sont écrites (--partial)' : ", rien n'a été écrit"} :`);
  for (const f of failures) console.error(`  - ${f}`);
  if (!partial) process.exit(1);
  process.exitCode = 1;
}

mkdirSync(outDir, { recursive: true });
for (const [file, r] of results) writeFileSync(join(outDir, `${file}.webp`), r.webp);

// Dimensions : le fichier généré garde les entrées non refaites (--only), retire les captures qui n'existent plus dans le manifeste
const previous = only || partial ? (await load('src/components/guide/guide.captures.ts')).GUIDE_CAPTURES : {};
const known = new Set(allShots.map(({ shot }) => shot.file));
const sizes = {};
for (const file of [...known].sort()) {
  const size = results.get(file)?.size ?? previous[file];
  if (size) sizes[file] = size;
}
writeFileSync(
  capturesFile,
  `/** Généré par scripts/capture-guide.mjs : dimensions de chaque capture. Ne pas modifier à la main. */\nexport const GUIDE_CAPTURES: Record<string, { w: number; h: number }> = ${JSON.stringify(sizes, null, 2)};\n`,
);

if (!only && !partial) {
  for (const name of readdirSync(outDir)) {
    if (name.endsWith('.webp') && !known.has(name.slice(0, -5))) {
      unlinkSync(join(outDir, name));
      console.log(`retiré : ${name}`);
    }
  }
}

const files = readdirSync(outDir).filter((n) => n.endsWith('.webp'));
const totalBytes = files.reduce((s, n) => s + statSync(join(outDir, n)).size, 0);
console.log(`\n${files.length} captures, ${(totalBytes / 1024 / 1024).toFixed(2)} Mo au total dans ${outDir}`);
