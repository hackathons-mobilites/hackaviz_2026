import { describe, expect, it } from 'vitest';
import type { PoleState, PoleStatus } from '../data/accessibility';
import type { PoleGeometry } from './layout';
import { motion, reveal } from '../theme/tokens';
import {
  arcControl,
  bezier,
  eclipseDirection,
  fx,
  gainLegend,
  lightingDuration,
  lostPoles,
  planGain,
  planTransition,
  poseDelays,
  poseOrder,
  revealTimeline,
  shootingDuration,
  shootingKindOf,
  shootingLegs,
  targetOf,
} from './transitions';

const st = (index: number, status: PoleStatus): PoleState => ({ index, id: `P${index}`, status, out: null, ret: null, reason: null });
const geo = (index: number, x: number): PoleGeometry => ({ index, id: `P${index}`, x, y: 100, r: 10 });

describe('éclipse : sens du voile', () => {
  it('suit le sens du sélecteur (le temps avance ou recule)', () => {
    expect(eclipseDirection('d09', 'd14')).toBe(1);
    expect(eclipseDirection('d06', 'd09')).toBe(1);
    expect(eclipseDirection('d09', 'd06')).toBe(-1);
    expect(eclipseDirection('d14', 'd06')).toBe(-1);
  });
  it('par défaut de gauche à droite si la journée précédente est inconnue', () => {
    expect(eclipseDirection(undefined, 'd06')).toBe(1);
    expect(eclipseDirection('d09', 'd09')).toBe(1);
  });

  it('chaque astre bascule quand le front du voile le croise, dans les deux sens', () => {
    const states = [st(0, 'accessible'), st(1, 'accessible')];
    const current = [targetOf(st(0, 'none')), targetOf(st(1, 'none'))];
    const g = [geo(0, 100), geo(1, 900)];
    const base = { reduced: false, screenWidth: 1000, current };
    const ltr = planTransition(states, g, 'day', { ...base, direction: 1 });
    const rtl = planTransition(states, g, 'day', { ...base, direction: -1 });
    expect(ltr[0]!.delay).toBeLessThan(ltr[1]!.delay);
    expect(rtl[0]!.delay).toBeGreaterThan(rtl[1]!.delay);
    // symétrie : l'astre de gauche en sens inverse bascule quand celui de droite basculait en sens direct
    expect(rtl[0]!.delay).toBeCloseTo(ltr[1]!.delay);
  });

  it('aucun pas pour un astre dont l\'état ne change pas (pas de voile sans différence réelle)', () => {
    const states = [st(0, 'accessible'), st(1, 'none')];
    const current = [targetOf(states[0]), targetOf(states[1])];
    const steps = planTransition(states, [geo(0, 100), geo(1, 900)], 'day', { reduced: false, screenWidth: 1000, current, direction: -1 });
    expect(steps).toHaveLength(0);
  });
});

describe('aller possible, retour hors budget (out_only)', () => {
  it('canal de forme distinct de « hors budget », sans lumière', () => {
    expect(targetOf(st(0, 'out_only'))).toEqual({ light: 0, known: 1, neutral: 0, outOnly: 1, od: 0, part: null });
    expect(targetOf(st(0, 'none'))).toEqual({ light: 0, known: 1, neutral: 0, outOnly: 0, od: 0, part: null });
    expect(targetOf(st(0, 'accessible')).outOnly).toBe(0);
    expect(targetOf(st(0, 'out_only'), true).outOnly).toBe(0);
  });
  it('passer de « hors budget » à « aller seulement » est un changement réel (un pas), sans lumière', () => {
    const states = [st(0, 'out_only')];
    const steps = planTransition(states, [geo(0, 100)], 'filter', { reduced: false, screenWidth: 1000, current: [targetOf(st(0, 'none'))] });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ light: 0, known: 1, outOnly: 1 });
  });
  it('un état courant sans canal outOnly vaut 0', () => {
    const steps = planTransition([st(0, 'none')], [geo(0, 100)], 'filter', {
      reduced: false,
      screenWidth: 1000,
      current: [{ light: 0, known: 1, neutral: 0 }],
    });
    expect(steps).toHaveLength(0);
  });
});

