/**
 * Provenance du bloc « Coût et carbone » du panneau de preuve (D-029, règle D-033 de Nicolas du 04/11 :
 * tout bloc chiffré nouveau affiche sa source quand le mode sources est actif). Fonctions PURES, dans un
 * fichier à part pour ne pas toucher `provenance.ts`. Les codes viennent des JSON publiés (meta.vehicles :
 * `consumption_source`, `price_source`, `co2_source` ; tolls.json : `sources`) ; aucun nom, millésime ni
 * lien n'est écrit en dur : un code absent de sources.json ne produit rien.
 */
import { engineFor, sourceTag, travelCodes, type ProvPart, type SourceTag } from './provenance';
import type { Meta, ModeId, SourceEntry, TollsFile, VehicleMeta } from './types';

const uniqueTags = (list: (SourceTag | null)[]): SourceTag[] =>
  list.filter((t): t is SourceTag => !!t).filter((t, i, a) => a.findIndex((x) => x.code === t.code) === i);

function part(lead: string, list: (SourceTag | null)[], engine: string | null = null): ProvPart | null {
  const tags = uniqueTags(list);
  return tags.length ? { lead, engine, tags } : null;
}

export interface CarCostProvenanceInput {
  vehicle: Pick<VehicleMeta, 'consumption_source' | 'price_source' | 'co2_source'>;
  /** tolls.json, une fois chargé (sinon aucune source de péage n'est citée) */
  tolls: Pick<TollsFile, 'sources'> | null;
  /** Les distances routières (`car_trip`) sont publiées pour ce trajet : le coût et les péages en dépendent */
  withTrip: boolean;
  /** Mode motorisé du scénario : le réseau routier du calcul est celui que `travelCodes` donne pour ce mode */
  mode: ModeId;
  meta: Pick<Meta, 'velib'>;
}

/**
 * Les sources des chiffres du bloc : consommation (SDES ou ADEME selon le véhicule), prix de l'énergie,
 * carbone (ENV02), distances routières (r5py sur le réseau du mode, comme les temps de trajet) et péages
 * (codes de tolls.json). Les lignes de sources textuelles du bloc (qui restent toujours affichées) ne sont
 * pas remplacées.
 */
export function carCostProvenance(sources: readonly SourceEntry[], input: CarCostProvenanceInput): ProvPart[] {
  const { vehicle: v, tolls, withTrip, mode, meta } = input;
  const road = travelCodes(mode, meta);
  const parts = [
    part('Consommation', [sourceTag(v.consumption_source?.source_id, sources, { year: v.consumption_source?.year })]),
    part("Prix de l'énergie", [sourceTag(v.price_source?.source_id, sources)]),
    part('Carbone', [sourceTag(v.co2_source?.source_id, sources)]),
    withTrip ? part('Distances routières', road.map((c) => sourceTag(c, sources)), engineFor(road, sources)) : null,
    withTrip && tolls ? part('Péages', (tolls.sources ?? []).map((s) => sourceTag(s.source_id, sources))) : null,
  ];
  return parts.filter((p): p is ProvPart => !!p);
}
