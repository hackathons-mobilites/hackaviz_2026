import { readdirSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChartReadingTip } from '../components/ChartReadingTip';
import { CommuneChart } from '../components/proof/CommuneChart';
import { ModeChart } from '../components/proof/ModeChart';
import { RecruitChart } from '../components/proof/RecruitChart';
import { TrafficChart } from '../components/proof/TrafficChart';
import { TripBand } from '../components/proof/TripBand';
import type { SkyTotals } from './accessibility';
import {
  DOT_KEY_NOTE,
  INCOME_STRIP_NOTE,
  MIRROR_DISC_NOTE,
  MODE_VERDICT_NOTE,
  READING_TITLE,
  jobsDefinition,
  communeChartReading,
  diptychReading,
  dotPlotReading,
  evolutionReading,
  flowShareReading,
  incomeStripReading,
  mirrorReading,
  modeChartReading,
  counterGaugeReading,
  odShareReading,
  recruitChartReading,
  ringReading,
  skyReading,
  trafficChartReading,
  tripBandReading,
  zoneStripReading,
  type ChartReading,
} from './chartReading';
import { formatInt, formatPercent } from './format';
import { buildHalo, commuteDotRows } from './halo';
import { incomeValueText, rankAmong, rankSentence, type IncomeMeasure } from './incomeRank';
import type { ItinTrip } from './itineraries';
import type { ModeChartModel } from './modeChart';
import type { CommuneChartModel } from './od/communeChart';
import type { RecruitChartRow } from './recruitChart';
import { CHOMAGE_DENOMINATOR, CHOMAGE_NOTES, EVOLUTION_NOTE, ZONE_SCALE_NOTE, ZONE_STRIP_READING, communeTerritoire, isTerritoireFile, lastRate, rateText, zoneSeries, type TerritoireFile } from './territoire';
import type { TrafficChartModel } from './trafficChart';
import { tripBandModel } from './tripBand';
import type { ContextFile } from './types';

/**
 * « Comment lire ce graphique » (demande de Nicolas du 10/11) : chaque type de graphique a son « i » ; le cas précis est construit avec
 * les valeurs passées (deux communes, deux textes) ; aucun chiffre n'est écrit en dur dans les textes. Données réelles publiées quand
 * elles existent (context, territoire), modèles de graphique sinon.
 */

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(path: string): T => JSON.parse(readFileSync(new URL(path, dataDir), 'utf-8')) as T;
const communes = read<{ insee: string; name: string }[]>('communes.json');
const nameOf = (insee: string) => communes.find((c) => c.insee === insee)?.name ?? insee;
const ctxOf = (insee: string) => read<ContextFile>(`context/${insee}.json`);

/** Nombres écrits dans un texte (« 42 520 », « 6,7 », « 2023 ») */
const numbersOf = (text: string): string[] => text.match(/\d+(?:[\u00a0\u202f ]\d{3})*(?:,\d+)?/g)?.map((n) => n.replace(/[\u00a0\u202f ]/g, ' ')) ?? [];
/** Chaque nombre du cas vient des valeurs passées (écrites comme à l'écran) */
const expectNumbersFrom = (r: ChartReading, allowed: readonly string[]) => {
  // L'origine de l'axe (0) est un repère du dessin, pas une valeur
  const ok = new Set(['0', ...allowed.flatMap(numbersOf)]);
  for (const n of r.example.flatMap(numbersOf)) expect(ok.has(n), `« ${n} » ne vient d'aucune valeur passée : ${r.example.join(' ')}`).toBe(true);
};
/**
 * Parties générales : aucune valeur. Seuls les repères fixes du dessin y sont écrits (l'axe qui part de 0, l'axe de 0 à 100 % des modes)
 * et la marge à 95 % de la phrase rangée mots inchangés.
 */
