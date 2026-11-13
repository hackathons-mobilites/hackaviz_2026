import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatInt } from '../../../data/format';
import type { ItinTrip } from '../../../data/itineraries';
import type { TransitOption } from '../../../data/subscriptions';
import {
  alternativesDir,
  ALT_CALC_TIP,
  ALT_EARLIER_GAP_TEXT,
  ALT_MISMATCH_TEXT,
  ALT_STATE_TEXT,
  ALT_TABS,
  CALC_WITH,
  CALC_WITHOUT,
  asItinTrip,
  carbonText,
  cellOf,
  compareText,
  costText,
  coverageLetter,
  earlierDeparturesGap,
  isAlternativesFile,
  isCoverageFile,
  linesOf,
  matchesWalkSetting,
  resolveAlternatives,
  sameAsCalcText,
  transfersText,
  tripCost,
  walkCoverageUsable,
  alternativesSource,
  type AlternativesCoverage,
  type AlternativesFile,
  type AltTrip,
} from './alternatives';
import { loadCommuneAlternatives, loadCoverage, resetAlternativesCache } from './loadAlternatives';

/** Échantillon réel réduit (Maisons-Laffitte, quatre astres, journée 6h-14h, `docs/echantillons/alternatives-1/`). */
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./__fixtures__/alternatives-78358-reduit.json', import.meta.url)), 'utf-8')) as {
  coverage: AlternativesCoverage;
  commune: AlternativesFile;
};
const { coverage, commune } = fixture;
const [P_C_ONLY, P_B_AND_C, P_NONE, P_NO_TRIP] = commune.poles as [string, string, string, string];
const DAY = 'd06' as const;

/** Un trajet A publié, de lignes données (la marche n'entre pas dans la suite des lignes). */
function tripA(lines: (string | null)[], over: Partial<ItinTrip> = {}): ItinTrip {
  return {
    status: 'ok',
    dep: '08:00',
    arr: '08:45',
    min: 45,
    rides: lines.length,
    legs: [
      { m: 'walk', dep: '08:00', arr: '08:05', min: 5, dist_m: 300, role: 'access', from: null, to: 'Arrêt' },
      ...lines.map((line) => ({ m: 'metro' as const, dep: '08:05', arr: '08:40', min: 35, dist_m: 9000, line })),
    ],
    tickets: { metro_train_rer: 1, bus_tram: 0, airport: 0, cost_eur: 2.55, status: 'ok' },
    co2_g: { value: 80, status: 'ok' },
    ...over,
  };
}

const pass = (over: Partial<TransitOption> = {}): TransitOption => ({
  id: 'navigo_month',
  label: 'Navigo Mois',
  kind: 'pass',
  price: { eur: 90.8, per: 'month' },
  covers: { rail: 'yes', surface: 'yes', ter: 'yes', airport_rail: 'yes', orlyval: 'no' },
  unknown_reasons: {},
  ...over,
});

const NO_DASH = /[\u2013\u2014]/;

describe('fichiers du contrat', () => {
  it('reconnaît la couverture et le fichier de commune, sans les confondre', () => {
    expect(isCoverageFile(coverage)).toBe(true);
    expect(isAlternativesFile(commune)).toBe(true);
    expect(isAlternativesFile(coverage)).toBe(false);
    expect(isCoverageFile(commune)).toBe(false);
    expect(isCoverageFile('<!doctype html>')).toBe(false);
  });
});

describe('couverture : trois lettres, jamais de valeur devinée', () => {
  it('lit la lettre par identifiant', () => {
    expect(coverageLetter(coverage, '78358', P_C_ONLY, DAY, 'out')).toBe('a');
    expect(coverageLetter(coverage, '78358', P_NONE, DAY, 'out')).toBe('s');
  });

  it('commune à null ou absente, astre inconnu, journée inconnue : pas encore calculé', () => {
    expect(coverageLetter(coverage, '93066', P_C_ONLY, DAY, 'out')).toBe('n');
    expect(coverageLetter(coverage, '00000', P_C_ONLY, DAY, 'out')).toBe('n');
    expect(coverageLetter(coverage, '78358', 'BE_INCONNU', DAY, 'out')).toBe('n');
    expect(coverageLetter(coverage, '78358', P_C_ONLY, 'd09', 'out')).toBe('n');
  });

  it('série tronquée : pas encore calculé, jamais lue par position', () => {
    const shorter: AlternativesCoverage = { ...coverage, communes: { '78358': { [DAY]: { out: 'aa', ret: 'aa' } } } };
    expect(coverageLetter(shorter, '78358', P_C_ONLY, DAY, 'out')).toBe('n');
  });
});

