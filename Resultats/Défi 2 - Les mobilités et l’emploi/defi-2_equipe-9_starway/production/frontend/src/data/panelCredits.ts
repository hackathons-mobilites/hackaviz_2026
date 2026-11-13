/**
 * Ligne de crédits du panneau de preuve et du ciel (D-060) : les producteurs des données affichées, en clair, toujours
 * visibles (mode sources ou non), en une seule ligne courte. Accord de l'organisateur du hackathon (Île-de-France
 * Mobilités, 09/11/2026) : le producteur est crédité dans la dataviz elle-même. Le détail (jeu, millésime, code) reste
 * en mode sources et dans « Sources & limites ».
 *
 * Fonctions pures : les codes viennent des mêmes fonctions de provenance que le mode sources (aucune liste écrite pour
 * un scénario), les noms de `CREDIT_NAMES`, sinon du titre publié dans sources.json.
 */
import { CREDIT_NAMES, OSM_CREDIT } from './attribution';
import { selectedVehicle } from './carCost';
import type { ItinTrip } from './itineraries';
import {
  bassinPart,
  codePart,
  jobsPart,
  mainEntry,
  modesParts,
  originPart,
  producerLabel,
  stopPart,
  travelPart,
  tripFactsPart,
  type ModeRowSources,
  type ProvPart,
} from './provenance';
import { carCostProvenance } from './provenanceCarCost';
import { guardCarTrip } from './seriesGuard';
import type { AccessFile, Commune, Dataset, ModeId, Pole, SourceEntry, TollsFile, TollCell, VehicleMeta } from './types';

export const OSM_CODE = 'CYC01';

/** Codes cités par des lignes de provenance, sans doublon, dans l'ordre. */
export function codesOfParts(parts: readonly (ProvPart | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of parts) for (const t of p?.tags ?? []) if (!out.includes(t.code)) out.push(t.code);
  return out;
}

/** Nom crédité d'un code : table, sinon producteur du titre publié ; null si rien à créditer ou code inconnu. */
export function creditName(code: string, sources: readonly SourceEntry[]): string | null {
  if (code in CREDIT_NAMES) return CREDIT_NAMES[code] || null;
  const e = mainEntry(code, sources);
  return e ? producerLabel(e) : null;
}

/**
 * Producteurs des péages traversés par le trajet voiture d'un astre (aller et retour), lus dans le crédit publié de
 * chaque point (`tolls.json`, « tarif © VINCI Autoroutes 2026 » donne « VINCI Autoroutes »). Un péage inconnu ne
 * crédite rien : aucun montant n'est affiché.
 */
export function crossedTollProducers(tj: TollsFile | null, cells: readonly (TollCell | null | undefined)[]): string[] {
  if (!tj) return [];
  const out: string[] = [];
  for (const cell of cells) {
    if (!Array.isArray(cell)) continue;
    for (const [e, s] of cell) {
      for (const i of e === s ? [e] : [e, s]) {
        const m = /^tarif (?:© )?(.+?) \d{4}\b/.exec(tj.points[i]?.credit ?? '');
        const name = m?.[1] ?? tj.points[i]?.operator ?? null;
        if (name && !out.includes(name)) out.push(name);
      }
    }
  }
  return out;
}

/** Noms crédités, sans doublon, OpenStreetMap en dernier avec sa mention ODbL (« © les contributeurs d'OpenStreetMap »). */
export function creditNames(codes: readonly string[], sources: readonly SourceEntry[], extra: readonly string[] = []): string[] {
  const names: string[] = [];
  for (const c of codes) {
    if (c === OSM_CODE) continue;
    const n = creditName(c, sources);
    if (n && !names.includes(n)) names.push(n);
  }
  for (const n of extra) if (!names.includes(n)) names.push(n);
  if (codes.includes(OSM_CODE)) names.push(OSM_CREDIT);
  return names;
}

/** « Données : INSEE, France Travail, © les contributeurs d'OpenStreetMap » ; null si rien à créditer. */
export function creditLine(names: readonly string[]): string | null {
  return names.length ? `Données : ${names.join(', ')}` : null;
}

/**
 * Codes à créditer dans la bande du ciel, toujours visible, EN PLUS des sources du ciel (D-060 amendée le 11/11 : la ligne de
 * crédits du pied du panneau n'est plus écrite qu'en mode sources ; chaque producteur dont une donnée est affichée doit donc
 * être crédité ici, sans ouvrir un « i »). Tout est lu dans meta.json (aucun code de producteur écrit pour un scénario, sauf
 * SUB05, le code du bloc de la prise en charge par l'employeur, comme dans `panelCreditCodes`) :
 * - voiture avec trafic : la source de l'indice de trafic (`meta.car_congestion.source_id`, DiRIF) ;
 * - voiture (les deux modes) : consommation, prix de l'énergie et carbone du véhicule choisi (EDF pour l'électrique) ;
 * - panneau d'un astre ouvert : « Comparer les moyens » écrit le temps avec trafic et le coût de chaque voiture publiée,
 *   quel que soit le mode : indice de trafic et sources de tous les véhicules ; en transports en commun, le bloc des
 *   abonnements cite la prise en charge par l'employeur (Service Public).
 * La bande ne sait pas quelles lignes du panneau sont dépliées : dès que le panneau est ouvert, ses producteurs sont crédités.
 * Un code absent de sources.json ne crédite rien.
 */
