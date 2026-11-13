import { describe, expect, it } from 'vitest';
import type { TrafficLeg } from './congestion';
import { trafficChartModel } from './trafficChart';
import type { CarCongestionMeta } from './types';

const cc = { month: '2026-09', texts: { no_period: 'pas de mesure de la DiRIF à cette heure', outside_period: 'le trajet dépasse la tranche' } } as unknown as CarCongestionMeta;
const period = { start: '16:00', end: '20:00', index: 1.95 } as never;
const ok: TrafficLeg = { free: 20, traffic: 39, used: 39, status: 'ok', period };

describe('trafficChartModel (route vide et trafic moyen)', () => {
  it('une ligne par sens : point vide (route vide), point plein (trafic moyen), indice écrit', () => {
    const m = trafficChartModel(cc, ok, { free: 25, traffic: 49, used: 49, status: 'ok', period });
    expect(m.rows.map((r) => r.label)).toEqual(['Aller', 'Retour']);
    expect(m.rows[0]).toMatchObject({ free: 20, traffic: 39, indexText: 'x 1,95 (16h-20h)', written: null });
    expect(m.axisMax).toBe(49);
  });

  it('sans indice applicable : seul le point vide est dessiné, la ligne l’écrit', () => {
    const m = trafficChartModel(cc, { free: 20, traffic: null, used: 20, status: 'no_period', period: null }, ok);
    expect(m.rows[0]).toMatchObject({ free: 20, traffic: null, indexText: null, written: 'Route vide seulement' });
    expect(m.rows[0]!.sentence).toContain('route vide');
  });

  it('sans trajet en voiture : rien n’est dessiné, « aucun trajet » est écrit, jamais 0', () => {
    const none: TrafficLeg = { free: null, traffic: null, used: null, status: null, period: null };
    const m = trafficChartModel(cc, none, none);
    expect(m.rows[0]).toMatchObject({ free: null, traffic: null, written: 'Aucun trajet' });
    expect(m.rows[0]!.sentence).toBe('Aller : aucun trajet en voiture trouvé.');
    expect(m.axisMax).toBe(0);
  });

  it('la phrase reprend celle du panneau, sans tiret long', () => {
    const m = trafficChartModel(cc, ok, ok);
    expect(m.rows[0]!.sentence).toBe('Aller : 20 min route vide, x 1,95 (16h-20h) : environ 39 min avec le trafic moyen.');
    for (const r of m.rows) expect(r.sentence).not.toMatch(/[\u2013\u2014]/);
  });
});
