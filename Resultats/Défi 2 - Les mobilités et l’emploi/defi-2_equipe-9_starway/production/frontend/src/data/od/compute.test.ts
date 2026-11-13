import { describe, expect, it } from 'vitest';
import { checkOdIndex, checkSwodHeader, computeOd, destStatus, poleShares, returnComputed, selfPairState } from './compute';
import { parseSwod, type OdLeg } from './swod';
import { buildSwod, fixtureIndex } from './testkit';

const leg = (minutes: number | null, reason: OdLeg['reason'] = minutes == null ? 'no_trip_within_120' : null): OdLeg => ({ minutes, reason });

describe('destStatus : aller ET retour mesurés, chacun <= B', () => {
  it.each([
    [leg(30), leg(30), 30, 'accessible'],
    [leg(30), leg(31), 30, 'out_only'],
    [leg(31), leg(10), 30, 'none'],
    [leg(null), leg(10), 30, 'none'],
    [leg(20), leg(null), 30, 'out_only'],
    // retour non calculé : aller dans le budget = pas de verdict ; aller hors budget = écarté quand même
    [leg(20), leg(null, 'not_computed'), 30, 'unknown'],
    [leg(40), leg(null, 'not_computed'), 30, 'none'],
    [leg(null), leg(null, 'not_computed'), 30, 'none'],
    [leg(null, 'not_computed'), leg(10), 30, 'unknown'],
    [leg(null, 'origin_not_snapped'), leg(null, 'origin_not_snapped'), 30, 'unknown'],
  ] as const)('%o / %o à %i min : %s', (out, ret, b, expected) => {
    expect(destStatus(out, ret, b)).toBe(expected);
  });
});

/*
 * Jeu synthétique (valeurs arbitraires, jamais affichées) : 4 communes, origine = commune 0.
 * Pôle 0 = communes 0 et 1, pôle 1 = commune 2, commune 3 hors pôle.
 */
const N = 229;
const constSeries = (v: number) => Array.from({ length: N }, () => v);
const index = fixtureIndex({
  communes: ['A', 'B', 'C', 'D'],
  jobs: [100, 200, 300, 400],
  pole_of: [0, 0, 1, null],
  poles: [
    { id: 'P0', jobs: 300 },
    { id: 'P1', jobs: 300 },
  ],
  files: ['A'],
  complete: false,
  coverage: { transit: { origins: 1, complete: false, computed: ['A', 'B'] } },
});

const file = parseSwod(
  buildSwod({
    origin: 0,
    step: 5,
    first: 180,
    nSlots: N,
    maxTrip: 120,
    sections: [
      {
        mode: 0,
        kind: 'series',
        records: [
          // A vers B : 30 min à tous les départs ; B vers A : 25 min
          { dest: 1, out: constSeries(30), ret: constSeries(25) },
          // A vers C : 40 min ; retour non calculé (C n'est pas dans coverage.computed)
          { dest: 2, out: constSeries(40), ret: constSeries(253) },
        ],
      },
      { mode: 3, kind: 'scalar', records: [{ dest: 3, out: 15, ret: 16 }] },
    ],
  }),
);

