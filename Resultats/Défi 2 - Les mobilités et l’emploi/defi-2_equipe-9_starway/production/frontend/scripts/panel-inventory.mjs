#!/usr/bin/env node
/**
 * Inventaire des phrases de l'interface (chantier C, « alléger sans rien perdre »).
 *
 *   node scripts/panel-inventory.mjs <url-de-base> --record     relève la RÉFÉRENCE (à faire sur main, avant un changement)
 *   node scripts/panel-inventory.mjs <url-de-base>               compare le site à la référence ; code 1 si une phrase a disparu
 *   options : --strict   les phrases de keep-visible.json doivent toutes être visibles sans rien ouvrir (à activer au lot qui les sort des replis)
 *             --out=<dossier>   où écrire le relevé courant (défaut : smoke-out/)
 *
 * Fichiers (scripts/inventory/) :
 *   panel-baseline.json     la référence, générée (phrases neutralisées, jamais de valeur chiffrée) ;
 *   panel-exceptions.json   les phrases qu'on a le droit de ne plus retrouver, chacune avec sa justification (relue par Nicolas) ;
 *   keep-visible.json       les phrases qui ne doivent jamais devenir moins visibles qu'à la référence.
 *
 * Le relevé ouvre chaque scénario, lit le texte de chaque zone (panneau de preuve, barre de scénario, légende) fermée,
 * puis plis ouverts, puis le texte des bulles « i ». Une phrase vaut sa neutralisation : minuscules, chiffres remplacés par « # ».
 * Aucun chiffre n'est écrit en dur : les scénarios et les phrases attendues viennent des JSON publiés et de la référence.
 * Appelé aussi par smoke.mjs (même navigateur), donc par le contrôle de la mise en ligne.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareInventories, matchesKeep, phrasesOf, validateExceptions, zoneFromTexts } from './lib/panelInventory.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = join(here, 'inventory');
export const BASELINE_FILE = join(dir, 'panel-baseline.json');
export const EXCEPTIONS_FILE = join(dir, 'panel-exceptions.json');
export const KEEP_FILE = join(dir, 'keep-visible.json');

/** Zones relevées : le panneau de preuve est l'objet du lot 1 ; barre et légende servent aux lots suivants. */
const ZONES = [
  { id: 'panneau', selector: '.proof-panel', required: true },
  { id: 'barre', selector: '.scenario-bar', required: false },
  { id: 'legende', selector: '.legend', required: false },
];

const VIEWPORT = { width: 1440, height: 900 };

/**
 * Scénarios de l'inventaire. Origine et pôle : ceux du constat de Nicolas (Montesson, pôle BE_1146 des 44 astres) ;
 * la seconde commune de la comparaison est la première autre commune calculée et, pour le vélo + TC, couverte.
 */
export function scenariosFor(meta) {
  const computed = meta.access_communes ?? [];
  const o = computed.includes('78358') ? '78358' : computed[0];
  const vs = computed.find((c) => c !== o && (!meta.mode_coverage?.bike_transit || meta.mode_coverage.bike_transit.includes(c))) ?? computed.find((c) => c !== o);
  const p = 'BE_1146';
  const base = `o=${o}&d=d09&b=60`;
  return [
    { id: 'tc', label: 'Transports en commun', url: `/?${base}&m=transit&p=${p}` },
    { id: 'velo-tc', label: 'Vélo + TC', url: `/?${base}&m=bike_transit&p=${p}` },
    { id: 'velib', label: "Vélib'", url: `/?o=${meta.mode_coverage?.velib?.[0] ?? o}&d=d09&b=60&m=velib&p=${p}` },
    { id: 'voiture', label: 'Voiture (route vide)', url: `/?${base}&m=car&p=${p}` },
    { id: 'voiture-trafic', label: 'Voiture (trafic moyen)', url: `/?${base}&m=car_traffic&p=${p}` },
    { id: 'horaires-libres', label: 'Horaires libres 8h-16h', url: `/?o=${o}&s=0800&e=1600&b=60&m=transit&p=${p}` },
    { id: 'poste-de-nuit', label: 'Poste de nuit 22h-6h', url: `/?o=${o}&s=2200&e=0600&b=60&m=transit&p=${p}` },
    { id: 'comparaison', label: 'Comparaison A/B', url: `/?${base}&m=transit&vs=${vs}&p=${p}` },
  ];
}

