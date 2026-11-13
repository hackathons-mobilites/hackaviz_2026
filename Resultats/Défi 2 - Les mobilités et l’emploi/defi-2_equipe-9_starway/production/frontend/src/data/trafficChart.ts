/**
 * Graphique « Voiture : route vide et trafic moyen » (lot 4, D-051) : fonctions PURES, au-dessus de `congestion.ts` (les temps, l'indice
 * et sa tranche viennent de là, rien n'est recalculé). Une ligne par sens : le temps route vide (point VIDE) et le temps avec le trafic
 * moyen (point PLEIN), reliés ; l'indice de la tranche est écrit. Sans indice applicable (hors tranche, pas de mesure), la ligne ne
 * dessine que le point vide et l'écrit. Sans trajet en voiture, rien n'est dessiné : « aucun trajet en voiture trouvé » est écrit.
 */
import { periodText, trafficLegText, type TrafficLeg } from './congestion';
import type { CarCongestionMeta } from './types';

export interface TrafficChartRow {
  label: 'Aller' | 'Retour';
  /** Temps route vide (min) ; null = aucun trajet en voiture */
  free: number | null;
  /** Temps avec le trafic moyen (min) ; null = l'indice ne s'applique pas */
  traffic: number | null;
  /** Indice de la tranche écrit (« x 1,95 (16h-20h) ») ; null sans indice applicable */
  indexText: string | null;
  /** Mot écrit à la place de ce qui n'est pas dessiné ; null quand les deux points sont là */
  written: string | null;
  /** Phrase du survol et du focus : celle du panneau (`trafficLegText`) précédée du sens */
  sentence: string;
}

export interface TrafficChartModel {
  rows: TrafficChartRow[];
  /** Fin de l'axe (l'axe part de 0) : le plus grand des temps dessinés ; 0 si rien n'est dessiné */
  axisMax: number;
}

function row(cc: Pick<CarCongestionMeta, 'texts' | 'month'>, label: TrafficChartRow['label'], leg: TrafficLeg): TrafficChartRow {
  const text = trafficLegText(cc, leg);
  const sentence = `${label} : ${text ?? 'aucun trajet en voiture trouvé'}.`;
  if (leg.free == null) return { label, free: null, traffic: null, indexText: null, written: 'Aucun trajet', sentence };
  if (leg.status === 'ok' && leg.period && leg.traffic != null) return { label, free: leg.free, traffic: leg.traffic, indexText: periodText(leg.period), written: null, sentence };
  return { label, free: leg.free, traffic: null, indexText: null, written: 'Route vide seulement', sentence };
}

export function trafficChartModel(cc: Pick<CarCongestionMeta, 'texts' | 'month'>, out: TrafficLeg, ret: TrafficLeg): TrafficChartModel {
  const rows = [row(cc, 'Aller', out), row(cc, 'Retour', ret)];
  const drawn = rows.flatMap((r) => [r.free, r.traffic]).filter((m): m is number => m != null);
  return { rows, axisMax: Math.max(0, ...drawn) };
}
