import { describe, expect, it } from 'vitest';
import { computeDelta, computePoleStates, computeTotals, getSeries, isAccessible, lightingOrder, listOrder, poleStatus, statusCounts, type PoleState, type PoleStatus } from './accessibility';
import type { AccessFile, Pole } from './types';

const pole = (id: string, jobs: number | null): Pole => ({
  id,
  name: id,
  communes: [],
  jobs,
  jobs_year: 2023,
  jobs_source: 'EMP01',
  point: { lon: 0, lat: 0, method: 'test' },
  sky: { x: 0.5, y: 0.5 },
});

const poles = [pole('A', 1000), pole('B', 2000), pole('C', 4000)];

const access: AccessFile = {
  insee: '93066',
  processing_version: 't',
  modes: {
    transit: {
      d09: { out: [38, null, 52], ret: [41, null, 47], reason: [null, 'no_trip_within_120', null] },
      d14: { out: [38, 20, 52], ret: [70, 25, null], reason: [null, null, 'no_service_at_hour'] },
    },
    walk: { any: { out: [10, 200, 30], ret: [10, 200, 30] } },
  },
};

describe('isAccessible', () => {
  it('exige aller ET retour ≤ budget', () => {
    expect(isAccessible(38, 41, 45)).toBe(true);
    expect(isAccessible(45, 45, 45)).toBe(true);
    expect(isAccessible(38, 46, 45)).toBe(false);
    expect(isAccessible(46, 38, 45)).toBe(false);
  });
  it('null = non accessible (jamais 0 de substitution)', () => {
    expect(isAccessible(null, 10, 45)).toBe(false);
    expect(isAccessible(10, null, 45)).toBe(false);
  });
});

describe('poleStatus', () => {
  it('distingue aller seul possible', () => {
    expect(poleStatus(30, 70, 45)).toBe('out_only');
    expect(poleStatus(60, 30, 45)).toBe('none');
    expect(poleStatus(null, null, 45, 'not_computed')).toBe('unknown');
    expect(poleStatus(null, null, 45, 'no_trip_within_120')).toBe('none');
  });
});

describe('getSeries', () => {
  it('replie sur "any" pour les modes indépendants de l’heure', () => {
    expect(getSeries(access, 'walk', 'd06')?.out[0]).toBe(10);
    expect(getSeries(access, 'car', 'd09')).toBeNull();
  });
});