/**
 * Réglages d'attente (variables d'environnement), valeurs par défaut larges : le relevé doit tenir sur un poste ou un
 * runner GitHub lent, en rendu logiciel. Une attente plus large ne change rien à ce qui est attendu ni comparé.
 * - STARWAY_INVENTORY_PANEL_TIMEOUT_MS : apparition du panneau de preuve, par tentative (défaut 120 s) ;
 * - STARWAY_INVENTORY_STABLE_MAX_MS : attente d'un texte stable (ou de requêtes terminées), par lecture (défaut 30 s) ;
 * - STARWAY_INVENTORY_CPU_THROTTLE et STARWAY_INVENTORY_LATENCY_MS : simulent un poste lent (ralentissement du processeur,
 *   latence réseau en ms) pour vérifier ces délais en local ; absents, rien n'est simulé.
 */
const envMs = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tentatives par scénario : un seul retry, journalisé. */
const ATTEMPTS = 2;
/** Deux scénarios de suite en échec après retry : le reste du relevé est abandonné (la durée d'un échec total reste bornée). */
const MAX_CONSECUTIVE_FAILURES = 2;

/**
 * Lecture d'une zone, faite DANS la page en un seul aller-retour (un aller-retour par lecture coûtait des secondes sur
 * un navigateur logiciel chargé). Le texte d'une zone : tant qu'il bouge (chargement, animation), on attend (trois lectures
 * identiques à 400 ms, comme avant) ; au plus `stableMax`. Retourne null si la zone n'existe pas.
 */
async function readZoneInPage({ sel, poll, stableMax }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = () => document.querySelector(sel)?.innerText ?? '';
  let unsettled = 0;
  const stable = async () => {
    let last = null;
    let same = 0;
    const t0 = performance.now();
    while (same < 2 && performance.now() - t0 < stableMax) {
      const t = read();
      same = t && t === last ? same + 1 : 0;
      last = t;
      await wait(poll);
    }
    if (same < 2) unsettled++;
    return last ?? '';
  };
  if (!document.querySelector(sel)) return null;
  const closed = await stable();
  // Tiroirs ouverts par un bouton à aria-expanded (flèche de la barre de scénario, D-049) : un tiroir est un repli, comme un pli du panneau
  let drawers = 0;
  document.querySelectorAll(`${sel} .bar-toggle[aria-expanded="false"]`).forEach((b) => {
    b.click();
    drawers++;
  });
  if (drawers) await wait(400);
  // Plis ouverts d'un coup (comme l'étape 28 de smoke.mjs). Tout par le DOM : aucune attente d'actionabilité sous un navigateur chargé
  document.querySelectorAll(`${sel} details`).forEach((d) => (d.open = true));
  const opened = await stable();
  // Puis listes de communes dépliées (« et N autres ») : les deux lectures comptent comme « replié »
  let expanded = '';
  for (let i = 0; i < 4; i++) {
    let clicked = 0;
    document.querySelectorAll(`${sel} button.pf-more`).forEach((b) => {
      if (/^replier/i.test(b.getAttribute('aria-label') ?? '')) return;
      b.click();
      clicked++;
    });
    if (!clicked) break;
    await wait(250);
    expanded = await stable();
  }
  // Bulles « i » : fermées donc absentes de innerText, on lit leur contenu
  const tips = [...document.querySelectorAll(`${sel} .info-pop`)].map((n) => n.textContent ?? '').join('\n');
  return { closed, opened, expanded, tips, unsettled };
}

async function readZoneOnce(page, zone, log) {
  const stableMax = envMs('STARWAY_INVENTORY_STABLE_MAX_MS', 30000);
  const raw = await page.evaluate(readZoneInPage, { sel: zone.selector, poll: 400, stableMax });
  if (!raw) return null;
  if (raw.unsettled) log(`    attention : texte de « ${zone.id} » encore instable après ${stableMax / 1000} s (relevé tel quel)`);
  return zoneFromTexts({ closed: raw.closed, opened: `${raw.opened}\n${raw.expanded}`, tips: raw.tips });
}

/** Une seconde chance : un navigateur logiciel chargé laisse parfois une évaluation sans réponse. */
async function readZone(page, zone, log) {
  try {
    return await readZoneOnce(page, zone, log);
  } catch {
    return readZoneOnce(page, zone, log);
  }
}

/** Ralentissement simulé (voir plus haut), pour essayer les délais en local. Chromium seulement. */
async function simulateSlowness(context, page) {
  const cpu = Number(process.env.STARWAY_INVENTORY_CPU_THROTTLE);
  const latency = Number(process.env.STARWAY_INVENTORY_LATENCY_MS);
  if (!(cpu > 1) && !(latency > 0)) return;
  const cdp = await context.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (latency > 0) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });
}

/** Attend que plus aucune requête ne soit en cours pendant `quietMs` (les données du panneau sont chargées) ; false si cela n'arrive pas. */
async function waitQuiet(pending, quietMs, maxMs) {
  const t0 = Date.now();
  let since = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (pending.size) since = Date.now();
    else if (Date.now() - since >= quietMs) return true;
    await sleep(200);
  }
  return false;
}

