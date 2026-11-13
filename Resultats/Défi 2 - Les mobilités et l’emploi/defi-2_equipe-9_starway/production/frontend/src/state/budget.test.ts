import { describe, expect, it } from 'vitest';
import { DEMO_META } from '../data/demo/generateDemo';
import type { Meta } from '../data/types';
import {
  budgetFraction,
  budgetPage,
  budgetScale,
  equivalentDistance,
  sanitizeBudget,
  snapBudget,
  starAgeOpacities,
  walkVariantOptions,
} from './budget';
import { DEFAULT_SCENARIO, sanitizeScenario } from './scenario';

/** meta.json réel (forme écrite par 06) : pas 5, horizon 120, découvertes à 30, 45, 60. */
const meta: Meta = { ...DEMO_META, budgets: [30, 45, 60], outbound_step_min: 5, max_trip_min: 120 };
/** Ancien jeu sans `outbound_step_min` ni `max_trip_min`. */
const legacy: Meta = { ...meta, outbound_step_min: undefined, max_trip_min: undefined };
const insee = new Set(['93048']);
const poles = new Set<string>();

describe('jauge du budget (D-018)', () => {
  it('bornes et repères lus dans meta.json', () => {
    expect(budgetScale(meta)).toEqual({ step: 5, min: 5, max: 120, marks: [30, 45, 60], bigStep: 15 });
  });
  it('ancien jeu : pas de jauge', () => {
    expect(budgetScale(legacy)).toBeNull();
    expect(budgetScale({ ...meta, outbound_step_min: 0 })).toBeNull();
    expect(budgetScale({ ...meta, max_trip_min: undefined })).toBeNull();
  });
  it('maximum ramené au multiple du pas, repères hors bornes écartés', () => {
    const s = budgetScale({ ...meta, max_trip_min: 58, budgets: [60, 30, 45, 30] })!;
    expect(s.max).toBe(55);
    expect(s.marks).toEqual([30, 45]);
  });
  it('arrondit au pas le plus proche et borne', () => {
    const s = budgetScale(meta)!;
    expect(snapBudget(37, s)).toBe(35);
    expect(snapBudget(38, s)).toBe(40);
    expect(snapBudget(1, s)).toBe(5);
    expect(snapBudget(180, s)).toBe(120);
    expect(budgetFraction(5, s)).toBe(0);
    expect(budgetFraction(120, s)).toBe(1);
  });
  it('PageUp / PageDown : plus petit écart entre repères, dans les bornes', () => {
    const s = budgetScale(meta)!;
    expect(budgetPage(45, 1, s)).toBe(60);
    expect(budgetPage(50, -1, s)).toBe(35);
    expect(budgetPage(115, 1, s)).toBe(120);
    expect(budgetPage(10, -1, s)).toBe(5);
    expect(budgetScale({ ...meta, budgets: [45] })!.bigStep).toBeNull();
    expect(budgetPage(45, 1, budgetScale({ ...meta, budgets: [45] })!)).toBe(50);
  });
  it('valeur non numérique : repli sur le budget par défaut', () => {
    expect(sanitizeBudget(Number.NaN, meta)).toBe(45);
    expect(sanitizeBudget(Number.NaN, legacy)).toBe(45);
  });
});

describe('sanitizeScenario : budget', () => {
  const run = (budget: number, m: Meta = meta) => sanitizeScenario({ ...DEFAULT_SCENARIO, budget }, m, insee, poles).budget;
  it('accepte tout multiple du pas entre un pas et max_trip_min', () => {
    expect(run(35)).toBe(35);
    expect(run(5)).toBe(5);
    expect(run(120)).toBe(120);
    expect(run(60)).toBe(60);
  });
  it('arrondit et borne ce qui sort de la grille', () => {
    expect(run(37)).toBe(35);
    expect(run(2)).toBe(5);
    expect(run(180)).toBe(120);
  });
  it('ancien jeu : seulement meta.budgets', () => {
    expect(run(60, legacy)).toBe(60);
    expect(run(35, legacy)).toBe(45);
  });
});