const STRUCTURAL = new Set(['0', '100', '95']);
const MOVED_AS_IS = new Set<string>([EVOLUTION_NOTE]);
const expectNoValueInParts = (r: ChartReading) => {
  // Une phrase rangée mots inchangés (le découpage 2020 des zones d'emploi) n'est pas une valeur du graphique
  for (const n of r.parts.filter((p) => !MOVED_AS_IS.has(p)).flatMap(numbersOf)) expect(STRUCTURAL.has(n), `chiffre « ${n} » dans les parties générales`).toBe(true);
};
const noDash = (r: ChartReading) => expect([...r.parts, ...r.example].join(' ')).not.toMatch(/[\u2013\u2014]|offres? d'emploi/i);

// Deux communes réelles, au niveau de vie publié et différent
const ML = '78358';
const OTHER = '93014';

/** Répartition comme au build (vite.config.ts, incomeDistribution) */
function distribution(): { year: number | null; median: [string, number][]; poverty: [string, number][] } {
  const median: [string, number][] = [];
  const poverty: [string, number][] = [];
  let year: number | null = null;
  for (const f of readdirSync(new URL('context/', dataDir)).filter((x) => x.endsWith('.json'))) {
    const c = read<ContextFile & { insee?: string }>(`context/${f}`);
    const b = c.income;
    if (!b) continue;
    year ??= b.year ?? null;
    const insee = c.insee ?? f.replace(/\.json$/, '');
    if ((b.median_status ?? b.status) === 'ok' && b.median_living_standard_eur != null) median.push([insee, b.median_living_standard_eur]);
    if ((b.poverty_rate_status ?? b.status) === 'ok' && b.poverty_rate != null) poverty.push([insee, b.poverty_rate]);
  }
  return { year, median, poverty };
}
const dist = distribution();

describe('bande de points du niveau de vie', () => {
  for (const measure of ['median', 'poverty'] as IncomeMeasure[]) {
    it(`${measure} : le cas suit la commune affichée, la phrase rangée est dans le « i », mots inchangés`, () => {
      const entries = dist[measure];
      const r = (insee: string) => incomeStripReading({ measure, entries, sides: [{ insee, name: nameOf(insee) }], year: dist.year, denominator: 'dénominateur lu' });
      const a = r(ML);
      const b = r(OTHER);
      expect(a.parts).toEqual(b.parts);
      expect(a.parts).toContain(INCOME_STRIP_NOTE);
      expect(a.example).not.toEqual(b.example);
      for (const [insee, t] of [[ML, a], [OTHER, b]] as const) {
        const v = entries.find(([c]) => c === insee)![1];
        const text = t.example.join(' ');
        expect(text).toContain(nameOf(insee));
        expect(text).toContain(incomeValueText[measure](v));
        expect(text).toContain('Dénominateur : dénominateur lu.');
        if (dist.year != null) expect(text).toContain(`Millésime ${dist.year}.`);
        // Même part que la phrase de rang visible sous la bande
        const share = rankSentence(measure, rankAmong(entries, insee, v))!.match(/(\d+)\u00a0%/)?.[1];
        if (share) expect(text).toContain(`${share}\u00a0%`);
        const lo = Math.min(...entries.map(([, x]) => x));
        const hi = Math.max(...entries.map(([, x]) => x));
        expectNumbersFrom(t, [incomeValueText[measure](v), incomeValueText[measure](lo), incomeValueText[measure](hi), formatInt(entries.length), formatInt(entries.length - 1), share ?? '', String(dist.year)]);
        expectNoValueInParts(t);
        noDash(t);
      }
    });
  }

  it('valeur non publiée : le cas le dit, aucun trait, aucune valeur inventée', () => {
    const t = incomeStripReading({ measure: 'poverty', entries: dist.poverty, sides: [{ insee: 'absente', name: 'Commune sans valeur' }], year: dist.year });
    expect(t.example[0]).toMatch(/n'est pas publié/);
    expect(t.example[0]).toMatch(/aucun trait doré/);
    expect(numbersOf(t.example[0]!)).toEqual([]);
  });

  it('comparaison : les deux communes, chacune avec son trait', () => {
    const t = incomeStripReading({ measure: 'median', entries: dist.median, sides: [{ insee: ML, name: nameOf(ML), tag: 'A' }, { insee: OTHER, name: nameOf(OTHER), tag: 'B' }], year: dist.year });
    const text = t.example.join(' ');
    expect(text).toContain(`A · ${nameOf(ML)} (trait A)`);
    expect(text).toContain(`B · ${nameOf(OTHER)} (trait B)`);
  });
});

describe('anneau des âges et constellation des modes (halo)', () => {
  const ring = (insee: string) => {
    const h = buildHalo(ctxOf(insee), 'age');
    const r = h.rings[0]!;
    return ringReading({
      sides: [{ name: nameOf(insee), segments: r.segments, items: h.legend.map((l) => ({ name: l.label, value: l.value })), denominator: h.denominator }],
      year: h.year,
    });
  };
  it('âges : arc le plus long et le plus court, valeurs et dénominateur de la commune', () => {
    const a = ring(ML);
    const b = ring(OTHER);
    expect(a.parts).toEqual(b.parts);
    expect(a.example).not.toEqual(b.example);
    for (const [insee, t] of [[ML, a], [OTHER, b]] as const) {
      const h = buildHalo(ctxOf(insee), 'age');
      expect(t.example.join(' ')).toContain(nameOf(insee));
      expect(t.example.join(' ')).toContain(`Dénominateur : ${h.denominator}.`);
      expectNumbersFrom(t, [...h.legend.flatMap((l) => [l.label, l.value]), h.denominator ?? '', String(h.year)]);
      expectNoValueInParts(t);
      noDash(t);
    }
  });

  it('modes : la ligne la plus remplie, femmes et hommes, marge, dénominateur ; la note des formes est rangée mots inchangés', () => {
    const dots = (insee: string) => {
      const h = buildHalo(ctxOf(insee), 'commute');
      return { t: dotPlotReading({ sides: [{ name: nameOf(insee), rows: commuteDotRows(ctxOf(insee)), denominator: h.denominator }], year: h.year }), h };
    };
    const a = dots(ML);
    const b = dots(OTHER);
    expect(a.t.parts).toEqual(b.t.parts);
    expect(a.t.parts.join(' ').toLowerCase()).toContain(DOT_KEY_NOTE);
    expect(a.t.example).not.toEqual(b.t.example);
    for (const [insee, { t, h }] of [[ML, a], [OTHER, b]] as const) {
      const rows = commuteDotRows(ctxOf(insee));
      expect(t.example.join(' ')).toContain(nameOf(insee));
      expectNumbersFrom(t, [...rows.flatMap((r) => [r.f, r.h, r.fMargin, r.hMargin].map((v) => (v == null ? '' : formatPercent(v)))), h.denominator ?? '', String(h.year)]);
      expectNoValueInParts(t);
      noDash(t);
    }
    expect(dotPlotReading({ sides: [{ name: 'Sans donnée', rows: [], denominator: null }], year: null }).example[0]).toMatch(/ne sont pas publiés/);
  });
});

describe('chômage : bande des zones d’emploi et courbe', () => {
  const raw = read<unknown>('territoire.json');
  const file = (isTerritoireFile(raw) ? raw : null) as TerritoireFile | null;
  it.runIf(!!file)('la zone de chaque commune, son taux et son rang ; la phrase rangée n’est plus dans les notes visibles', () => {
    const f = file!;
    // Deux communes de zones d'emploi différentes
    const ids = Object.keys(f.communes);
    const za = communeTerritoire(f, ids[0])!;
    const otherId = ids.find((i) => communeTerritoire(f, i)?.zoneId !== za.zoneId)!;
    const zb = communeTerritoire(f, otherId)!;
    const a = zoneStripReading(f, [{ name: nameOf(ids[0]!), zoneId: za.zoneId }]);
    const b = zoneStripReading(f, [{ name: nameOf(otherId), zoneId: zb.zoneId }]);
    expect(a.parts).toEqual(b.parts);
    expect(a.parts).toContain(ZONE_STRIP_READING);
    expect(a.parts).toContain(ZONE_SCALE_NOTE);
    expect(CHOMAGE_NOTES.join(' ')).not.toContain(ZONE_STRIP_READING);
    expect(CHOMAGE_NOTES.join(' ')).not.toContain(ZONE_SCALE_NOTE);
    expect(a.example).toContain(`Dénominateur : ${CHOMAGE_DENOMINATOR}.`);
    expect(a.example).not.toEqual(b.example);
    expect(a.example.join(' ')).toContain(rateText(lastRate(za.zone)));
    expectNoValueInParts(a);
    noDash(a);
    expect(zoneStripReading(f, [{ name: 'Inconnue', zoneId: null }]).example[0]).toMatch(/aucun repère de chômage/);

    const ea = evolutionReading(f, za.zoneId);
    const eb = evolutionReading(f, zb.zoneId);
    expect(ea.example).not.toEqual(eb.example);
    const s = zoneSeries(f, za.zoneId);
    expect(ea.example[0]).toContain(rateText(s[0]!.rate));
    expect(ea.example[0]).toContain(rateText(s[s.length - 1]!.rate));
    expectNoValueInParts(ea);
    noDash(ea);
  });
});

/* ------------------------------------------------------------------ graphiques du panneau de preuve (modèles) */

const modeModel = (a: number, b: number): ModeChartModel => ({
  rows: [
    { mode: 'car', label: 'Voiture (route vide)', current: false, out: { minutes: a, written: null }, ret: { minutes: a + 2, written: null }, sentence: '' },
    { mode: 'transit', label: 'Transports en commun', current: true, out: { minutes: b, written: null }, ret: { minutes: b + 3, written: null }, sentence: '' },
    { mode: 'walk', label: 'Marche', current: false, out: { minutes: null, written: 'Aucun trajet' }, ret: { minutes: null, written: 'Aucun trajet' }, sentence: '' },
  ],
  axisMax: b + 3,
});

const communeModel = (jobs: number, out: number, budget: number): CommuneChartModel => ({
  budget,
  axisMax: Math.max(budget, out + 5),
  ticks: [0, budget],
  rows: [
    { insee: '1', name: 'Première', jobs, accessible: out + 5 <= budget, self: false, out: { minutes: out, within: out <= budget, written: null }, ret: { minutes: out + 5, within: out + 5 <= budget, written: null }, sentence: '', outText: '', retText: '', title: '' },
    { insee: '2', name: 'Seconde', jobs: jobs - 1, accessible: false, self: false, out: { minutes: null, within: false, written: 'Aucun trajet' }, ret: { minutes: null, within: false, written: 'Aucun trajet' }, sentence: '', outText: '', retText: '', title: '' },
  ],
});

const trafficModel = (free: number, traffic: number): TrafficChartModel => ({
  rows: [
    { label: 'Aller', free, traffic, indexText: 'x 1,31 (7h-10h)', written: null, sentence: '' },
    { label: 'Retour', free: free + 1, traffic: null, indexText: null, written: 'Route vide seulement', sentence: '' },
  ],
  axisMax: traffic,
});

const recruitRows = (n: number): RecruitChartRow[] => [
  { code: 'a', label: 'Famille A', n, bar: 1, atLeast: true, phrase: `au moins ${formatInt(n)}`, selected: false, sentence: '' },
  { code: 'b', label: 'Famille B', n: Math.floor(n / 3), bar: 0.3, atLeast: false, phrase: formatInt(Math.floor(n / 3)), selected: false, sentence: '' },
  { code: 'c', label: 'Famille C', n: null, bar: 0, atLeast: false, phrase: 'non diffusé', selected: false, sentence: '' },
];

const trip = (walk: number, ride: number): ItinTrip =>
  ({
    status: 'ok',
    dep: '08:00',
    arr: '09:00',
    min: walk + ride,
    legs: [
      { m: 'walk', dep: '08:00', arr: '08:10', min: walk },
      { m: 'rail', dep: '08:10', arr: '08:50', min: ride, line: 'A', wait_min: 2 },
    ],
  }) as unknown as ItinTrip;

const totals = (accessible: number, jobs: number, od?: { reachedAll: number; reachedCommunes: number; communes: number }): SkyTotals => ({
  poleCount: 44,
  accessibleCount: accessible,
  jobs,
  totalJobs: jobs * 3,
  hasData: true,
  ...(od ? { od: { ...od, allJobs: od.reachedAll * 2, measurableJobs: od.reachedAll * 2, selfJobs: 0, unknownJobs: 0 } } : {}),
});

describe('graphiques du panneau, du ciel et de la carte : le cas suit les valeurs passées', () => {
  const cases: { name: string; make: (k: 0 | 1) => { r: ChartReading; values: string[] } }[] = [
    { name: 'triangles, moyens de transport', make: (k) => ({ r: modeChartReading(modeModel(17 + k * 4, 41 + k * 6), { verdicts: true }), values: [17 + k * 4, 19 + k * 4, 41 + k * 6, 44 + k * 6].map(String) }) },
    { name: 'triangles, communes du pôle', make: (k) => ({ r: communeChartReading(communeModel(12345 + k * 1000, 23 + k * 20, 45)), values: [formatInt(12345 + k * 1000), String(23 + k * 20), String(28 + k * 20), '45', '1', '2', '0'] }) },
    { name: 'route vide et trafic moyen', make: (k) => ({ r: trafficChartReading(trafficModel(31 + k, 44 + k)), values: [String(31 + k), String(44 + k), String(32 + k), 'x 1,31 (7h-10h)'] }) },
    { name: 'barres du recrutement', make: (k) => ({ r: recruitChartReading(recruitRows(3210 + k * 300), { bassin: 'Bassin test', year: 2026 }), values: [formatInt(3210 + k * 300), formatInt(Math.floor((3210 + k * 300) / 3)), '1', '2026'] }) },
    { name: 'bande du trajet', make: (k) => ({ r: tripBandReading(tripBandModel(trip(9 + k, 33 + k)), 'out'), values: [String(9 + k), String(33 + k), '2', 'A'] }) },
    { name: 'barre de part, postes atteints', make: (k) => ({ r: odShareReading({ percent: formatPercent(37.5 + k), reached: 4321 + k, measurable: 11523, year: 2023 }), values: [formatPercent(37.5 + k), formatInt(4321 + k), formatInt(11523), '2023'] }) },
    { name: 'barre de part, flux observés', make: (k) => ({ r: flowShareReading({ name: k ? 'Commune B' : 'Commune A', flux: 812 + k, share: 4.2 + k, year: 2022, approx: false }), values: [formatInt(812 + k), formatPercent(4.2 + k), '2022'] }) },
    { name: 'ciel', make: (k) => ({ r: skyReading({ origin: k ? 'Commune B' : 'Commune A', budget: 45, totals: totals(12 + k, 345678 + k), od: false }), values: ['45', String(12 + k), '44', formatInt(345678 + k)] }) },
    { name: 'ciel commune par commune', make: (k) => ({ r: skyReading({ origin: 'Commune A', budget: 60, totals: totals(0, 0, { reachedAll: 987654 + k, reachedCommunes: 211 + k, communes: 1267 }), od: true }), values: ['60', formatInt(987654 + k), String(211 + k), formatInt(1267)] }) },
    { name: 'deux ciels', make: (k) => ({ r: diptychReading({ name: 'A1', totals: totals(10 + k, 1000), od: false }, { name: 'B1', totals: totals(20, 2000 + k), od: false }, 45), values: ['45', String(10 + k), '20', '44', formatInt(1000), formatInt(2000 + k), '1'] }) },
    { name: 'carte miroir', make: (k) => ({ r: mirrorReading({ origin: 'Commune A', budget: 30, od: totals(0, 0, { reachedAll: 55555 + k, reachedCommunes: 77 + k, communes: 1267 }).od!, accessibleCount: 0, poleCount: 44, astres: true }), values: ['30', formatInt(55555 + k), String(77 + k)] }) },
    { name: 'jauge du compteur, pôles', make: (k) => ({ r: counterGaugeReading({ origin: k ? 'Commune B' : 'Commune A', budget: 45, totals: totals(12 + k, 345678 + k), od: false, year: 2023 }), values: ['45', formatPercent(100 / 3), formatInt(345678 + k), String(12 + k), formatInt((345678 + k) * 3), '44', '2023'] }) },
    { name: 'jauge du compteur, commune par commune', make: (k) => ({ r: counterGaugeReading({ origin: 'Commune A', budget: 60, totals: totals(0, 0, { reachedAll: 987654 + k, reachedCommunes: 211, communes: 1267 }), od: true, year: 2023 }), values: ['60', formatPercent(50), formatInt(987654 + k), formatInt((987654 + k) * 2), '2023'] }) },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const a = c.make(0);
      const b = c.make(1);
      expect(a.r.parts).toEqual(b.r.parts);
      expect(a.r.example.length).toBeGreaterThan(0);
      expect(a.r.example).not.toEqual(b.r.example);
      expectNumbersFrom(a.r, a.values);
      expectNumbersFrom(b.r, b.values);
      expectNoValueInParts(a.r);
      noDash(a.r);
    });
  }

  it('jauge du compteur : dénominateur dit, commune de départ hors du total, rien sans commune ni part', () => {
    const od = { reachedAll: 1200, allJobs: 5000, measurableJobs: 4000, selfJobs: 1000, unknownJobs: 0, reachedCommunes: 12, communes: 1267 };
    const t: SkyTotals = { poleCount: 44, accessibleCount: 0, jobs: 0, totalJobs: 0, hasData: true, od };
    const r = counterGaugeReading({ origin: 'Commune A', budget: 45, totals: t, od: true, year: null });
    // même part que l'écran : atteints / postes dont le trajet est mesuré (sans la commune de départ)
    expect(r.example[0]).toContain(formatPercent(30));
    expect(r.example[0]).toContain(`sur ${formatInt(4000)} postes d'Île-de-France hors votre commune`);
    expect(r.example.join(' ')).toMatch(/sans ceux de votre commune de départ/);
    expect(r.example.join(' ')).not.toMatch(/Millésime/);
    expectNumbersFrom(r, ['45', formatPercent(30), formatInt(1200), formatInt(4000)]);
    // pôles : un seul pôle, accord au singulier
    const one = counterGaugeReading({ origin: 'Commune A', budget: 30, totals: totals(1, 5000), od: false, year: 2023 });
    expect(one.example[0]).toContain('dans 1 pôle accessible aller et retour');
    // pas de commune, pas de donnée, pas de dénominateur : aucun cas inventé
    expect(counterGaugeReading({ origin: null, budget: 45, totals: totals(3, 100), od: false, year: 2023 }).example).toEqual([]);
    expect(counterGaugeReading({ origin: 'A', budget: 45, totals: { ...totals(3, 100), hasData: false }, od: false, year: 2023 }).example).toEqual([]);
    expect(counterGaugeReading({ origin: 'A', budget: 45, totals: { ...totals(3, 100), jobs: null }, od: false, year: 2023 }).example).toEqual([]);
    expect(counterGaugeReading({ origin: 'A', budget: 45, totals: { ...t, od: { ...od, measurableJobs: 0 } }, od: true, year: 2023 }).example).toEqual([]);
    // les parties disent ce que représente le filet selon la base de calcul
    expect(r.parts[0]).toMatch(/Île-de-France/);
    expect(one.parts[0]).toMatch(/pôles d'emploi du ciel/);
  });

  it("« i » du compteur : la première ligne dit ce que sont les postes, millésime lu dans les données (retour de Cyril, 11/11)", () => {
    const t = totals(3, 100);
    expect(counterGaugeReading({ origin: 'A', budget: 45, totals: t, od: false, year: 2023 }).intro).toEqual([
      "Postes salariés (INSEE) : postes salariés recensés par l'INSEE (Flores 2023), comptés au lieu de travail.",
    ]);
    // sans millésime publié, aucun millésime écrit ; la définition reste, même sans commune choisie
    expect(counterGaugeReading({ origin: null, budget: 45, totals: t, od: false, year: null }).intro).toEqual([jobsDefinition(null)]);
    expect(jobsDefinition(null)).not.toMatch(/\d/);
    // le millésime n'est dit qu'une fois
    expect(counterGaugeReading({ origin: 'A', budget: 45, totals: t, od: false, year: 2023 }).example.join(' ')).not.toMatch(/2023/);
    // rendu : la définition avant « Comment lire ce graphique »
    const h = renderToStaticMarkup(createElement(ChartReadingTip, { chart: 'filet', reading: counterGaugeReading({ origin: 'A', budget: 45, totals: t, od: false, year: 2023 }) }));
    expect(h.indexOf('Flores 2023')).toBeGreaterThan(-1);
    expect(h.indexOf('Flores 2023')).toBeLessThan(h.indexOf(READING_TITLE + '</span>'));
  });

  it('phrases rangées mots inchangés : verdict des moyens, disques de la carte', () => {
    expect(modeChartReading(modeModel(1, 2), { verdicts: true }).parts).toContain(MODE_VERDICT_NOTE);
    expect(modeChartReading(modeModel(1, 2), { verdicts: false }).parts).not.toContain(MODE_VERDICT_NOTE);
    const m = mirrorReading({ origin: null, budget: 45, od: null, accessibleCount: 0, poleCount: 44, astres: false });
    expect(m.parts).toContain(MIRROR_DISC_NOTE.poles);
    expect(m.parts).toContain(MIRROR_DISC_NOTE.sky);
    expect(m.example).toEqual([]);
  });
});

describe('le « i » est rendu à côté du titre de chaque graphique du panneau', () => {
  const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
  const tipOf = (h: string) => h.match(/aria-label="Comment lire ce graphique : ([^"]+)"/)?.[1] ?? null;
  it('ChartReadingTip : intitulé, titre, une phrase par ligne, puis le cas', () => {
    const h = html(createElement(ChartReadingTip, { chart: 'essai', reading: { parts: ['Phrase un.', 'Phrase deux.'], example: ['Ici, un cas.'] } }));
    expect(h).toContain(`aria-label="${READING_TITLE} : essai"`);
    expect(h).toContain('Un cas précis');
    expect(h).toMatch(/Phrase un\.<\/span>\n<span class="chart-read-line">Phrase deux\./);
  });
  it('triangles, route vide, barres, bande du trajet : chacun a son « i » et son cas', () => {
    const noop = () => {};
    const renders = [
      html(createElement(ModeChart, { model: modeModel(17, 41), title: 'Titre', active: null, onActive: noop })),
      html(createElement(CommuneChart, { model: communeModel(12345, 23, 45), title: 'Titre' })),
      html(createElement(TrafficChart, { model: trafficModel(31, 44), title: 'Titre', active: null, onActive: noop, children: null })),
      html(createElement(RecruitChart, { rows: recruitRows(3210), title: 'Titre', bassin: 'Bassin test', year: 2026, active: null, onActive: noop, children: null })),
      html(createElement(TripBand, { trip: trip(9, 33), scale: 50, side: 'out' })),
    ];
    for (const h of renders) {
      expect(tipOf(h)).not.toBeNull();
      expect(h).toContain('Un cas précis');
    }
    // Le verdict des moyens n'est plus écrit sous le titre : il est dans le « i »
    expect(renders[0]!.match(/<p class="pf-cc-key">[\s\S]*?<\/p>/)?.[0]).not.toContain(MODE_VERDICT_NOTE);
    expect(renders[0]).toContain(MODE_VERDICT_NOTE);
    // Deux communes, deux cas
    const other = html(createElement(CommuneChart, { model: communeModel(54321, 70, 45), title: 'Titre' }));
    expect(other).toContain(formatInt(54321));
    expect(renders[1]).not.toContain(formatInt(54321));
  });

  it('les graphiques hors panneau (halo, carte, ciel, deux ciels, jauge du compteur) posent aussi leur « i »', () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8');
    for (const [file, n] of [
      ['../components/IncomeRanks.tsx', 1],
      ['../components/HaloPanel.tsx', 2],
      ['../components/territoire/UnemploymentTab.tsx', 2],
      ['../components/MirrorMap.tsx', 1],
      ['../components/Legend.tsx', 1],
      ['../components/Diptych.tsx', 1],
      ['../components/proof/ProofOd.tsx', 1],
      ['../components/proof/ProofJobs.tsx', 1],
      ['../components/CounterBlock.tsx', 1],
    ] as const) {
      expect((src(file).match(/<ChartReadingTip\b/g) ?? []).length, file).toBe(n);
    }
    // Phrases de lecture rangées dans le « i », plus écrites dans le dessin
    expect(src('../components/IncomeRanks.tsx')).not.toContain(INCOME_STRIP_NOTE);
    expect(src('../components/HaloDotPlot.tsx')).not.toMatch(/className="dot-key-note"/);
    expect(src('../components/MirrorMap.tsx')).not.toContain(MIRROR_DISC_NOTE.sky);
  });
});
