/**
 * Fonctions PURES de calcul d'accessibilité. Aucune dépendance au DOM, à React ou à PixiJS.
 * Règle de vérité : accessible = aller ET retour, chacun ≤ budget.
 */
import type { AccessFile, AccessSeries, DayTypeId, ModeId, NullReason, Pole } from './types';
import { guardSeries } from './seriesGuard';

/** Accessible pour un budget B ⇔ out ≤ B && ret ≤ B (null = non accessible). */
export function isAccessible(out: number | null | undefined, ret: number | null | undefined, budget: number): boolean {
  return out != null && ret != null && out <= budget && ret <= budget;
}

/**
 * État d'un pôle dans un scénario.
 * - accessible : aller ET retour ≤ budget
 * - out_only   : aller ≤ budget mais retour hors budget ou impossible
 * - none       : aller hors budget ou impossible (calcul fait)
 * - unknown    : pas de donnée calculée (fichier absent, mode ou réglage de marche non calculé,
 *                origine non raccordée)
 */
export type PoleStatus = 'accessible' | 'out_only' | 'none' | 'unknown';

/** Raisons « pas de résultat » (rien n'a été mesuré pour ce pôle). */
const UNKNOWN_REASONS: ReadonlySet<NullReason> = new Set(['not_computed', 'origin_not_snapped']);

export function poleStatus(
  out: number | null | undefined,
  ret: number | null | undefined,
  budget: number,
  reason?: NullReason | null,
): PoleStatus {
  if ((out == null || ret == null) && reason && UNKNOWN_REASONS.has(reason)) return 'unknown';
  if (out === undefined && ret === undefined) return 'unknown';
  if (isAccessible(out, ret, budget)) return 'accessible';
  if (out != null && out <= budget) return 'out_only';
  return 'none';
}

/**
 * Série d'un mode × journée. Les modes indépendants de l'heure peuvent être stockés sous "any".
 * `walkKey` (D-024, `walkSeriesKey`) : clé d'un autre réglage de marche, lue dans `variants.{key}` ;
 * null ou absent = réglage par défaut (`modes`). Réglage absent du fichier : null (non calculé), jamais
 * un repli silencieux sur le défaut.
 */
export function getSeries(
  access: AccessFile | null | undefined,
  mode: ModeId,
  day: DayTypeId,
  walkKey?: string | null,
): AccessSeries | null {
  if (walkKey) {
    const v = access?.variants?.[walkKey] as Partial<Record<ModeId, Partial<Record<DayTypeId, AccessSeries>>>> | undefined;
    return v?.[mode]?.[day] ?? null;
  }
  const byDay = access?.modes?.[mode];
  if (!byDay) return null;
  return byDay[day] ?? byDay.any ?? null;
}

/** Série propre à la journée-type (TC) ; false pour un mode stocké sous "any" (marche, vélo, voiture). */
export function isTimeDependent(access: AccessFile | null | undefined, mode: ModeId, day: DayTypeId): boolean {
  return !!access?.modes?.[mode]?.[day];
}

/**
 * Part d'un pôle atteinte, commune par commune (D-019, table OD). Présente seulement quand le ciel
 * est calculé sur la table OD ; `status` vaut alors `accessible` dès qu'au moins un poste du pôle est
 * atteint aller ET retour, et l'astre ne s'éclaire qu'en partie (cœur d'aire ∝ postes atteints).
 * `out` / `ret` du pôle restent null : un pôle a plusieurs communes, donc plusieurs temps.
 */
export interface PoleOdPart {
  /** Postes du pôle (index.poles[p].jobs) : taille de l'astre, identique dans tous les scénarios */
  jobs: number;
  /** Postes du pôle dont le trajet est mesuré (`jobs` moins la commune de départ) : dénominateur de `share` */
  measurable: number;
  /** Postes des communes du pôle atteintes aller ET retour */
  reached: number;
  /** Postes des communes mesurées et non atteintes */
  notReached: number;
  /** dont : aller dans le temps choisi, retour au-delà ou aucun retour */
  outOnly: number;
  /** Postes sans verdict (non calculé, point non raccordé) */
  unknown: number;
  /** Postes de la commune d'origine si elle est dans le pôle (trajet non mesuré) */
  self: number;
  /** reached / measurable (commune de départ hors du dénominateur) ; null si le pôle n'a aucun poste mesurable */
  share: number | null;
  /** Communes du pôle, et celles atteintes aller ET retour */
  communes: number;
  reachedCommunes: number;
  /** Aller le plus court (min) vers une commune atteinte du pôle : ordre d'allumage seulement */
  fastestOut: number | null;
}

