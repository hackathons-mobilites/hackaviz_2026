#!/usr/bin/env node
/**
 * Contrôle du ciel à 44 astres (D-030, seul ciel depuis D-054), en complément de smoke.mjs :
 *
 *   node scripts/smoke44.mjs <url-de-base>
 *
 * Échoue (code 1) si :
 * - le ciel n'annonce pas 44 pôles ;
 * - un mode pas encore calculé pour une commune affiche un résultat par pôle ;
 * - la carte miroir perd le contour d'astre, la bulle d'un rond ou celle d'une commune ;
 * - erreur console, ou fichier de données absent ;
 * - un ancien lien (`?astres=15`, ou un pôle `p=P_...` qui n'existe plus) n'affiche pas le ciel à 44 astres.
 */
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const pwPath = resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(pwPath).href);

const base = process.argv[2];
if (!base) {
  console.error('Usage : node scripts/smoke44.mjs <url-de-base>');
  process.exit(2);
}
const root = base.endsWith('/') ? base : `${base}/`;
const scenario = 'o=78358&d=d09&b=60';
const failures = [];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] });

async function summary(query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => {
    if (m.type() === 'error') failures.push(`${query} : erreur console : ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => failures.push(`${query} : erreur de page : ${String(e).slice(0, 200)}`));
  page.on('response', (r) => {
    const missing = r.status() >= 400 || (r.url().endsWith('.bin') && (r.headers()['content-type'] ?? '').includes('text/html'));
    if (missing && r.url().includes('/data/')) failures.push(`${query} : fichier absent (${r.status()}) : ${r.url()}`);
  });
  await page.goto(`${root}${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => /Depuis [^\n]+(atteints aller et retour|accessibles aller et retour|pas encore calculé)/.test(document.body.innerText), undefined, { timeout: 60000 });
  const text = await page.evaluate(() => document.body.innerText);
  await page.close();
  return text.match(/Depuis [^\n]+/)[0];
}

try {
  const sky44 = await summary(`?${scenario}&m=transit`);
  console.log(`44 : ${sky44}`);
  if (!/sur 44/.test(sky44)) failures.push(`le ciel n'annonce pas 44 pôles : ${sky44}`);
  // Anciens liens : le paramètre retiré est ignoré, un pôle disparu n'ouvre rien, le ciel reste celui des 44 astres
  const oldParam = await summary(`?astres=15&${scenario}&m=transit`);
  const oldPole = await summary(`?${scenario}&m=transit&p=P_PARIS_QCA`);
  if (oldParam !== sky44) failures.push(`?astres=15 change le ciel :\n  ${oldParam}\n  ${sky44}`);
  if (oldPole !== sky44) failures.push(`p=P_... change le ciel :\n  ${oldPole}\n  ${sky44}`);

  // Vélo + TC : mode partiel tant que meta.mode_coverage en donne la liste (une commune hors liste ne montre jamais une
  // série par pôle) ; sans liste (flux du 06/11 : calculé pour toutes les communes), une commune quelconque montre son
  // résultat par pôle sur les 44 astres
  const meta44 = await (await fetch(`${root}data/meta.json`)).json();
  const bikeList = meta44.mode_coverage?.bike_transit;
  if (bikeList) {
    const bikeOther = (meta44.access_communes ?? []).find((c) => !bikeList.includes(c));
    const notRecomputed = await summary(`?o=${bikeOther}&d=d09&b=60&m=bike_transit`);
    console.log(`44 (défaut), vélo + TC (${bikeOther}, hors des ${bikeList.length} communes calculées) : ${notRecomputed}`);
    if (/sur 44 accessibles/.test(notRecomputed)) failures.push(`résultat par pôle sans calcul vélo + TC publié : ${notRecomputed}`);
  } else {
    const anyCommune = (meta44.access_communes ?? [])[0];
    const bikeAll = await summary(`?o=${anyCommune}&d=d09&b=60&m=bike_transit`);
    console.log(`44 (défaut), vélo + TC (${anyCommune}, calculé pour toutes les communes) : ${bikeAll}`);
    if (!/vélo \+ transports en commun : \d+ pôles? sur 44 accessibles aller et retour/.test(bikeAll)) failures.push(`vélo + TC publié partout, mais pas de résultat par pôle : ${bikeAll}`);
  }

  // Carte miroir (D-030) : contour d'astre expliqué en légende, bulle d'un rond (astre, bassin, communes, postes),
  // survol d'une commune (son astre).
  async function mapChecks(query, expectAstres) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (e) => failures.push(`${query} : erreur de page : ${String(e).slice(0, 200)}`));
    await page.goto(`${root}${query}`, { waitUntil: 'load' });
    await page.waitForSelector('.mirror-legend', { timeout: 60000 });
    await page.waitForTimeout(1500);
    const legend = await page.locator('.mirror-legend').innerText();
    const hasLegend = /Contour épais : communes regroupées dans un astre/.test(legend);
    if (hasLegend !== expectAstres) failures.push(`${query} : ligne de légende du contour d'astre ${hasLegend ? 'présente' : 'absente'}`);
    await page.locator('.mirror-hit').first().focus();
    await page.waitForTimeout(500);
    const tip = (await page.locator('.mirror-tip').first().innerText().catch(() => '')) ?? '';
    const poleTip = /bassin [^\n]+/.test(tip) && /communes?, [\d\s\u202f\u00a0]+ postes salariés \(INSEE\)/.test(tip);
    if (poleTip !== expectAstres) failures.push(`${query} : bulle d'un rond ${poleTip ? 'avec' : 'sans'} bassin, communes et postes : ${tip.replace(/\n/g, ' | ').slice(0, 200)}`);
    if (expectAstres) {
      await page.keyboard.press('Tab');
      // un point de commune non recouvert par un rond ni par un contour d'astre (le centre du tracé l'est souvent)
      const spot = await page.evaluate(() => {
        for (const path of document.querySelectorAll('.mirror-communes path.mc-accessible')) {
          const r = path.getBoundingClientRect();
          for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.2], [0.5, 0.8]]) {
            const x = r.x + r.width * fx;
            const y = r.y + r.height * fy;
            if (document.elementFromPoint(x, y) === path) return { x, y };
          }
        }
        return null;
      });
      if (spot) {
        await page.mouse.move(spot.x, spot.y);
        await page.waitForTimeout(500);
        const ctip = await page.locator('.mirror-tip-commune').innerText().catch(() => '');
        if (!/Astre [^\n]+, bassin [^\n]+/.test(ctip)) failures.push(`${query} : survol d'une commune sans son astre : ${ctip.replace(/\n/g, ' | ').slice(0, 200)}`);
      } else failures.push(`${query} : aucune commune atteinte survolable`);
    }
    await page.close();
  }
  await mapChecks(`?${scenario}&m=transit&v=map`, true);
} catch (e) {
  failures.push(String(e).slice(0, 300));
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nContrôle 44 astres en échec :\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nContrôle 44 astres réussi.');