describe('quatre états strictement distincts', () => {
  const realCell = (pole: string, dir: 'out' | 'ret') => cellOf(commune, pole, DAY, dir)!;

  it('plusieurs trajets quand a_lines correspond à A', () => {
    const cell = realCell(P_C_ONLY, 'out');
    const r = resolveAlternatives({ letter: 'a', cell, a: tripA(cell.a_lines!) });
    expect(r.state).toBe('with');
    expect(r.b).toBeNull();
    expect(r.c?.legs.length).toBeGreaterThan(0);
  });

  it('calculé sans autre trajet', () => {
    const cell = realCell(P_NONE, 'out');
    expect(resolveAlternatives({ letter: 's', cell, a: tripA(cell.a_lines!) }).state).toBe('without');
  });

  it("calculé sans aucun trajet (status) : sans autre trajet, et rien à montrer si A n'existe pas non plus", () => {
    const cell = realCell(P_NO_TRIP, 'out');
    expect(cell.status).toBe('no_trip_in_matrix');
    expect(resolveAlternatives({ letter: 's', cell, a: null })).toMatchObject({ state: 'without', a: null });
  });

  it("pas de couverture, case absente ou état contradictoire : pas encore calculé, jamais « pas d'autre trajet »", () => {
    const cell = realCell(P_NONE, 'out');
    const a = tripA(cell.a_lines!);
    expect(resolveAlternatives({ letter: 'n', cell: null, a }).state).toBe('pending');
    expect(resolveAlternatives({ letter: 's', cell: null, a }).state).toBe('pending');
    expect(resolveAlternatives({ letter: 'a', cell, a }).state).toBe('pending');
    expect(resolveAlternatives({ letter: 's', cell: { state: 'pas_encore_calcule' }, a }).state).toBe('pending');
  });

  it("a_lines différent de A : case calculée non affichée (jamais « pas encore calculé »), A reste affiché, rien n'est mélangé", () => {
    const cell = realCell(P_C_ONLY, 'out');
    const a = tripA(['ZZZ']);
    expect(resolveAlternatives({ letter: 'a', cell, a })).toMatchObject({ state: 'mismatch', mismatch: 'other_trip', a, b: null, c: null });
    const without = realCell(P_NONE, 'out');
    expect(resolveAlternatives({ letter: 's', cell: without, a })).toMatchObject({ state: 'mismatch', mismatch: 'other_trip', a, b: null, c: null });
  });

  it("calcul sans trajet A (status) alors que le panneau en a un : calculé, non affiché, jamais « pas d'autre trajet »", () => {
    const a = tripA(['A']);
    expect(resolveAlternatives({ letter: 's', cell: realCell(P_NO_TRIP, 'out'), a })).toMatchObject({ state: 'mismatch', mismatch: 'other_trip', a });
  });

  it("A absent du panneau alors que le calcul en a un : calculé, non affiché, raison propre", () => {
    expect(resolveAlternatives({ letter: 'a', cell: realCell(P_C_ONLY, 'out'), a: null })).toMatchObject({ state: 'mismatch', mismatch: 'no_published_trip', b: null, c: null });
    expect(resolveAlternatives({ letter: 's', cell: realCell(P_NONE, 'out'), a: null })).toMatchObject({ state: 'mismatch', mismatch: 'no_published_trip' });
  });

  it("l'état « non affiché » n'apparaît que pour une case calculée", () => {
    const a = tripA(['ZZZ']);
    expect(resolveAlternatives({ letter: 'n', cell: realCell(P_C_ONLY, 'out'), a }).state).toBe('pending');
    expect(resolveAlternatives({ letter: 'a', cell: null, a }).state).toBe('pending');
    expect(resolveAlternatives({ letter: 'a', cell: realCell(P_NONE, 'out'), a }).state).toBe('pending');
  });

  it('case « avec alternatives » sans trajet B ni C : pas encore calculé (fichier incohérent)', () => {
    const cell = { state: CALC_WITH, a_lines: ['A'], B: null, C: null };
    expect(resolveAlternatives({ letter: 'a', cell, a: tripA(['A']) }).state).toBe('pending');
  });

  it('C identique à B : un seul trajet, et le fait est dit', () => {
    const b = realCell(P_B_AND_C, 'ret').B as AltTrip;
    const cell = { state: CALC_WITH, a_lines: ['A'], B: b, C: { same_as: 'B' as const } };
    expect(resolveAlternatives({ letter: 'a', cell, a: tripA(['A']) })).toMatchObject({ state: 'with', b, c: b, cSameAsB: true });
  });

  it('cellule « sans autre trajet » : aucune alternative exposée', () => {
    const cell = { state: CALC_WITHOUT, a_lines: ['A'], B: null, C: null };
    expect(resolveAlternatives({ letter: 's', cell, a: tripA(['A']) })).toMatchObject({ state: 'without', b: null, c: null });
  });

  it('la marche ne compte pas dans la suite des lignes', () => {
    expect(linesOf(tripA(['A', '7']))).toEqual(['A', '7']);
  });
});

