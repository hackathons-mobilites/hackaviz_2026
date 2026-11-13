import { describe, expect, it } from 'vitest';
import type { ItinLeg } from './itineraries';
import { lineInk, tripBandModel, tripBandScale } from './tripBand';

const walk = (min: number): ItinLeg => ({ m: 'walk', dep: '08:10', arr: '08:19', min, dist_m: 500, role: 'access' });
const ride = (min: number, wait: number | null, line = 'A', color = 'EB2132'): ItinLeg => ({ m: 'rer', dep: '08:24', arr: '08:45', min, dist_m: 1000, line, color, text_color: 'FFFFFF', wait_min: wait });

describe('lineInk (nom de ligne sur sa couleur)', () => {
  const dark = '#080E20';
  const light = '#F4F6FF';
  it('garde l’encre GTFS quand elle atteint 4,5:1', () => {
    expect(lineInk('#EB2132', '#000000', dark, light)).toBe('#000000');
  });
  it('remplace une encre GTFS sous 4,5:1 par la plus lisible de la palette', () => {
    expect(lineInk('#008C5A', '#FFFFFF', dark, light)).toBe(dark);
  });
  it('sans encre GTFS : l’encre la plus lisible', () => {
    expect(lineInk('#000000', null, dark, light)).toBe(light);
  });
});

describe('tripBandModel (bande du trajet)', () => {
  const trip = { legs: [walk(9.2), ride(21.1, 5.4), walk(6), { ...ride(2.2, 2.6, '7', 'FF82B4'), m: 'metro' as const }, walk(1.4)] };
  const m = tripBandModel(trip)!;

  it('un segment par tronçon, l’attente avant de monter en segment à part, dans l’ordre', () => {
    expect(m.segments.map((s) => s.kind)).toEqual(['walk', 'wait', 'ride', 'walk', 'wait', 'ride', 'walk']);
  });

  it('la largeur est la durée publiée : la somme des segments est le total, sans rien inventer', () => {
    expect(m.total).toBeCloseTo(9.2 + 5.4 + 21.1 + 6 + 2.6 + 2.2 + 1.4, 6);
    expect(m.segments[2]!.start).toBeCloseTo(9.2 + 5.4, 6);
    expect(m.segments.map((s) => s.minutes)).toEqual([9.2, 5.4, 21.1, 6, 2.6, 2.2, 1.4]);
  });

  it('durée écrite en minutes entières, au moins 1 ; nom et couleur GTFS seulement pour un véhicule', () => {
    expect(m.segments.map((s) => s.label)).toEqual(['9', '5', '21', '6', '3', '2', '1']);
    const r = m.segments[2]!;
    expect(r).toMatchObject({ line: 'A', color: 'EB2132', textColor: 'FFFFFF', text: 'RER A, 21\u00a0min' });
    expect(m.segments[0]).toMatchObject({ line: null, color: null, text: 'Marche, 9\u00a0min' });
    expect(m.segments[1]).toMatchObject({ color: null, text: 'Attente, 5\u00a0min', leg: null });
  });

  it('une couleur mal formée n’est jamais utilisée', () => {
    const bad = tripBandModel({ legs: [ride(10, null, 'B', 'rouge')] })!;
    expect(bad.segments[0]!.color).toBeNull();
  });

  it('sans tronçon publié : aucune bande ; échelle commune = le plus grand total', () => {
    expect(tripBandModel({ legs: [] })).toBeNull();
    expect(tripBandModel(null)).toBeNull();
    const short = tripBandModel({ legs: [walk(10)] });
    expect(tripBandScale(m, short, null)).toBe(m.total);
    expect(tripBandScale(null, null)).toBe(0);
  });
});