export interface PoleState {
  index: number;
  id: string;
  status: PoleStatus;
  out: number | null;
  ret: number | null;
  reason: NullReason | null;
  /** Ciel calculé sur la table OD (D-019) : part atteinte du pôle ; absent sinon (`access/`) */
  od?: PoleOdPart;
}

/** État de chaque pôle (même ordre que poles.json). `walkKey` : voir getSeries (D-024). */
export function computePoleStates(
  poles: readonly Pole[],
  access: AccessFile | null | undefined,
  mode: ModeId,
  day: DayTypeId,
  budget: number,
  walkKey?: string | null,
): PoleState[] {
  const found = getSeries(access, mode, day, walkKey);
  // Séries lues par position : leur longueur doit être celle des astres affichés (garde de longueur, arbitrage de
  // Nicolas du 05/11). Une série d'une autre longueur désignerait de mauvais astres : elle est
  // REFUSÉE, « non calculé », jamais une valeur.
  const series = guardSeries(poles.length, found);
  return poles.map((pole, index) => {
    if (!series) {
      return { index, id: pole.id, status: 'unknown', out: null, ret: null, reason: 'not_computed' };
    }
    const out = series.out[index] ?? null;
    const ret = series.ret[index] ?? null;
    const reason = series.reason?.[index] ?? null;
    const inRange = index < series.out.length && index < series.ret.length;
    const status: PoleStatus = inRange ? poleStatus(out, ret, budget, reason) : 'unknown';
    return { index, id: pole.id, status, out, ret, reason: inRange ? reason : 'not_computed' };
  });
}

export interface SkyTotals {
  poleCount: number;
  accessibleCount: number;
  /** Somme des postes des pôles accessibles ; null si l'un d'eux a des postes inconnus */
  jobs: number | null;
  /** Somme des postes de tous les pôles ; null si l'un d'eux est inconnu */
  totalJobs: number | null;
  /** true si au moins un pôle a un état calculé */
  hasData: boolean;
  /**
   * Ciel calculé sur la table OD (D-019) : `jobs` = postes atteints dans les pôles (somme des parts)
   * et `od` = toute l'Île-de-France. Absent sinon.
   */
  od?: OdSkyTotals;
}

/** Totaux de la table OD (D-019) : toutes les communes d'Île-de-France sont des destinations. */
export interface OdSkyTotals {
  /** Postes atteints aller ET retour, toutes destinations, hors commune d'origine */
  reachedAll: number;
  /** Postes de toute l'Île-de-France (somme de index.jobs, Flores), commune de départ comprise */
  allJobs: number;
  /** Postes dont le trajet est mesuré (`allJobs` moins la commune de départ) : dénominateur de la part */
  measurableJobs: number;
  /** Postes de la commune d'origine (trajet non mesuré, ni atteints ni non atteints, hors du total) */
  selfJobs: number;
  /** Postes sans verdict (non calculé) */
  unknownJobs: number;
  /** Communes atteintes aller ET retour, et nombre de communes de destination mesurées (la commune de départ n'en fait pas partie) */
  reachedCommunes: number;
  communes: number;
}

function sumJobs(poles: readonly Pole[]): number | null {
  let total = 0;
  for (const p of poles) {
    if (p.jobs == null) return null;
    total += p.jobs;
  }
  return total;
}

