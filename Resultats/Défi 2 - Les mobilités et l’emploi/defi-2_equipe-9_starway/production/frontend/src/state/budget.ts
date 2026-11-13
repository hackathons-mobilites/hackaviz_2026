import type { Meta } from '../data/types';
import { walkSettingsMeta } from '../data/walkSettings';

/**
 * Jauge du budget par sens (D-018). Toutes les bornes viennent de meta.json :
 * - pas = `outbound_step_min` (grille des départs aller du calcul : un pas plus fin laisserait
 *   croire à une précision que le calcul n'a pas) ;
 * - minimum = un pas, maximum = `max_trip_min` (horizon de recherche, ramené au multiple du pas) ;
 * - repères = `budgets` (budgets où les découvertes sont calculées), jamais présentés comme des seuils.
 */
export interface BudgetScale {
  step: number;
  min: number;
  max: number;
  /** Repères de la jauge : budgets des découvertes (meta.budgets) compris dans [min, max] */
  marks: number[];
  /** Saut PageUp / PageDown : plus petit écart entre deux repères, arrondi au pas (null = défaut du navigateur) */
  bigStep: number | null;
}

const validMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Échelle continue, ou null si meta ne la permet pas (ancien jeu : boutons meta.budgets). */
export function budgetScale(meta: Pick<Meta, 'budgets' | 'outbound_step_min' | 'max_trip_min'>): BudgetScale | null {
  const step = meta.outbound_step_min;
  const horizon = meta.max_trip_min;
  if (!validMinutes(step) || !validMinutes(horizon)) return null;
  const max = Math.floor(horizon / step) * step;
  if (max < step) return null;
  const marks = [...new Set(meta.budgets)].filter((b) => b >= step && b <= max).sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < marks.length; i++) gap = Math.min(gap, marks[i]! - marks[i - 1]!);
  const bigStep = Number.isFinite(gap) ? Math.max(step, Math.round(gap / step) * step) : null;
  return { step, min: step, max, marks, bigStep };
}

/** Ramène une valeur sur la grille : multiple du pas le plus proche, borné à [min, max]. */
export function snapBudget(value: number, scale: BudgetScale): number {
  const snapped = Math.round(value / scale.step) * scale.step;
  return Math.min(scale.max, Math.max(scale.min, snapped));
}

/** Budget autorisé par meta.json (jauge continue, sinon liste meta.budgets). */
export function sanitizeBudget(value: number, meta: Pick<Meta, 'budgets' | 'outbound_step_min' | 'max_trip_min'>): number {
  const fallback = meta.budgets.includes(45) ? 45 : meta.budgets[0] ?? 45;
  const scale = budgetScale(meta);
  if (!scale) return meta.budgets.includes(value) ? value : fallback;
  return Number.isFinite(value) ? snapBudget(value, scale) : snapBudget(fallback, scale);
}

/** Position (0 à 1) d'une valeur sur la piste de la jauge. */
export function budgetFraction(value: number, scale: BudgetScale): number {
  return scale.max === scale.min ? 0 : (value - scale.min) / (scale.max - scale.min);
}

/**
 * Poignée « étoile qui vieillit » (IMG-20) : opacité de chacun des `stages` sprites pour la position
 * p ∈ [0, 1] de la poignée (min → max de la jauge). Fondu continu entre les deux stades voisins
 * (p × (stages - 1) → stades i et i + 1, opacités complémentaires) : aucun palier, aucun stade
 * associé à une durée. Somme toujours égale à 1, deux valeurs non nulles au plus.
 */
export function starAgeOpacities(p: number, stages: number): number[] {
  const out = new Array<number>(Math.max(stages, 0)).fill(0);
  if (stages <= 0) return out;
  if (stages === 1) {
    out[0] = 1;
    return out;
  }
  const x = (Number.isFinite(p) ? Math.min(Math.max(p, 0), 1) : 0) * (stages - 1);
  const i = Math.min(Math.floor(x), stages - 2);
  const f = x - i;
  out[i] = 1 - f;
  out[i + 1] = f;
  return out;
}

/** PageUp (+1) / PageDown (-1) : saut d'un `bigStep`, sur la grille et dans les bornes. */
export function budgetPage(value: number, direction: 1 | -1, scale: BudgetScale): number {
  return snapBudget(value + direction * (scale.bigStep ?? scale.step), scale);
}

/**
 * Distance équivalente au temps choisi (L-06b) : temps × vitesse du calcul publiée par le pipeline
 * (`meta.speeds`), à pied ou à vélo seulement. null si la vitesse n'est pas publiée (rien en dur)
 * ou pour un autre mode. Arrondi à 0,1 km sous 10 km, au km au-dessus. Distance de chemin à vitesse
 * constante, pas un rayon à vol d'oiseau.
 */
export function equivalentDistance(
  minutes: number,
  mode: string,
  speeds: { walk_kmh?: number | null; bike_kmh?: number | null } | null | undefined,
): { km: number; text: string; kmh: number } | null {
  const kmh = mode === 'walk' ? speeds?.walk_kmh : mode === 'bike' ? speeds?.bike_kmh : null;
  if (kmh == null || !Number.isFinite(kmh) || kmh <= 0 || !Number.isFinite(minutes) || minutes <= 0) return null;
  const raw = (minutes / 60) * kmh;
  const km = raw < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  const num = km < 10 ? km.toFixed(1).replace('.', ',') : String(km);
  return { km, kmh, text: `≈ ${num}\u00a0km ${mode === 'walk' ? 'à pied' : 'à vélo'}` };
}

/**
 * Options du réglage de marche D-024 pour un mode, lues dans `meta.walk_settings.settings` : libellé
 * publié tel quel (« normal : jusqu'à 3 km à pied »), distance (`leg_limit_m`), défaut marqué, dans
 * l'ordre publié. [] si rien n'est publié ou si le mode n'a pas de réglage (seul `walk_settings.mode`).
 */
export function walkVariantOptions(
  meta: Pick<Meta, 'walk_settings'> | null | undefined,
  mode: string,
): { id: string; label: string; legLimitM: number; isDefault: boolean }[] {
  const ws = walkSettingsMeta(meta);
  if (!ws || ws.mode !== mode) return [];
  return ws.settings.map((s) => ({ id: s.id, label: s.label, legLimitM: s.leg_limit_m, isDefault: s.id === ws.default }));
}
