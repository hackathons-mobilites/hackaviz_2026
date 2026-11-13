#!/usr/bin/env node
/**
 * Test de fumée avant déploiement : une dizaine de scénarios RÉELS (communes de meta.access_communes).
 *
 *   node scripts/smoke.mjs <url-de-base> [dossier-captures]
 *   node scripts/smoke.mjs --serve [dossier-captures]   lance puis arrête `swa start ./dist --port 4280`
 *   ex. node scripts/smoke.mjs http://localhost:4280 ../design/smoke     (swa start déjà lancé)
 *       node scripts/smoke.mjs http://localhost:4173 ./smoke-out          (vite preview)
 *
 * Échoue (code 1) si : erreur console, violation CSP (« Refused to »), 404 sur /data/*, texte contenant
 * un tiret cadratin ou demi-cadratin, ou « DONNÉES FICTIVES » sans ?demo=1.
 * Un seul navigateur (Playwright de tools/record-tour, rendu logiciel swiftshader), fermé à la fin.
 * Captures 1600×900 par écran-clé (dont Vélib', Vélib' hors zone, réglage de marche D-024, horaires libres
 * 8h-16h, carte miroir commune par commune D-019 et mode « provenance des données », dont 390 px, et mode daltonien). À lancer
 * sous le verrou (NIGHT-RULES).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const pwPath = resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pwPath).href);

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const positional = args.filter((a) => !a.startsWith('--'));
const SERVE_PORT = 4280;
const base = (serve ? `http://localhost:${SERVE_PORT}` : (positional[0] ?? '')).replace(/\/$/, '');
const outDir = resolve((serve ? positional[0] : positional[1]) ?? join(here, '..', 'smoke-out'));
if (!base) {
  console.error('Usage : node scripts/smoke.mjs <url-de-base> [dossier-captures]  |  node scripts/smoke.mjs --serve [dossier-captures]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// --serve : `swa start ./dist --port 4280` (en-têtes et CSP de staticwebapp.config.json), arrêté à la fin
let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
}
process.on('exit', stopServer);
process.on('SIGINT', () => process.exit(130));
if (serve) {
  const dist = resolve(here, '..', 'dist');
  // Windows : swa est un script .cmd, lancé par le shell en une seule ligne (pas de tableau d'arguments)
  server =
    process.platform === 'win32'
      ? spawn(`swa start "${dist}" --port ${SERVE_PORT}`, { shell: true, stdio: 'ignore' })
      : spawn('swa', ['start', dist, '--port', String(SERVE_PORT)], { detached: true, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    up = await fetch(`${base}/data/meta.json`).then((r) => r.ok, () => false);
  }
  if (!up) {
    console.error(`swa start ne répond pas sur ${base} (dist construit ? SWA CLI installé ?)`);
    process.exit(1);
  }
}

const DASHES = /[\u2013\u2014]/;
const failures = [];
const warnings = [];
let current = 'démarrage';
const fail = (msg) => failures.push(`[${current}] ${msg}`);

// Ciel unique à 44 astres (D-054) : meta.json, access/, itineraries* et poles.json sont à la racine de data/.
const meta = await (await fetch(`${base}/data/meta.json`)).json();
const poles = await (await fetch(`${base}/data/poles.json`)).json();
const computed = meta.access_communes ?? [];
if (!computed.length) warnings.push('meta.access_communes est vide : scénarios sans résultat seulement.');
const [c1, c2, c3] = [computed[0], computed[1] ?? computed[0], computed[2] ?? computed[0]];
const covered = (mode, insee) => !meta.mode_coverage?.[mode] || meta.mode_coverage[mode].includes(insee);
const otherMode = ['walk', 'bike', 'car', 'bike_transit'].find((m) => c2 && covered(m, c2)) ?? 'transit';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();

page.on('console', (m) => {
  const t = m.text();
  if (/Refused to/i.test(t)) fail(`violation CSP : ${t.slice(0, 200)}`);
  else if (m.type() === 'error' && !/Failed to load resource/.test(t)) fail(`erreur console : ${t.slice(0, 200)}`);
});
page.on('pageerror', (e) => fail(`exception : ${e.message.slice(0, 200)}`));
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/data/') && r.status() === 404) {
    // access/{insee}.json absent pour une commune non calculée : attendu seulement hors access_communes
    const m = u.pathname.match(/\/data\/access\/(\w+)\.json$/);
    // alternatives/coverage.json : tant que les trajets alternatifs (D-055) ne sont pas publiés, ce fichier n'existe pas (404 attendu, une fois par session)
    if (u.pathname.endsWith('/data/alternatives/coverage.json')) return;
    // alternatives_comfort/coverage.json : réglage de marche « confort » (phase G), 404 attendu tant que ce dossier n'est pas publié
    if (u.pathname.endsWith('/data/alternatives_comfort/coverage.json')) return;
    if (!m || computed.includes(m[1])) fail(`404 sur ${u.pathname}`);
  }
});

async function checkText(demo = false) {
  const text = await page.evaluate(() => document.body.innerText);
  if (DASHES.test(text)) fail('texte contenant un tiret cadratin ou demi-cadratin');
  if (!demo && /DONNÉES FICTIVES/.test(text)) fail('« DONNÉES FICTIVES » affiché hors ?demo=1');
}

async function settle(ms = 3000, selector = '.scenario-bar') {
  await page.waitForSelector(selector, { timeout: 30000 });
  await page.waitForTimeout(ms);
}

async function shot(name) {
  await page.screenshot({ path: join(outDir, `${name}.png`) });
}

async function step(name, url, action, selector) {
  current = name;
  try {
    if (url) {
      await page.goto(`${base}${url}`, { waitUntil: 'load', timeout: 60000 });
      await settle(3000, selector);
    }
    if (action) await action();
    await checkText();
    await shot(name);
    console.log(`ok  ${name}`);
  } catch (e) {
    fail(`étape interrompue : ${e.message.split('\n')[0]}`);
    console.log(`KO  ${name}`);
  }
}

const sc = (o, extra = '') => `/?o=${o}&d=d09&b=45&m=transit${extra}`;
const escape = () => page.keyboard.press('Escape');
const clickButton = async (name) => {
  const b = page.getByRole('button', { name }).first();
  if (!(await b.count())) throw new Error(`bouton « ${name} » introuvable`);
  if (await b.isDisabled()) {
    warnings.push(`bouton « ${name} » désactivé`);
    return false;
  }
  await b.click();
  return true;
};

// Écran-titre : aucune interface n'est montée sous le titre (pas de barre de scénario), on attend le titre.
await step('01-titre', '/', null, '.title-screen');
if (c1) {
  await step('02-commune', sc(c1));
  await step('03-journee-6h', `/?o=${c1}&d=d06&b=60&m=transit`);
  await step('04-budget-30', `/?o=${c1}&d=d09&b=30&m=transit`);
  await step('05-mode', `/?o=${c2}&d=d09&b=45&m=${otherMode}`);
  await step('06-comparaison', sc(c1, `&vs=${c3 !== c1 ? c3 : c2}`));
  await step('07-preuve', sc(c1, `&p=${poles[0]?.id ?? ''}`));
  await step('08-halo', sc(c1, '&h=sex'));
  await step('09-liste', sc(c1), async () => {
    await clickButton(/Lire le ciel en liste|Liste/);
    await page.waitForSelector('.sky-table', { timeout: 10000 });
  });
  await step('10-carte', sc(c1), async () => {
    if (await clickButton(/^Voir la carte$/)) await page.waitForTimeout(3000);
    // Retour du testeur KBS (10/11) : le même bouton dit maintenant où il mène, et Échap revient au ciel
    if (!(await page.getByRole('button', { name: 'Revenir au ciel' }).count())) fail('carte ouverte : bouton « Revenir au ciel » absent');
  });
  await step('11-decouvertes', sc(c1), async () => {
    if (await page.getByRole('button', { name: /Découvertes/ }).count()) {
      await clickButton(/Découvertes/);
      await page.waitForTimeout(800);
    } else warnings.push('bouton « Découvertes » absent (meta.insights absent)');
  });
  await step('12-affiche', sc(c1), async () => {
    // Le bouton ouvre un menu (PNG, haute définition, texte) : on choisit « Affiche PNG ».
    if (await clickButton(/Exporter l.affiche|Affiche/)) {
      const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
      await page.getByRole('menuitem', { name: /Affiche PNG/ }).click();
      const d = await dl;
      if (!d) fail("l'export de l'affiche n'a produit aucun téléchargement");
      else await d.saveAs(join(outDir, d.suggestedFilename()));
    }
  });
  await escape();
}
await step('13-sources', '/?d=d09&b=45&m=transit', async () => {
  await clickButton(/Sources/);
  await page.waitForSelector('#sources-title', { timeout: 10000 });
});

// Vélib' (D-027) : une commune avec station (avertissement publié sous le mode et en tête de la preuve),
// puis une commune calculée sans station (texte publié `out_of_zone`, jamais « non calculé »)
const velibIn = meta.mode_coverage?.velib?.[0];
const velibOut = computed.find((c) => meta.mode_coverage?.velib && !meta.mode_coverage.velib.includes(c));
const velibFirst = meta.velib?.warning?.split(/(?<=[.!?])\s/)[0];
const expectText = async (needle, what) => {
  const text = await page.evaluate(() => document.body.innerText);
  if (needle && !text.includes(needle)) fail(`${what} absent de la page`);
};
if (velibIn && meta.velib) {
  await step('14-velib', `/?o=${velibIn}&d=d09&b=45&m=velib&p=${poles[0]?.id ?? ''}`, async () => {
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    await expectText(velibFirst, "avertissement Vélib'");
  });
} else warnings.push("mode Vélib' non publié (meta.velib ou mode_coverage.velib absent)");
if (velibOut && meta.velib) {
  await step('15-velib-hors-zone', `/?o=${velibOut}&d=d09&b=45&m=velib`, async () => {
    await expectText(meta.velib.out_of_zone, "texte « hors zone » Vélib'");
  });
}
// Réglage de marche D-024 : autre réglage que le défaut (paramètre w), sélecteur sur la ligne du mode
const otherWalk = meta.walk_settings?.settings?.find((s) => s.key);
if (c1 && otherWalk) {
  await step('16-marche-reglage', `/?o=${c1}&d=d14&b=60&m=transit&w=${otherWalk.id}`, async () => {
    const v = await page.locator('#walk-select').inputValue().catch(() => null);
    if (v !== otherWalk.id) fail(`sélecteur de marche : « ${v} » au lieu de « ${otherWalk.id} »`);
  });
} else warnings.push('réglage de marche non publié (meta.walk_settings sans autre réglage)');

// Véhicule D-029 : deux-roues choisi (paramètre vh), sélecteur sur la ligne du mode, bloc « Coût et carbone » du panneau
const twoWheeler = (meta.vehicles ?? []).find((v) => v.family === 'two_wheeler');
const carOrigin = computed.includes('78005') ? '78005' : c1;
if (carOrigin && twoWheeler && meta.car_costs?.distances?.status === 'ok') {
  await step('16b-vehicule-deux-roues', `/?o=${carOrigin}&d=d09&b=60&m=car&vh=${twoWheeler.id}&p=${poles[0]?.id ?? ''}`, async () => {
    const v = await page.locator('#vehicle-select').inputValue().catch(() => null);
    if (v !== twoWheeler.id) fail(`sélecteur de véhicule : « ${v} » au lieu de « ${twoWheeler.id} »`);
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    // le titre est en capitales à l'écran (text-transform des étiquettes du panneau) : comparaison sans casse
    const body = await page.evaluate(() => document.body.innerText);
    if (!/Coût et carbone/i.test(body)) fail('bloc « Coût et carbone » absent de la page');
    if (/\bnull\b|\bNaN\b|\bundefined\b/.test(body)) fail('valeur manquante affichée dans le panneau (null, NaN ou undefined)');
  });
  // Véhicule par défaut (aucun `vh`), mode sources coupé (défaut D-033) : le bloc est là, sans valeur manquante ni ligne de source
  await step('16c-voiture-defaut', `/?o=${carOrigin}&d=d09&b=60&m=car&p=${poles[0]?.id ?? ''}`, async () => {
    // Lot 3 : « Coût et carbone » est un pli du panneau, fermé par défaut ; on l'ouvre pour lire le bloc (le contrôle reste le même)
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    await page.locator('.proof-panel details').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
    await page.waitForTimeout(300);
    const body = await page.evaluate(() => document.body.innerText);
    if (!/Coût et carbone : voiture essence/i.test(body)) fail('bloc « Coût et carbone » de la voiture essence absent (véhicule par défaut)');
    if (/\bnull\b|\bNaN\b|\bundefined\b/.test(body)) fail('valeur manquante affichée dans le panneau (null, NaN ou undefined)');
    const notes = await page.locator('.pf-carcost .prov-note').count();
    if (notes) fail(`mode sources coupé : ${notes} ligne(s) de provenance dans le bloc coût`);
  });
} else warnings.push('véhicules D-029 non publiés (meta.vehicles sans deux-roues ou distances corrigées absentes)');

// Table commune x commune (D-019) : horaires libres et carte miroir sur toutes les communes, si publiées
const odIndex = await fetch(`${base}/data/od_walk3000/index.json`).then((r) => (r.ok ? r.json() : null), () => null);
if (odIndex?.coverage?.transit?.complete) {
  const odOrigin = odIndex.communes.includes('75101') ? '75101' : odIndex.communes[0];
  await step('17-horaires-libres', `/?o=${odOrigin}&s=0800&e=1600&b=45&m=transit`, async () => {
    await page.waitForTimeout(1500);
    await expectText('Horaires libres : 8h-16h', 'horaires libres 8h-16h dans la barre');
    await expectText("postes d'Île-de-France", "compteur sur toute l'Île-de-France");
    const q = new URL(page.url()).searchParams;
    if (q.get('s') !== '0800' || q.get('e') !== '1600' || q.has('d')) fail(`URL des horaires libres : ${page.url()}`);
  });
  const mapOrigin = odIndex.communes.includes('78358') ? '78358' : odOrigin;
  await step('18-carte-od', `/?o=${mapOrigin}&d=d09&b=60&m=transit&v=map`, async () => {
    await page.waitForTimeout(6000);
    const lit = await page.locator('.mirror-communes path.mc-accessible').count();
    if (!lit) fail('carte miroir en table OD : aucune commune atteinte dessinée');
    const text = await page.evaluate(() => document.body.innerText);
    if (/Autres communes : pas encore calculées/.test(text)) fail('légende « Autres communes » affichée en table OD');
  });
} else warnings.push('table OD D-019 non publiée (od_walk3000/index.json absent ou TC incomplet)');

// Mode « provenance des données » (bouton de la barre du haut, `?src=1` pour la session) : bande du ciel,
// lignes de provenance du panneau de preuve et de la carte, lien vers la fiche de la source, téléphone 390 px
const provSky = async () => {
  const t = await page.locator('#prov-sky').innerText().catch(() => '');
  if (!/EMP01/.test(t) || !/TRA01/.test(t)) fail(`bande de provenance du ciel incomplète : « ${t.slice(0, 160)} »`);
  if ((await page.evaluate(() => document.documentElement.dataset.provenance)) !== 'on') fail('html[data-provenance] différent de « on »');
};
if (c1) {
  await step('19-provenance-ciel', sc(c1, '&src=1'), provSky);
  await step('20-provenance-preuve', sc(c1, `&p=${poles[0]?.id ?? ''}&src=1`), async () => {
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    const n = await page.locator('.proof-panel .prov-note').count();
    if (n < 2) fail(`panneau de preuve : ${n} ligne(s) de provenance (2 au moins attendues : temps, postes)`);
    await shot('20-provenance-preuve');
    // Le lien d'une source ouvre « Sources & limites » sur sa fiche
    await page.locator('.proof-panel .prov-link').first().click();
    await page.waitForSelector('#sources-title', { timeout: 10000 });
    await page.waitForTimeout(600);
    const id = await page.evaluate(() => document.activeElement?.id ?? '');
    if (!id.startsWith('fiche-')) fail(`le lien de provenance n'ouvre pas une fiche (focus sur « ${id} »)`);
    await shot('20b-provenance-fiche');
    await escape();
  });
  await step('21-provenance-carte', `/?o=${c1}&d=d09&b=45&m=transit&v=map&src=1`, async () => {
    await page.waitForTimeout(6000);
    if (!(await page.locator('.mirror-map .prov-note, .prov-note').count())) fail('carte miroir : aucune ligne de provenance');
  });
  // Bouton de la barre du haut : coupe le mode (préférence mémorisée), la place de la bande ne bouge pas
  await step('22-provenance-bouton', sc(c1), async () => {
    const btn = page.getByRole('button', { name: 'Provenance des données' }).first();
    if (!(await btn.count())) throw new Error('bouton « Provenance des données » introuvable');
    const before = await page.locator('.sky-credit').boundingBox();
    const was = await btn.getAttribute('aria-pressed');
    await btn.click();
    await page.waitForTimeout(300);
    const now = await btn.getAttribute('aria-pressed');
    if (now === was) fail('le bouton provenance ne change pas aria-pressed');
    const after = await page.locator('.sky-credit').boundingBox();
    if (before && after && (Math.abs(before.y - after.y) > 1 || Math.abs(before.height - after.height) > 1)) fail('la bande du ciel change de place avec le réglage');
    if (now === 'true') await provSky();
    await btn.click();
  });
  current = '23-provenance-mobile';
  await page.setViewportSize({ width: 390, height: 844 });
  await step('23-provenance-mobile', sc(c1, '&src=1'), provSky);
  await step('24-provenance-mobile-preuve', sc(c1, `&p=${poles[0]?.id ?? ''}&src=1`), async () => {
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    await page.waitForTimeout(800);
  });
  await page.setViewportSize({ width: 1600, height: 900 });
}

// Couverture de la provenance (D-033) : coupée par défaut, rien d'affiché ; mode actif, chaque bloc chiffré
// présent dans le panneau de preuve porte sa ligne de source (code du manifeste) ; ciel à 44 astres : GEO04.
if (c1 && poles[0]?.id) {
  const proofUrl = (extra = '', mode = 'transit') => `/?o=${c1}&d=d09&b=45&m=${mode}&p=${poles[0].id}${extra}`;
  const code = /\([A-Z][A-Z0-9-]*\d\)/;
  await step('27-couverture-defaut', proofUrl(), async () => {
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    await page.waitForTimeout(2500);
    if ((await page.evaluate(() => document.documentElement.dataset.provenance)) !== 'off') fail('provenance non coupée par défaut');
    const notes = await page.locator('.prov-note').count();
    if (notes) fail(`${notes} ligne(s) de provenance affichée(s) par défaut`);
    // Tout le panneau, pied compris : avec le mode coupé, aucun code de source (D-033, y compris le crédit OpenStreetMap)
    const text = await page.locator('.proof-panel').evaluate((el) => el.innerText ?? el.textContent ?? '');
    const hit = code.exec(text);
    if (hit) fail(`code de source visible par défaut dans le panneau : « ${text.slice(Math.max(0, hit.index - 80), hit.index + 20).replace(/\s+/g, ' ')} »`);
  });
  await step('28-couverture-actif', proofUrl('&src=1'), async () => {
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    await page.waitForTimeout(3500);
    // Dans le volet simplifié, le carbone et « Comparer les modes » sont dans des blocs repliés : on les déplie pour lire leurs lignes de source
    await page.locator('.proof-panel details').evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
    await page.waitForTimeout(300);
    for (const sel of ['.pf-subs', '.pf-transports', '.pf-cost', '.pf-carbon', '.pf-jobs']) {
      const sec = page.locator(`.proof-panel ${sel}`).first();
      if (!(await sec.count())) {
        warnings.push(`couverture : bloc ${sel} absent de ce scénario (non vérifié)`);
        continue;
      }
      const notes = await sec.locator('.prov-note').allInnerTexts();
      if (!notes.some((n) => code.test(n))) fail(`bloc ${sel} sans ligne de source (code du manifeste attendu)`);
      await sec.scrollIntoViewIfNeeded();
      await shot(`28-couverture-${sel.slice(4)}`);
    }
    await shot('28-couverture-actif');
  });
  await step('29-couverture-trafic', proofUrl('&src=1', 'car_traffic'), async () => {
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    await page.waitForTimeout(2500);
    const notes = await page.locator('.proof-panel .pf-traffic .prov-note').allInnerTexts();
    if (!notes.some((n) => /ROAD01/.test(n))) fail(`bloc trafic sans la source ROAD01 : « ${notes.join(' | ').slice(0, 120)} »`);
    await page.locator('.proof-panel .pf-traffic').first().scrollIntoViewIfNeeded().catch(() => undefined);
  });
}

// Mode daltonien (couleurs adaptées, motion-spec « Mode daltonien ») : ?cv=1 (session, non mémorisé, retiré
// de l'adresse), ciel avec or ambre et seconde orbite (vélo + TC), liste et panneau de preuve d'un pôle doré,
// carte miroir ; puis le bouton de l'en-tête (aria-pressed, mémorisé), remis à l'état coupé à la fin.
const cvOrigin = computed.includes('78358') ? '78358' : c1;
const cvButton = 'button[aria-label="Couleurs adaptées au daltonisme"]';
const expectCv = async (on) => {
  const st = await page.evaluate(
    (sel) => ({
      attr: document.documentElement.dataset.cv ?? null,
      gain: getComputedStyle(document.documentElement).getPropertyValue('--gain').trim().toLowerCase(),
      pressed: document.querySelector(sel)?.getAttribute('aria-pressed') ?? null,
      search: location.search,
    }),
    cvButton,
  );
  if ((st.attr === '1') !== on) fail(`attribut data-cv : ${st.attr} (attendu ${on ? '1' : 'absent'})`);
  if (on && st.gain !== '#e8923a') fail(`--gain en mode daltonien : ${st.gain}`);
  if (st.pressed !== String(on)) fail(`bouton daltonien aria-pressed=${st.pressed}`);
  if (/[?&]cv=/.test(st.search)) fail('?cv= resté dans l’adresse (il serait copié dans les liens partagés)');
};
if (cvOrigin) {
  const cvSky = `/?o=${cvOrigin}&d=d09&b=60&m=bike_transit`;
  await step('25-daltonien-ciel', `${cvSky}&cv=1`, async () => {
    await page.waitForTimeout(2500);
    await expectCv(true);
    const legend = await page.locator('.legend').innerText().catch(() => '');
    if (!/Or : gain démontré/.test(legend)) warnings.push(`daltonien : aucun or sur ${cvSky} (pas de gain démontré à montrer)`);
  });
  await step('26-daltonien-preuve', `${cvSky}&cv=1`, async () => {
    await page.waitForTimeout(1500);
    await clickButton(/Lire le ciel en liste|Liste/);
    await page.waitForSelector('.sky-table', { timeout: 10000 });
    const gold = page.locator('.sky-table button[aria-label*="or : gain démontré"]');
    if (!(await gold.count())) {
      warnings.push('daltonien : aucun pôle doré dans la liste');
      return;
    }
    await shot('26a-daltonien-liste');
    await gold.first().click();
    await page.waitForSelector('.proof-panel', { timeout: 10000 });
    await page.waitForTimeout(1200);
    await expectText('Or : gain démontré', 'badge « Or : gain démontré » du panneau de preuve');
  });
  await step('27-daltonien-carte', `/?o=${cvOrigin}&d=d09&b=45&m=transit&v=map&cv=1`, async () => {
    await page.waitForTimeout(6000);
    await expectCv(true);
  });
  await step('28-daltonien-bouton', sc(cvOrigin), async () => {
    await expectCv(false);
    await page.locator(cvButton).first().click();
    await expectCv(true);
    const stored = await page.evaluate(() => localStorage.getItem('starway.cv'));
    if (stored !== 'on') fail(`choix daltonien non mémorisé : ${stored}`);
    await page.locator(cvButton).first().click();
    await expectCv(false);
  });
}

// Panneau de preuve, chantier « panneau-lignes » (04/11) : itinéraires gzip, lignes utilisées avec climatisation
// et ponctualité (mention ODbL), heure creuse, « Comparer les modes », détail replié ; réglage « confort »
// (itinéraires de meta.itineraries_variants.comfort). Le panneau s'ouvre sur un pôle avec un trajet détaillé.
const itinOrigin = (meta.itineraries_communes ?? []).includes('78358') ? '78358' : (meta.itineraries_communes ?? [])[0];
const itinPole = poles.find((p) => p.id === 'P_PARIS_QCA')?.id ?? poles[0]?.id;
const openFolds = async () => {
  for (const s of await page.locator('.proof-panel details.pf-fold').all()) await s.evaluate((d) => (d.open = true));
  await page.waitForTimeout(400);
};
if (itinOrigin && itinPole) {
  await step('29-preuve-lignes', `/?o=${itinOrigin}&d=d09&b=60&m=transit&p=${itinPole}`, async () => {
    await page.waitForSelector('.proof-panel .pf-lines', { timeout: 15000 });
    // La base du calcul (table OD ou access) se pose un instant après les lignes : on attend les blocs
    await page.waitForSelector('.proof-panel .pf-offpeak', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.proof-panel .pf-modes', { timeout: 15000 }).catch(() => {});
    await expectText('climatisation :', 'climatisation par ligne (TRA03)');
    await expectText('ponctualité', 'ponctualité par ligne (QS01)');
    await shot('29a-preuve-lignes-replie');
    await openFolds();
    // Lot 4 de l'audit d'affichage (10/11) : l'heure creuse est dans le pli « Comparer les moyens » : on la lit une fois les plis ouverts
    await expectText('En partant à 11h00', 'heure creuse (offpeak)');
    // Retours KBS du 10/11 : la mention ODbL des faits par ligne est dans le « i » de la liste des lignes (texte présent, bulle fermée)
    const linesTip = await page.locator('.proof-panel .pf-transports .pf-lines .info-pop').first().textContent().catch(() => '');
    if (!/ODbL/.test(linesTip ?? '')) fail('mention ODbL des faits par ligne absente du « i » des lignes');
    // Titre en capitales par la feuille de style (innerText rend le texte transformé) : comparaison sans casse
    // Audit d'affichage du 11/11 (M1) : le titre interne « Comparer les modes » est retiré, le pli s'appelle « Comparer les moyens »
    if (!/comparer les moyens/i.test(await page.evaluate(() => document.body.innerText))) fail('pli « Comparer les moyens » absent de la page');
    if (!(await page.locator('.pf-modes-table tbody tr').count())) fail('tableau « Comparer les modes » vide');
    const body = await page.locator('.proof-panel').innerText();
    if (/taux d.incident/i.test(body)) fail('« taux d’incident » affiché (le mot est « ponctualité »)');
    // Provenance coupée par défaut : aucune source des blocs chiffrés de la preuve (lignes, heure creuse, modes)
    if (await page.locator('.proof-panel .pf-lines ~ .prov-note, .proof-panel .pf-offpeak .prov-note, .proof-panel .pf-modes .prov-note').count())
      fail('provenance coupée : une source des lignes, de l’heure creuse ou des modes est affichée');
    if (/\((TRA03|QS01)\)/.test(body)) fail('provenance coupée : TRA03 ou QS01 cité dans la preuve');
    // Règle d'affichage finale du 11/11 (D-064, D5) : sans mode sources, la ligne « Données : » n'est plus au pied du panneau (elle reste en bas du ciel)
    if (body.split(String.fromCharCode(10)).some((l) => l.startsWith('Données : '))) fail('mode sources coupé : la ligne « Données : » est encore au pied du panneau');
    await page.locator('.proof-panel').evaluate((el) => (el.scrollTop = el.scrollHeight));
  });
  // Provenance activée (`?src=1`) : jeu, millésime et code de TRA03 et QS01, de l'heure creuse et des modes, avec lien vers la fiche
  await step('29s-preuve-lignes-provenance', `/?o=${itinOrigin}&d=d09&b=60&m=transit&p=${itinPole}&src=1`, async () => {
    await page.waitForSelector('.proof-panel .pf-lines', { timeout: 15000 });
    await page.waitForSelector('.proof-panel .pf-modes', { timeout: 15000 }).catch(() => {});
    await openFolds();
    const has = (sel) => page.locator(sel).count();
    if (!(await has('.proof-panel .pf-transports .prov-note a[href="#fiche-TRA03"]'))) fail('provenance : lien vers la fiche TRA03 absent sous les lignes');
    if (!(await has('.proof-panel .pf-transports .prov-note a[href="#fiche-QS01"]'))) fail('provenance : lien vers la fiche QS01 absent sous les lignes');
    if (!(await has('.proof-panel .pf-offpeak .prov-note a[href="#fiche-TRA01"]'))) fail('provenance : source de l’heure creuse absente');
    if (!(await has('.proof-panel .pf-modes .prov-note a[href="#fiche-TRA01"]'))) fail('provenance : source de « Comparer les modes » absente');
    const lineNote = await page.locator('.proof-panel .pf-transports .prov-note').first().innerText();
    if (!/QS01/.test(lineNote) || !/20\d{2}/.test(lineNote)) fail('provenance : millésime de la ponctualité absent');
    // Mode sources : « tout revient » (D-064, D8), dont la ligne « Données : » des producteurs au pied du panneau
    if (!(await page.locator('.proof-panel footer .pf-credits').filter({ hasText: /^Données : / }).count())) fail('mode sources : ligne « Données : » absente du pied du panneau');
    await page.locator('.proof-panel').evaluate((el) => (el.scrollTop = 0));
  });
  if ((meta.itineraries_variants?.comfort?.communes ?? []).includes(itinOrigin)) {
    await step('30-preuve-confort', `/?o=${itinOrigin}&d=d09&b=60&m=transit&w=comfort&p=${itinPole}`, async () => {
      await page.waitForSelector('.proof-panel .pf-lines', { timeout: 15000 });
      const t = await page.locator('.proof-panel').innerText();
      // Phrase de `itineraryUnavailableText('walk')` seulement (« Autres trajets : calculés pour le réglage de marche normal. » est voulu, 11/11)
      if (/Détail du trajet, coût au ticket et carbone : calculés pour le réglage de marche/.test(t)) fail('réglage « confort » : détail annoncé comme non calculé');
    });
  }
  await step('31-preuve-modes-velo', `/?o=${itinOrigin}&d=d09&b=60&m=bike&p=${itinPole}`, async () => {
    await page.waitForSelector('.proof-panel', { timeout: 15000 });
    await openFolds();
    if (!(await page.locator('.pf-modes-table tr.is-current').count())) fail('« Comparer les modes » : ligne du mode affiché absente');
  });
}

// Légende du compteur dans la barre (10/11, constat de Nicolas pendant la visite) : à 1280, 1366 et 1920 px de large, la
// pastille de variation affichée (budget remonté du minimum de la jauge à 60 min, comme le balayage de la visite), la légende
// tient dans la barre (trois lignes au plus) et la pastille ne recouvre pas le nombre. Mesure dans la page, aucun chiffre attendu.
// Depuis le 11/11 (site en ligne : pastille au-dessus de la barre, filet et « i » dessous), aussi à 1600, 1220, 820, 720 et 390 px : le
// nombre, le filet, son « i » et la pastille restent entre le haut et le bas de la barre.
if (computed.length) {
  const counterOrigin = computed.includes('78358') ? '78358' : computed[0];
  for (const [w, h] of [
    [1280, 720],
    [1366, 720],
    [1600, 900],
    [1920, 900],
    [1220, 800],
    [820, 900],
    [720, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await step(`32-compteur-legende-${w}x${h}`, `/?o=${counterOrigin}&d=d09&b=60&m=transit`, async () => {
      const range = page.locator('#budget-range');
      await range.fill(String(await range.getAttribute('min')));
      await page.waitForTimeout(2500);
      await range.fill('60');
      const badge = await page.waitForSelector('.scenario-bar .counter-badge', { timeout: 15000 }).then(() => true, () => false);
      if (!badge) warnings.push(`compteur ${w}x${h} : pas de pastille de variation (mesure sans elle)`);
      const m = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        const cap = document.querySelector('section.scenario-bar .counter-caption');
        const lh = cap ? parseFloat(getComputedStyle(cap).lineHeight) : 0;
        const badgeEl = document.querySelector('section.scenario-bar .counter-badge');
        const badgeLh = badgeEl ? parseFloat(getComputedStyle(badgeEl).lineHeight) : 0;
        return { bar: r('section.scenario-bar'), cap: r('section.scenario-bar .counter-caption'), num: r('section.scenario-bar .counter-value'), badge: r('section.scenario-bar .counter-badge'), gauge: r('section.scenario-bar .counter-gauge'), tip: r('section.scenario-bar .counter-gauge-tip .info-btn'), lh, badgeLh, vh: innerHeight };
      });
      if (!m.bar || !m.cap) return fail('légende du compteur introuvable dans la barre');
      if (m.cap.bottom > m.bar.bottom + 0.5 || m.cap.top < m.bar.top - 0.5 || m.cap.bottom > m.vh)
        fail(`légende du compteur hors de la barre (légende ${Math.round(m.cap.top)}-${Math.round(m.cap.bottom)} px, barre ${Math.round(m.bar.top)}-${Math.round(m.bar.bottom)} px)`);
      for (const [name, box] of [['nombre', m.num], ['filet', m.gauge], ['« i » du filet', m.tip], ['pastille de variation', m.badge]]) {
        if (box && (box.top < m.bar.top - 0.5 || box.bottom > m.bar.bottom + 0.5))
          fail(`compteur ${w}x${h} : ${name} hors de la barre (${Math.round(box.top)}-${Math.round(box.bottom)} px, barre ${Math.round(m.bar.top)}-${Math.round(m.bar.bottom)} px)`);
      }
      // pastille (12/11, échec sous Linux à 1280 px) : au moins 4 px de marge avec le haut et le bas de la barre, deux lignes au plus,
      // et jamais sur le « i » du filet
      if (m.badge && (m.badge.top < m.bar.top + 4 || m.badge.bottom > m.bar.bottom - 4))
        fail(`compteur ${w}x${h} : pastille de variation à moins de 4 px du bord de la barre (${Math.round(m.badge.top)}-${Math.round(m.badge.bottom)} px, barre ${Math.round(m.bar.top)}-${Math.round(m.bar.bottom)} px)`);
      if (m.badge && m.badgeLh && m.badge.height > 2 * m.badgeLh + 4) fail(`compteur ${w}x${h} : pastille de variation sur plus de deux lignes (${Math.round(m.badge.height)} px)`);
      if (m.badge && m.tip && m.badge.bottom > m.tip.top + 1 && m.badge.top < m.tip.bottom - 1 && m.badge.left < m.tip.right - 1 && m.badge.right > m.tip.left + 1)
        fail(`compteur ${w}x${h} : la pastille de variation recouvre le « i » du filet`);
      // trois lignes au plus sur la ligne unique (1280 px et plus) ; en dessous, la cellule du compteur grandit avec sa légende
      if (w >= 1280 && m.lh && m.cap.height > 3 * m.lh + 1) fail(`légende du compteur sur plus de trois lignes (${Math.round(m.cap.height / m.lh)})`);
      // nombre décimal de la légende (« 40,2 % ») : virgule décimale, jamais un point
      if (/\d\.\d/.test(await page.locator('section.scenario-bar .counter-caption').innerText())) fail('légende du compteur : nombre décimal écrit avec un point');
      // recouvrement réel des deux rectangles (la pastille peut être au-dessus, à côté ou sous le nombre selon la largeur)
      if (m.badge && m.num && m.badge.bottom > m.num.top + 1 && m.badge.top < m.num.bottom - 1 && m.badge.left < m.num.right - 1 && m.badge.right > m.num.left + 1)
        fail('la pastille de variation recouvre le nombre du compteur');
    });
  }
  await page.setViewportSize({ width: 1600, height: 900 });
}

// Inventaire des phrases (chantier C, « alléger sans rien perdre ») : une phrase de la référence qui n'est plus nulle part
// dans le panneau, la barre ou la légende, sans exception justifiée, fait échouer le test de fumée.
// Lent (rendu logiciel) : --sans-inventaire pour l'écarter pendant un travail en cours, jamais avant une PR.
if (!args.includes('--sans-inventaire')) {
  current = 'inventaire des phrases';
  const { runInventory } = await import('./panel-inventory.mjs');
  // --strict (lot 3, D-050) : les phrases de keep-visible.json doivent être lues sans rien ouvrir
  const inv = await runInventory({ browser, base, outDir, strict: true, log: (m) => console.log(m) });
  for (const f of inv.failures) fail(f);
  if (inv.report?.added?.length) console.log(`inventaire : ${inv.report.added.length} phrase(s) nouvelle(s) depuis la référence (information).`);
}

await browser.close();
stopServer();

for (const w of warnings) console.log(`attention : ${w}`);
if (failures.length) {
  console.error(`\n${failures.length} échec(s) :`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`Captures : ${outDir}`);
  process.exit(1);
}
console.log(`\nTest de fumée réussi. Captures : ${outDir}`);
