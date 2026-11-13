import { describe, expect, it } from 'vitest';
import { demoAccess, demoDataset } from '../data/demo/generateDemo';
import { DEFAULT_SCENARIO } from '../state/scenario';
import { buildSkyView } from '../state/skyView';
import { resolveNarration } from './variables';

// Jeu DÉMO (fictif) : on teste la mécanique des phrases conditionnelles, pas des chiffres.
const dataset = demoDataset('query');
const access = { '93066': demoAccess('93066', dataset.poles, dataset.communes) };
const view = buildSkyView(dataset, { ...DEFAULT_SCENARIO, origin: '93066', mode: 'bike_transit' }, access);
const p = dataset.poles;
const say = (gain: Parameters<typeof resolveNarration>[1]['gain']) =>
  resolveNarration('Recalculés.{gain.goldPhrase}{gain.lostPhrase}', { view, previous: null, gain });

describe('acte 4 : or et pôles perdus, résolus depuis le bilan du gain', () => {
  it('or affiché et pôles perdus : les deux phrases', () => {
    const r = say({ shown: true, gained: [p[0]!.id, p[1]!.id], lost: [p[2]!.id] });
    expect(r.missing).toEqual([]);
    expect(r.text).toMatch(/^Recalculés\. En or, ce qu’elle gagne : (près de |plus de )?.+postes\. Mais elle en perd une étoile\.$/);
  });
  it('aucun or peint : la phrase « en or » n’est pas dite', () => {
    const r = say({ shown: false, gained: [], lost: [] });
    expect(r.missing).toEqual([]);
    expect(r.text).toBe('Recalculés.');
  });
  it('or sans perte : pas de « mais elle en perd »', () => {
    const r = say({ shown: true, gained: [p[0]!.id], lost: [] });
    expect(r.text).not.toMatch(/perd/);
  });
  it('aucun bilan (ciel absent) : la visite s’arrête, rien n’est inventé', () => {
    expect(say(null).missing).toEqual(['gain.goldPhrase', 'gain.lostPhrase']);
  });
});