describe('distance équivalente à pied ou à vélo (L-06b)', () => {
  // Vitesses de test (fixtures) : les vraies sont publiées par le pipeline dans meta.speeds
  const speeds = { walk_kmh: 4, bike_kmh: 15 };
  it('temps × vitesse publiée, arrondi à 0,1 km sous 10 km', () => {
    expect(equivalentDistance(45, 'walk', speeds)?.text).toBe('≈ 3,0\u00a0km à pied');
    expect(equivalentDistance(20, 'walk', speeds)?.km).toBe(1.3);
  });
  it('au km au-dessus de 10 km, à vélo', () => {
    expect(equivalentDistance(60, 'bike', speeds)?.text).toBe('≈ 15\u00a0km à vélo');
  });
  it('rien sans vitesse publiée, ni pour les TC, le vélo + TC ou la voiture', () => {
    expect(equivalentDistance(60, 'walk', undefined)).toBeNull();
    expect(equivalentDistance(60, 'walk', { bike_kmh: 15 })).toBeNull();
    expect(equivalentDistance(60, 'transit', speeds)).toBeNull();
    expect(equivalentDistance(60, 'bike_transit', speeds)).toBeNull();
    expect(equivalentDistance(60, 'car', speeds)).toBeNull();
  });
});

describe('réglage de marche D-024 (L-07)', () => {
  // Fixture au format de meta.walk_settings (les vrais libellés et distances sont publiés par 06)
  const meta = {
    walk_settings: {
      nature: 'choix de l’équipe',
      default: 'a',
      mode: 'transit' as const,
      settings: [
        { id: 'a', label: 'a : jusqu’à 4 km à pied', leg_limit_m: 4000, max_time_walking_min: 60, key: null },
        { id: 'b', label: 'b : pas plus de 500 m à pied', leg_limit_m: 500, max_time_walking_min: 8, key: 'b' },
      ],
    },
  };
  it('libellés publiés, dans l’ordre publié, défaut marqué, pour le seul mode concerné', () => {
    expect(walkVariantOptions(meta, 'transit')).toEqual([
      { id: 'a', label: 'a : jusqu’à 4 km à pied', legLimitM: 4000, isDefault: true },
      { id: 'b', label: 'b : pas plus de 500 m à pied', legLimitM: 500, isDefault: false },
    ]);
    expect(walkVariantOptions(meta, 'car')).toEqual([]);
    expect(walkVariantOptions(meta, 'bike_transit')).toEqual([]);
    expect(walkVariantOptions(undefined, 'transit')).toEqual([]);
  });
});

describe('poignée « étoile qui vieillit » (IMG-20)', () => {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  it('bornes : stade 1 au minimum, stade 6 au maximum', () => {
    expect(starAgeOpacities(0, 6)).toEqual([1, 0, 0, 0, 0, 0]);
    expect(starAgeOpacities(1, 6)).toEqual([0, 0, 0, 0, 0, 1]);
  });
  it('fondu continu entre deux stades voisins, opacités complémentaires', () => {
    const o = starAgeOpacities(0.5, 6); // x = 2,5 : stades 3 et 4 à parts égales
    expect(o[2]).toBeCloseTo(0.5);
    expect(o[3]).toBeCloseTo(0.5);
    expect(o.filter((v) => v > 0)).toHaveLength(2);
    for (let k = 0; k <= 100; k++) {
      const a = starAgeOpacities(k / 100, 6);
      expect(sum(a)).toBeCloseTo(1);
      expect(a.filter((v) => v > 0).length).toBeLessThanOrEqual(2);
    }
  });
  it('aucun palier : une petite avance change un peu les opacités', () => {
    const a = starAgeOpacities(0.3, 6);
    const b = starAgeOpacities(0.301, 6);
    const diff = a.reduce((d, v, i) => d + Math.abs(v - b[i]!), 0);
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThan(0.02);
  });
  it('valeurs hors bornes ramenées dans [0, 1]', () => {
    expect(starAgeOpacities(-1, 6)).toEqual(starAgeOpacities(0, 6));
    expect(starAgeOpacities(2, 6)).toEqual(starAgeOpacities(1, 6));
    expect(starAgeOpacities(Number.NaN, 6)).toEqual(starAgeOpacities(0, 6));
    expect(starAgeOpacities(0.4, 1)).toEqual([1]);
  });
});