export function scenarioCreditCodes(
  ds: Pick<Dataset, 'origin' | 'meta' | 'sources'>,
  x: { mode: ModeId; vehicle?: string | null; panelOpen: boolean; hasOrigin: boolean },
): string[] {
  if (ds.origin !== 'real' || !x.hasOrigin) return [];
  const car = x.mode === 'car' || x.mode === 'car_traffic';
  const traffic = ds.meta.car_congestion?.source_id ?? null;
  const vehicleCodes = (v: Pick<VehicleMeta, 'consumption_source' | 'price_source' | 'co2_source'>) =>
    [v.consumption_source?.source_id, v.price_source?.source_id, v.co2_source?.source_id].filter((c): c is string => !!c);
  const out: string[] = [];
  const add = (c: string | null | undefined) => {
    if (c && !out.includes(c) && mainEntry(c, ds.sources)) out.push(c);
  };
  if (traffic && (x.mode === 'car_traffic' || x.panelOpen)) add(traffic);
  const chosen = car ? selectedVehicle(ds.meta, x.vehicle) : null;
  if (chosen) vehicleCodes(chosen).forEach(add);
  if (x.panelOpen) {
    for (const v of ds.meta.vehicles ?? []) vehicleCodes(v).forEach(add);
    if (x.mode === 'transit' || x.mode === 'bike_transit') add('SUB05');
  }
  return out;
}

/** Ce que le panneau affiche pour un astre : de quoi retrouver les sources de chaque bloc. */
export interface PanelCreditInput {
  ds: Pick<Dataset, 'origin' | 'meta' | 'sources' | 'poles'>;
  mode: ModeId;
  pole: Pick<Pole, 'jobs_source' | 'jobs_year' | 'bassin' | 'point'>;
  origins: readonly (Pick<Commune, 'origin'> | null | undefined)[];
  /** Itinéraires TC affichés (aller, retour) */
  trips: readonly (Pick<ItinTrip, 'legs'> | null | undefined)[];
  /** Bloc des abonnements avec la prise en charge par l'employeur (TC, une seule commune) */
  employer: boolean;
  /** Voiture : fichier access de la commune, véhicule de l'URL, indice de l'astre, tolls.json */
  access?: Pick<AccessFile, 'car_trip'> | null;
  vehicle?: string | null;
  poleIndex?: number;
  tolls?: TollsFile | null;
  /** Bloc des offres de « Choisir le service public » affiché (case cochée) */
  publicOffers: boolean;
  /** Lignes de « Comparer les moyens » */
  modeRows?: readonly ModeRowSources[] | null;
}

/** Codes des données que montre le panneau d'un astre, et producteurs des péages traversés. */
export function panelCreditCodes(x: PanelCreditInput): { codes: string[]; tolls: string[] } {
  const { ds, mode } = x;
  const hasOrigin = x.origins.some((o) => !!o);
  const car = hasOrigin && (mode === 'car' || mode === 'car_traffic');
  const trips = x.trips.filter((t): t is Pick<ItinTrip, 'legs'> => !!t);
  const parts: (ProvPart | null)[] = [
    hasOrigin ? travelPart(ds, mode) : null,
    jobsPart(ds, x.pole),
    bassinPart(ds.sources, [x.pole]),
    hasOrigin ? originPart(ds, x.origins) : null,
    hasOrigin ? codePart(ds.sources, 'GEO01') : null,
    trips.length ? stopPart(ds, x.pole) : null,
    ...trips.map((t) => tripFactsPart(ds.sources, t)),
    trips.length ? codePart(ds.sources, 'COST02') : null,
    x.employer ? codePart(ds.sources, 'SUB05') : null,
    car && ds.meta.car_congestion ? codePart(ds.sources, ds.meta.car_congestion.source_id) : null,
    x.publicOffers ? codePart(ds.sources, 'EMP04') : null,
    ...(x.modeRows?.length ? modesParts(ds, x.modeRows) : []),
  ];
  let tolls: string[] = [];
  const v = car ? selectedVehicle(ds.meta, x.vehicle) : null;
  if (v) {
    const trip = guardCarTrip(ds.poles.length, x.access?.car_trip);
    parts.push(...carCostProvenance(ds.sources, { vehicle: v, tolls: null, withTrip: !!trip, mode, meta: ds.meta }));
    const i = x.poleIndex ?? -1;
    if (trip?.toll && i >= 0) tolls = crossedTollProducers(x.tolls ?? null, [trip.toll.out[i], trip.toll.ret[i]]);
  }
  return { codes: codesOfParts(parts), tolls };
}
