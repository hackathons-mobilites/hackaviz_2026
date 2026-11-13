import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computePoleStates } from '../data/accessibility';
import { familyRows, projectsPhrase, recruitView, isBmoFile, type BmoFile } from '../data/bmo';
import { isBmoMetiersFile } from '../data/bmoMetiers';
import { trafficLeg } from '../data/congestion';
import { itineraryOf } from '../data/itineraries';
import { formatInt } from '../data/format';
import { odCommuneRows } from '../data/od/proofOd';
import { odCounterDetail, odSkySummary } from '../data/od/summaryText';
import { odTextContext } from '../data/od/texts';
import { inboundAt, outboundAt } from '../data/od/swod';
import { shiftFromDayType, formatShift } from '../data/od/shift';
import { jobsOral, starsOral } from '../data/oral';
import type { AccessFile, Commune, ContextFile, Dataset, Meta, Pole } from '../data/types';
import { planGain } from '../sky/transitions';
import { DEFAULT_SCENARIO, sanitizeScenario, type Scenario } from '../state/scenario';
import { buildSkyView, transitCommuneStates } from '../state/skyView';
import { readItinerariesFile, readOdOffline } from '../../scripts/nodeData';
import { offlineOdShown } from './odOffline';
import { resolveTour } from './resolve';
import { lea } from './tours/lea.tour';

/**
 * CONTRÔLE « la visite dit les chiffres du site » (décision de Nicolas du 06/11) : le chiffre d'une étape doit être celui que
 * l'application affiche pour le MÊME scénario. Un jury qui ouvre le site (ou la slide, PR 64) doit retrouver ce qu'il vient
 * d'entendre ; l'écart n'est pas expliqué dans une FAQ, il n'existe pas.
 *
 * Trois lectures du même scénario sont comparées au texte résolu de l'étape :
 *  1. les TEXTES QUE LE SITE ÉCRIT (compteur `odCounterDetail`, résumé du ciel `odSkySummary`, lignes du panneau de preuve
 *     `odCommuneRows`, or `planGain`), sur une vue construite comme `applyScenario` le fait (`offlineOdShown`) ;
 *  2. un recalcul INDÉPENDANT depuis les fichiers `od_walk3000/o/{insee}.bin` (boucle ci-dessous, sans `computeOd`) ;
 *  3. les valeurs publiées par la slide (design/slides/src/build_slide.py : 2 580 329 et 54 749 postes) quand le fichier existe.
 * Aucune valeur n'est figée ici : tout est relu dans les données, sauf les deux de la slide, lues dans son script.
 */
const root = fileURLToPath(new URL('../../public', import.meta.url));
const url = (rel: string) => new URL(`../../public/data/${rel}`, import.meta.url);
const readJson = <T,>(rel: string): T | null => (existsSync(url(rel)) ? (JSON.parse(readFileSync(url(rel), 'utf-8')) as T) : null);
const meta = readJson<Meta>('meta.json');
const poles = readJson<Pole[]>('poles.json');
const communes = readJson<Commune[]>('communes.json');
const od = meta ? readOdOffline(root, meta) : null;
const ORIGINS = ['78358', '78418'];
const published = !!meta && !!poles && !!communes && !!od && ORIGINS.every((i) => existsSync(url(`access/${i}.json`)));
const dataset: Dataset | null = published ? { origin: 'real', meta: meta!, poles: poles!, communes: communes!, insights: [], sources: [] } : null;
const access: Record<string, AccessFile | null> = Object.fromEntries(ORIGINS.map((i) => [i, readJson<AccessFile>(`access/${i}.json`)]));
const FOCUS = 'BE_1107_75108';
/** Astre du soir de la visite : Seine-Aval, ancré à Poissy (lea.tour.ts, EVENING_POLE) */
const EVENING = 'BE_1125';

const digits = (s: string) => Number(s.replace(/\D/g, ''));

function scenarioOf(over: Partial<Scenario>): Scenario {
  return sanitizeScenario(
    { ...DEFAULT_SCENARIO, origin: '78358', budget: 60, mode: 'transit', day: 'd09', compare: null, pole: null, halo: null, walk: null, shift: null, ...over },
    meta!,
    new Set(communes!.map((c) => c.insee)),
    new Set(poles!.map((p) => p.id)),
  );
}

