import { describe, expect, it } from 'vitest';
import type { OdDestState } from './compute';
import { communeChartModel } from './communeChart';
import type { OdLeg } from './swod';
import type { OdTextContext } from './texts';

const ctx: OdTextContext = { maxTripMin: 120, timeDependent: true, partial: false };
const leg = (minutes: number | null, reason: OdLeg['reason'] = minutes == null ? 'no_trip_within_120' : null, dep?: number): OdLeg => ({ minutes, reason, ...(dep !== undefined ? { dep } : {}) });
const d = (insee: string, jobs: number, status: OdDestState['status'], out: OdLeg, ret: OdLeg): OdDestState => ({ dest: 0, insee, status, out, ret, jobs, pole: 0, record: true });
const names = new Map([
  ['92050', 'Nanterre'],
  ['92026', 'Courbevoie'],
  ['92063', 'Rueil-Malmaison'],
  ['92012', 'Boulogne-Billancourt'],
]);

describe('communeChartModel (graphique des communes du pôle)', () => {
  const share = {
    communes: [
      d('92026', 1000, 'accessible', leg(32, null, 505), leg(40)),
      d('92050', 5000, 'out_only', leg(50, null, 500), leg(95)),
      d('92063', 800, 'none', leg(null), leg(null)),
      d('92012', 300, 'self', leg(null, null), leg(null, null)),
    ],
  };
  const m = communeChartModel(share, names, 60, ctx, 1020);

  it('trie par postes décroissants (comme la liste) et garde une ligne par commune', () => {
    expect(m.rows.map((r) => r.insee)).toEqual(['92050', '92026', '92063', '92012']);
  });

  it('l’axe part de 0 et finit au plus grand des temps dessinés et du temps choisi (jamais un nombre écrit)', () => {
    expect(m.axisMax).toBe(95);
    expect(m.ticks).toEqual([0, 60, 95]);
    expect(communeChartModel({ communes: [d('92026', 1, 'accessible', leg(10), leg(12))] }, names, 60, ctx, 1020).axisMax).toBe(60);
    expect(communeChartModel({ communes: [d('92026', 1, 'accessible', leg(10), leg(60))] }, names, 60, ctx, 1020).ticks).toEqual([0, 60]);
  });

  it('triangle plein si la durée tient dans le temps choisi, vide sinon ; cyan seulement si accessible aller et retour', () => {
    const nanterre = m.rows[0]!;
    expect(nanterre.out).toMatchObject({ minutes: 50, within: true });
    expect(nanterre.ret).toMatchObject({ minutes: 95, within: false });
    expect(nanterre.accessible).toBe(false);
    expect(m.rows[1]!.accessible).toBe(true);
    // pile le temps choisi : dans le temps (≤)
    expect(communeChartModel({ communes: [d('92026', 1, 'accessible', leg(60), leg(60))] }, names, 60, ctx, 1020).rows[0]!.out.within).toBe(true);
  });

  it('un sens sans durée est ÉCRIT, jamais dessiné comme une valeur', () => {
    const none = m.rows[2]!;
    expect(none.out).toEqual({ minutes: null, within: false, written: 'Aucun trajet' });
    expect(none.ret.written).toBe('Aucun trajet');
    const unknown = communeChartModel({ communes: [d('92026', 1, 'unknown', leg(20), leg(null, 'not_computed'))] }, names, 60, ctx, 1020).rows[0]!;
    expect(unknown.ret).toEqual({ minutes: null, within: false, written: 'Non calculé' });
    // la commune de départ : ni triangle ni mot de sens, la ligne le dit
    const self = m.rows[3]!;
    expect(self.self).toBe(true);
    expect(self.out).toEqual({ minutes: null, within: false, written: null });
  });

  it('la phrase complète reprend le verdict, l’aller et le retour de la liste, sans tiret long', () => {
    const r = m.rows[1]!;
    expect(r.sentence).toContain('Courbevoie');
    expect(r.sentence).toContain('aller 32 min (départ 8h25, arrivée 8h57)'.replace(/^a/, 'A'));
    expect(r.sentence).toContain('Retour 40 min, attente comprise (fin du poste à 17h, arrivée 17h40)');
    for (const row of m.rows) expect(row.sentence).not.toMatch(/[\u2013\u2014]/);
  });
});
