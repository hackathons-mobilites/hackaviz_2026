import { describe, expect, it } from 'vitest';
import type { TollLeg } from './tolls';
import { breakdownSentence, carBreakdown, percentShares, ticketBreakdown, type UnitTicket } from './costBreakdown';

const unit: Record<string, UnitTicket> = {
  metro_train_rer: { label: 'Ticket Métro-Train-RER', eur: 2.55 },
  bus_tram: { label: 'Ticket Bus-Tram', eur: 2.05 },
  airport: { label: 'Ticket Paris Région <> Aéroports', eur: 14 },
};
const tk = (o: Partial<{ metro_train_rer: number; bus_tram: number; airport: number; cost_eur: number | null; status: string }>) =>
  ({ metro_train_rer: 0, bus_tram: 0, airport: 0, cost_eur: 0, status: 'ok', ...o }) as never;

describe('percentShares', () => {
  it('fait toujours 100 (plus fort reste)', () => {
    expect(percentShares([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentShares([2.55, 2.05])).toEqual([55, 45]);
    expect(percentShares([5])).toEqual([100]);
  });
  it('rien sans total positif', () => {
    expect(percentShares([0, 0])).toEqual([]);
  });
});

describe('ticketBreakdown', () => {
  it('un seul ticket : 100 %', () => {
    const b = ticketBreakdown(tk({ metro_train_rer: 1, cost_eur: 2.55 }), unit)!;
    expect(b.slices).toHaveLength(1);
    expect(b.slices[0]).toMatchObject({ label: 'Ticket Métro-Train-RER', pct: 100, eur: 2.55 });
  });
  it('deux types de tickets : parts au prorata des euros, détail du nombre', () => {
    const b = ticketBreakdown(tk({ metro_train_rer: 1, bus_tram: 1, cost_eur: 4.6 }), unit)!;
    expect(b.slices.map((s) => s.pct)).toEqual([55, 45]);
    expect(b.totalEur).toBe(4.6);
    expect(b.slices[0]!.detail).toBeNull();
    expect(breakdownSentence(b)).toBe('55\u00a0% Ticket Métro-Train-RER (2,55\u00a0€), 45\u00a0% Ticket Bus-Tram (2,05\u00a0€), soit 4,60\u00a0€.');
  });
  it('plusieurs tickets du même type : le nombre est dit', () => {
    const b = ticketBreakdown(tk({ metro_train_rer: 2, cost_eur: 5.1 }), unit)!;
    expect(b.slices[0]!.detail).toBe('2 tickets x 2,55\u00a0€');
  });
  it('rien si la somme ne retombe pas sur le coût publié, si un prix manque, si le prix du sens est incertain ou à pied', () => {
    expect(ticketBreakdown(tk({ metro_train_rer: 1, cost_eur: 3 }), unit)).toBeNull();
    expect(ticketBreakdown(tk({ metro_train_rer: 1, cost_eur: 2.55 }), { bus_tram: unit.bus_tram! })).toBeNull();
    expect(ticketBreakdown(tk({ metro_train_rer: 1, cost_eur: 2.55, status: 'street_transfer_unverified' }), unit)).toBeNull();
    expect(ticketBreakdown(tk({ cost_eur: 0 }), unit)).toBeNull();
    expect(ticketBreakdown(undefined, unit)).toBeNull();
    expect(ticketBreakdown(tk({ metro_train_rer: 1, cost_eur: 2.55 }), null)).toBeNull();
  });
});

describe('carBreakdown', () => {
  const toll = (o: Partial<TollLeg>): TollLeg => ({ min: 0, max: 0, status: 'ok' as never, items: [], ...o });
  it('énergie et péage, le péage est hachuré', () => {
    const b = carBreakdown({ energy: 3, toll: toll({ min: 2, max: 2 }) }, 'SP95-E10')!;
    expect(b.slices.map((s) => [s.id, s.pct, s.hatched])).toEqual([
      ['energy', 60, false],
      ['toll', 40, true],
    ]);
    expect(b.slices[0]!.label).toBe('Énergie : SP95-E10');
    expect(b.note).toBeNull();
  });
  it('péage en fourchette : compté au bas, dit sous l’anneau', () => {
    const b = carBreakdown({ energy: 3, toll: toll({ min: 2, max: 3 }) }, 'gazole')!;
    expect(b.totalEur).toBe(5);
    expect(b.note).toContain('bas de sa fourchette');
  });
  it('sans péage : 100 % énergie ; péage inconnu ou énergie absente : rien', () => {
    expect(carBreakdown({ energy: 3, toll: toll({ status: 'sans_peage' as never, min: 0, max: 0 }) }, 'gazole')!.slices).toHaveLength(1);
    expect(carBreakdown({ energy: 3, toll: toll({ min: null, max: null }) }, 'gazole')).toBeNull();
    expect(carBreakdown({ energy: null, toll: toll({}) }, 'gazole')).toBeNull();
    expect(carBreakdown({ energy: 3, toll: null }, 'gazole')).toBeNull();
  });
});
