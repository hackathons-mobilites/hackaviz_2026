#!/usr/bin/env node
/**
 * Parcours « Mes réglages » (D-057), à lancer sous le verrou, sur un site construit (vite preview ou swa start) :
 *   node scripts/check-mes-reglages.mjs <url-de-base> <dossier-captures>
 * Cas : premier usage, brouillon, Annuler, Échap, enregistrement, confirmation, rechargement, ancien localStorage,
 * clavier complet du tiroir, rappels du panneau, visite avec des réglages actifs, 1280 x 720 et 390 px.
 * Code 1 si un contrôle échoue.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const here = fileURLToPath(new URL('.', import.meta.url));
const pw = resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pw).href);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] });

const results = [];
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'OK ' : 'ECHEC'} ${name}${extra ? ` : ${extra}` : ''}`);
  console.log(results.at(-1));
};
const errs = [];

const SKY = `${base}/?o=78358&d=d09&b=60&m=transit`;
const PROOF = `${SKY}&p=BE_1146`;

async function newPage(w, h, init) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', hasTouch: w < 500, isMobile: w < 500 });
  await ctx.addInitScript((data) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  }, init ?? {});
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errs.push(`console: ${m.text()}`));
  return { ctx, page };
}
const store = (page) => page.evaluate(() => ({ subs: localStorage.getItem('starway.subscriptions'), needs: localStorage.getItem('starway.needs.v3') }));
const ready = async (page) => {
  await page.waitForSelector('.scenario-bar .bar-toggle', { state: 'visible', timeout: 180000 });
  await page.waitForTimeout(5000);
};
const openDrawer = async (page) => {
  if ((await page.locator('.bar-toggle').getAttribute('aria-expanded')) !== 'true') await page.locator('.bar-toggle').click();
  await page.waitForSelector('.drawer-settings', { state: 'visible', timeout: 15000 });
};
const summary = (page) => page.locator('.drawer-settings-summary').innerText();
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const openFold = (page, id) => page.evaluate((i) => { const d = document.querySelector(`.pf-group[data-group="${i}"] details`); if (d) d.open = true; }, id);
const astres = (page) => page.evaluate(() => [...document.querySelectorAll('.pole-hit')].map((b) => { const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','); }).join(';'));

// ---------- 1. premier usage
{
  const { ctx, page } = await newPage(1280, 720);
  await page.goto(SKY, { timeout: 180000 });
  await ready(page);
  await openDrawer(page);
  ok('premier usage : résumé', (await summary(page)) === 'Aucun réglage', await summary(page));
  ok('premier usage : bouton Choisir', (await page.locator('.drawer-settings-btn').innerText()) === 'Choisir');
  await shot(page, '01-tiroir-premier-usage-1280');
  const before = await astres(page);
  await page.locator('.drawer-settings-btn').click();
  await page.waitForSelector('.subs-dialog');
  await page.waitForTimeout(400);
  ok('aide une ligne', (await page.locator('.settings-help').innerText()).includes('puis enregistrez'));
  const helpBox = await page.locator('.settings-help').boundingBox();
  ok('aide tient sur une ligne à 1280', helpBox.height < 60, `${helpBox.height}px`);
  ok('Enregistrer visible sans défiler', await page.locator('.settings-actions .btn-primary').isVisible());
  const saveBox = await page.locator('.settings-actions .btn-primary').boundingBox();
  ok('actions dans la fenêtre', saveBox.y + saveBox.height <= 720, JSON.stringify(saveBox));
  await shot(page, '02-dialogue-abonnements-1280');

  // ---------- 2. brouillon, Annuler
  await page.locator('.subs-radio', { hasText: 'Navigo Annuel' }).first().click();
  ok('brouillon : rien en localStorage', (await store(page)).subs === null, JSON.stringify(await store(page)));
  ok('brouillon : onglet montre le choix', (await page.locator('.settings-tab').first().innerText()).includes('Navigo Annuel'));
  await page.locator('.settings-actions .btn-secondary').click();
  await page.waitForTimeout(300);
  ok('Annuler ferme', (await page.locator('.subs-dialog').count()) === 0);
  ok('Annuler : rien enregistré', (await store(page)).subs === null);
  ok('Annuler : résumé inchangé', (await summary(page)) === 'Aucun réglage');
  ok('Annuler : focus rendu au bouton', await page.evaluate(() => document.activeElement?.classList.contains('drawer-settings-btn')));

  // ---------- 3. Échap avec brouillon
  await page.locator('.drawer-settings-btn').click();
  await page.waitForSelector('.subs-dialog');
  await page.locator('.subs-radio', { hasText: 'Navigo Annuel' }).first().click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Échap ferme sans enregistrer', (await page.locator('.subs-dialog').count()) === 0 && (await store(page)).subs === null);
  ok('Échap ne replie pas le tiroir', (await page.locator('.bar-toggle').getAttribute('aria-expanded')) === 'true');

  // ---------- 4. fond : avec brouillon, ne ferme pas
  await page.locator('.drawer-settings-btn').click();
  await page.waitForSelector('.subs-dialog');
  await page.locator('.subs-radio', { hasText: 'Navigo Annuel' }).first().click();
  await page.mouse.click(40, 300);
  await page.waitForTimeout(200);
  ok('clic sur le fond avec brouillon : reste ouvert', (await page.locator('.subs-dialog').count()) === 1);

  // ---------- 5. Enregistrer abonnement + besoins
  await page.locator('.settings-tab').nth(1).click();
  await page.waitForTimeout(150);
  await shot(page, '03-dialogue-besoins-1280');
  await page.locator('.pf-needs-item', { hasText: 'Arrêts déclarés' }).click();
  await page.locator('.pf-needs-item', { hasText: 'Annonces sonores' }).click();
  ok('brouillon besoins : aucune marque', (await page.locator('.needs-mark-shape').count()) === 0);
  ok('brouillon besoins : rien en localStorage', (await store(page)).needs === null);
  await page.locator('.settings-actions .btn-primary').click();
  await page.waitForTimeout(500);
  const toast = await page.locator('.settings-toast').innerText();
  ok('confirmation visible', toast === 'Enregistré dans ce navigateur', toast);
  await shot(page, '04-enregistre-confirmation-1280');
  const s = await store(page);
  ok('enregistré', s.subs?.includes('"transit"') && s.needs?.includes('wc_stops') && s.needs?.includes('audio'), JSON.stringify(s));
  ok('résumé après', (await summary(page)).includes('Navigo Annuel') && (await summary(page)).includes('2 besoins'), await summary(page));
  ok('bouton devient Modifier', (await page.locator('.drawer-settings-btn').innerText()) === 'Modifier');
  ok('focus rendu', await page.evaluate(() => document.activeElement?.classList.contains('drawer-settings-btn')));
  ok('URL sans réglage', !/navigo|transit=|needs|subs/i.test(page.url()), page.url());
  await page.waitForTimeout(5000);
  const after = await astres(page);
  ok('positions et tailles des astres identiques', before.length > 0 && before === after);
  const marks = await page.locator('.needs-mark-shape').count();
  console.log(`marques après enregistrement : ${marks}`);
  console.log('legende:', await page.locator('.legend').innerText().catch(() => ''));
  await page.waitForTimeout(4500);
  ok('confirmation disparaît', (await page.locator('.settings-toast').innerText()) === '');

  // ---------- 6. recharger
  await page.reload();
  await ready(page);
  await openDrawer(page);
  ok('rechargé : résumé gardé', (await summary(page)).includes('Navigo Annuel') && (await summary(page)).includes('2 besoins'), await summary(page));
  await shot(page, '05-tiroir-apres-rechargement-1280');
  await ctx.close();
}

// ---------- 7. ancien localStorage et identifiant retiré
{
  const { ctx, page } = await newPage(1280, 720, { 'starway.subscriptions': JSON.stringify({ transit: 'imagine_r_student', velib: 'identifiant-retire' }), 'starway.needs.v3': JSON.stringify(['audio', 'wc_trip', 'inconnu']), 'starway.needs': JSON.stringify(['fauteuil']) });
  await page.goto(SKY, { timeout: 180000 });
  await ready(page);
  await openDrawer(page);
  const s = await summary(page);
  ok('ancien stockage relu', /besoins/.test(s), s);
  ok('ancienne clé des besoins purgée', (await page.evaluate(() => localStorage.getItem('starway.needs'))) === null);
  console.log('résumé ancien stockage :', s);
  await ctx.close();
}

// ---------- 8. clavier complet du tiroir
{
  const { ctx, page } = await newPage(1280, 720);
  await page.goto(SKY, { timeout: 180000 });
  await ready(page);
  await page.locator('.bar-toggle').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.drawer-settings', { state: 'visible' });
  const seen = [];
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => { const a = document.activeElement; return { c: a?.className ?? '', t: a?.getAttribute('aria-label') ?? a?.innerText ?? a?.id ?? '', v: !!a?.closest('.bar-drawer') }; });
    seen.push(`${d.v ? 'tiroir' : 'hors'}:${String(d.t).slice(0, 28)}`);
    if (String(d.c).includes('drawer-settings-btn')) reached = true;
  }
  console.log('ordre Tab :', seen.join(' > '));
  ok('Tab atteint Mes réglages', reached);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.subs-dialog');
  await page.waitForTimeout(200);
  ok('focus initial sur l’onglet actif', await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement?.getAttribute('aria-selected') === 'true'));
  await page.keyboard.press('ArrowRight');
  ok('flèche : onglet besoins', (await page.evaluate(() => document.activeElement?.innerText)).includes("Ce qu'il me faut"));
  await page.keyboard.press('Tab');
  ok('Tab entre dans la partie', await page.evaluate(() => document.activeElement?.type === 'checkbox' || !!document.activeElement?.closest('.settings-body')));
  await page.keyboard.press('Space');
  ok('Espace coche', await page.evaluate(() => document.activeElement?.type === 'checkbox' && document.activeElement?.checked));
  let saved = false;
  for (let i = 0; i < 20 && !saved; i++) {
    await page.keyboard.press('Tab');
    saved = await page.evaluate(() => document.activeElement?.classList.contains('btn-primary'));
  }
  ok('Tab atteint Enregistrer', saved);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const trapped = await page.evaluate(() => !!document.activeElement?.closest('.subs-dialog'));
  ok('piège de focus boucle', trapped);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Échap referme, focus sur le bouton', await page.evaluate(() => document.activeElement?.classList.contains('drawer-settings-btn')));
  ok('Échap : rien enregistré', (await store(page)).needs === null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('second Échap replie le tiroir', (await page.locator('.bar-toggle').getAttribute('aria-expanded')) === 'false');
  await ctx.close();
}

// ---------- 9. panneau : rappel d'une ligne et Modifier
{
  const { ctx, page } = await newPage(1280, 720);
  await page.goto(PROOF, { timeout: 180000 });
  await page.waitForSelector('.proof-panel', { timeout: 180000 });
  await page.waitForTimeout(6000);
  await openFold(page, 'besoins');
  await page.waitForTimeout(300);
  const recall = page.locator('.proof-panel .pf-needs-recall');
  ok('panneau : rappel', (await recall.count()) === 1 && (await recall.innerText()).includes('Mes besoins'), await recall.innerText());
  ok('panneau : plus de cases', (await page.locator('.proof-panel .pf-needs input[type=checkbox]').count()) === 0);
  await recall.scrollIntoViewIfNeeded();
  await shot(page, '06-panneau-rappel-1280');
  await recall.getByRole('button', { name: 'Modifier' }).click();
  await page.waitForSelector('.subs-dialog');
  await page.waitForTimeout(200);
  ok('Modifier ouvre les besoins', (await page.locator('.settings-tab[aria-selected=true]').innerText()).includes("Ce qu'il me faut"));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Échap garde le panneau', (await page.locator('.proof-panel').count()) === 1);
  await page.evaluate(() => { const d = document.querySelector('.pf-group[data-group="cout"] details'); if (d) d.open = true; });
  await page.waitForTimeout(300);
  // Audit d'affichage du 10/11 : la ligne « Mes abonnements : … » a laissé place à un bouton « Mes réglages » ou « Modifier » sur la ligne de coût
  const subsLine = page.locator('.proof-panel .subs-settings-btn').first();
  if (await subsLine.count()) {
    console.log('ligne abonnements :', await subsLine.locator('xpath=..').innerText());
    await subsLine.click();
    await page.waitForSelector('.subs-dialog');
    ok('Modifier ouvre les abonnements', (await page.locator('.settings-tab[aria-selected=true]').innerText()).includes('Mes abonnements'));
    await page.keyboard.press('Escape');
  } else ok('ligne abonnements présente', false);
  await ctx.close();
}

// ---------- 10. barre du haut, mode sources
{
  const { ctx, page } = await newPage(1280, 720);
  await page.goto(SKY, { timeout: 180000 });
  await ready(page);
  await page.locator('.subs-top').click();
  await page.waitForSelector('.subs-dialog');
  await page.waitForTimeout(200);
  await page.locator('.settings-tab').nth(1).click();
  const plain = await page.locator('.settings-body').innerText();
  ok('hors mode sources : pas de nom de source', !/IDFM|GTFS|TRA0/.test(plain), plain.match(/IDFM|GTFS|TRA0/)?.[0] ?? '');
  await ctx.close();
}

// ---------- 11. visite lancée avec des réglages actifs
{
  const { ctx, page } = await newPage(1280, 720, { 'starway.subscriptions': JSON.stringify({ transit: 'navigo_annual', velib: null }), 'starway.needs.v3': JSON.stringify(['wc_stops', 'audio']) });
  await page.goto(`${base}/`, { timeout: 180000 });
  await page.getByRole('button', { name: /Lancer la visite/ }).first().click({ timeout: 90000 });
  await page.locator('.tour-choice-option[data-tour-version="lea"]').click({ timeout: 30000 });
  await page.waitForFunction(() => /[?&]o=/.test(location.search) || document.querySelector('.tour-overlay, [class*=tour]'), null, { timeout: 90000 });
  await page.waitForTimeout(9000);
  ok('visite : lien du haut absent', (await page.locator('.subs-top').count()) === 0);
  ok('visite : entrée du tiroir absente', (await page.locator('.drawer-settings').count()) === 0);
  ok('visite : pas de marques', (await page.locator('.needs-mark-shape').count()) === 0);
  ok('visite : URL sans réglage', !/navigo|needs|wc_/i.test(page.url()), page.url());
  const stored = await store(page);
  ok('visite : réglages conservés', stored.subs?.includes('navigo_annual') && stored.needs?.includes('audio'));
  await shot(page, '07-visite-avec-reglages-1280');
  // le panneau peut s'ouvrir à une étape : on cherche la ligne personnelle pendant 60 s
  let personal = false;
  for (let i = 0; i < 30 && !personal; i++) {
    personal = (await page.locator('.subs-settings-btn, .pf-needs-recall').count()) > 0;
    await page.waitForTimeout(2000);
  }
  ok('visite : aucune ligne personnelle dans le panneau', !personal);
  await ctx.close();
}

// ---------- 12. 390 px
{
  const { ctx, page } = await newPage(390, 844);
  await page.goto(SKY, { timeout: 180000 });
  await ready(page);
  await openDrawer(page);
  await page.locator('.drawer-settings').scrollIntoViewIfNeeded();
  await shot(page, '08-tiroir-390');
  await page.locator('.drawer-settings-btn').click();
  await page.waitForSelector('.subs-dialog');
  await page.waitForTimeout(300);
  await shot(page, '09-dialogue-abonnements-390');
  const save = await page.locator('.settings-actions .btn-primary').boundingBox();
  ok('390 : Enregistrer dans la fenêtre', save.y + save.height <= 844, JSON.stringify(save));
  const over = await page.evaluate(() => document.querySelector('.subs-dialog').scrollWidth - document.querySelector('.subs-dialog').clientWidth);
  ok('390 : pas de débordement', over <= 0, `${over}px`);
  await page.locator('.settings-tab').nth(1).click();
  await page.waitForTimeout(200);
  await shot(page, '10-dialogue-besoins-390');
  await page.locator('.pf-needs-item', { hasText: 'Annonces sonores' }).click();
  await page.locator('.settings-actions .btn-primary').click();
  await page.waitForTimeout(400);
  await shot(page, '11-confirmation-390');
  ok('390 : confirmation', (await page.locator('.settings-toast').innerText()) === 'Enregistré dans ce navigateur');
  await ctx.close();
}

console.log('\nerreurs console/page :', errs.length ? [...new Set(errs)].slice(0, 12).join('\n') : 'aucune');
console.log(`\n${results.filter((r) => r.startsWith('OK')).length} OK, ${results.filter((r) => r.startsWith('ECHEC')).length} ECHEC`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
process.exit(results.some((r) => r.startsWith('ECHEC')) ? 1 : 0);