/** Une tentative de relevé d'un scénario. En cas d'échec, l'exception porte POURQUOI : URL, texte visible, requêtes en attente, erreurs de la console, et une capture. */
async function attempt({ context, base, sc, outDir, log, tryNo }) {
  const page = await context.newPage();
  const pending = new Set();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('request', (r) => pending.add(r));
  page.on('requestfinished', (r) => pending.delete(r));
  page.on('requestfailed', (r) => {
    pending.delete(r);
    failedRequests.push(r.url().replace(base, ''));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().replace(base, '')}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120));
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 120)));
  const panelTimeout = envMs('STARWAY_INVENTORY_PANEL_TIMEOUT_MS', 120000);
  const t0 = Date.now();
  try {
    await simulateSlowness(context, page);
    await page.goto(`${base}${sc.url}`, { waitUntil: 'load', timeout: panelTimeout });
    await page.waitForSelector('.proof-panel', { timeout: panelTimeout });
    log(`    ${sc.id} / panneau apparu : ${Math.round((Date.now() - t0) / 100) / 10} s`);
    // Le panneau est là : on attend aussi que ses données soient chargées (plus de requête en cours) avant de lire
    if (!(await waitQuiet(pending, 1500, envMs('STARWAY_INVENTORY_STABLE_MAX_MS', 30000)))) log(`    attention : requêtes encore en cours pour ${sc.id} (relevé tel quel)`);
    const zones = {};
    const errors = [];
    for (const z of ZONES) {
      const t1 = Date.now();
      const r = await readZone(page, z, log);
      if (r) zones[z.id] = r;
      else if (z.required) errors.push(`[${sc.id}] zone « ${z.id} » introuvable (${z.selector})`);
      log(`    ${sc.id} / ${z.id} : ${Math.round((Date.now() - t1) / 100) / 10} s`);
    }
    return { zones, errors };
  } catch (e) {
    const visible = await Promise.race([page.evaluate(() => document.body?.innerText ?? '').catch(() => ''), sleep(5000).then(() => '')]);
    let shot = '';
    if (outDir && tryNo === ATTEMPTS) {
      try {
        mkdirSync(outDir, { recursive: true });
        shot = join(outDir, `inventaire-${sc.id}-echec.png`);
        await Promise.race([page.screenshot({ path: shot }), sleep(10000)]);
      } catch {
        shot = '';
      }
    }
    const why = [
      String(e.message).split('\n')[0],
      `après ${Math.round((Date.now() - t0) / 1000)} s (délai ${panelTimeout / 1000} s)`,
      `URL ${base}${sc.url}`,
      `texte visible : « ${visible.replace(/\s+/g, ' ').trim().slice(0, 300)} »`,
      `requêtes en cours : ${pending.size}${pending.size ? ` (${[...pending].slice(0, 3).map((r) => r.url().replace(base, '')).join(', ')})` : ''}`,
      failedRequests.length ? `requêtes en échec : ${failedRequests.slice(0, 3).join(', ')}` : '',
      consoleErrors.length ? `erreurs de la console : ${consoleErrors.slice(0, 3).join(' | ')}` : '',
      shot ? `capture : ${shot}` : '',
    ].filter(Boolean);
    throw new Error(why.join(' ; '));
  } finally {
    await page.close();
  }
}

/** Relève tous les scénarios avec un navigateur déjà lancé. Un scénario est tenté deux fois au plus (un seul retry, journalisé). */
export async function collect({ browser, base, meta, log = () => {}, outDir }) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const scenarios = [];
  const errors = [];
  let failuresInARow = 0;
  const all = scenariosFor(meta);
  for (const [i, sc] of all.entries()) {
    if (failuresInARow >= MAX_CONSECUTIVE_FAILURES) {
      errors.push(`[${sc.id}] non relevé : arrêt anticipé après ${MAX_CONSECUTIVE_FAILURES} scénarios de suite en échec (voir les messages précédents)`);
      log(`KO  inventaire ${sc.id} (non tenté)`);
      continue;
    }
    let done = null;
    let lastError = '';
    for (let tryNo = 1; tryNo <= ATTEMPTS && !done; tryNo++) {
      try {
        done = await attempt({ context, base, sc, outDir, log, tryNo });
      } catch (e) {
        lastError = String(e.message);
        if (tryNo < ATTEMPTS) log(`    nouvelle tentative pour ${sc.id} (${i + 1}/${all.length}) : ${lastError.slice(0, 200)}`);
      }
    }
    if (done) {
      failuresInARow = 0;
      errors.push(...done.errors);
      scenarios.push({ id: sc.id, label: sc.label, url: sc.url, zones: done.zones });
      log(`ok  inventaire ${sc.id}`);
    } else {
      failuresInARow++;
      errors.push(`[${sc.id}] ${lastError}`);
      log(`KO  inventaire ${sc.id}`);
    }
  }
  await context.close();
  return { current: { viewport: VIEWPORT, scenarios }, errors };
}

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : fallback);