/** Ce que le SITE affiche pour le scénario : vue sur la table OD, textes du compteur et du résumé du ciel. */
function site(over: Partial<Scenario>) {
  const sc = scenarioOf(over);
  const shown = offlineOdShown(dataset!, sc, od)!;
  expect(shown, 'le site affiche la table commune x commune pour ce scénario').not.toBeNull();
  const view = buildSkyView(dataset!, sc, access, true, { shown, side: 'A' });
  const totals = view.totals;
  const jobsYear = poles!.find((p) => p.jobs_source === 'EMP01')?.jobs_year ?? null;
  const counter = odCounterDetail(totals.od!, sc.budget, jobsYear);
  const summary = odSkySummary({
    originName: view.origin!.name,
    shiftLabel: formatShift({ start: view.od!.scenario.start, end: view.od!.scenario.end }),
    modeLabel: meta!.modes.find((m) => m.id === sc.mode)?.label ?? sc.mode,
    budget: sc.budget,
    totals,
  })!;
  const reached = digits(/^([\d\s\u00a0\u202f]+) postes salariés sont atteints/.exec(counter)![1]!);
  const stars = Number(/(\d+) pôles? sur \d+ éclairés? en partie ou en entier/.exec(summary)![1]);
  return { sc, view, shown, counter, summary, reached, stars };
}

/** Recalcul indépendant (sans `computeOd`) : postes atteints aller ET retour et astres allumés, commune de départ hors total. */
function independent(insee: string, mode: 'transit' | 'car_traffic', day: 'd09' | 'd14', budget: number) {
  const index = od!.index;
  const file = od!.read(insee)!;
  const dt = meta!.day_types.find((d) => d.id === day)!;
  const shift = shiftFromDayType(site({ origin: insee, day }).shown.bounds, dt)!;
  const code = index.modes.find((m) => m.id === (mode === 'car_traffic' ? 'car' : mode))!.code;
  const section = file.sections.get(code)!;
  const at = new Map<number, number>();
  section.dest.forEach((d, i) => at.set(d, i));
  const self = index.communes.indexOf(insee);
  let reached = 0;
  const lit = new Set<number>();
  index.communes.forEach((_c, dest) => {
    const i = at.get(dest);
    if (i === undefined || dest === self) return;
    let out = section.kind === 'series' ? outboundAt(file, section.outSeries![i]!, shift.start, index.outbound_lookback_min) : { minutes: section.out![i]! <= file.maxTrip ? section.out![i]! : null };
    let ret = section.kind === 'series' ? inboundAt(file, section.retSeries![i]!, shift.end) : { minutes: section.ret![i]! <= file.maxTrip ? section.ret![i]! : null };
    if (mode === 'car_traffic') {
      const cc = meta!.car_congestion!;
      out = { ...out, minutes: trafficLeg(cc, 'out', shift.start, out.minutes).used };
      ret = { ...ret, minutes: trafficLeg(cc, 'ret', shift.end, ret.minutes).used };
    }
    if (out.minutes != null && ret.minutes != null && out.minutes <= budget && ret.minutes <= budget) {
      reached += index.jobs[dest]!;
      const p = index.pole_of[dest];
      if (p != null) lit.add(p);
    }
  });
  return { reached, stars: lit.size };
}

const resolved = () => {
  const { tour, missing } = resolveTour(lea, {
    dataset: dataset!,
    access: (insee) => access[insee] ?? readJson<AccessFile>(`access/${insee}.json`),
    context: (insee) => readJson<ContextFile>(`context/${insee}.json`),
    itineraries: (insee) => readItinerariesFile(fileURLToPath(new URL('../../public/data', import.meta.url)), meta, insee),
    bmoMetiers: ((f) => (isBmoMetiersFile(f) ? f : null))(readJson<unknown>('bmo_metiers.json')),
    bmo: ((f) => (isBmoFile(f) ? f : null))(readJson<unknown>('bmo.json')),
    od,
  });
  expect(missing).toEqual([]);
  return Object.fromEntries(tour.steps.map((s) => [s.id, s.text]));
};

/** Valeurs de la slide de dépôt (PR 64), lues dans son script : le site, la slide et la visite disent les mêmes nombres. */
function slideValues(): { ref: number; day: number } | null {
  const p = fileURLToPath(new URL('../../../design/slides/src/build_slide.py', import.meta.url));
  if (!existsSync(p)) return null;
  const m = /"reached_ref": (\d+), "reached": (\d+)/.exec(readFileSync(p, 'utf-8'));
  return m ? { ref: Number(m[1]), day: Number(m[2]) } : null;
}