describe('coût selon les abonnements', () => {
  it('sans abonnement : le prix au ticket', () => {
    const c = tripCost(tripA(['A']), null, null);
    expect(c.status).toBe('tickets');
    expect(costText(c, null, {}, '1 ticket Métro-Train-RER')).toEqual({ value: '2,55\u00a0€', note: 'Au ticket, plein tarif (1 ticket Métro-Train-RER).' });
  });

  it('avec un abonnement qui couvre : 0, dit comme inclus', () => {
    const option = pass();
    const c = tripCost(tripA(['A']), option, null);
    expect(c.status).toBe('included');
    expect(costText(c, option, {}, null)).toEqual({ value: '0,00\u00a0€', note: 'Inclus dans votre Navigo Mois.' });
  });

  it('prix inconnu : dit tel quel, jamais 0, jamais estimé', () => {
    const trip = tripA(['X'], { tickets: { metro_train_rer: null, bus_tram: null, airport: null, cost_eur: null, status: 'unknown', reasons: ['ligne sans titre relevé'] } });
    for (const option of [null, pass()]) {
      const t = costText(tripCost(trip, option, null), option, {}, null);
      expect(t.value).toBe('Prix inconnu');
      expect(t.note).toBe('ligne sans titre relevé.');
    }
  });

  it("titre complémentaire : ce qui n'est pas couvert, avec son libellé", () => {
    const trip = tripA(['X'], { legs: [{ m: 'metro', dep: '08:05', arr: '08:40', min: 35, dist_m: 9000, line: 'ORLYVAL' }] });
    const option = pass();
    const extra = { orlyval_ticket: { label: 'Ticket Orlyval', eur: 14 } };
    const c = tripCost(trip, option, { transit: { extra_titles: extra, unpriced_agencies: {}, options: [], not_proposed: [] } } as never);
    expect(costText(c, option, extra, null)).toEqual({ value: '14,00\u00a0€', note: 'En plus de votre Navigo Mois : Ticket Orlyval, non couvert.' });
  });
});

describe('carbone', () => {
  it('valeur publiée, ou la raison, jamais une estimation', () => {
    expect(carbonText({ value: 1234, status: 'ok' }).value).toBe(`${formatInt(1234)}\u00a0g CO2e (estimation)`); // V4 (audit du 11/11)
    expect(carbonText({ value: null, status: 'unknown', reason: 'facteur non publié pour la ligne X' })).toEqual({ value: 'Inconnu', note: 'Carbone non calculé : facteur non publié pour la ligne X.' });
    expect(carbonText(undefined).value).toBe('Inconnu');
  });
});

