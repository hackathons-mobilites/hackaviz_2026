import { describe, expect, it } from 'vitest';
import { demoAccess, demoDataset } from '../data/demo/generateDemo';
import { resolveTour, type ResolvedTour } from './resolve';
import type { TourScript } from './types';

// Jeu DÉMO (fictif) : on teste la mécanique de résolution, pas des chiffres.
const dataset = { ...demoDataset('query'), origin: 'real' as const };
const sources = {
  dataset,
  access: (insee: string) => demoAccess(insee, dataset.poles, dataset.communes),
  context: () => null,
};

const script: TourScript = {
  id: 'test',
  title: 'Test',
  disclaimer: '',
  ready: false,
  steps: [
    { id: 'a', act: 'prologue', reveal: false, state: { origin: '93066', budget: 45 }, narration: 'Ici {origin.name}.' },
    { id: 'b', act: 'acte1', state: { budget: 60 }, narration: '{access.stars} à {budget} minutes.' },
    { id: 'c', act: 'acte2', state: { day: 'd06' }, narration: '{delta.stars} {delta.sign}.' },
  ],
};

describe('npm run tour:resolve (mécanique)', () => {
  it('rejoue les états et résout chaque étape', () => {
    const { tour, missing } = resolveTour(script, sources, null, new Date('2026-11-02T00:00:00Z'));
    expect(missing).toEqual([]);
    expect(tour.processing_version).toBe('demo');
    expect(tour.steps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(tour.steps[0]!.text).toBe('Ici Saint-Denis.');
    expect(tour.steps[1]!.text).toMatch(/à 60 minutes\.$/);
  });
  it('ciel non révélé : la variable d’accessibilité manque à cette étape', () => {
    const s: TourScript = { ...script, steps: [{ ...script.steps[0]!, narration: '{access.stars}' }] };
    expect(resolveTour(s, sources).missing).toEqual([{ step: 'a', variables: ['access.stars'] }]);
  });
  it('conserve durationMs seulement si le texte est inchangé', () => {
    const first = resolveTour(script, sources).tour;
    const withAudio: ResolvedTour = {
      ...first,
      steps: first.steps.map((s, i) => ({ ...s, durationMs: 1000 + i, text: i === 2 ? 'ancien texte' : s.text })),
    };
    const again = resolveTour(script, sources, withAudio).tour;
    expect(again.steps.map((s) => s.durationMs)).toEqual([1000, 1001, undefined]);
  });
  it('pôle suivi : vérifié contre poles.json', () => {
    const ok: TourScript = { ...script, steps: [{ ...script.steps[0]!, narration: 'x', focusPole: dataset.poles[0]!.id }] };
    const r1 = resolveTour(ok, sources);
    expect(r1.missing).toEqual([]);
    expect(r1.tour.steps[0]!.focusPole).toBe(dataset.poles[0]!.id);
    const bad: TourScript = { ...script, steps: [{ ...script.steps[0]!, narration: 'x', focusPole: 'P_INCONNU' }] };
    expect(resolveTour(bad, sources).missing).toEqual([{ step: 'a', variables: ['focusPole:P_INCONNU'] }]);
  });
});
