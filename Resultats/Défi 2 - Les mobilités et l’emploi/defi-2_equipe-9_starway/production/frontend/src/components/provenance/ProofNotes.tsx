import type { HaloContextDimension } from '../../data/halo';
import {
  alternativesPart,
  bassinPart,
  chomagePart,
  codePart,
  costPart,
  flowsPart,
  haloPart,
  jobsPart,
  mapProvenance,
  modesParts,
  needsPart,
  offpeakPart,
  originPart,
  polarityPart,
  recordsPart,
  skyProvenance,
  stopPart,
  travelPart,
  tripFactsPart,
  workTimePart,
  type ModeRowSources,
} from '../../data/provenance';
import type { ItinTrip } from '../../data/itineraries';
import type { TerritoireFile } from '../../data/territoire';
import type { Commune, ContextFile, ModeId, Pole, SourceEntry } from '../../data/types';
import { useSkyStore } from '../../store/useSkyStore';
import { ProvenanceNote } from './ProvenanceNote';

const NO_SOURCES: SourceEntry[] = [];

function useDataset() {
  return useSkyStore((s) => s.dataset);
}

function useSources() {
  return useSkyStore((s) => s.dataset?.sources ?? NO_SOURCES);
}

/*
 * Lignes de provenance prêtes à poser, une par bloc chiffré : chacune lit elle-même les JSON publiés
 * (store) pour que les panneaux n'aient qu'une ligne à ajouter. Rien n'est rendu si le mode est coupé
 * ou si la source n'est pas publiée.
 */

/** Temps de trajet (aller, retour ; part des postes en horaires libres) et point de départ. */
export function TravelSourceNote({
  mode,
  origins,
  withJobs = false,
  lead,
  className,
}: {
  mode: ModeId;
  origins: readonly (Pick<Commune, 'origin'> | null | undefined)[];
  withJobs?: boolean;
  /** Ce que la source fonde, si ce n'est pas « Temps de trajet » (« Itinéraire ») */
  lead?: string;
  className?: string;
}) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={[travelPart(ds, mode, lead), originPart(ds, origins), withJobs ? jobsPart(ds) : null]} />;
}

/** Bassin d'emploi des astres (GEO04). */
export function BassinSourceNote({ poles, className }: { poles: readonly Pick<Pole, 'bassin'>[]; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[bassinPart(sources, poles)]} />;
}

/** Faits de ligne d'un itinéraire (TRA03, TRA04, QS01) : seulement ceux que le tronçon porte et que sources.json publie ; mois et extrait lus dans la donnée. */
export function TripFactsSourceNote({ trip, className }: { trip: Pick<ItinTrip, 'legs'>; className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={[tripFactsPart(ds.sources, trip, ds.meta.line_facts)]} />;
}

/**
 * Sources lues dans les enregistrements publiés que le bloc affiche (champs `source_id` : prix, citations) :
 * abonnements SUB01 à SUB05, jamais une liste de codes écrite dans le composant.
 */
export function RecordsSourceNote({ nodes, className }: { nodes: readonly unknown[]; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[recordsPart(sources, nodes)]} />;
}

/** Arrêt de référence du pôle (GTFS IDFM, date de service). */
export function StopSourceNote({ pole, className }: { pole: Pick<Pole, 'point'>; className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={[stopPart(ds, pole)]} />;
}

/** Postes salariés (INSEE) d'un pôle. */
export function JobsSourceNote({ pole, className }: { pole: Pick<Pole, 'jobs_source' | 'jobs_year'>; className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={[jobsPart(ds, pole, null)]} />;
}


/** Actifs qui travaillent déjà dans le pôle (EMP02). */
export function FlowsSourceNote({ ctxs, className }: { ctxs: readonly (ContextFile | null | undefined)[]; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[flowsPart(sources, ctxs)]} />;
}

/** Forfait Navigo (code en tête du texte publié). */
export function CostSourceNote({ transitSource, className }: { transitSource: string | null | undefined; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[costPart(sources, transitSource)]} />;
}

/** Une source citée par son code (tickets COST02, carbone ENV01) : rien si elle n'est pas dans sources.json. */
export function CodeSourceNote({ code, method, className }: { code: string; method?: string; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[codePart(sources, code, method)]} />;
}

/** Heure creuse : horaires GTFS et rues OSM du calcul. */
export function OffpeakSourceNote({ className }: { className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={[offpeakPart(ds)]} />;
}

/** Autres trajets (D-055) : horaires GTFS et rues OSM du calcul, règle de choix des onglets. */
export function AlternativesSourceNote({ className }: { className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={[alternativesPart(ds)]} />;
}

/** « Comparer les modes » : durées, prix au ticket, carbone et coût voiture réellement affichés. */
export function ModesSourceNote({ rows, className }: { rows: readonly ModeRowSources[]; className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={modesParts(ds, rows)} />;
}

/** Onglet du halo (GEN04, GEN01, SOC01 : code et millésime du bloc lu). */
export function HaloSourceNote({ ctx, dim, className }: { ctx: ContextFile | null | undefined; dim: HaloContextDimension; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[haloPart(sources, ctx, dim)]} />;
}

/** Onglet « Chômage » du halo (D-048) : taux de l'Insee et composition communale des zones d'emploi. */
export function ChomageSourceNote({ file, method, className }: { file: TerritoireFile | null | undefined; method?: string; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[chomagePart(sources, file, method)]} />;
}

/** Bulle de la journée-type et pli « Méthode et sources » (D-048) : enquête Emploi, niveau national. */
export function WorkTimeSourceNote({ file, method, className }: { file: TerritoireFile | null | undefined; method?: string; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[workTimePart(sources, file, method)]} />;
}

/** Polarité SDRIF-E sous le nom de la commune et dans le pli « Communes du pôle » (D-048). */
export function PolaritySourceNote({ file, method, className }: { file: TerritoireFile | null | undefined; method?: string; className?: string }) {
  const sources = useSources();
  return <ProvenanceNote className={className} parts={[polarityPart(sources, file, method)]} />;
}

/** Ciel en liste, découvertes, contraste du jour : postes et temps de trajet. */
export function SkySourceNote({ mode, className }: { mode: ModeId; className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={skyProvenance(ds, mode)} />;
}

/** Carte miroir : contours, disques, aire, temps de trajet. */
export function MapSourceNote({ mode, className }: { mode: ModeId; className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={mapProvenance(ds, mode)} />;
}

/** « Mes besoins » : sources de l'accessibilité déclarée (codes lus dans meta.needs.sources). */
export function NeedsSourceNote({ className }: { className?: string }) {
  const ds = useDataset();
  if (!ds) return null;
  return <ProvenanceNote className={className} parts={[needsPart(ds)]} />;
}