describe('comparaison avec le trajet retenu', () => {
  const a = tripA(['A'], { min: 45, rides: 2, tickets: { metro_train_rer: 2, bus_tram: 0, airport: 0, cost_eur: 5.1, status: 'ok' } });
  const other = (over: Partial<ItinTrip>) => tripA(['B'], { min: 60, rides: 1, ...over });
  const costs = (t: ItinTrip) => tripCost(t, null, null);

  it('prix et temps, calculés', () => {
    const b = other({});
    expect(compareText('B', a, costs(a), b, costs(b))).toBe('Par rapport au trajet retenu : 2,55\u00a0€ de moins, 15\u00a0min de plus.');
  });

  it('C : les correspondances et le temps', () => {
    const c = other({ rides: 1 });
    expect(compareText('C', a, costs(a), c, costs(c))).toBe('Par rapport au trajet retenu : 1 correspondance de moins, 15\u00a0min de plus.');
  });

  it('égalités écrites, pas de chiffre nul', () => {
    const b = tripA(['B'], { min: 45, rides: 2, tickets: a.tickets });
    expect(compareText('B', a, costs(a), b, costs(b))).toBe('Par rapport au trajet retenu : même prix, même durée.');
  });

  it("prix inconnu : l'écart de prix n'est pas écrit", () => {
    const b = other({ tickets: { metro_train_rer: null, bus_tram: null, airport: null, cost_eur: null, status: 'unknown' } });
    expect(compareText('B', a, costs(a), b, costs(b))).toBe('Par rapport au trajet retenu : 15\u00a0min de plus.');
  });

  it('avec abonnement : même prix quand les deux sont couverts', () => {
    const option = pass();
    const b = other({});
    expect(compareText('B', a, tripCost(a, option, null), b, tripCost(b, option, null))).toBe('Par rapport au trajet retenu : même prix, 15\u00a0min de plus.');
  });

  it('B ou C plus court que le trajet retenu : dit simplement', () => {
    const c = other({ min: 44, rides: 1 });
    expect(compareText('C', a, costs(a), c, costs(c))).toBe('Par rapport au trajet retenu : 1 correspondance de moins, 1 min de moins.');
  });

  it('A : rien à comparer', () => {
    expect(compareText('A', a, costs(a), a, costs(a))).toBeNull();
  });
});

describe('phrases', () => {
  it('nombre de correspondances', () => {
    expect([0, 1, 2, 3].map(transfersText)).toEqual(['À pied', 'Sans correspondance', '1 correspondance', '2 correspondances']);
  });

  it('B ou C sans trajet propre', () => {
    expect(sameAsCalcText('C', tripA(['A']))).toBe('Le trajet retenu est aussi celui qui a le moins de correspondances.');
    expect(sameAsCalcText('B', tripA(['A']))).toBe('Le trajet retenu est aussi le moins cher.');
    expect(sameAsCalcText('B', tripA(['A'], { tickets: { metro_train_rer: null, bus_tram: null, airport: null, cost_eur: null, status: 'unknown' } }))).toContain("n'a de prix connu");
  });

  it("onglet A : « Trajet retenu » (retour de Cyril du 11/11), jamais « le plus rapide » (B ou C peut être plus court au même départ)", () => {
    expect(ALT_TABS.map((t) => t.label)).toEqual(['Trajet retenu', 'Le moins cher', 'Le moins de correspondances']);
    const all = [...ALT_TABS.map((t) => t.label), ALT_CALC_TIP, sameAsCalcText('B', tripA(['A'])), sameAsCalcText('C', tripA(['A']))].join(' ');
    expect(all.toLowerCase()).not.toContain('plus rapide');
  });

  it('les quatre états ont des phrases distinctes ; une case calculée ne dit jamais « pas encore calculé »', () => {
    const states = Object.values(ALT_STATE_TEXT);
    expect(new Set(states).size).toBe(states.length);
    for (const why of Object.values(ALT_MISMATCH_TEXT)) expect(why.toLowerCase()).not.toContain('pas encore');
    expect(ALT_STATE_TEXT.mismatch.toLowerCase()).not.toContain('pas encore');
  });

  it('aucune phrase ne contient de tiret long, ni « offre »', () => {
    const texts = [
      costText(tripCost(tripA(['A']), null, null), null, {}, null).note,
      sameAsCalcText('B', tripA(['A'])),
      sameAsCalcText('C', tripA(['A'])),
      ...Object.values(ALT_STATE_TEXT),
      ...Object.values(ALT_MISMATCH_TEXT),
      ALT_CALC_TIP,
      ALT_EARLIER_GAP_TEXT,
      ...ALT_TABS.map((t) => t.label),
      compareText('B', tripA(['A']), tripCost(tripA(['A']), null, null), tripA(['B']), tripCost(tripA(['B']), null, null)),
    ].join(' ');
    expect(texts).not.toMatch(NO_DASH);
    expect(texts.toLowerCase()).not.toContain('offre');
  });
});

