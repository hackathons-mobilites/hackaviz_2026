import { describe, expect, it } from 'vitest';
import type { AccessFile, Commune, Dataset, Pole } from '../data/types';
import { buildDisplayedView, displayedScenario, introAtLeast, lightsShown, selectDisplayMask, INTRO_STEPS } from './displayMask';
import { DEFAULT_SCENARIO, type Scenario } from './scenario';

const pole = (id: string, jobs: number): Pole => ({
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
const communes = [
  { insee: '93066', name: 'Saint-Denis', sky: { x: 0.4, y: 0.4 } },
  { insee: '77186', name: 'Fontainebleau', sky: { x: 0.6, y: 0.8 } },
] as unknown as Commune[];
const dataset = { poles, communes } as unknown as Dataset;

const access: Record<string, AccessFile | null> = {
  '93066': {
    insee: '93066',
    processing_version: 't',
    modes: { transit: { d09: { out: [38, 70, 20], ret: [41, 30, 25] } } },
  },
  // commune sans matrice publiée
  '77186': null,
};

const scenario: Scenario = { ...DEFAULT_SCENARIO, origin: '93066', budget: 45, pole: 'C', halo: 'age' };

describe('étapes de la révélation', () => {
  it('ordre title < pose < origin < light < done', () => {
    expect(INTRO_STEPS).toEqual(['title', 'pose', 'origin', 'light', 'done']);
    expect(introAtLeast('origin', 'pose')).toBe(true);
    expect(introAtLeast('pose', 'origin')).toBe(false);
    expect(introAtLeast('done', 'light')).toBe(true);
  });

  it('masque de chaque étape (motion-spec, Acte 0)', () => {
    expect(selectDisplayMask('title')).toEqual({ poles: false, origin: false, light: false, done: false });
    expect(selectDisplayMask('pose')).toEqual({ poles: true, origin: false, light: false, done: false });
    expect(selectDisplayMask('origin')).toEqual({ poles: true, origin: true, light: false, done: false });
    expect(selectDisplayMask('light')).toEqual({ poles: true, origin: true, light: true, done: false });
    expect(selectDisplayMask('done')).toEqual({ poles: true, origin: true, light: true, done: true });
  });
});

describe('aucun état avant le temps D et les données', () => {
  it('états réels seulement à partir de light, données chargées', () => {
    for (const step of ['title', 'pose', 'origin'] as const) {
      expect(lightsShown(step, '93066', access, null)).toBe(false);
    }
    expect(lightsShown('light', '93066', access, null)).toBe(true);
    expect(lightsShown('done', '93066', access, null)).toBe(true);
  });

  it('chargement en cours : le ciel reste en perle pendant light', () => {
    expect(lightsShown('light', '93066', access, '93066')).toBe(false);
    expect(lightsShown('light', '92050', access, null)).toBe(false); // fichier pas encore arrivé
    const v = buildDisplayedView(dataset, scenario, access, true, 'light', '93066');
    expect(v.neutral).toBe(true);
    expect(v.totals.hasData).toBe(false);
    expect(v.states.every((s) => s.status === 'unknown')).toBe(true);
  });

  it('après la révélation, un chargement ne remet pas le ciel en perle (le scénario affiché est déjà chargé)', () => {
    expect(lightsShown('done', '93066', access, '75056')).toBe(true);
  });

  it('pose : ni commune, ni état, ni pôle sélectionné, ni halo', () => {
    const v = buildDisplayedView(dataset, scenario, access, true, 'pose', null);
    expect(v.origin).toBeNull();
    expect(v.neutral).toBe(true);
    expect(v.selectedPole).toBeNull();
    expect(v.scenario.halo).toBeNull();
    expect(v.totals.accessibleCount).toBe(0);
  });

  it('origin : la commune (étoile-guide) arrive, toujours aucun état', () => {
    const v = buildDisplayedView(dataset, scenario, access, true, 'origin', null);
    expect(v.origin?.insee).toBe('93066');
    expect(v.neutral).toBe(true);
    expect(v.totals.hasData).toBe(false);
    expect(v.accessMissing).toBe(false);
  });

  it('light : états réels, aller ET retour (pôle A et C), sans pôle sélectionné', () => {
    const v = buildDisplayedView(dataset, scenario, access, true, 'light', null);
    expect(v.neutral).toBe(false);
    expect(v.states.map((s) => s.status)).toEqual(['accessible', 'none', 'accessible']);
    expect(v.selectedPole).toBeNull();
  });

  it('done : vue réelle complète (pôle sélectionné, halo)', () => {
    const v = buildDisplayedView(dataset, scenario, access, true, 'done', null);
    expect(v.selectedPole?.id).toBe('C');
    expect(v.scenario.halo).toBe('age');
    expect(displayedScenario(scenario, 'done')).toBe(scenario);
  });

  it('commune sans matrice : perle, et l’absence de fichier n’est lue qu’à partir de light', () => {
    const sc = { ...scenario, origin: '77186' };
    expect(buildDisplayedView(dataset, sc, access, true, 'origin', null).accessMissing).toBe(false);
    const v = buildDisplayedView(dataset, sc, access, true, 'light', null);
    expect(v.accessMissing).toBe(true);
    expect(v.totals.hasData).toBe(false);
  });

  it('ciel non révélé (prologue de la visite) : perle même après la révélation', () => {
    const v = buildDisplayedView(dataset, scenario, access, false, 'done', null);
    expect(v.neutral).toBe(true);
  });
});
