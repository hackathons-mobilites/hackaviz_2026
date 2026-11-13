/**
 * Faits du trajet motorisé partagés par le bloc « Trajet » (`ModeTripBlock`, D-066) et le pli « Coût et carbone » (`ProofCarCost`) :
 * fichier sans composant (rafraîchissement à chaud de Vite).
 */
import { carTripFacts, selectedVehicle } from '../../data/carCost';
import { trafficLeg } from '../../data/congestion';
import { parseClock } from '../../data/proof';
import { guardCarTrip, guardSeries } from '../../data/seriesGuard';
import type { AccessFile, Meta, ModeId, TollsFile } from '../../data/types';
import type { Scenario } from '../../state/scenario';

export interface CarScenarioInput {
  meta: Meta;
  access: AccessFile | null | undefined;
  poleIndex: number;
  /** Nombre d'astres affichés : garde de longueur des séries par position (arbitrage du 05/11) */
  polesCount: number;
  scenario: Scenario;
  tolls: TollsFile | null;
}

/**
 * Faits du trajet motorisé (D-029) pour le véhicule choisi : partagés par le bloc « Trajet » (tuiles d'un sens, D-066) et par ce pli
 * (graphique aller et retour). Fonction pure ; null sans véhicule ni `car_costs` publiés.
 */
export function carScenarioFacts({ meta, access, poleIndex, polesCount, scenario, tolls: tj }: CarScenarioInput) {
  const costs = meta.car_costs;
  const v = selectedVehicle(meta, scenario.vehicle);
  // Séries par position (distances, durées) : de toute autre longueur que les astres affichés, elles sont refusées (pas de coût)
  const trip = guardCarTrip(polesCount, access?.car_trip);
  if (!v || !costs) return null;
  const day = meta.day_types.find((d) => d.id === scenario.day);
  const start = scenario.shift?.start ?? parseClock(day?.start);
  const end = scenario.shift?.end ?? parseClock(day?.end);
  const base = guardSeries(polesCount, access?.modes?.car?.any);
  const durations = legDurations(meta, scenario.mode, start, end, base?.out[poleIndex], base?.ret[poleIndex]);
  const facts = trip && start != null && end != null && poleIndex >= 0 ? carTripFacts(trip, tj, v, poleIndex, start, end, durations.out, durations.ret) : null;
  const forbidden = !!facts && [facts.out.toll?.status, facts.ret.toll?.status].includes('interdit');
  return { costs, v, trip, start, end, durations, facts, forbidden };
}


/** Durée affichée de chaque sens : route vide, ou trafic moyen DiRIF en mode `car_traffic` (même règle que ProofTraffic). */
function legDurations(meta: Meta, mode: ModeId, start: number | null, end: number | null, out: number | null | undefined, ret: number | null | undefined) {
  const cc = meta.car_congestion;
  if (mode !== 'car_traffic' || !cc || start == null || end == null) return { out: out ?? null, ret: ret ?? null };
  return { out: trafficLeg(cc, 'out', start, out).used, ret: trafficLeg(cc, 'ret', end, ret).used };
}

