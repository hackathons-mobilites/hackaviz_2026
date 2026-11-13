/**
 * Voiture avec le trafic moyen mesuré par la DiRIF (D-029) : fonctions PURES.
 *
 * Le mode `car_traffic` n'a pas de série publiée : il est déduit de la série `car` (temps route vide
 * de R5) et de `meta.car_congestion` (indices DiRIF par tranche horaire). Règle, identique au bit
 * près à pipeline/starway/congestion.py (mêmes cas de test) :
 * - aller (arrivée à l'heure de début S) : tranche p avec p.start < S <= p.end, et S - T x k >= p.start ;
 * - retour (départ à l'heure de fin E) : tranche p avec p.start <= E < p.end, et E + T x k <= p.end ;
 * - temps avec trafic = T x k arrondi à la minute la plus proche (entiers, indice en centièmes) ;
 * - sinon (`no_period` : aucune mesure à cette heure ; `outside_period` : le trajet dépasse la
 *   tranche) : le temps route vide est GARDÉ, et le panneau le dit (jamais « x 1 »).
 * Appliquer à tout le trajet un indice mesuré sur les voies rapides est un choix de l'équipe, pas une
 * mesure (texte `meta.car_congestion.texts.choice`).
 */
import { parseClock } from './proof';
import type { AccessFile, AccessSeries, CarCongestionMeta, CongestionPeriod, DayTypeId, Meta } from './types';

export const TRAFFIC_MODE = 'car_traffic' as const;
export const TRAFFIC_BASE_MODE = 'car' as const;

export type TrafficStatus = 'ok' | 'no_period' | 'outside_period';

/** Un sens d'un trajet en voiture avec le trafic moyen. */
export interface TrafficLeg {
  /** Temps route vide (R5, min) ; null = pas de trajet (raison de la série `car`) */
  free: number | null;
  /** Temps avec l'indice de la tranche (min) ; null si l'indice ne s'applique pas */
  traffic: number | null;
  /** Temps retenu par le mode `car_traffic` : `traffic` s'il existe, sinon `free` */
  used: number | null;
  status: TrafficStatus | null;
  period: CongestionPeriod | null;
}

function indexX100(p: CongestionPeriod): number {
  return Math.round(p.index * 100);
}

/** T x k arrondi à la minute la plus proche (demi-minute vers le haut), en entiers. */
export function congestedMinutes(free: number, period: CongestionPeriod): number {
  return Math.floor((free * indexX100(period) + 50) / 100);
}

/**
 * Un sens : `leg` = 'out' (arrivée à `clock` minutes) ou 'ret' (départ à `clock`).
 */
export function trafficLeg(cc: Pick<CarCongestionMeta, 'periods'>, leg: 'out' | 'ret', clock: number, free: number | null | undefined): TrafficLeg {
  if (free == null) return { free: null, traffic: null, used: null, status: null, period: null };
  const periods = cc.periods.map((p) => ({ p, s: parseClock(p.start) ?? NaN, e: parseClock(p.end) ?? NaN }));
  const hit = periods.find(({ s, e }) => (leg === 'out' ? s < clock && clock <= e : s <= clock && clock < e));
  if (!hit) return { free, traffic: null, used: free, status: 'no_period', period: null };
  const span100 = free * indexX100(hit.p);
  const fits = leg === 'out' ? (clock - hit.s) * 100 >= span100 : (hit.e - clock) * 100 >= span100;
  if (!fits) return { free, traffic: null, used: free, status: 'outside_period', period: hit.p };
  const t = congestedMinutes(free, hit.p);
  return { free, traffic: t, used: t, status: 'ok', period: hit.p };
}

/** Série `car_traffic` déduite de la série `car` pour un début et une fin de poste (minutes). */
export function trafficSeries(cc: Pick<CarCongestionMeta, 'periods'>, base: AccessSeries, start: number, end: number): AccessSeries {
  return {
    out: base.out.map((t) => trafficLeg(cc, 'out', start, t).used),
    ret: base.ret.map((t) => trafficLeg(cc, 'ret', end, t).used),
    ...(base.reason ? { reason: base.reason } : {}),
  };
}

const cache = new WeakMap<AccessFile, Map<string, AccessFile>>();

/**
 * Fichier access/ complété de la série `car_traffic` pour la journée-type `day` (ou l'horaire libre
 * `shift`) : rangée sous la clé de la journée, comme une série TC, pour que tout le reste de
 * l'application la lise sans changement. Sans `meta.car_congestion` ou sans série `car` : inchangé.
 */
export function withCarTraffic(
  file: AccessFile | null | undefined,
  meta: Pick<Meta, 'car_congestion' | 'day_types'>,
  day: DayTypeId,
  shift?: { start: number; end: number } | null,
): AccessFile | null | undefined {
  const cc = meta.car_congestion;
  const base = file?.modes?.[TRAFFIC_BASE_MODE]?.any;
  if (!file || !cc || !base) return file;
  const dt = meta.day_types.find((d) => d.id === day);
  const start = shift?.start ?? (dt ? parseClock(dt.start) : null);
  const end = shift?.end ?? (dt ? parseClock(dt.end) : null);
  if (start == null || end == null) return file;
  const key = `${day}|${start}|${end}`;
  let byKey = cache.get(file);
  if (!byKey) {
    byKey = new Map();
    cache.set(file, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;
  const out: AccessFile = { ...file, modes: { ...file.modes, [TRAFFIC_MODE]: { [day]: trafficSeries(cc, base, start, end) } } };
  byKey.set(key, out);
  return out;
}

/** Le mode du scénario est-il la voiture avec trafic ? */
export function isTrafficMode(mode: string): boolean {
  return mode === TRAFFIC_MODE;
}

/** Texte d'un indice : « x 1,95 (16h-20h) ». */
export function periodText(p: CongestionPeriod): string {
  const h = (t: string) => {
    const [hh, mm] = t.split(':');
    return mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
  };
  return `x ${p.index.toFixed(2).replace('.', ',')} (${h(p.start)}-${h(p.end)})`;
}

/** Phrase d'un sens pour le panneau de preuve (null = rien à dire, pas de trajet). */
export function trafficLegText(cc: Pick<CarCongestionMeta, 'texts' | 'month'>, leg: TrafficLeg): string | null {
  if (leg.free == null) return null;
  if (leg.status === 'ok' && leg.period && leg.traffic != null) return `${leg.free} min route vide, ${periodText(leg.period)} : environ ${leg.traffic} min avec le trafic moyen`;
  if (leg.status === 'outside_period') return `${leg.free} min route vide (${cc.texts.outside_period})`;
  return `${leg.free} min route vide (${cc.texts.no_period})`;
}