describe('glisser de la jauge du budget (scrub)', () => {
  it('fondu court sans décalage, contre un allumage échelonné hors glisser', () => {
    const states = [{ ...st(0, 'accessible'), out: 20 }, { ...st(1, 'accessible'), out: 40 }];
    const current = [targetOf(undefined), targetOf(undefined)];
    const opts = { reduced: false, screenWidth: 1000, current };
    const g = [geo(0, 100), geo(1, 900)];
    const scrub = planTransition(states, g, 'scrub', opts);
    expect(scrub.map((x) => [x.delay, x.duration])).toEqual([
      [0, motion.reduced],
      [0, motion.reduced],
    ]);
    const filter = planTransition(states, g, 'filter', opts);
    expect(filter.some((x) => x.delay > 0)).toBe(true);
  });
});

describe('silence : pôles perdus', () => {
  it('ne retient que accessible → hors budget', () => {
    const prev = [st(0, 'accessible'), st(1, 'accessible'), st(2, 'none'), st(3, 'accessible'), st(4, 'accessible')];
    const next = [st(0, 'none'), st(1, 'accessible'), st(2, 'accessible'), st(3, 'unknown'), st(4, 'out_only')];
    expect(lostPoles(prev, next)).toEqual([0, 4]);
  });
  it('rien sans ciel précédent, ni depuis ou vers un ciel neutre', () => {
    const prev = [st(0, 'accessible')];
    const next = [st(0, 'none')];
    expect(lostPoles(null, next)).toEqual([]);
    expect(lostPoles(prev, next, { prevNeutral: true })).toEqual([]);
    expect(lostPoles(prev, next, { nextNeutral: true })).toEqual([]);
  });
});

describe('étoile filante en deux arcs', () => {
  it('la forme suit l\'état réel du pôle, rien sans donnée', () => {
    expect(shootingKindOf('accessible')).toBe('full');
    expect(shootingKindOf('out_only')).toBe('return_half');
    expect(shootingKindOf('none')).toBe('out_60');
    expect(shootingKindOf('unknown')).toBeNull();
    expect(shootingKindOf(undefined)).toBeNull();
  });

  it('aller et retour réussis ; retour arrêté à 50 % ; aller arrêté à 60 % sans retour', () => {
    expect(shootingLegs('full')).toEqual([
      { dir: 'out', end: 1, ok: true },
      { dir: 'back', end: 1, ok: true },
    ]);
    expect(shootingLegs('return_half')).toEqual([
      { dir: 'out', end: 1, ok: true },
      { dir: 'back', end: 0.5, ok: false },
    ]);
    expect(shootingLegs('out_60')).toEqual([{ dir: 'out', end: 0.6, ok: false }]);
  });

  it('aller au-dessus de la corde, retour au-dessous : une lentille symétrique', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const up = arcControl(a, b, 'above');
    const down = arcControl(a, b, 'below');
    expect(up.y).toBeCloseTo(-200 * fx.shooting.curve);
    expect(down.y).toBeCloseTo(200 * fx.shooting.curve);
    expect((up.x + down.x) / 2).toBeCloseTo(100);
    // « au-dessus » ne dépend pas du sens de la corde
    expect(arcControl(b, a, 'above').y).toBeLessThan(0);
    // corde verticale : décalage horizontal, déterministe
    const v = arcControl({ x: 0, y: 0 }, { x: 0, y: 100 }, 'above');
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeCloseTo(50);
  });

  it('les arcs partent et arrivent exactement à l\'étoile-guide et au pôle', () => {
    const a = { x: 10, y: 20 };
    const b = { x: 300, y: 80 };
    const c = arcControl(a, b, 'above');
    expect(bezier(a, c, b, 0)).toEqual(a);
    expect(bezier(a, c, b, 1).x).toBeCloseTo(b.x);
    expect(bezier(a, c, b, 1).y).toBeCloseTo(b.y);
  });

  it('durée : aller + pause + retour ; fondu court en mouvement réduit', () => {
    const s = fx.shooting;
    expect(shootingDuration('full', false)).toBe(s.leg + s.pause + s.leg + 280);
    expect(shootingDuration('out_60', false)).toBe(s.leg * 0.6 + s.failFade);
    expect(shootingDuration('full', true)).toBe(150);
  });
});

