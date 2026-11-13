/**
 * Bande du trajet (chantier C, lot 4, D-051) : fonctions PURES. Un sens d'un itinéraire publié, à l'échelle du temps : chaque tronçon
 * est un segment dont la largeur est sa durée (`leg.min`), l'attente avant de monter (`leg.wait_min`) est un segment à part. Rien
 * n'est inventé : la somme des segments est la durée des tronçons publiés ; pour comparer l'aller et le retour sur la même échelle,
 * l'appelant passe le plus grand des deux totaux. Aucune ligne de budget : c'est un exemple vers l'arrêt d'un astre, pas un verdict.
 */
import { contrast } from '../theme/cvd';
import { legMinutes, legTitle, type ItinLeg, type ItinTrip } from './itineraries';

/** Contraste minimal du nom de ligne sur sa couleur (WCAG 1.4.3, petit texte) */
const LINE_INK_MIN = 4.5;

/**
 * Encre du nom de ligne sur la couleur de la ligne : celle publiée (GTFS) si elle est assez contrastée, sinon la plus lisible
 * des deux encres de la palette. Couleur de ligne inconnue : l'encre sombre, comme le repli existant de la bande.
 */
export function lineInk(fill: string, gtfsText: string | null, dark: string, light: string): string {
  if (gtfsText && contrast(fill, gtfsText) >= LINE_INK_MIN) return gtfsText;
  return contrast(fill, dark) >= contrast(fill, light) ? dark : light;
}

export type TripBandKind = 'walk' | 'wait' | 'ride';

export interface TripBandSegment {
  kind: TripBandKind;
  /** Durée en minutes, telle que publiée */
  minutes: number;
  /** Durée écrite sous le segment : minutes entières, au moins 1 (`legMinutes`) */
  label: string;
  /** Début du segment depuis le départ (min) */
  start: number;
  /** Ligne à sa couleur GTFS (hexadécimal sans #), seulement pour un trajet en véhicule ; sinon null */
  color: string | null;
  textColor: string | null;
  /** Nom court de la ligne écrit dans le segment (« A », « 7 ») ; null hors véhicule */
  line: string | null;
  /** Phrase du segment pour le survol et le tableau : « RER A, 21 min », « Marche, 9 min », « Attente, 5 min » */
  text: string;
  /** Tronçon publié (null pour une attente) : heures de départ et d'arrivée, faits de la ligne */
  leg: ItinLeg | null;
}

export interface TripBandModel {
  segments: TripBandSegment[];
  /** Somme des segments (min) */
  total: number;
}

const HEX = /^[0-9a-f]{6}$/i;

function segment(kind: TripBandKind, minutes: number, start: number, leg: ItinLeg | null): TripBandSegment {
  const n = legMinutes(minutes);
  const title = kind === 'wait' ? 'Attente' : leg ? legTitle(leg) : 'Marche';
  return {
    kind,
    minutes,
    label: String(n),
    start,
    color: kind === 'ride' && leg?.color && HEX.test(leg.color) ? leg.color : null,
    textColor: kind === 'ride' && leg?.text_color && HEX.test(leg.text_color) ? leg.text_color : null,
    line: kind === 'ride' ? (leg?.line ?? null) : null,
    text: `${title}, ${n}\u00a0min`,
    leg: kind === 'wait' ? null : leg,
  };
}

/** null si le sens n'a pas de tronçon publié (le texte d'indisponibilité du bloc le dit). */
export function tripBandModel(trip: Pick<ItinTrip, 'legs'> | null | undefined): TripBandModel | null {
  const legs = trip?.legs ?? [];
  if (legs.length === 0) return null;
  const segments: TripBandSegment[] = [];
  let t = 0;
  for (const leg of legs) {
    if (!(leg.min > 0)) continue;
    const walk = leg.m === 'walk';
    const wait = !walk && typeof leg.wait_min === 'number' && leg.wait_min > 0 ? leg.wait_min : 0;
    if (wait > 0) {
      segments.push(segment('wait', wait, t, null));
      t += wait;
    }
    segments.push(segment(walk ? 'walk' : 'ride', leg.min, t, leg));
    t += leg.min;
  }
  return segments.length ? { segments, total: t } : null;
}

/** Échelle commune de l'aller et du retour : le plus grand des totaux publiés. */
export function tripBandScale(...models: (TripBandModel | null)[]): number {
  return Math.max(0, ...models.map((m) => m?.total ?? 0));
}
