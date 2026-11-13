import { describe, expect, it } from 'vitest';
import { trafficLeg, trafficSeries, withCarTraffic, periodText, trafficLegText } from './congestion';
import type { AccessFile, CarCongestionMeta, Meta } from './types';

/** Périodes de meta.car_congestion (indices DiRIF de novembre 2025, ROAD01) ; temps des cas : FIXTURES. */
const CC = {
  periods: [
    { id: 'p06_10', start: '06:00', end: '10:00', index: 1.75 },
    { id: 'p10_16', start: '10:00', end: '16:00', index: 1.39 },
    { id: 'p16_20', start: '16:00', end: '20:00', index: 1.95 },
  ],
  texts: { no_period: 'pas de mesure de la DiRIF à cette heure', outside_period: 'trajet qui dépasse la tranche', choice: 'choix', label: 'label' },
  month: '2025-11',
} as unknown as CarCongestionMeta;

// Mêmes cas que pipeline/tests/test_congestion_vehicles.py (CASES) : les deux implémentations doivent concorder.
const CASES: [('out' | 'ret'), number, number | null, [string | null, string | null, number | null]][] = [
  ['out', 9 * 60, 40, ['p06_10', 'ok', 70]],
  ['out', 9 * 60, 103, ['p06_10', 'outside_period', null]],
  ['out', 9 * 60, 102, ['p06_10', 'ok', 179]],
  ['out', 6 * 60, 30, [null, 'no_period', null]],
  ['out', 10 * 60, 20, ['p06_10', 'ok', 35]],
  ['out', 14 * 60, 50, ['p10_16', 'ok', 70]],
  ['ret', 17 * 60, 40, ['p16_20', 'ok', 78]],
  ['ret', 17 * 60, 93, ['p16_20', 'outside_period', null]],
  ['ret', 14 * 60, 86, ['p10_16', 'ok', 120]],
  ['ret', 14 * 60, 87, ['p10_16', 'outside_period', null]],
  ['ret', 22 * 60, 30, [null, 'no_period', null]],
  ['ret', 20 * 60, 30, [null, 'no_period', null]],
  ['ret', 16 * 60, 10, ['p16_20', 'ok', 20]],
  ['out', 9 * 60, null, [null, null, null]],
];

describe('trafficLeg (même règle que starway/congestion.py)', () => {
  it.each(CASES)('%s à %i min, route vide %s', (leg, clock, free, [period, status, minutes]) => {
    const r = trafficLeg(CC, leg, clock, free);
    expect(r.period?.id ?? null).toBe(period);
    expect(r.status).toBe(status);
    expect(r.traffic).toBe(minutes);
    // hors tranche : le temps route vide est gardé, jamais « x 1 » inventé
    expect(r.used).toBe(minutes ?? free);
  });
});

describe('série et fichier car_traffic', () => {
  const file = {
    insee: '78358',
    processing_version: 'x',
    modes: { car: { any: { out: [40, null], ret: [40, 30], reason: [null, 'no_trip_within_120'] } } },
  } as unknown as AccessFile;
  const meta = {
    car_congestion: CC,
    day_types: [
      { id: 'd06', label: '6h-14h', start: '06:00', end: '14:00' },
      { id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' },
      { id: 'd14', label: '14h-22h', start: '14:00', end: '22:00' },
    ],
  } as unknown as Pick<Meta, 'car_congestion' | 'day_types'>;

  it('multiplie chaque sens par l’indice de sa tranche', () => {
    const s = trafficSeries(CC, file.modes.car!.any!, 9 * 60, 17 * 60);
    expect(s.out).toEqual([70, null]);
    expect(s.ret).toEqual([78, 59]); // 30 x 1,95 = 58,5 -> 59
    expect(s.reason).toEqual([null, 'no_trip_within_120']);
  });

  it('range la série sous la journée-type, garde la route vide hors tranche, horaires libres', () => {
    const d06 = withCarTraffic(file, meta, 'd06')!;
    expect(d06.modes.car_traffic?.d06?.out).toEqual([40, null]); // aller avant 6h : pas de mesure
    expect(d06.modes.car_traffic?.d06?.ret).toEqual([56, 42]); // 40 x 1,39 = 55,6 ; 30 x 1,39 = 41,7
    expect(withCarTraffic(file, meta, 'd06')).toBe(d06); // mis en cache
    const free = withCarTraffic(file, meta, 'd09', { start: 8 * 60, end: 18 * 60 })!;
    expect(free.modes.car_traffic?.d09?.out).toEqual([70, null]);
    expect(free.modes.car).toBe(file.modes.car); // la série route vide n'est jamais modifiée
    expect(withCarTraffic(file, { day_types: meta.day_types }, 'd09')).toBe(file); // sans indices : inchangé
  });

  it('textes du panneau', () => {
    expect(periodText(CC.periods[2]!)).toBe('x 1,95 (16h-20h)');
    expect(trafficLegText(CC, trafficLeg(CC, 'ret', 17 * 60, 40))).toBe('40 min route vide, x 1,95 (16h-20h) : environ 78 min avec le trafic moyen');
    expect(trafficLegText(CC, trafficLeg(CC, 'out', 6 * 60, 30))).toBe('30 min route vide (pas de mesure de la DiRIF à cette heure)');
  });
});
