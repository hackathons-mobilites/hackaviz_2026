#!/usr/bin/env node
/**
 * Contrôle automatique de STARWAY : ce qui est affiché à l'écran correspond-il aux données publiées ?
 *
 *   node frontend/scripts/verifier-affichage.mjs <URL> [--rapide] [--graine=N] [--cas=N] [--rapport=chemin.md] [--filtre=texte]
 *   ex. node frontend/scripts/verifier-affichage.mjs https://jolly-cliff-07f518503.5.azurestaticapps.net --rapide
 *
 * Principe : un ORACLE INDÉPENDANT (`verifier-affichage/oracle.mjs`) recalcule chaque valeur depuis les JSON publiés sur l'URL visée et
 * les règles écrites dans docs/ ; un navigateur (Playwright, un seul, sans parallélisme) ouvre chaque scénario et lit le DOM.
 * Aucune fonction du front n'est importée. Sortie non nulle au moindre écart (1) ou erreur technique (2), avec le scénario à rejouer.
 * Détail : docs/verifier-affichage.md.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CAS_RECHERCHES, casAleatoires, casDesTrouvailles, casExplicites, chercherCasParticuliers, generateur } from './verifier-affichage/echantillon.mjs';
import { GRAVITE, Journal, controlerAlternatives, controlerCiel, controlerOr, controlerPreuve } from './verifier-affichage/controles.mjs';
import { attendreStable, cielStable, lireCiel, lirePreuve, ouvrirAstre, preuveStable } from './verifier-affichage/lecture.mjs';
import { Oracle } from './verifier-affichage/oracle.mjs';
import { OR_GAIN_ACTIF, SEL, STOCKAGE } from './verifier-affichage/selecteurs.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Playwright est installé sous tools/record-tour (voir smoke.mjs) ; depuis un arbre de travail sans node_modules, on prend celui du dépôt principal. */
function trouverPlaywright() {
  const candidats = [
    process.env.STARWAY_PLAYWRIGHT,
    resolve(here, '../../tools/record-tour/node_modules/playwright/index.mjs'),
    resolve(here, '../../../hackaton/tools/record-tour/node_modules/playwright/index.mjs'),
    resolve(here, '../../../../hackaton/tools/record-tour/node_modules/playwright/index.mjs'),
  ].filter(Boolean);
  for (const c of candidats) if (existsSync(c)) return c;
  throw new Error('Playwright introuvable : installer tools/record-tour (npm ci) ou poser STARWAY_PLAYWRIGHT=chemin/vers/index.mjs');
}

const args = process.argv.slice(2);
const opt = (nom) => args.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const positional = args.filter((a) => !a.startsWith('--'));
const base = (positional[0] ?? '').replace(/\/$/, '');
const rapide = args.includes('--rapide');
const graine = Number(opt('graine') ?? 20261113);
const nbAlea = opt('cas') != null ? Number(opt('cas')) : rapide ? 0 : 240;
const rapportChemin = opt('rapport') ?? null;
const filtre = opt('filtre') ?? null;
const orActif = args.includes('--or-gain=actif') || (OR_GAIN_ACTIF && !args.includes('--or-gain=attente'));
if (!base) {
  console.error('Usage : node frontend/scripts/verifier-affichage.mjs <URL> [--rapide] [--graine=N] [--cas=N] [--rapport=chemin] [--filtre=texte]');
  process.exit(2);
}

const debut = Date.now();
console.log(`STARWAY - contrôle de l'affichage\nURL : ${base}\nmode : ${rapide ? 'rapide' : 'complet'}, graine ${graine}\n`);

const oracle = await new Oracle(base).charger();
console.log(`Données : ${oracle.communes.length} communes, ${oracle.poles.length} astres, jeu ${oracle.meta.dataset_id ?? '?'} (${oracle.meta.generated_at})`);
console.log(`Trajets alternatifs : ${oracle.altCouverture ? 'publiés, contrôle actif' : 'non publiés (coverage.json absent), contrôle inactif'}`);
console.log(`Or du gain (D-056) : ${orActif ? 'contrôle actif' : 'contrôle en attente de front/or-gain-commune (rapporté à part, ne fait pas échouer)'}\n`);

const g = generateur(graine);
const maxScan = rapide ? 70 : 500;
const trouve = await chercherCasParticuliers(oracle, g, maxScan);
const nonTrouves = CAS_RECHERCHES.filter((k) => !trouve[k]);
console.log(`Cas particuliers trouvés après ${maxScan} fichiers au plus : ${Object.keys(trouve).length}${nonTrouves.length ? ` ; non trouvés : ${nonTrouves.join(', ')}` : ''}`);