/** Phrases à garder visibles : la liste du dépôt, plus celles qui viennent des JSON publiés (avertissement Vélib'). */
export function keepVisibleFor(meta) {
  const fixed = readJson(KEEP_FILE, { entrees: [] }).entrees;
  const velib = meta.velib?.warning ? phrasesOf(meta.velib.warning)[0] : null;
  return velib ? [...fixed, { fragment: velib, scenarios: ['velib'], zone: 'panneau', pourquoi: "avertissement Vélib' publié (meta.velib.warning), tel quel" }] : fixed;
}

/**
 * Relève et compare. `record` écrit la référence. Retourne { failures, report } : failures vide si tout va bien.
 */
export async function runInventory({ browser, base, record = false, strict = false, outDir, log = console.log }) {
  const meta = await (await fetch(`${base}/data/meta.json`)).json();
  const { current, errors } = await collect({ browser, base, meta, log, outDir });
  const failures = [...errors];
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'panel-inventory.json'), `${JSON.stringify(current, null, 1)}\n`);
  }
  if (record) {
    if (errors.length) return { failures, report: { current } };
    writeFileSync(BASELINE_FILE, `${JSON.stringify({ note: 'Référence générée par scripts/panel-inventory.mjs --record : phrases neutralisées (minuscules, chiffres remplacés par #), jamais de valeur.', ...current }, null, 1)}\n`);
    log(`Référence écrite : ${BASELINE_FILE}`);
    return { failures, report: { current } };
  }
  if (!existsSync(BASELINE_FILE)) return { failures: [...failures, `référence absente : ${BASELINE_FILE} (lancer avec --record sur main)`], report: { current } };
  const baseline = readJson(BASELINE_FILE);
  const exceptions = readJson(EXCEPTIONS_FILE, { exceptions: [] }).exceptions;
  const keepVisible = keepVisibleFor(meta);
  for (const p of validateExceptions(exceptions, baseline)) failures.push(`exceptions : ${p}`);
  const report = compareInventories({ baseline, current, exceptions, keepVisible, strict });
  for (const m of report.missing) failures.push(`phrase disparue [${m.scenario} / ${m.zone}] (était ${m.was ?? '?'}) : « ${m.phrase} »`);
  for (const d of report.degraded) failures.push(`phrase à garder visible devenue moins visible [${d.scenario} / ${d.zone}] (${d.was} puis ${d.now}) : « ${d.phrase} »`);
  for (const n of report.notVisible) failures.push(`phrase à garder visible mais pas visible [${n.scenario} / ${n.zone}] (${n.now}) : « ${n.phrase} »`);
  return { failures, report: { ...report, current, keepVisible } };
}

/** Phrases à garder visibles trouvées dans la référence, avec leur état (pour le compte rendu). */
export function keepVisibleStates(baseline, keepVisible) {
  const rows = [];
  for (const sc of baseline.scenarios)
    for (const [zone, z] of Object.entries(sc.zones))
      for (const s of ['visible', 'fold', 'tip']) for (const phrase of z[s]) if (matchesKeep(keepVisible, { scenario: sc.id, zone, phrase })) rows.push({ scenario: sc.id, zone, state: s, phrase });
  return rows;
}

// Exécution directe
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const base = (args.find((a) => !a.startsWith('--')) ?? '').replace(/\/$/, '');
  if (!base) {
    console.error('Usage : node scripts/panel-inventory.mjs <url-de-base> [--record] [--strict] [--out=dossier]');
    process.exit(2);
  }
  const pwPath = resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(pwPath).href);
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] });
  const outArg = args.find((a) => a.startsWith('--out='));
  const outDir = resolve(outArg ? outArg.slice(6) : join(here, '..', 'smoke-out'));
  try {
    const { failures, report } = await runInventory({ browser, base, record: args.includes('--record'), strict: args.includes('--strict'), outDir });
    if (report.added?.length) console.log(`${report.added.length} phrase(s) nouvelle(s) depuis la référence (information).`);
    if (failures.length) {
      console.error(`\n${failures.length} échec(s) :`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else console.log(args.includes('--record') ? 'Référence relevée.' : "Inventaire conforme : aucune phrase n'a disparu sans exception justifiée.");
  } finally {
    // Un navigateur logiciel chargé met parfois longtemps à se fermer : on ne l'attend pas indéfiniment
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
    process.exit(process.exitCode ?? 0);
  }
}
