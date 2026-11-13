/**
 * Garde de longueur des séries par position (arbitrage de Nicolas du 05/11, point 4). Une série lue par position
 * (`access/` : out, ret, reason, dep ; `car_trip` : dist_m, reason, toll ; `offpeak` ; Vélib') ne s'applique qu'aux astres
 * affichés si sa longueur est EXACTEMENT celle de ces astres : une série d'une autre longueur
 * désignerait de mauvais astres. Elle est alors REFUSÉE : l'appelant montre « non calculé », jamais une valeur.
 * Fonctions pures, sans DOM ni React.
 */
import type { AccessSeries, CarTrip } from './types';

/** Phrase quand une série publiée ne correspond pas aux astres affichés (jamais une valeur à la place). */
export const SERIES_REFUSED_TEXT = 'Non calculé : la série publiée ne correspond pas aux astres affichés.';

/** Une série par position a-t-elle exactement `n` éléments (`n` = astres affichés) ? */
export function seriesFit(n: number, series: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(series) && series.length === n;
}

/** Série facultative : absente, c'est permis ; présente, sa longueur doit être `n`. */
export function optionalSeriesFit(n: number, series: readonly unknown[] | null | undefined): boolean {
  return series == null || seriesFit(n, series);
}

/**
 * Série d'un mode × journée (out, ret, et reason / dep si publiés) : renvoyée telle quelle si toutes ses séries ont `n`
 * éléments, sinon null (refusée). `null` ou absente : null.
 */
export function guardSeries(n: number, series: AccessSeries | null | undefined): AccessSeries | null {
  if (!series) return null;
  return seriesFit(n, series.out) && seriesFit(n, series.ret) && optionalSeriesFit(n, series.reason) && optionalSeriesFit(n, series.dep) ? series : null;
}

/** Distances routières `car_trip` : dist_m (aller, retour) obligatoires ; reason et toll, s'ils sont publiés, de même longueur. */
export function carTripFits(n: number, trip: CarTrip | null | undefined): boolean {
  if (!trip) return false;
  return (
    seriesFit(n, trip.dist_m?.out) &&
    seriesFit(n, trip.dist_m?.ret) &&
    optionalSeriesFit(n, trip.reason?.out) &&
    optionalSeriesFit(n, trip.reason?.ret) &&
    optionalSeriesFit(n, trip.toll?.out) &&
    optionalSeriesFit(n, trip.toll?.ret)
  );
}

/** `car_trip` lisible par position pour `n` astres, sinon null (refusé). */
export function guardCarTrip(n: number, trip: CarTrip | null | undefined): CarTrip | null {
  return carTripFits(n, trip) ? (trip ?? null) : null;
}

/**
 * Lecture d'une valeur d'une série par position : la valeur de l'astre `index` seulement si la série a `n` éléments, sinon
 * null (refusée). Un index hors de [0, n[ renvoie null.
 */
export function seriesAt<T>(n: number, series: readonly T[] | null | undefined, index: number): T | null {
  if (!seriesFit(n, series) || index < 0 || index >= n) return null;
  return series![index] ?? null;
}
