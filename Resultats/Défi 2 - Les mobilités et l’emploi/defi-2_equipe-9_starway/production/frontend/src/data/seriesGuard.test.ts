import { describe, expect, it } from 'vitest';
import { itineraryOf, tripEntry, type ItinerariesFile, type ItinTrip } from './itineraries';
import { carTripFits, guardCarTrip, guardSeries, optionalSeriesFit, seriesAt, seriesFit, SERIES_REFUSED_TEXT } from './seriesGuard';
import { velibRides } from './subscriptions';
import type { AccessSeries, CarTrip } from './types';
import type { SubscriptionsFile } from './subscriptions';

/**
 * Garde de longueur des séries par position (arbitrage de Nicolas du 05/11, point 4) : une série de 15 sur 44 astres, de 44
 * sur 15, ou de toute autre longueur que les astres affichés est REFUSÉE (« non calculé »), jamais une valeur.
 * Les tests de `computePoleStates` sont dans accessibility.test.ts, ceux de la comparaison des modes et du coût voiture dans
 * panneauLignes.test.ts et ProofCarCost.test.ts.
 */
const serie = (n: number, extra: Partial<AccessSeries> = {}): AccessSeries => ({ out: Array(n).fill(10), ret: Array(n).fill(12), ...extra });
const trip = (n: number, extra: Partial<CarTrip> = {}): CarTrip => ({
  dist_m: { out: Array(n).fill(1000), ret: Array(n).fill(1000) },
  reason: { out: Array(n).fill(null), ret: Array(n).fill(null) },
  ...extra,
});

describe('garde de longueur : séries d’accès (access/)', () => {
  it('15 sur 44 et 44 sur 15 : refusées', () => {
    expect(guardSeries(44, serie(15))).toBeNull();
    expect(guardSeries(15, serie(44))).toBeNull();
  });
  it('la bonne longueur est rendue telle quelle', () => {
    const s = serie(44);
    expect(guardSeries(44, s)).toBe(s);
    expect(guardSeries(15, serie(15))).not.toBeNull();
  });
  it('absente : null ; reason ou dep de longueur différente : toute la série est refusée', () => {
    expect(guardSeries(3, null)).toBeNull();
    expect(guardSeries(3, undefined)).toBeNull();
    expect(guardSeries(3, serie(3, { reason: Array(2).fill(null) }))).toBeNull();
    expect(guardSeries(3, serie(3, { dep: ['08:00'] }))).toBeNull();
    expect(guardSeries(3, serie(3, { reason: Array(3).fill(null), dep: Array(3).fill('08:00') }))).not.toBeNull();
  });
  it('seriesFit / optionalSeriesFit / seriesAt', () => {
    expect(seriesFit(3, [1, 2, 3])).toBe(true);
    expect(seriesFit(3, [1, 2])).toBe(false);
    expect(seriesFit(3, null)).toBe(false);
    expect(optionalSeriesFit(3, undefined)).toBe(true);
    expect(optionalSeriesFit(3, [1])).toBe(false);
    expect(seriesAt(3, [7, 8, 9], 1)).toBe(8);
    expect(seriesAt(44, [7, 8, 9], 1)).toBeNull(); // 3 valeurs sur 44 astres : jamais lue
    expect(seriesAt(3, [7, 8, 9], 3)).toBeNull();
    expect(seriesAt(3, [7, 8, 9], -1)).toBeNull();
  });
  it('le message « non calculé » ne porte aucune valeur ni tiret long', () => {
    expect(SERIES_REFUSED_TEXT).toMatch(/^Non calculé/);
    expect(SERIES_REFUSED_TEXT).not.toMatch(/\d|[\u2013\u2014]/);
  });
});

describe('garde de longueur : distances routières (car_trip)', () => {
  it('15 sur 44 et 44 sur 15 : refusées', () => {
    expect(carTripFits(44, trip(15))).toBe(false);
    expect(carTripFits(15, trip(44))).toBe(false);
    expect(guardCarTrip(44, trip(15))).toBeNull();
  });
  it('dist_m aller et retour, reason et toll de même longueur', () => {
    expect(carTripFits(15, trip(15))).toBe(true);
    expect(carTripFits(15, trip(15, { dist_m: { out: Array(15).fill(1), ret: Array(14).fill(1) } }))).toBe(false);
    expect(carTripFits(15, trip(15, { reason: { out: Array(15).fill(null), ret: Array(44).fill(null) } }))).toBe(false);
    expect(carTripFits(15, trip(15, { toll: { out: Array(15).fill([]), ret: Array(15).fill([]) } }))).toBe(true);
    expect(carTripFits(15, trip(15, { toll: { out: Array(44).fill([]), ret: Array(15).fill([]) } }))).toBe(false);
    expect(carTripFits(15, undefined)).toBe(false);
  });
});

describe('garde de longueur : itinéraires et Vélib’', () => {
  const trajet = (): ItinTrip => ({ status: 'ok', legs: [{ m: 'rer', dep: '08:00', arr: '08:20', min: 20, dist_m: 9000, line: 'A' }] }) as ItinTrip;
  const file = (n: number): ItinerariesFile =>
    ({ insee: '93048', contract: 'itineraries-2', poles: ['P_A', 'P_B'], days: { d09: { out: Array.from({ length: n }, trajet), ret: Array.from({ length: n }, trajet) } } }) as unknown as ItinerariesFile;
  it('trajets par position de file.poles : une série de 15 ou de 44 pour 2 astres est refusée', () => {
    expect(itineraryOf(file(2), 'P_A', 'd09', 'out')).not.toBeNull();
    expect(tripEntry(file(2), 'P_B', 'd09', 'ret')).not.toBeNull();
    for (const n of [15, 44, 1, 3]) {
      expect(itineraryOf(file(n), 'P_A', 'd09', 'out'), `n = ${n}`).toBeNull();
      expect(tripEntry(file(n), 'P_A', 'd09', 'out'), `n = ${n}`).toBeNull();
    }
  });
  it('Vélib’ : durées par position, refusées si la série n’a pas autant de valeurs que d’astres affichés', () => {
    const f = { velib: { rides: { '75101': { out: [5, 6, 7], ret: [8, 9, 10] } } } } as unknown as SubscriptionsFile;
    expect(velibRides(f, '75101', 1, 3)).toEqual({ out: 6, ret: 9 });
    expect(velibRides(f, '75101', 1, 44)).toBeNull();
    expect(velibRides(f, '75101', 1, 15)).toBeNull();
    expect(velibRides(f, '75101', 1, 2)).toBeNull();
  });
});
