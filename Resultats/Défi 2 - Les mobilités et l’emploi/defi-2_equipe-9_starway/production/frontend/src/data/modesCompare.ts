/**
 * « Comparer les modes » (retour de Cyril et Sara du 03/11, V0) : pour la commune et l'astre choisis,
 * une ligne par mode publié pour la commune, avec l'aller, le retour, le verdict au temps choisi et,
 * SEULEMENT là où le pipeline les publie, le coût et le carbone aller et retour. Rien n'est estimé :
 * un coût ou un carbone non publié est écrit « non publié ». Fonctions PURES (aucun React).
 *
 * Sources des durées : access/{insee}.json (même série que le ciel ; TC au réglage de marche du
 * scénario ; voiture avec trafic déduite de `car` par `withCarTraffic`, D-029). Coût TC : prix au
 * ticket de l'itinéraire détaillé publié (D-028) ; coût voiture : `car_trip` (D-029, carburant seul) ;
 * carbone TC : `co2_g` de l'itinéraire (ENV01) ; carbone voiture : `car_trip` x facteur ADEME du véhicule (ENV02, `co2Grams`,
 * même calcul que le bloc « Coût et carbone » ; audit d'affichage du 10/11, lot 4 : il était écrit « non publié » à tort). Abonnements et autres véhicules : à venir (branches
 * `data/abonnements`, `data/cout-voiture`), la place est prévue dans `cost`.
 */
import { getSeries, poleStatus, type PoleStatus } from './accessibility';
import { guardCarTrip, guardSeries } from './seriesGuard';
import { co2Grams, energyEur, roundGrams } from './carCost';
import { withCarTraffic } from './congestion';
import { modeComputedFor } from './coverage';
import { nbsp } from './format';
import { carbonFact, ticketFact, ticketTotalText, type ItinTrip } from './itineraries';
import { roundCents } from './tolls';
import type { AccessFile, DayTypeId, Meta, ModeId, NullReason } from './types';

export type ModeVerdict = PoleStatus | 'in_only';

export interface ModeRow {
  mode: ModeId;
  label: string;
  out: number | null;
  ret: number | null;
  verdict: ModeVerdict;
  /** « Accessible aller et retour », « Aller seulement », « Retour seulement », « Hors de portée », « Non calculé » */
  verdictText: string;
  /** Coût aller et retour publié, sinon null (« non publié ») */
  cost: string | null;
  /** Carbone aller et retour publié, sinon null */
  carbon: string | null;
  /** Mode du ciel affiché */
  current: boolean;
}