let liste = [...casExplicites(oracle, base, { rapide }), ...casDesTrouvailles(trouve, base)];
if (rapide) {
  // Mode rapide : une liste réduite de cas, un par catégorie importante (quelques minutes)
  const garde = ['commune du récit', 'découverte', 'TC confort', 'marche', 'voiture trafic moyen', 'deux-roues sur', 'deux-roues', 'vélo + TC hors', 'vélo + TC', "Vélib' hors", "Vélib'", 'vélo', 'poste de nuit', 'horaires libres', 'commune de Paris', 'abonnement qui couvre', 'aéroport avec Navigo', 'Navigo Jour', 'Orlyval', 'ticket non calculé', 'carbone non calculé', 'péage en fourchette', 'péage inconnu', 'besoins cochés', 'astre réellement marqué', 'mode sources activé', 'aucun trajet dans'];
  liste = liste.filter((c) => garde.some((g2) => c.tag.includes(g2)));
  const seul = new Set();
  liste = liste.filter((c) => {
    const k = garde.find((g2) => c.tag.includes(g2));
    if (seul.has(k)) return false;
    seul.add(k);
    return true;
  });
}
liste = [...liste, ...casAleatoires(oracle, base, g, nbAlea)];
if (filtre) liste = liste.filter((c) => c.tag.includes(filtre) || c.urlPage().includes(filtre));
// Reprise d'une exécution interrompue : même graine, on repart du cas N (numérotation du journal)
const depuis = Number(opt('depuis') ?? 1);
if (depuis > 1) liste = liste.slice(depuis - 1);
console.log(`Scénarios à jouer : ${liste.length}${depuis > 1 ? ` (reprise au cas ${depuis})` : ''}\n`);