describe("séries calculées pour d'autres pôles (D-030)", () => {
  it('15 valeurs sous 44 astres : tout est « non calculé », aucun chiffre lu par position', () => {
    const astres = Array.from({ length: 44 }, (_, i) => ({ ...poles[0]!, id: `BE_${i}` }));
    const vieux = { any: { out: Array(15).fill(10), ret: Array(15).fill(10), reason: Array(15).fill(null) } };
    const states = computePoleStates(astres, { ...access, modes: { ...access.modes, transit: vieux } }, 'transit', 'd09', 60);
    expect(states.every((s) => s.status === 'unknown' && s.out === null && s.ret === null)).toBe(true);
  });

  /* Garde de longueur (arbitrage de Nicolas du 05/11, point 4) : TOUTE série par position dont la longueur n'est pas celle des
     astres affichés est refusée, quels que soient les identifiants des astres (plus seulement `BE_*`). */
  const allUnknown = (states: PoleState[]) => states.every((s) => s.status === 'unknown' && s.out === null && s.ret === null && s.reason === 'not_computed');
  const serie = (n: number, extra: Record<string, unknown> = {}) => ({ any: { out: Array(n).fill(10), ret: Array(n).fill(10), reason: Array(n).fill(null), ...extra } });
  const withTransit = (t: ReturnType<typeof serie>): AccessFile => ({ ...access, modes: { ...access.modes, transit: t } }) as unknown as AccessFile;

  it('série de 15 sur 44 astres : « non calculé », jamais une valeur', () => {
    const astres = Array.from({ length: 44 }, (_, i) => pole(`BE_${i}`, 1));
    expect(allUnknown(computePoleStates(astres, withTransit(serie(15)), 'transit', 'd09', 60))).toBe(true);
  });
  it('série de 44 sur 15 astres : « non calculé », jamais une valeur (même sans identifiant BE_)', () => {
    const quinze = Array.from({ length: 15 }, (_, i) => pole(`P_${i}`, 1));
    expect(allUnknown(computePoleStates(quinze, withTransit(serie(44)), 'transit', 'd09', 60))).toBe(true);
  });
  it('plus longue ou plus courte d’un seul élément : refusée', () => {
    expect(allUnknown(computePoleStates(poles, withTransit(serie(4)), 'transit', 'd09', 60))).toBe(true);
    expect(allUnknown(computePoleStates(poles, withTransit(serie(2)), 'transit', 'd09', 60))).toBe(true);
  });
  it('la bonne longueur est lue', () => {
    const states = computePoleStates(poles, withTransit(serie(3)), 'transit', 'd09', 60);
    expect(states.map((s) => s.status)).toEqual(['accessible', 'accessible', 'accessible']);
    expect(states.map((s) => s.out)).toEqual([10, 10, 10]);
  });
  it('reason ou dep de longueur différente : toute la série est refusée', () => {
    expect(allUnknown(computePoleStates(poles, withTransit(serie(3, { reason: Array(44).fill(null) })), 'transit', 'd09', 60))).toBe(true);
    expect(allUnknown(computePoleStates(poles, withTransit(serie(3, { dep: ['08:00'] })), 'transit', 'd09', 60))).toBe(true);
  });
  it('le réglage de marche (variants) est gardé de la même façon', () => {
    const f = { ...access, variants: { comfort: { transit: { d09: { out: Array(15).fill(10), ret: Array(15).fill(10) } } } } } as unknown as AccessFile;
    expect(allUnknown(computePoleStates(poles, f, 'transit', 'd09', 60, 'comfort'))).toBe(true);
  });
});

describe('totaux et deltas', () => {
  const at45 = computePoleStates(poles, access, 'transit', 'd09', 45);
  const at60 = computePoleStates(poles, access, 'transit', 'd09', 60);
  it('somme les postes des pôles accessibles', () => {
    expect(computeTotals(poles, at45)).toMatchObject({ accessibleCount: 1, jobs: 1000, totalJobs: 7000 });
    expect(computeTotals(poles, at60)).toMatchObject({ accessibleCount: 2, jobs: 5000 });
  });
  it('postes inconnus → total null', () => {
    const p2 = [pole('A', null), poles[1]!, poles[2]!];
    expect(computeTotals(p2, at45).jobs).toBeNull();
  });
  it('delta entre scénarios', () => {
    const d = computeDelta(poles, at45, at60);
    expect(d).toEqual({ gained: ['C'], lost: [], excluded: [], polesDelta: 1, jobsDelta: 4000 });
  });
  it('un pôle non calculé d’un côté ou de l’autre n’est jamais un gain ni une perte (audit, point 11)', () => {
    const st = (statuses: PoleStatus[]): PoleState[] =>
      statuses.map((status, index) => ({ index, id: poles[index]!.id, status, out: null, ret: null, reason: null }));
    // A : non calculé → accessible ; B : accessible → non calculé ; C : hors budget → accessible (seul vrai gain)
    const d = computeDelta(poles, st(['unknown', 'accessible', 'none']), st(['accessible', 'unknown', 'accessible']));
    expect(d.gained).toEqual(['C']);
    expect(d.lost).toEqual([]);
    expect(d.excluded).toEqual(['A', 'B']);
    expect(d.polesDelta).toBe(1);
    expect(d.jobsDelta).toBe(4000);
    // tout non calculé d'un côté : aucun écart
    expect(computeDelta(poles, st(['unknown', 'unknown', 'unknown']), st(['accessible', 'accessible', 'accessible']))).toMatchObject({
      gained: [],
      polesDelta: 0,
      jobsDelta: 0,
    });
  });
  it('éclipse : le soir, le retour fait perdre A', () => {
    const soir = computePoleStates(poles, access, 'transit', 'd14', 45);
    expect(soir.map((s) => s.status)).toEqual(['out_only', 'accessible', 'none']);
  });
  it('sans fichier : tout inconnu', () => {
    const s = computePoleStates(poles, null, 'transit', 'd09', 45);
    expect(s.every((x) => x.status === 'unknown')).toBe(true);
    expect(computeTotals(poles, s).hasData).toBe(false);
  });
  it('ordre d’allumage par aller croissant', () => {
    expect(lightingOrder(at60)).toEqual([0, 2]);
  });
});

