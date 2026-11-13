/**
 * Coût et carbone d'un trajet motorisé par véhicule (D-029), calculés depuis `car_trip.dist_m` et
 * `meta.vehicles`, avec les mêmes opérations que pipeline/starway/vehicles.py (`energy_eur`,
 * `co2_g`, `round_eur`, `round_g`) : mêmes résultats au centime et au gramme. 07 vérifie la formule
 * (distance x consommation x prix, ou x facteur ENV02).
 */
import { passageWindow, roundCents, tollLeg, type TollLeg } from './tolls';
import type { CarTrip, Meta, TollsFile, VehicleMeta } from './types';

/** Énergie d'un sens (EUR), non arrondie : distance (m) / 1000 x coût au km. */
export function energyEur(distM: number | null | undefined, v: Pick<VehicleMeta, 'cost_eur_per_km'>): number | null {
  return distM == null ? null : (distM / 1000) * v.cost_eur_per_km;
}

/** Carbone d'un sens (g CO2e), non arrondi : distance (m) x facteur au km (kg). */
export function co2Grams(distM: number | null | undefined, v: Pick<VehicleMeta, 'co2_kg_per_km'>): number | null {
  return distM == null || v.co2_kg_per_km == null ? null : distM * v.co2_kg_per_km;
}

/** Au gramme, demi-gramme vers le haut. */
export function roundGrams(x: number): number {
  return Math.floor(x + 0.5);
}

export interface CarLegFacts {
  distM: number | null;
  /** Énergie (EUR, au centime) */
  energy: number | null;
  /** Péage du sens (fourchette possible) ; null si tolls.json n'est pas encore chargé */
  toll: TollLeg | null;
  /** Énergie + péage (EUR) : min et max égaux sauf fourchette ; null si l'un manque */
  totalMin: number | null;
  totalMax: number | null;
  /** Carbone (g CO2e, au gramme) */
  co2: number | null;
  /** Durée qui fixe la fenêtre de passage (min) */
  minutes: number | null;
}

export interface CarTripFacts {
  out: CarLegFacts;
  ret: CarLegFacts;
  /** Aller + retour : énergie (arrondie après la somme), total, carbone */
  energy: number | null;
  totalMin: number | null;
  totalMax: number | null;
  co2: number | null;
}

/** Véhicule choisi (identifiant de l'URL `vh`), sinon le premier publié. */
export function selectedVehicle(meta: Pick<Meta, 'vehicles'>, id: string | null | undefined): VehicleMeta | null {
  const vs = meta.vehicles ?? [];
  return vs.find((v) => v.id === id) ?? vs[0] ?? null;
}

/** Identifiant de véhicule de l'URL ramené aux véhicules publiés ; null = défaut (le premier). */
export function sanitizeVehicle(id: string | null | undefined, meta: Pick<Meta, 'vehicles'>): string | null {
  const vs = meta.vehicles ?? [];
  if (!id || !vs.length || id === vs[0]!.id) return null;
  return vs.some((v) => v.id === id) ? id : null;
}

function legFacts(trip: CarTrip, tj: TollsFile | null, v: VehicleMeta, leg: 'out' | 'ret', i: number, clock: number, minutes: number | null): CarLegFacts {
  const distM = trip.dist_m[leg][i] ?? null;
  const e = energyEur(distM, v);
  const g = co2Grams(distM, v);
  const win = passageWindow(leg, clock, minutes);
  const cell = trip.toll?.[leg]?.[i];
  const toll = tj && trip.toll && win ? tollLeg(tj, cell, v.toll_class, win[0], win[1]) : null;
  const known = e != null && toll != null && toll.min != null && toll.max != null;
  return {
    distM,
    energy: e == null ? null : roundCents(e),
    toll,
    totalMin: known ? roundCents(e + toll.min!) : null,
    totalMax: known ? roundCents(e + toll.max!) : null,
    co2: g == null ? null : roundGrams(g),
    minutes,
  };
}

/**
 * Faits d'un trajet aller et retour vers le pôle d'indice `i` : `start` / `end` en minutes (début et
 * fin du poste), `outMin` / `retMin` = durées affichées (route vide ou trafic moyen).
 */
export function carTripFacts(
  trip: CarTrip,
  tj: TollsFile | null,
  v: VehicleMeta,
  i: number,
  start: number,
  end: number,
  outMin: number | null,
  retMin: number | null,
): CarTripFacts {
  const out = legFacts(trip, tj, v, 'out', i, start, outMin);
  const ret = legFacts(trip, tj, v, 'ret', i, end, retMin);
  const eo = energyEur(out.distM, v);
  const er = energyEur(ret.distM, v);
  const go = co2Grams(out.distM, v);
  const gr = co2Grams(ret.distM, v);
  const energy = eo == null || er == null ? null : roundCents(eo + er);
  const tolls = out.toll && ret.toll && out.toll.min != null && ret.toll.min != null ? [out.toll.min + ret.toll.min, out.toll.max! + ret.toll.max!] : null;
  return {
    out,
    ret,
    energy,
    totalMin: energy == null || !tolls ? null : roundCents(eo! + er! + tolls[0]!),
    totalMax: energy == null || !tolls ? null : roundCents(eo! + er! + tolls[1]!),
    co2: go == null || gr == null ? null : roundGrams(go + gr),
  };
}