const { chromium } = await import(pathToFileURL(trouverPlaywright()).href);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
const page = await context.newPage();
const detail = args.includes('--detail');
// Images et sons décoratifs inutiles à la vérification : la page se charge plus vite sur un poste chargé
await page.route(/\/assets\/(img|audio)\//, (r) => r.abort());
await page.route(/\.(mp3|vtt)$/, (r) => r.abort());
const erreursPage = [];
page.on('pageerror', (e) => erreursPage.push(e.message.slice(0, 200)));

const journal = new Journal();
const techniques = [];
let cible = 0;

/** Page légère du domaine, pour le localStorage (après une coupure réseau ou une mise en veille, la page est sur un document d'erreur) */
async function revenirSurLeDomaine() {
  for (let essai = 1; ; essai++) {
    try {
      await page.goto(`${base}/data/meta.json`, { waitUntil: 'commit', timeout: 120000 });
      return;
    } catch (e) {
      if (essai >= 5) throw e;
      await new Promise((r) => setTimeout(r, 15000 * essai));
    }
  }
}

async function poserReglages(cas) {
  if (!page.url().startsWith(base)) await revenirSurLeDomaine();
  // localStorage : mêmes clés que le site, posées sur le même domaine avant de charger la page
  await page.evaluate(
    ([keys, sub, needs]) => {
      localStorage.setItem(keys.abonnements, JSON.stringify(sub));
      localStorage.setItem(keys.besoins, JSON.stringify(needs));
    },
    [STOCKAGE, { transit: cas.transit, velib: cas.velib }, cas.needs ?? []],
  );
}

await revenirSurLeDomaine();

const debutCas = Date.now();
let total = liste.length;
for (let k = 0; k < liste.length; k++) {
  const cas = liste[k];
  total = liste.length;
  cible = k + 1;
  const debutUn = Date.now();
  const lire = `[${cible}/${total}] ${cas.tag} : ${cas.urlPage()}`;
  try {
    await poserReglages(cas);
    const cielAttendu = await oracle.ciel(cas);
    await page.goto(cas.urlPage(), { waitUntil: 'load', timeout: 120000 });
    if (detail) console.log(`  page chargée en ${Date.now() - debutUn} ms`);
    const lu = await cielStable(page);
    if (detail) console.log(`  ciel stable en ${Date.now() - debutUn} ms`);
    const marques = await oracle.marques(cas, cielAttendu);
    controlerCiel(journal, cas, cielAttendu, lu, marques, oracle.poles);

    if (cas.m === 'bike_transit' && !cas.s) {
      const or = await oracle.orAttendu(cas, cielAttendu);
      if (or) {
        // L'or est peint après la transition du ciel : il faut le laisser arriver avant de lire
        if (or.length) await page.waitForFunction((s) => [...document.querySelectorAll(s)].some((b) => b.getAttribute('aria-label')?.includes('or : gain')), SEL.astre, { timeout: 10000 }).catch(() => {});
        else await new Promise((r) => setTimeout(r, 2500));
        controlerOr(journal, cas, or, await lireCiel(page), oracle.poles, orActif);
      }
    }

    const polesUniques = [...new Set(cas.poles)];
    for (const [i, poleId] of polesUniques.entries()) {
      if (i > 0) {
        await ouvrirAstre(page, oracle.parPole.get(poleId).i);
      }
      await page.waitForSelector(SEL.preuve, { timeout: 30000 }).catch(() => {});
      let luP = await preuveStable(page).catch(() => null);
      if (detail) console.log(`  panneau ${poleId} stable en ${Date.now() - debutUn} ms`);
      const exp = await oracle.preuve(cas, poleId, cielAttendu);
      // Titre différent : la page n'a pas encore pris en compte le clic
      if (luP && exp.titre && luP.titre !== exp.titre) {
        await attendreStable(page, lirePreuve, (p) => (p?.titre === exp.titre ? p.texteComplet : ''), { minimum: 2, delai: 15000 }).catch(() => null);
        luP = await lirePreuve(page);
      }
      // Bloc asynchrone (itinéraires, péages, abonnements) : relit une fois en cas d'écart pour écarter une lecture trop tôt
      const j2 = new Journal();
      controlerPreuve(j2, cas, exp, luP);
      if (j2.ecarts.length) {
        await new Promise((r) => setTimeout(r, 1500));
        luP = await lirePreuve(page);
      }
      controlerPreuve(journal, cas, exp, luP);
      // Trajets alternatifs : TC, réglage de marche normal, journée-type seulement (contrat alternatives-1)
      if (cas.m === 'transit' && cas.s == null && !cas.w) controlerAlternatives(journal, cas, oracle.altCouverture, poleId, luP);
    }
    console.log(`${lire} - ok (${((Date.now() - debutUn) / 1000).toFixed(1)} s, ${journal.controles} contrôles)`);
  } catch (e) {
    if (!cas.reessaye) {
      cas.reessaye = true;
      liste.splice(cible, 0, cas);
      console.log(`${lire} - relancé une fois après une erreur technique : ${String(e.message ?? e).split('\n')[0]}`);
      continue;
    }
    techniques.push({ url: cas.urlPage(), tag: cas.tag, message: String(e.message ?? e).split('\n')[0] });
    console.log(`${lire} - ERREUR TECHNIQUE : ${String(e.message ?? e).split('\n')[0]}`);
  }
}
const duree = ((Date.now() - debut) / 1000).toFixed(0);
const parGravite = { [GRAVITE.BLOQUANT]: [], [GRAVITE.MAJEUR]: [], [GRAVITE.MINEUR]: [] };
for (const e of journal.ecarts) parGravite[e.gravite].push(e);

const lignes = [];
const titre = (t) => lignes.push('', `## ${t}`, '');
lignes.push(`# Contrôle de l'affichage - ${base}`, '', `Jeu : ${oracle.meta.dataset_id ?? '?'} (${oracle.meta.generated_at}), graine ${graine}, ${liste.length} scénarios, ${journal.controles} contrôles, ${duree} s.`, '', `Écarts : ${journal.ecarts.length} (bloquants ${parGravite.BLOQUANT.length}, majeurs ${parGravite.MAJEUR.length}, mineurs ${parGravite.MINEUR.length}) ; erreurs techniques : ${techniques.length} ; contrôles en attente (or D-056) : ${journal.attente.length}.`);
for (const [nom, liste2] of Object.entries(parGravite)) {
  if (!liste2.length) continue;
  titre(`${nom} (${liste2.length})`);
  for (const e of liste2) lignes.push(`- **${e.controle}**${e.pole ? ` (astre ${e.pole})` : ''} [${e.tag}]`, `  - attendu : ${e.attendu}`, `  - affiché : ${e.affiche}`, `  - règle : ${e.regle}`, `  - rejouer : ${e.url}`);
}
if (journal.attente.length) {
  titre(`Contrôles en attente (or du gain, D-056, pas encore en ligne) (${journal.attente.length})`);
  for (const e of journal.attente) lignes.push(`- **${e.controle}** ; attendu ${rendu(e.attendu)} ; affiché ${rendu(e.affiche)}`, `  - règle : ${e.regle}`, `  - rejouer : ${e.url}`);
}
if (techniques.length) {
  titre(`Erreurs techniques (${techniques.length})`);
  for (const e of techniques) lignes.push(`- [${e.tag}] ${e.url} : ${e.message}`);
}
if (erreursPage.length) {
  titre(`Erreurs JavaScript de la page (${erreursPage.length})`);
  for (const m of [...new Set(erreursPage)].slice(0, 20)) lignes.push(`- ${m}`);
}
const rapport = lignes.join('\n');
console.log(`\n${rapport}\n`);
if (rapportChemin) {
  mkdirSync(dirname(resolve(rapportChemin)), { recursive: true });
  writeFileSync(rapportChemin, rapport, 'utf8');
  console.log(`Rapport écrit : ${resolve(rapportChemin)}`);
}
// process.exit coupe la sortie vers un tube sous Windows : le code de sortie est posé, le processus se termine seul
const code = techniques.length ? 2 : journal.ecarts.length ? 1 : 0;
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
process.stdout.write('', () => process.exit(code));

function rendu(v) {
  return Array.isArray(v) ? `[${v.join(', ')}]` : String(v);
}