describe('computeOd (synthétique)', () => {
  const sc = { origin: 'A', start: 540, end: 1020, budget: 45, mode: 'transit' as const };

  it('états des communes : enregistrement, commune d’origine, absente, retour non calculé', () => {
    const r = computeOd(index, file, sc);
    expect(r.status).toBe('ok');
    expect(r.timeDependent).toBe(true);
    const [a, b, c, d] = r.dests;
    expect(a).toMatchObject({ insee: 'A', status: 'self', record: false });
    // début 9h : départ le plus tardif qui arrive à l'heure = 8h30 (30 min)
    expect(b).toMatchObject({ status: 'accessible', out: { minutes: 30, dep: 510 }, ret: { minutes: 25 } });
    expect(c!.out).toEqual({ minutes: 40, reason: null, dep: 500 });
    expect(c).toMatchObject({ status: 'unknown', ret: { minutes: null, reason: 'not_computed' } });
    // D absente : aucun trajet à l'aller ; retour non calculé (export partiel, D hors coverage.computed)
    expect(d).toMatchObject({ status: 'none', record: false, out: { reason: 'no_trip_within_120' }, ret: { reason: 'not_computed' } });
  });

  it('parts des pôles : atteints / postes mesurables du pôle (commune de départ exclue), commune d’origine à part', () => {
    const r = computeOd(index, file, sc);
    expect(r.poles[0]).toMatchObject({ id: 'P0', jobs: 300, measurable: 200, reached: 200, self: 100, unknown: 0, notReached: 0 });
    expect(r.poles[0]!.share).toBeCloseTo(200 / 200);
    expect(r.poles[1]).toMatchObject({ id: 'P1', reached: 0, unknown: 300, share: 0 });
    expect(r.totals).toMatchObject({
      reachedInPoles: 200,
      reachedAll: 200,
      selfJobs: 100,
      unknownJobs: 300,
      polesJobs: 600,
      allJobs: 1000,
      measurableJobs: 900,
      measurableCommunes: 3,
      reachedCommunes: 1,
    });
    for (const p of r.poles) expect(p.reached + p.notReached + p.unknown + p.self).toBe(p.jobs);
    for (const p of r.poles) expect(p.reached + p.notReached + p.unknown).toBe(p.measurable);
  });

  it('budget plus court : la commune B passe hors budget (aller 30 min)', () => {
    const r = computeOd(index, file, { ...sc, budget: 25 });
    expect(r.dests[1]!.status).toBe('none');
    expect(r.poles[0]!.reached).toBe(0);
  });

  it('mode sans horaire : section scalaire, S et E sans effet', () => {
    const r1 = computeOd(index, file, { ...sc, mode: 'car' });
    const r2 = computeOd(index, file, { ...sc, mode: 'car', start: 600, end: 700 });
    expect(r1.timeDependent).toBe(false);
    expect(r1.dests[3]).toMatchObject({ status: 'accessible', out: { minutes: 15 }, ret: { minutes: 16 } });
    expect(r2.dests.map((x) => x.status)).toEqual(r1.dests.map((x) => x.status));
  });

  it('voiture avec trafic moyen DiRIF (D-029) : section car, indice de la tranche de chaque sens', () => {
    const congestion = {
      periods: [
        { id: 'p06_10', start: '06:00', end: '10:00', index: 1.75 },
        { id: 'p10_16', start: '10:00', end: '16:00', index: 1.39 },
        { id: 'p16_20', start: '16:00', end: '20:00', index: 1.95 },
      ],
    } as unknown as NonNullable<Parameters<typeof computeOd>[2]['congestion']>;
    // 9h-17h : 15 x 1,75 = 26,25 -> 26 ; 16 x 1,95 = 31,2 -> 31
    const r = computeOd(index, file, { ...sc, mode: 'car_traffic', congestion });
    expect(r.dests[3]).toMatchObject({ status: 'accessible', out: { minutes: 26 }, ret: { minutes: 31 } });
    expect(computeOd(index, file, { ...sc, mode: 'car_traffic', congestion, budget: 30 }).dests[3]!.status).toBe('out_only');
    // 6h-22h : aucune mesure avant 6h ni après 20h, temps route vide gardé
    expect(computeOd(index, file, { ...sc, mode: 'car_traffic', congestion, start: 360, end: 1320 }).dests[3]).toMatchObject({ out: { minutes: 15 }, ret: { minutes: 16 } });
    // sans indices publiés : pas de calcul inventé
    expect(computeOd(index, file, { ...sc, mode: 'car_traffic' }).status).toBe('mode_not_in_od');
  });

  it('scénarios non calculables : ciel neutre, aucun état inventé', () => {
    expect(computeOd(index, file, { ...sc, origin: 'B' }).status).toBe('origin_not_computed');
    expect(computeOd(index, null, sc).status).toBe('origin_not_computed');
    expect(computeOd(index, file, { ...sc, mode: 'bike_transit' }).status).toBe('mode_not_in_od');
    expect(computeOd(index, file, { ...sc, mode: 'walk' }).status).toBe('mode_not_computed');
    // début 4h : la fenêtre de 2 h commencerait avant le premier départ de la grille
    expect(computeOd(index, file, { ...sc, start: 240 }).status).toBe('invalid_shift');
    expect(computeOd(index, file, { ...sc, start: 541 }).status).toBe('invalid_shift');
    expect(computeOd(index, file, { ...sc, end: 540 }).status).toBe('invalid_shift');
    const r = computeOd(index, file, { ...sc, origin: 'B' });
    expect(r.dests).toEqual([]);
    expect(r.totals).toBeNull();
  });

  it('poste de nuit : l’aller lit le début, le retour la série à l’heure de fin du lendemain matin', () => {
    // retour : 25 min à tous les départs sauf 20 min à 6h (créneau (360 - 180) / 5 = 36) ; aller : 20 min
    const ret = constSeries(25);
    ret[36] = 20;
    const night = parseSwod(
      buildSwod({
        origin: 0,
        step: 5,
        first: 180,
        nSlots: N,
        maxTrip: 120,
        sections: [{ mode: 0, kind: 'series', records: [{ dest: 1, out: constSeries(20), ret }] }],
      }),
    );
    // 22h-6h : départ à 21h40 pour arriver à 22h, retour au créneau de 6h
    const r = computeOd(index, night, { ...sc, start: 1320, end: 360 });
    expect(r.status).toBe('ok');
    expect(r.dests[1]).toMatchObject({ status: 'accessible', out: { minutes: 20, dep: 1300 }, ret: { minutes: 20 } });
    // même poste, fin à 6h05 : le retour change, l'aller non (preuve que la fin lit sa propre série)
    expect(computeOd(index, night, { ...sc, start: 1320, end: 365 }).dests[1]).toMatchObject({ out: { minutes: 20, dep: 1300 }, ret: { minutes: 25 } });
    // 21h-5h30
    expect(computeOd(index, night, { ...sc, start: 1260, end: 330 }).status).toBe('ok');
    // aller ET retour dans le budget : à 22 min, le retour de 6h (20) passe, celui de 6h05 (25) écarte l'aller-retour
    expect(computeOd(index, night, { ...sc, start: 1320, end: 360, budget: 22 }).dests[1]!.status).toBe('accessible');
    expect(computeOd(index, night, { ...sc, start: 1320, end: 365, budget: 22 }).dests[1]!.status).toBe('out_only');
    // fins avant le début qui ne sont pas des postes de nuit : refusées
    expect(computeOd(index, night, { ...sc, start: 1020, end: 540 }).status).toBe('invalid_shift'); // 17h-9h
    expect(computeOd(index, night, { ...sc, start: 1320, end: 480 }).status).toBe('invalid_shift'); // 22h-8h
    expect(computeOd(index, night, { ...sc, start: 1200, end: 360 }).status).toBe('invalid_shift'); // 20h-6h
    // les modes sans horaire ignorent S et E, de nuit comme de jour (voiture : section scalaire absente ici)
    expect(computeOd(index, file, { ...sc, mode: 'car', start: 1320, end: 360 }).timeDependent).toBe(false);
  });

  it('règle « commune d’origine » : une seule fonction, ni atteinte ni non atteinte', () => {
    expect(selfPairState().status).toBe('self');
    const shares = poleShares(index, [{ dest: 0, insee: 'A', jobs: 100, pole: 0, record: false, ...selfPairState() }]);
    expect(shares[0]).toMatchObject({ reached: 0, notReached: 0, self: 100 });
  });

  it('returnComputed suit coverage, sans rien supposer si la couverture manque', () => {
    expect(returnComputed(index, 'transit', 'B')).toBe(true);
    expect(returnComputed(index, 'transit', 'C')).toBe(false);
    expect(returnComputed(index, 'walk', 'C')).toBe(false); // couverture absente, export partiel
    expect(returnComputed({ ...index, complete: true }, 'walk', 'C')).toBe(true);
  });

  it('contrôles de cohérence : index et en-tête de fichier', () => {
    expect(checkOdIndex(index, [{ id: 'P0', jobs: 300 }, { id: 'P1', jobs: 300 }])).toEqual([]);
    expect(checkOdIndex(index, [{ id: 'P1', jobs: 300 }, { id: 'P0', jobs: 300 }]).length).toBe(2);
    expect(checkOdIndex({ ...index, poles: [{ id: 'P0', jobs: 301 }, { id: 'P1', jobs: 300 }] }, [{ id: 'P0', jobs: 301 }, { id: 'P1', jobs: 300 }])).toEqual([
      'P0 : somme des communes 300 au lieu de 301',
    ]);
    expect(checkSwodHeader(index, file, 'A')).toEqual([]);
    expect(checkSwodHeader(index, file, 'B')).toEqual(['origine A au lieu de B']);
  });
});