export interface ModeComparison {
  rows: ModeRow[];
  /** Modes de meta.modes non publiés pour cette commune (libellés) */
  notComputed: string[];
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const g = new Intl.NumberFormat('fr-FR');

const VERDICT_TEXT: Record<ModeVerdict, string> = {
  accessible: 'Accessible aller et retour',
  out_only: 'Aller seulement',
  in_only: 'Retour seulement',
  none: 'Hors de portée',
  unknown: 'Non calculé',
};

/** Verdict d'un mode au temps choisi (même règle que le ciel, plus « retour seulement »). */
export function modeVerdict(out: number | null | undefined, ret: number | null | undefined, budget: number, reason?: string | null): ModeVerdict {
  const s = poleStatus(out, ret, budget, (reason ?? null) as NullReason | null);
  if (s === 'none' && ret != null && ret <= budget) return 'in_only';
  return s;
}

/**
 * Coût voiture publié (`car_trip` x `meta.vehicles`, aller et retour) : énergie seule des voitures, calculée comme le
 * bloc « Coût et carbone » (distance x coût au km, arrondie après la somme). Les péages ne sont pas comptés ici (ils
 * dépendent de l'heure de passage, tolls.json chargé par le bloc de coût) : la phrase le dit.
 * « Énergie seule, péages non comptés : essence 3,84 € ; diesel 3,10 € ».
 */
export function carCostText(
  meta: Pick<Meta, 'vehicles' | 'car_costs'>,
  access: AccessFile | null | undefined,
  poleIndex: number,
  polesCount: number,
): string | null {
  // Garde de longueur (arbitrage du 05/11) : des distances d'un autre jeu d'astres sont refusées (pas de coût)
  const trip = guardCarTrip(polesCount, access?.car_trip);
  if (!trip || !meta.vehicles?.length) return null;
  const parts = meta.vehicles
    .filter((v) => (v.family ?? 'car') === 'car')
    .map((v) => {
      const eo = energyEur(trip.dist_m.out[poleIndex], v);
      const er = energyEur(trip.dist_m.ret[poleIndex], v);
      return { v, t: eo == null || er == null ? null : roundCents(eo + er) };
    })
    .filter((x): x is { v: (typeof x)['v']; t: number } => x.t != null && Number.isFinite(x.t))
    .map(({ v, t }) => `${v.label.replace(/^Voiture /, '')} ${nbsp(eur.format(t))}`);
  if (!parts.length) return null;
  return `Énergie seule, péages non comptés : ${parts.join(' ; ')}`;
}

/**
 * Carbone voiture publié (`car_trip` x `meta.vehicles`, aller et retour), pour les mêmes véhicules que `carCostText` (les voitures ;
 * les deux-roues ont leur bloc, qui vérifie l'interdiction du Duplex A86 avec tolls.json) : facteur ADEME « combustion + amont »
 * au km (`co2Grams`), arrondi au gramme après la somme, comme le bloc « Coût et carbone ».
 * « essence 3 606 g ; diesel 3 662 g ; électrique 182 g CO2e (estimation, énergie seule) ».
 */
export function carCarbonText(
  meta: Pick<Meta, 'vehicles'>,
  access: AccessFile | null | undefined,
  poleIndex: number,
  polesCount: number,
): string | null {
  const trip = guardCarTrip(polesCount, access?.car_trip);
  if (!trip || !meta.vehicles?.length) return null;
  const parts = meta.vehicles
    .filter((v) => (v.family ?? 'car') === 'car')
    .map((v) => {
      const go = co2Grams(trip.dist_m.out[poleIndex], v);
      const gr = co2Grams(trip.dist_m.ret[poleIndex], v);
      return { v, t: go == null || gr == null ? null : roundGrams(go + gr) };
    })
    .filter((x): x is { v: (typeof x)['v']; t: number } => x.t != null && Number.isFinite(x.t))
    .map(({ v, t }) => `${v.label.replace(/^Voiture /, '')} ${nbsp(g.format(t))}\u00a0g`);
  if (!parts.length) return null;
  return `${parts.join(' ; ')} CO2e (estimation, énergie seule)`;
}

export interface ModeComparisonInput {
  meta: Meta;
  access: AccessFile | null | undefined;
  insee: string;
  poleIndex: number;
  /** Nombre d'astres affichés : les séries par position de toute autre longueur sont refusées (non calculé) */
  polesCount: number;
  day: DayTypeId;
  budget: number;
  /** Réglage de marche du scénario (clé de `variants`, null = défaut) : appliqué au TC seulement */
  walkKey: string | null | undefined;
  currentMode: ModeId;
  /** Itinéraire TC détaillé publié pour ce réglage (aller, retour), pour le coût au ticket et le carbone */
  transitTrips?: { out: ItinTrip | null; ret: ItinTrip | null } | null;
}

/** Une ligne par mode de `meta.modes` publié pour la commune (ordre de meta.modes). */
export function modeComparison(p: ModeComparisonInput): ModeComparison {
  const rows: ModeRow[] = [];
  const notComputed: string[] = [];
  const withTraffic = withCarTraffic(p.access, p.meta, p.day);
  for (const m of p.meta.modes) {
    const mode = m.id;
    const walkKey = mode === 'transit' ? p.walkKey ?? null : null;
    const file = mode === 'car_traffic' ? withTraffic : p.access;
    const series = modeComputedFor(p.meta, mode, p.insee) ? guardSeries(p.polesCount, getSeries(file, mode, p.day, walkKey)) : null;
    if (!series) {
      notComputed.push(m.label);
      continue;
    }
    const out = series.out[p.poleIndex] ?? null;
    const ret = series.ret[p.poleIndex] ?? null;
    const verdict = modeVerdict(out, ret, p.budget, series.reason?.[p.poleIndex] ?? null);
    let cost: string | null = null;
    let carbon: string | null = null;
    if (mode === 'transit' && p.transitTrips) {
      const total = ticketTotalText(ticketFact(p.transitTrips.out, 'out'), ticketFact(p.transitTrips.ret, 'ret'));
      cost = total ? `${total.replace(/^Aller et retour : /, '')} au ticket` : null;
      const c = carbonFact(p.transitTrips.out, p.transitTrips.ret);
      // V4 (audit du 11/11) : le carbone TC est une estimation, comme celui de la voiture à côté
      carbon = c ? `${nbsp(g.format(c.totalG))}\u00a0g CO2e (estimation)` : null;
    }
    if (mode === 'car' || mode === 'car_traffic') {
      cost = carCostText(p.meta, p.access, p.poleIndex, p.polesCount);
      carbon = carCarbonText(p.meta, p.access, p.poleIndex, p.polesCount);
    }
    rows.push({ mode, label: m.label, out, ret, verdict, verdictText: VERDICT_TEXT[verdict], cost, carbon, current: mode === p.currentMode });
  }
  return { rows, notComputed };
}

/** Texte d'une durée de la comparaison : « 42 min » ou « aucun trajet ». */
export function minutesText(v: number | null): string {
  return v == null ? 'aucun trajet' : `${v}\u00a0min`;
}

/**
 * En commune par commune (table OD, base par défaut du ciel), le tableau donne les durées vers l'arrêt d'ancrage
 * du pôle (comme l'exemple de trajet), pas vers le centre de chaque commune : la phrase le dit, et le verdict
 * du tableau n'est pas affiché (celui du ciel est celui de la table OD).
 */
export function modesAnchorNote(stop: string | null, dayLabel: string | null): string {
  const to = stop ? `vers ${stop}, l'arrêt le plus desservi du pôle` : "vers l'arrêt le plus desservi du pôle";
  return `Durées ${to}${dayLabel ? `, journée ${dayLabel}` : ''}. ${MODES_ANCHOR_TAIL}`;
}

/** Seconde phrase de `modesAnchorNote` (méthode) : rangée dans le « i » du tableau (audit d'affichage du 10/11, lot 4). */
export const MODES_ANCHOR_TAIL =
  "Le ciel en commune par commune vise le centre de chaque commune du pôle : ses temps et son verdict peuvent différer, c'est pourquoi aucun verdict n'est donné ici.";

/** Phrase visible (la première) et phrase du « i » (la seconde) de `modesAnchorNote`. */
export function splitAnchorNote(note: string): { lead: string; tail: string | null } {
  return note.endsWith(MODES_ANCHOR_TAIL) ? { lead: note.slice(0, -MODES_ANCHOR_TAIL.length).trim(), tail: MODES_ANCHOR_TAIL } : { lead: note, tail: null };
}