/** Totaux de postes salariés (INSEE) atteignables. */
export function computeTotals(poles: readonly Pole[], states: readonly PoleState[]): SkyTotals {
  const accessiblePoles = states.filter((s) => s.status === 'accessible').map((s) => poles[s.index]!);
  return {
    poleCount: poles.length,
    accessibleCount: accessiblePoles.length,
    jobs: sumJobs(accessiblePoles),
    totalJobs: sumJobs(poles),
    hasData: states.some((s) => s.status !== 'unknown'),
  };
}

export interface ScenarioDelta {
  /** Pôles accessibles en B, calculés et non accessibles en A */
  gained: string[];
  /** Pôles accessibles en A, calculés et non accessibles en B */
  lost: string[];
  /**
   * Pôles « non calculés » (`unknown`, ou état absent) dans l'un des deux scénarios : ni gagnés ni
   * perdus, et hors des écarts (on ne compare pas une mesure à une absence de mesure).
   */
  excluded: string[];
  /** Écart de pôles B − A, sur les pôles calculés des deux côtés (= gagnés − perdus) */
  polesDelta: number;
  /** Écart de postes B − A sur les mêmes pôles ; null si un pôle gagné ou perdu a des postes inconnus */
  jobsDelta: number | null;
}

/**
 * Écart entre deux scénarios (A → B) sur le même panier de pôles.
 * Règle de vérité : un pôle « non calculé » d'un côté ou de l'autre n'est JAMAIS un gain (ni une
 * perte) : passer de `unknown` à `accessible` ne démontre rien. Sans pôle exclu, polesDelta et
 * jobsDelta valent exactement la différence des totaux.
 */
export function computeDelta(
  poles: readonly Pole[],
  a: readonly PoleState[],
  b: readonly PoleState[],
): ScenarioDelta {
  const gained: string[] = [];
  const lost: string[] = [];
  const excluded: string[] = [];
  let jobs: number | null = 0;
  poles.forEach((pole, i) => {
    const sa = a[i]?.status;
    const sb = b[i]?.status;
    if (!sa || !sb || sa === 'unknown' || sb === 'unknown') {
      excluded.push(pole.id);
      return;
    }
    const wasOn = sa === 'accessible';
    const isOn = sb === 'accessible';
    if (wasOn === isOn) return;
    (isOn ? gained : lost).push(pole.id);
    jobs = jobs == null || pole.jobs == null ? null : jobs + (isOn ? pole.jobs : -pole.jobs);
  });
  return { gained, lost, excluded, polesDelta: gained.length - lost.length, jobsDelta: jobs };
}

/** Nombre de pôles par état (liste du ciel, légende). */
export function statusCounts(states: readonly PoleState[]): Record<PoleStatus, number> {
  const out: Record<PoleStatus, number> = { accessible: 0, out_only: 0, none: 0, unknown: 0 };
  for (const s of states) out[s.status] += 1;
  return out;
}

/** Rang d'un état dans la liste du ciel : accessible, aller seulement, hors budget, non calculé. */
export const STATUS_RANK: Readonly<Record<PoleStatus, number>> = { accessible: 0, out_only: 1, none: 2, unknown: 3 };

/**
 * Ordre par défaut de la liste du ciel : état (accessibles d'abord), puis durée aller croissante
 * (comme l'allumage), puis postes décroissants, puis ordre de poles.json. Renvoie des indices.
 */
export function listOrder(poles: readonly Pole[], states: readonly PoleState[]): number[] {
  return states
    .map((s) => s.index)
    .sort((a, b) => {
      const sa = states[a]!;
      const sb = states[b]!;
      return (
        STATUS_RANK[sa.status] - STATUS_RANK[sb.status] ||
        (sa.out ?? Infinity) - (sb.out ?? Infinity) ||
        (poles[b]?.jobs ?? -1) - (poles[a]?.jobs ?? -1) ||
        a - b
      );
    });
}

/** Ordre d'allumage : durée aller croissante (le seul cas où l'ordre porte du sens). */
export function lightingOrder(states: readonly PoleState[]): number[] {
  return states
    .filter((s) => s.status === 'accessible')
    .sort((x, y) => (x.od?.fastestOut ?? x.out ?? Infinity) - (y.od?.fastestOut ?? y.out ?? Infinity) || x.index - y.index)
    .map((s) => s.index);
}