describe('données réelles réduites', () => {
  it('B et C du fichier sont des trajets lisibles par les fonctions de coût', () => {
    const cell = cellOf(commune, P_B_AND_C, DAY, 'ret')!;
    const b = cell.B as AltTrip;
    const t = asItinTrip(b);
    expect(t.status).toBe('ok');
    expect(tripCost(t, null, null).extra_eur).toBe(b.tickets.cost_eur);
  });
});

describe('chargeur', () => {
  beforeEach(() => resetAlternativesCache());
  const dataset = { origin: 'real' as const, base: '/data/' };

  it('404 : null, sans exception', async () => {
    const fetcher = vi.fn(async () => new Response('absent', { status: 404 }));
    await expect(loadCoverage(dataset, fetcher as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('page HTML du serveur à la place du fichier : null', async () => {
    const fetcher = vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(loadCoverage(dataset, fetcher as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('une seule requête par session', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(coverage), { status: 200, headers: { 'content-type': 'application/json' } }));
    const first = await loadCoverage(dataset, fetcher as unknown as typeof fetch);
    await loadCoverage(dataset, fetcher as unknown as typeof fetch);
    expect(first?.contract).toBe(coverage.contract);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('données de démonstration : rien n’est demandé', async () => {
    const fetcher = vi.fn();
    await expect(loadCoverage({ origin: 'demo' }, fetcher as unknown as typeof fetch)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/**
 * Réglage de marche « confort » (phase G, contrat « Réglage confort ») : dossier `alternatives_comfort/`, mêmes clés, `walk_setting:
 * "comfort"` et `comfort_note: null`. Fixtures minimales construites pour le test à partir de l'échantillon réduit (pas une donnée
 * publiée) : la case de P_C_ONLY y suit un trajet A confort de lignes différentes de celles du réglage normal.
 */
describe('réglage confort (phase G)', () => {
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  const notFound = () => new Response('absent', { status: 404 });
  const dataset = { origin: 'real' as const, base: '/data/' };
  const COMFORT_LINES = ['BUS_CONFORT'];
  const normalCell = cellOf(commune, P_C_ONLY, DAY, 'out')!;
  const comfortCell = { ...normalCell, a_lines: COMFORT_LINES };
  const comfortCoverage: AlternativesCoverage = {
    ...coverage,
    walk_setting: 'comfort',
    comfort_note: null,
    communes: { '78358': { [DAY]: { out: 'annn', ret: 'annn' } }, '93066': null },
  };
  const comfortFile: AlternativesFile = {
    ...commune,
    walk_setting: 'comfort',
    days: { [DAY]: { out: [comfortCell, { state: 'pas_encore_calcule' }, { state: 'pas_encore_calcule' }, { state: 'pas_encore_calcule' }] } },
  };
  /** Serveur de test : le dossier normal toujours publié, le dossier confort selon `comfort` (null = 404). */
  const server = (comfort: { cov: unknown; file: unknown } | null) =>
    vi.fn(async (url: string) => {
      if (url === '/data/alternatives/coverage.json') return json(coverage);
      if (url === '/data/alternatives/78358.json.gz') return json(commune);
      if (comfort && url === '/data/alternatives_comfort/coverage.json') return json(comfort.cov);
      if (comfort && url === '/data/alternatives_comfort/78358.json.gz') return json(comfort.file);
      return notFound();
    });
  beforeEach(() => resetAlternativesCache());

  it('dossier dérivé du réglage : défaut → alternatives, confort → alternatives_comfort, identifiant douteux → rien', () => {
    expect(alternativesDir(null)).toBe('alternatives');
    expect(alternativesDir('comfort')).toBe('alternatives_comfort');
    expect(alternativesDir('../x')).toBeNull();
  });

  it('réglage normal inchangé : même URL, aucune exigence de walk_setting, une seule requête', async () => {
    const fetcher = server(null);
    const cov = await loadCoverage(dataset, fetcher as unknown as typeof fetch);
    const withoutSetting = { ...coverage, walk_setting: undefined };
    resetAlternativesCache();
    const old = await loadCoverage(dataset, vi.fn(async () => json(withoutSetting)) as unknown as typeof fetch);
    expect(cov?.walk_setting).toBe('normal');
    expect(old).not.toBeNull();
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(['/data/alternatives/coverage.json']);
    expect(matchesWalkSetting(coverage, null)).toBe(true);
  });

  it('confort lu dans son dossier quand le réglage est confort, caches séparés du normal', async () => {
    const fetcher = server({ cov: comfortCoverage, file: comfortFile });
    const normal = await loadCoverage(dataset, fetcher as unknown as typeof fetch);
    const comfort = await loadCoverage(dataset, fetcher as unknown as typeof fetch, 'comfort');
    await loadCoverage(dataset, fetcher as unknown as typeof fetch, 'comfort');
    const file = await loadCommuneAlternatives(dataset, '78358', fetcher as unknown as typeof fetch, 'comfort');
    expect(normal?.walk_setting).toBe('normal');
    expect(comfort?.walk_setting).toBe('comfort');
    expect(comfort?.comfort_note).toBeNull();
    expect(file?.walk_setting).toBe('comfort');
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      '/data/alternatives/coverage.json',
      '/data/alternatives_comfort/coverage.json',
      '/data/alternatives_comfort/78358.json.gz',
    ]);
    expect(walkCoverageUsable(comfort, '78358', P_C_ONLY, DAY)).toBe(true);
  });

  it('404 du dossier confort (pas encore publié) : null, et repli sur le comportement actuel', async () => {
    const fetcher = server(null);
    const comfort = await loadCoverage(dataset, fetcher as unknown as typeof fetch, 'comfort');
    expect(comfort).toBeNull();
    expect(walkCoverageUsable(comfort, '78358', P_C_ONLY, DAY)).toBe(false);
    await expect(loadCommuneAlternatives(dataset, '78358', fetcher as unknown as typeof fetch, 'comfort')).resolves.toBeNull();
  });

  it("refus d'une couverture ou d'un fichier d'un autre réglage dans le dossier confort", async () => {
    const fetcher = server({ cov: coverage, file: commune });
    await expect(loadCoverage(dataset, fetcher as unknown as typeof fetch, 'comfort')).resolves.toBeNull();
    await expect(loadCommuneAlternatives(dataset, '78358', fetcher as unknown as typeof fetch, 'comfort')).resolves.toBeNull();
    resetAlternativesCache();
    const withoutSetting = { ...comfortCoverage, walk_setting: undefined };
    await expect(loadCoverage(dataset, server({ cov: withoutSetting, file: comfortFile }) as unknown as typeof fetch, 'comfort')).resolves.toBeNull();
    expect(matchesWalkSetting(coverage, 'comfort')).toBe(false);
    expect(matchesWalkSetting(comfortCoverage, 'comfort')).toBe(true);
  });

  it('case confort pas encore calculée (commune à null, lettre n) : repli, jamais « pas d’autre trajet »', () => {
    expect(walkCoverageUsable(comfortCoverage, '93066', P_C_ONLY, DAY)).toBe(false);
    expect(walkCoverageUsable(comfortCoverage, '78358', P_NONE, DAY)).toBe(false);
    expect(walkCoverageUsable(comfortCoverage, '78358', P_C_ONLY, 'd09')).toBe(false);
    expect(resolveAlternatives({ letter: coverageLetter(comfortCoverage, '78358', P_NONE, DAY, 'out'), cell: cellOf(comfortFile, P_NONE, DAY, 'out'), a: tripA(['A']) }).state).toBe('pending');
  });

  it('bloc « Trajet » : dossier lu selon le réglage de marche (défaut, confort publié, repli)', () => {
    const k = { insee: '78358', poleId: P_C_ONLY, day: DAY };
    expect(alternativesSource({ ...k, walkKey: null, walkId: null, walkCov: null })).toBe('default');
    expect(alternativesSource({ ...k, walkKey: 'comfort', walkId: 'comfort', walkCov: comfortCoverage })).toBe('walk');
    // 404 ou couverture pas encore chargée, réglage absent de meta.walk_settings, case ou commune pas encore calculée en confort
    expect(alternativesSource({ ...k, walkKey: 'comfort', walkId: 'comfort', walkCov: null })).toBe('fallback');
    expect(alternativesSource({ ...k, walkKey: 'comfort', walkId: null, walkCov: comfortCoverage })).toBe('fallback');
    expect(alternativesSource({ ...k, poleId: P_NONE, walkKey: 'comfort', walkId: 'comfort', walkCov: comfortCoverage })).toBe('fallback');
    expect(alternativesSource({ ...k, insee: '93066', walkKey: 'comfort', walkId: 'comfort', walkCov: comfortCoverage })).toBe('fallback');
  });

  it("a_lines confort comparé à l'itinéraire confort : plusieurs trajets ; à l'itinéraire normal : calcul fait, non affiché", () => {
    const letter = coverageLetter(comfortCoverage, '78358', P_C_ONLY, DAY, 'out');
    const cell = cellOf(comfortFile, P_C_ONLY, DAY, 'out');
    expect(resolveAlternatives({ letter, cell, a: tripA(COMFORT_LINES) }).state).toBe('with');
    expect(resolveAlternatives({ letter, cell, a: tripA(normalCell.a_lines!) })).toMatchObject({ state: 'mismatch', mismatch: 'other_trip' });
  });

  it('comfort_note null : la couverture reste lisible', () => {
    expect(isCoverageFile(comfortCoverage)).toBe(true);
    expect(isAlternativesFile(comfortFile)).toBe(true);
  });

  it('écart de palier 2 (11/11) : une ligne au « i » seulement si cherché en normal et pas en confort, rien si le champ manque', () => {
    const gap: AlternativesFile = {
      ...comfortFile,
      earlier_departures: { d06: false, d09: false, d14: false },
      earlier_departures_normal: { d06: true, d09: true, d14: true },
    };
    expect(earlierDeparturesGap(gap, DAY)).toBe(true);
    // cherché dans les deux réglages, ni dans l'un ni dans l'autre, réseau pas calculé (null) : rien
    expect(earlierDeparturesGap({ ...gap, earlier_departures: { [DAY]: true } }, DAY)).toBe(false);
    expect(earlierDeparturesGap({ ...gap, earlier_departures_normal: { [DAY]: false } }, DAY)).toBe(false);
    expect(earlierDeparturesGap({ ...gap, earlier_departures: { [DAY]: null } }, DAY)).toBe(false);
    // champ absent (fichier normal, ou export confort sans les sources normales) : rien
    expect(earlierDeparturesGap(comfortFile, DAY)).toBe(false);
    expect(earlierDeparturesGap({ ...comfortFile, earlier_departures: { [DAY]: false } }, DAY)).toBe(false);
    expect(earlierDeparturesGap(commune, DAY)).toBe(false);
    expect(earlierDeparturesGap(null, DAY)).toBe(false);
    expect(ALT_EARLIER_GAP_TEXT).toBe(
      "Pour cette commune, en réglage confort, les départs plus tôt n'ont pas été cherchés : il peut y avoir moins d'autres trajets qu'en réglage normal.",
    );
  });
});