describe('export partiel (POC)', () => {
  it('journée non calculée → tout « non calculé », compteur masqué', () => {
    const s = computePoleStates(poles, access, 'transit', 'd06', 60);
    expect(s.every((x) => x.status === 'unknown')).toBe(true);
    expect(computeTotals(poles, s)).toMatchObject({ hasData: false, accessibleCount: 0 });
  });
  it('mode non calculé → « non calculé »', () => {
    const s = computePoleStates(poles, access, 'bike_transit', 'd09', 60);
    expect(s.every((x) => x.status === 'unknown')).toBe(true);
  });
});

describe('liste du ciel', () => {
  it('compte les pôles par état', () => {
    const soir = computePoleStates(poles, access, 'transit', 'd14', 45);
    expect(statusCounts(soir)).toEqual({ accessible: 1, out_only: 1, none: 1, unknown: 0 });
  });
  it('accessibles d’abord, puis aller seulement, hors budget, non calculé', () => {
    const soir = computePoleStates(poles, access, 'transit', 'd14', 45);
    // B accessible, A aller seulement (retour 70 min), C hors budget (aller 52 min)
    expect(listOrder(poles, soir)).toEqual([1, 0, 2]);
  });
  it('à état égal : aller croissant, puis postes décroissants', () => {
    const s = computePoleStates(poles, access, 'transit', 'd09', 60);
    // A (38 min) et C (52 min) accessibles, B sans trajet
    expect(listOrder(poles, s)).toEqual([0, 2, 1]);
    const none = computePoleStates(poles, null, 'transit', 'd09', 60);
    expect(listOrder(poles, none)).toEqual([2, 1, 0]);
  });
});

describe("réglages de marche D-024 (variants) et Vélib' (clé any)", () => {
  // Fichier de test (valeurs fictives) au format de access/{insee}.json
  const file: AccessFile = {
    insee: '78396',
    processing_version: 't',
    modes: {
      transit: { d14: { out: [40, 50, 30], ret: [44, null, 35], reason: [null, 'no_trip_within_120', null] } },
      velib: { any: { out: [20, null, 25], ret: [22, null, 25], reason: [null, 'no_trip_within_120', null] } },
    },
    variants: {
      comfort: { transit: { d14: { out: [40, 50, 30], ret: [null, null, 35], reason: ['no_trip_within_120', 'no_trip_within_120', null] } } },
    },
  };
  it('sans clé : réglage par défaut (modes) ; avec clé : variants.{key}', () => {
    expect(computePoleStates(poles, file, 'transit', 'd14', 45).map((x) => x.status)).toEqual(['accessible', 'none', 'accessible']);
    expect(computePoleStates(poles, file, 'transit', 'd14', 45, 'comfort').map((x) => x.status)).toEqual(['out_only', 'none', 'accessible']);
  });
  it('réglage ou journée absents du fichier : non calculé, jamais un repli sur le défaut', () => {
    expect(getSeries(file, 'transit', 'd14', 'other')).toBeNull();
    expect(getSeries(file, 'transit', 'd09', 'comfort')).toBeNull();
    expect(computePoleStates(poles, file, 'transit', 'd09', 45, 'comfort').every((x) => x.status === 'unknown')).toBe(true);
  });
  it("Vélib' : mêmes valeurs pour les trois journées-types (clé any)", () => {
    expect(getSeries(file, 'velib', 'd06')).toBe(getSeries(file, 'velib', 'd14'));
    expect(computePoleStates(poles, file, 'velib', 'd06', 24).map((x) => x.status)).toEqual(['accessible', 'none', 'none']);
  });
});