describe('gain démontré (or) : vélo + TC face aux TC, même journée, même budget', () => {
  const poles = [0, 1, 2, 3].map((i) => ({
    id: `P${i}`,
    name: `P${i}`,
    communes: [],
    jobs: 1000 * (i + 1),
    jobs_year: 2023,
    jobs_source: 'EMP01',
    point: { lon: 0, lat: 0, method: '' },
    sky: { x: 0, y: 0 },
  }));
  const view = (mode: string, statuses: PoleStatus[], over: Partial<{ day: string; budget: number; neutral: boolean }> = {}) => ({
    states: statuses.map((s, i) => ({ ...st(i, s), out: 10 * (4 - i) })),
    mode,
    day: 'd09',
    budget: 45,
    ...over,
  });
  const tc = view('transit', ['accessible', 'none', 'out_only', 'accessible']);
  const bike = view('bike_transit', ['accessible', 'accessible', 'accessible', 'none']);
  /** Ciel TC commune par commune (D-056) : `reached` postes atteints par pôle, tous mesurés */
  const commune = (reached: number[]): PoleState[] =>
    reached.map((r, i) => ({
      ...st(i, r > 0 ? 'accessible' : 'none'),
      od: { jobs: 1000, measurable: 1000, reached: r, notReached: 1000 - r, outOnly: 0, unknown: 0, self: 0, share: r / 1000, communes: 2, reachedCommunes: r > 0 ? 1 : 0, fastestOut: null },
    }));
  const dark = commune([0, 0, 0, 0]);

  it('or = accessibles aller et retour en vélo + TC et pas en TC ; perdus = écart net, jamais cachés', () => {
    const plan = planGain(poles, tc, bike, dark);
    expect(plan.reason).toBeNull();
    // ordre d'allumage : durée aller croissante dans le complément (P2 : 20 min, P1 : 30 min)
    expect(plan.gained).toEqual([2, 1]);
    expect(plan.lost).toEqual([3]);
  });

  it('aucun or sans comparaison valide', () => {
    expect(planGain(poles, tc, view('transit', ['accessible', 'accessible', 'accessible', 'none']), dark).reason).toBe('same_mode');
    expect(planGain(poles, tc, view('bike_transit', ['accessible', 'accessible', 'accessible', 'none'], { day: 'd06' }), dark).reason).toBe('different_day');
    expect(planGain(poles, tc, view('bike_transit', ['accessible', 'accessible', 'accessible', 'none'], { budget: 60 }), dark).reason).toBe('different_budget');
    expect(planGain(poles, tc, view('bike_transit', ['unknown', 'unknown', 'unknown', 'unknown']), dark).reason).toBe('no_data');
    expect(planGain(poles, tc, { ...bike, neutral: true }, dark).reason).toBe('no_data');
    expect(planGain(poles, tc, view('bike_transit', ['accessible']), dark).reason).toBe('length_mismatch');
  });

  it('un pôle non calculé dans le complément n\'est jamais doré', () => {
    const plan = planGain(poles, tc, view('bike_transit', ['accessible', 'unknown', 'accessible', 'accessible']), dark);
    expect(plan.gained).toEqual([2]);
    expect(plan.lost).toEqual([]);
  });

  it('un pôle non calculé dans la référence TC n\'est jamais doré (audit, point 11)', () => {
    // P1 : non calculé en TC, accessible en vélo + TC : aucun gain démontré ; P2 : aller seulement puis accessible : or
    const ref = view('transit', ['accessible', 'unknown', 'out_only', 'accessible']);
    const plan = planGain(poles, ref, view('bike_transit', ['accessible', 'accessible', 'accessible', 'accessible']), dark);
    expect(plan.reason).toBeNull();
    expect(plan.gained).toEqual([2]);
    expect(plan.lost).toEqual([]);
  });

  it('jamais d\'or sur un astre dont la part TC commune par commune est non nulle (D-056)', () => {
    // P1 : part TC non nulle (1 poste atteint) ; P2 : part TC nulle, le seul or
    const plan = planGain(poles, tc, bike, commune([0, 1, 0, 0]));
    expect(plan.reason).toBeNull();
    expect(plan.gained).toEqual([2]);
    expect(plan.lost).toEqual([3]);
  });

  it('ciel TC commune par commune absent ou incomplet : aucun or, rien n\'est démontré', () => {
    expect(planGain(poles, tc, bike, null).reason).toBe('no_commune_transit');
    expect(planGain(poles, tc, bike, null).gained).toEqual([]);
    expect(planGain(poles, tc, bike, dark.slice(0, 2)).reason).toBe('no_commune_transit');
  });

  it('un astre non calculé, ou mesuré en partie, dans le ciel TC commune par commune n\'est jamais doré', () => {
    const mixed = commune([0, 0, 0, 0]).map((s, i) => (i === 1 ? { ...s, status: 'unknown' as const } : i === 2 ? { ...s, od: { ...s.od!, unknown: 10 } } : s));
    expect(planGain(poles, tc, bike, mixed).gained).toEqual([]);
  });

  it('légende de l\'or : couleur du token gain, forme pleine', () => {
    expect(gainLegend.label).toBe('Or : gain démontré');
    expect(gainLegend.color).toBe('#F5B86D');
  });
});