describe.skipIf(!published)('la visite dit les chiffres du site (compteur, ciel, panneau), pour le même scénario', () => {
  const text = published ? resolved() : {};

  it('acte 1 : étoiles allumées et postes à portée = compteur et résumé du ciel, 9h-17h, 60 min', () => {
    const s = site({ day: 'd09' });
    const i = independent('78358', 'transit', 'd09', 60);
    expect(s.reached, 'compteur du site = recalcul indépendant').toBe(i.reached);
    expect(s.stars, 'astres éclairés du site = recalcul indépendant').toBe(i.stars);
    expect(text['acte1-ciel']).toContain(`${starsOral(s.stars)} s’allument, en partie ou en entier.`);
    expect(text['acte1-ciel']).toContain(`Au compteur : ${jobsOral(s.reached)} à sa portée, hors sa commune.`);
    // le compteur du site écrit bien le même nombre, hors commune de départ
    expect(s.counter).toContain(`${formatInt(s.reached)} postes salariés sont atteints aller et retour en 60 min`);
    expect(s.counter).toContain('hors votre commune');
    const slide = slideValues();
    if (slide) expect(s.reached, 'slide de dépôt').toBe(slide.ref);
  });

  it('acte 3 : Montesson, étoiles et postes de l’en-tête B du diptyque', () => {
    const s = site({ origin: '78418', day: 'd09' });
    const i = independent('78418', 'transit', 'd09', 60);
    expect([s.reached, s.stars]).toEqual([i.reached, i.stars]);
    expect(text['acte3-horizons']).toContain(`À droite, seulement ${starsOral(s.stars)}. En haut de son ciel : ${jobsOral(s.reached)} à sa portée.`);
  });

  it('acte 2 : l’éclipse ne dit aucun nombre d’étoiles perdues (non confirmé) ; les deux compteurs du site restent ceux de la slide', () => {
    const a = site({ day: 'd09' });
    const b = site({ day: 'd14' });
    const i = independent('78358', 'transit', 'd14', 60);
    expect([b.reached, b.stars]).toEqual([i.reached, i.stars]);
    // 06/11 (recoupement Navitia, PR 74) : « 23 étoiles de moins » vient d'un plan de travaux du RER A périmé, il n'est plus dit
    expect(text['acte2-eclipse']).not.toMatch(/étoile|de moins|se voile|postes|passent de/);
    expect(text['acte2-eclipse']).toContain('Le ciel est recalculé');
    const slide = slideValues();
    if (slide) expect([a.reached, b.reached], 'slide de dépôt').toEqual([slide.ref, slide.day]);
  });

  it('acte 4, voiture : étoiles et postes du site avec le trafic moyen, 14h-22h', () => {
    const s = site({ day: 'd14', mode: 'car_traffic' });
    const i = independent('78358', 'car_traffic', 'd14', 60);
    expect([s.reached, s.stars]).toEqual([i.reached, i.stars]);
    expect(text['acte4-voiture']).toContain(`${starsOral(s.stars)} s’allumeraient.`);
    const reachedOral = jobsOral(s.reached) ?? '';
    expect(text['acte4-voiture']).toContain(`${reachedOral.charAt(0).toUpperCase()}${reachedOral.slice(1)} seraient à sa portée.`);
  });

  // 12/11 (retours de Cyril et de Nicolas) : la voix disait les durées de la matrice (celles de la ligne de la liste des communes), alors que le
  // cadre éclairé est le bloc « Trajet », qui montre l'EXEMPLE de trajet : ce sont ses durées (attente comprise) que la voix doit dire.
  it('acte 1, preuve : les temps de Paris 8e sont ceux de l’exemple de trajet que le bloc « Trajet » affiche (9h-17h)', () => {
    const file = readItinerariesFile(fileURLToPath(new URL('../../public/data', import.meta.url)), meta!, '78358');
    const out = itineraryOf(file!, FOCUS, 'd09', 'out')!.min!;
    const ret = itineraryOf(file!, FOCUS, 'd09', 'ret')!.min!;
    const said = `Voici un exemple de trajet : pour arriver avant le début de sa journée de travail, l’aller prend ${out} minutes. À la fin de sa journée de travail, le retour prend ${ret} minutes, attente comprise.`;
    expect(text['acte1-preuve']).toContain(said);
  });

  /**
   * Recoupement Navitia du 06/11 (PR 74, passation 4.21) : le cas du soir ne tient que si ALLER ET RETOUR sont confirmés à 5
   * minutes près. Le test lit le fichier du recoupement et le compare aux temps que la visite dit.
   */
  const recoupement = (() => {
    const p = new URL('../../../data/processed/navitia_recoupement_6h14_visite_06_11.csv', import.meta.url);
    if (!existsSync(p)) return null;
    const [head, ...lines] = readFileSync(p, 'utf-8').trim().split(/\r?\n/);
    // CSV avec champs entre guillemets (les listes de lignes contiennent des virgules)
    const split = (l: string) => [...l.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => m[1]!.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const cols = split(head!);
    return lines.map((l) => Object.fromEntries(split(l).map((v, k) => [cols[k]!, v])));
  })();

  it.skipIf(!recoupement)('acte 2, le soir : Seine-Aval, ancré à Poissy, dit les temps de la ligne du panneau, confirmés aller et retour par Navitia', () => {
    const s = site({ day: 'd14', pole: EVENING });
    const pole = poles!.find((p) => p.id === EVENING)!;
    const share = s.view.od!.poles.find((p) => p.id === EVENING)!;
    const names = new Map(communes!.map((c) => [c.insee, c.name]));
    const rows = odCommuneRows(share, names, 60, odTextContext(s.shown.index, true, 'transit'), s.view.od!.scenario.end);
    const row = rows.find((r) => r.insee === pole.name_short_insee)!;
    expect(row.glyph, 'la commune d’ancrage est atteinte aller et retour (astre allumé par elle)').toBe('accessible');
    const out = Number(/aller (\d+) min/i.exec(row.out)![1]);
    const ret = Number(/retour (\d+) min/i.exec(row.ret)![1]);
    expect(text['acte2-pole']).toBe(
      `Dans le panneau de droite, la fiche de Seine-Aval. Dans la liste des communes du pôle, la ligne de Poissy. L’aller prend ${out} minutes. Le retour en prend ${ret}, attente comprise. Poissy reste à sa portée, même le soir. Ces temps ont été recoupés avec le calculateur d’Île-de-France Mobilités.`,
    );
    // Navitia : Maisons-Laffitte vers Poissy, 14h-22h. Les minutes comparées sont celles que la visite dit (lues dans les données
    // publiées, elles suivent un recalcul) ; seule la durée de Navitia vient du fichier du recoupement.
    for (const [leg, minutes] of [['aller', out], ['retour', ret]] as const) {
      const r = recoupement!.find((x) => x.origin === 'Maisons-Laffitte' && x.dest === 'Poissy' && x.day === 'd14' && x.leg === leg)!;
      expect(r, `${leg} recoupé`).toBeDefined();
      expect(Math.abs(minutes - Number(r.navitia_min)), `${leg} : écart avec Navitia`).toBeLessThanOrEqual(5);
    }
    // la preuve de l'étape 4 (Paris 8e, 9h-17h) est recoupée plus bas (étapes 8 et 10), sur les minutes publiées aussi
    expect(text['acte2-pole'], 'aucun bus de remplacement : ce retour n’existe plus (plan de travaux périmé)').not.toMatch(/bus|remplacement|RER A/);
  });

  it('acte 4, vélo + TC : AUCUN nombre d’étoiles en or ni de postes (06/11 16h30), l’idée seule ; le site montre toujours un gain', () => {
    const sc = scenarioOf({ day: 'd14', mode: 'bike_transit' });
    expect(offlineOdShown(dataset!, sc, od), 'vélo + TC : la table commune x commune ne le sert pas, le site affiche `access/`').toBeNull();
    const bike = buildSkyView(dataset!, sc, access, true, null);
    const ref = computePoleStates(poles!, access['78358'], 'transit', 'd14', 60);
    const communeTransit = transitCommuneStates(dataset!, sc, offlineOdShown(dataset!, { ...sc, mode: 'transit' }, od));
    const plan = planGain(poles!, { states: ref, mode: 'transit', day: 'd14', budget: 60 }, { states: bike.states, mode: 'bike_transit', day: 'd14', budget: 60 }, communeTransit);
    // le contrôle `gain.case` de l'étape s'appuie sur ce bilan : il existe, mais son nombre n'est pas dit
    expect(plan.reason).toBeNull();
    expect(plan.gained.length).toBeGreaterThan(0);
    const t = text['acte4-velo']!;
    expect(t).toBe(
      'Alors, une solution complémentaire : son vélo jusqu’à la gare, puis les transports en commun. Sans compter le temps pour le garer, son périmètre de recherche d’emploi s’élargit, sans prendre la voiture.',
    );
    expect(t, 'ni astres en or, ni nombre d’étoiles, ni postes : le compteur de ce mode additionne des astres entiers').not.toMatch(/\d|postes|million|étoile|en or|gagne/);
  });

  it.skipIf(!recoupement)('étapes 8 et 10 : la fiche de Paris 8e est en 9h-17h (confirmée par Navitia), et le chiffre de la famille de Léa reste « au moins 47 307 »', () => {
    // le récit n'ouvre jamais Paris 8e en 14h-22h : voir lea.test.ts ; ici, la fiche affichée aux étapes 8 et 10 est celle de 9h-17h
    const s = site({ day: 'd09', pole: FOCUS });
    const share = s.view.od!.poles.find((p) => p.id === FOCUS)!;
    const names = new Map(communes!.map((c) => [c.insee, c.name]));
    const row = odCommuneRows(share, names, 60, odTextContext(s.shown.index, true, 'transit'), s.view.od!.scenario.end)[0]!;
    expect(row.glyph).toBe('accessible');
    for (const leg of ['aller', 'retour'] as const) {
      const shown = Number(new RegExp(`${leg} (\\d+) min`, 'i').exec(leg === 'aller' ? row.out : row.ret)![1]);
      const r = recoupement!.find((x) => x.origin === 'Maisons-Laffitte' && x.dest?.startsWith('Paris 8e') && x.day === 'd09' && x.leg === leg)!;
      // `shown` vient des données publiées (il suit un recalcul) ; seule la durée de Navitia vient du fichier du recoupement
      expect(Math.abs(shown - Number(r.navitia_min)), `${leg} : écart avec Navitia`).toBeLessThanOrEqual(5);
    }
    // le chiffre BMO de la famille ne dépend ni de la journée ni du réglage : toujours 47 307 dans le bassin T1 Paris
    const file = readJson<BmoFile>('bmo.json')!;
    const rv = recruitView(file, poles!.find((p) => p.id === FOCUS)!, poles!);
    expect(rv.status).toBe('ok');
    if (rv.status !== 'ok') return;
    expect(digits(projectsPhrase(familyRows(file, rv.bassin).find((r) => r.code === 'V')!.cell))).toBe(47307);
    expect(text['acte2-recrutement']).toMatch(/au moins 47[\s\u00a0\u202f]000 dans sa famille de métiers/);
  });

  it('étape BMO (site seulement) : le chiffre dit est celui de la ligne de la FAMILLE de métiers du panneau, pas celui du métier', () => {
    const file = readJson<BmoFile>('bmo.json')!;
    const pole = poles!.find((p) => p.id === FOCUS)!;
    const rv = recruitView(file, pole, poles!);
    expect(rv.status).toBe('ok');
    if (rv.status !== 'ok') return;
    const row = familyRows(file, rv.bassin).find((r) => r.code === 'V')!;
    const shown = projectsPhrase(row.cell); // ce que la liste du panneau écrit : « au moins 47 307 » ou « 47 307 »
    const n = digits(shown);
    const said = /prévoient (au moins |près de |plus de )?([\d\u00a0\u202f ]+) dans sa famille de métiers : les (.+)\. Ce sont les recrutements prévus pour (\d{4}),/.exec(text['acte2-recrutement']!)!;
    // « au moins 47 000 » pour « au moins 47 307 » : arrondi par le bas quand des cases « * » manquent, jamais au-dessus du chiffre affiché
    expect(digits(said[2]!)).toBeLessThanOrEqual(n);
    expect(n - digits(said[2]!)).toBeLessThan(n >= 10_000 ? 1_000 : n >= 1_000 ? 100 : 10);
    expect(said[3]!.charAt(0).toUpperCase() + said[3]!.slice(1), 'libellé de la famille du panneau').toBe(row.label);
    expect(said[4]).toBe(String(file.year));
  });

  it('sans table commune x commune, la résolution s’arrête : jamais les chiffres d’un autre calcul', () => {
    const { missing } = resolveTour(lea, {
      dataset: dataset!,
      access: (insee) => access[insee] ?? null,
      context: (insee) => readJson<ContextFile>(`context/${insee}.json`),
      itineraries: (insee) => readItinerariesFile(fileURLToPath(new URL('../../public/data', import.meta.url)), meta, insee),
    });
    const odSteps = ['acte1-ciel', 'acte1-preuve', 'acte3-horizons', 'acte2-eclipse', 'acte2-pole', 'acte4-voiture'];
    for (const id of odSteps) expect(missing.find((m) => m.step === id)?.variables.join(' '), id).toContain('sky.basisCase=access (attendu od)');
  });
});