describe('acte 0 : ordre et délais de la pose', () => {
  const g = (id: string, r: number) => ({ id, r });
  it('rayon décroissant (donc postes), égalités par identifiant', () => {
    expect(poseOrder([g('P_B', 5), g('P_A', 12), g('P_D', 8), g('P_C', 8)])).toEqual([1, 3, 2, 0]);
    expect(poseOrder([])).toEqual([]);
  });
  it('décalage min(40, 560 / (n - 1)) : fenêtre de départs de 560 ms au plus', () => {
    expect(poseDelays(0)).toEqual([]);
    expect(poseDelays(1)).toEqual([0]);
    const d15 = poseDelays(15);
    expect(d15[1]).toBe(reveal.poleStagger);
    expect(d15.at(-1)).toBe(560);
    const d5 = poseDelays(5);
    expect(d5).toEqual([0, 40, 80, 120, 160]);
    const d30 = poseDelays(30);
    expect(d30.at(-1)).toBeCloseTo(reveal.poseWindow, 6);
    expect(d30[1]!).toBeLessThan(reveal.poleStagger);
  });
  it('durée d’allumage = dernier délai + 600 ms (le compteur finit avec le dernier astre)', () => {
    expect(lightingDuration(7)).toBe(6 * motion.stagger + motion.light);
    expect(lightingDuration(0)).toBe(motion.light);
    expect(lightingDuration(7, true)).toBe(0);
  });
  it('chronologie : environ 3 s pour 15 pôles (motion-spec)', () => {
    const t = revealTimeline(15);
    expect(t.poseAt).toBe(250);
    expect(t.poseEnd).toBe(1410);
    expect(t.originAt).toBe(1510);
    expect(t.lightAt).toBe(2210);
    // 7 pôles allumés : fin vers 2,9 s, puis le temps calme
    expect(t.lightAt + lightingDuration(7)).toBe(3020);
    expect(revealTimeline(15, { shared: true }).poseAt).toBe(reveal.sharedPoseAt);
  });
  it('mouvement réduit : fondus de 150 ms séparés de 100 ms', () => {
    const t = revealTimeline(15, { reduced: true });
    expect(t).toEqual({ poseAt: 150, poseEnd: 300, originAt: 400, lightAt: 650 });
    expect(revealTimeline(15, { reduced: true, shared: true }).poseAt).toBe(0);
  });
});
