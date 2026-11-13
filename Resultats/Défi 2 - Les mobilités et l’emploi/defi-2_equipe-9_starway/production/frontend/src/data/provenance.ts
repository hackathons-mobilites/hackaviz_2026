/**
 * Provenance des données (motion-spec, section « Affichage », partie B ; demande de Nicolas du 03/11).
 * Fonctions PURES : à partir des JSON publiés (sources.json, meta.json, poles.json, context/{insee}.json),
 * la source de chaque chiffre affiché : jeu, millésime, code et ancre de sa fiche dans « Sources &
 * limites ». Aucun nom, millésime ni lien écrit en dur : un code absent de sources.json ne produit
 * rien (le chiffre reste affiché, sans mention de source).
 */
import type { HaloContextDimension } from './halo';
import { monthText, punctualityText, type ItinTrip } from './itineraries';
import { frDate, quarterLabel, type TerritoireFile } from './territoire';
import type { Commune, ContextFile, Dataset, LineFactsMeta, ModeId, Pole, SourceEntry } from './types';

/** Une source citée : « INSEE Flores 2023 (EMP01) », « GTFS IDFM, mardi 17/11/2026 (TRA01) ». */
export interface SourceTag {
  code: string;
  /** Producteur et jeu, tirés du titre publié (partie avant « - ») */
  label: string;
  /** Millésime ou date (lu dans la donnée, sinon dans sources.json) ; null si rien n'est publié */
  period: string | null;
  /** Texte affiché */
  text: string;
  /** Ancre de la fiche de la source dans « Sources & limites » */
  anchor: string;
}

/** Une ligne de provenance : « Temps de trajet : calcul r5py sur … et … ». */
export interface ProvPart {
  /** Ce que la source fonde (« Postes », « Temps de trajet ») ; null : « Source » */
  lead: string | null;
  /** Calcul intermédiaire cité dans sources.json (« calcul r5py ») ; null sinon */
  engine: string | null;
  tags: SourceTag[];
  /**
   * Comment le chiffre a été calculé, en une phrase (règle de Nicolas du 05/11 : toute donnée affichée, même
   * calculée, dit sa source ET sa méthode quand le mode sources est actif). Absent : méthode déjà dite par `engine`.
   */
  method?: string;
}

/** Méthodes de calcul des chiffres affichés (voir docs/methodologie.md) : une phrase, jamais un chiffre ni un nom de jeu. */
export const METHODS = {
  tickets:
    "tickets à l'unité au plein tarif, un par suite de tronçons dans la fenêtre de correspondance de 2 h ; ticket aéroport pour les trajets qui y arrivent ou en partent ; aucun forfait",
  carbon:
    "distance de chaque tronçon en transport en commun multipliée par le facteur d'émission publié pour sa ligne ou son mode, somme par sens ; la marche n'est pas comptée",
  offpeak: "même calcul que les temps du ciel, avec un départ en heure creuse",
  alternatives:
    "le trajet retenu est l'itinéraire du panneau, dont la durée est la plus proche du temps de trajet calculé ; les autres sont cherchés par le même moteur, dans la largeur de recherche indiquée, parmi les trajets qui arrivent avant le début du poste à l'aller et partent après sa fin au retour ; le moins cher a le prix au ticket connu le plus bas (à prix égal, le plus court) ; le moins de correspondances a le moins de montées (à égalité, le plus court)",
  modes: "chaque mode est calculé comme sur le ciel ; coût et carbone d'un mode ne sont affichés que s'ils sont publiés pour ce trajet",
  flows:
    "actifs occupés qui habitent la commune et déclarent au recensement (estimation par sondage) travailler dans une commune du pôle ou de l'astre affiché, flux des communes additionnés (arrondissements pour Paris) ; la part se calcule sur tous les actifs occupés de la commune, y compris ceux qui travaillent ailleurs ou hors d'Île-de-France ; sous 200 : ordre de grandeur ; un couple absent du fichier INSEE n'a aucun chiffre",
  // Repères de territoire (D-048), valeurs lues telles quelles, aucun calcul
  chomage:
    "taux du dernier trimestre lus tels quels dans les fichiers de l'Insee, sans calcul ; la zone d'emploi de la commune de départ est celle de la composition communale ; taux mesuré au lieu de résidence, descriptif",
  workTime:
    "part lue telle quelle dans le tableau de l'enquête Emploi, au niveau national, sur quatre semaines ; aucune valeur par territoire ; aucune catégorie « tôt le matin », donc aucun chiffre pour la journée-type 6h-14h",
  polarity:
    "commune repérée par son nom dans la liste des polarités du SDRIF-E ; les noms mal écrits dans ce fichier sont corrigés par une table explicite du pipeline ; descriptif, pas un classement d'accessibilité",
} as const;

/* ------------------------------------------------------------------ préférence */

/**
 * Provenance affichée au chargement : `?src=1` / `?src=0` priment (pour la session, non mémorisés) ;
 * sinon le choix mémorisé (« on » / « off ») ; sinon la valeur par défaut. `?record=1` (vidéo) ne
 * change rien de plus : la vidéo suit le défaut, sauf `?src=` explicite.
 */
export function initialProvenance(search: string, stored: string | null, defaultOn: boolean): boolean {
  const param = new URLSearchParams(search).get('src');
  if (param === '1') return true;
  if (param === '0') return false;
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return defaultOn;
}

/* ------------------------------------------------------------------ sources.json */

/** Ancre de la fiche d'une source dans « Sources & limites » (première entrée de ce code). */
export function ficheAnchor(code: string): string {
  return `fiche-${code}`;
}

const isDocumentation = (e: SourceEntry) => /documentation/i.test(e.titre);

/** Entrée principale d'un code : la première qui n'est pas une documentation, sinon la première. */
export function mainEntry(code: string, sources: readonly SourceEntry[]): SourceEntry | null {
  const all = sources.filter((s) => s.source_id === code);
  return all.find((s) => !isDocumentation(s)) ?? all[0] ?? null;
}

/**
 * Producteur et jeu, lus dans le titre publié : « INSEE Flores - Nombre d'établissements… » →
 * « INSEE Flores ». Un jeu GTFS dont le producteur seul est en tête (« IDFM - Horaires prévus… (GTFS
 * Datahub…) ») devient « GTFS IDFM » : le mot vient du même titre.
 */
export function producerLabel(entry: Pick<SourceEntry, 'titre'>): string {
  const head = entry.titre.split(' - ')[0]!.trim();
  return /\bGTFS\b/.test(entry.titre) && !/\bGTFS\b/.test(head) ? `GTFS ${head}` : head;
}

/** "2026-11-17" ou "2026-11-02T14:20Z" → « 17/11/2026 » ; null si illisible. */
export function shortDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** "2026-11-17" → « mardi 17/11/2026 » (jour de la semaine calculé). */
export function dayDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${WEEKDAYS[wd]} ${m[3]}/${m[2]}/${m[1]}`;
}

export interface TagOptions {
  /** Millésime porté par la donnée elle-même (poles.json `jobs_year`, context `year`) */
  year?: number | null;
  /** Date de service porté par la donnée (meta.service_date) : « mardi 17/11/2026 » */
  serviceDate?: string | null;
  /** Période déjà formulée à partir de la donnée (« septembre 2026 », « extrait du 03/11/2026 ») : prime sur le millésime de sources.json */
  period?: string | null;
}

/**
 * Source citée pour un code. Millésime : celui de la donnée (options) ; sinon l'année en tête de
 * `millesime` (« 2023 (…) », « RP 2023 (…) ») ; sinon la date d'extraction. null si le code n'est pas
 * dans sources.json (rien n'est inventé).
 */
export function sourceTag(code: string | null | undefined, sources: readonly SourceEntry[], opts: TagOptions = {}): SourceTag | null {
  if (!code) return null;
  const entry = mainEntry(code, sources);
  if (!entry) return null;
  const label = producerLabel(entry);
  const anchor = ficheAnchor(code);
  if (opts.period) return { code, label, period: opts.period, text: `${label}, ${opts.period} (${code})`, anchor };
  const service = dayDate(opts.serviceDate);
  if (service) return { code, label, period: service, text: `${label}, ${service} (${code})`, anchor };
  const year = opts.year ?? Number(/^(?:RP\s+)?((?:19|20)\d{2})\b/.exec(entry.millesime ?? '')?.[1] ?? NaN);
  if (Number.isFinite(year)) {
    const y = String(year);
    const inLabel = /\b(?:19|20)\d{2}\b/.exec(label)?.[0];
    const text = inLabel === y ? `${label} (${code})` : inLabel ? `${label}, millésime ${y} (${code})` : `${label} ${y} (${code})`;
    return { code, label, period: y, text, anchor };
  }
  // Titre qui porte déjà son millésime (« INSEE Filosofi 2021 ») : pas de date d'extraction en plus
  const extracted = /\b(?:19|20)\d{2}\b/.test(label) ? null : shortDate(entry.date_extraction);
  if (extracted) {
    const period = `extrait du ${extracted}`;
    return { code, label, period, text: `${label}, ${period} (${code})`, anchor };
  }
  return { code, label, period: null, text: `${label} (${code})`, anchor };
}

const tags = (list: (SourceTag | null)[]): SourceTag[] => list.filter((t): t is SourceTag => !!t);

const part = (lead: string | null, list: (SourceTag | null)[], engine: string | null = null, method?: string): ProvPart | null => {
  const t = tags(list);
  return t.length ? { lead, engine, tags: t, ...(method ? { method } : {}) } : null;
};

/**
 * Calcul intermédiaire cité par sources.json : « calcul r5py » si les traitements publiés d'une des
 * sources le nomment (TRA01, CYC01 : « entrée directe de r5py »). null sinon.
 */
export function engineFor(codes: readonly string[], sources: readonly SourceEntry[]): string | null {
  const named = codes.some((c) => sources.some((s) => s.source_id === c && /\br5py\b/.test(s.traitements ?? '')));
  return named ? 'calcul r5py' : null;
}

/* ------------------------------------------------------------------ éléments affichés */

type DatasetLike = Pick<Dataset, 'origin' | 'meta' | 'sources' | 'poles'>;

/**
 * Sources des temps de trajet d'un mode : rues OSM (CYC01) pour tous ; horaires GTFS (TRA01) pour
 * les modes qui prennent les transports en commun ; stations Vélib' (code publié dans meta.velib).
 */
export function travelCodes(mode: ModeId, meta: Pick<Dataset['meta'], 'velib'>): string[] {
  if (mode === 'transit' || mode === 'bike_transit') return ['TRA01', 'CYC01'];
  if (mode === 'velib') return ['CYC01', ...(meta.velib?.source ? [meta.velib.source] : [])];
  return ['CYC01'];
}

/** Temps de trajet (aller, retour, états du ciel) : « calcul r5py sur GTFS IDFM, … et OpenStreetMap, … ». */
export function travelPart(ds: DatasetLike, mode: ModeId, lead: string | null = 'Temps de trajet'): ProvPart | null {
  if (ds.origin !== 'real') return null;
  const codes = travelCodes(mode, ds.meta);
  return part(
    lead,
    codes.map((c) => sourceTag(c, ds.sources, c === 'TRA01' ? { serviceDate: ds.meta.service_date } : {})),
    engineFor(codes, ds.sources),
  );
}

/** Postes salariés (INSEE) d'un pôle (ou de tout le ciel) : code et millésime lus dans poles.json. */
export function jobsPart(ds: DatasetLike, pole?: Pick<Pole, 'jobs_source' | 'jobs_year'> | null, lead: string | null = 'Postes'): ProvPart | null {
  if (ds.origin !== 'real') return null;
  const p = pole ?? ds.poles[0];
  if (!p) return null;
  return part(lead, [sourceTag(p.jobs_source, ds.sources, { year: p.jobs_year })]);
}

/**
 * Bande du ciel : postes (aire des astres), temps de trajet (états) et, au jeu des 44 astres (D-030),
 * le découpage en bassins d'emploi qui nomme et regroupe les astres (GEO04).
 */
export function skyProvenance(ds: DatasetLike, mode: ModeId): ProvPart[] {
  return [jobsPart(ds), travelPart(ds, mode), ds.origin === 'real' ? bassinPart(ds.sources, ds.poles) : null].filter((p): p is ProvPart => !!p);
}

/**
 * Bassins d'emploi (GEO04, D-030) : le code est en tête de `pole.bassin.source` (« GEO04, France Travail,
 * bassins d'emploi 2026 »), publié par le pipeline avec chaque astre du jeu de 44.
 */
export function bassinPart(sources: readonly SourceEntry[], poles: readonly Pick<Pole, 'bassin'>[], lead: string | null = "Bassins d'emploi"): ProvPart | null {
  const code = poles.map((p) => /^([A-Z][A-Z0-9-]*\d)\b/.exec(p.bassin?.source ?? '')?.[1]).find((c): c is string => !!c);
  return code ? part(lead, [sourceTag(code, sources)]) : null;
}

/**
 * Sources des faits de ligne d'un itinéraire (« Transports utilisés ») : TRA03 (climatisation, accessibilité
 * déclarées), TRA04 (niveau des gares), QS01 (ponctualité). Un code n'est cité que si le tronçon porte le fait
 * ET si sources.json le publie. Période : le mois de la ponctualité est lu sur le tronçon (sinon dans
 * `meta.line_facts`), la date de l'extrait TRA03 dans `meta.line_facts.tra03_snapshot` ; à défaut, le
 * millésime de sources.json.
 */
export function tripFactsPart(
  sources: readonly SourceEntry[],
  trip: Pick<ItinTrip, 'legs'>,
  lineFacts?: Pick<LineFactsMeta, 'tra03_snapshot' | 'punctuality_month'> | null,
): ProvPart | null {
  const legs = (trip.legs ?? []).filter((l) => l.m && l.m !== 'walk');
  const snapshot = shortDate(lineFacts?.tra03_snapshot);
  const month = monthText(legs.map((l) => l.punctuality?.month).find((m) => !!m) ?? lineFacts?.punctuality_month);
  return part('Faits de ligne', [
    legs.some((l) => l.air_conditioning !== undefined || l.accessibility !== undefined)
      ? sourceTag('TRA03', sources, { period: snapshot ? `extrait du ${snapshot}` : null })
      : null,
    legs.some((l) => l.station_from !== undefined || l.station_to !== undefined) ? sourceTag('TRA04', sources) : null,
    legs.some((l) => punctualityText(l) !== null) ? sourceTag('QS01', sources, { period: month }) : null,
  ]);
}

/**
 * Codes de source portés par des données publiées : tous les champs `source_id` des objets donnés, sans
 * doublon, dans l'ordre de première apparition (ex. prix d'un abonnement : « SUB01 », citations « SUB02 »).
 * Le bloc cite donc ce que sa donnée dit, jamais une liste écrite à la main.
 */
export function sourceIdsOf(...nodes: readonly unknown[]): string[] {
  const seen: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'source_id' && typeof v === 'string') {
        if (!seen.includes(v)) seen.push(v);
      } else walk(v);
    }
  };
  nodes.forEach(walk);
  return seen;
}

/** Sources des données affichées par un bloc : codes lus dans les enregistrements publiés (`sourceIdsOf`), triés. */
export function recordsPart(sources: readonly SourceEntry[], nodes: readonly unknown[], lead: string | null = null): ProvPart | null {
  return part(
    lead,
    sourceIdsOf(...nodes)
      .sort()
      .map((c) => sourceTag(c, sources)),
  );
}

/** Point de départ du calcul (D-017, GEO02) : seulement si une commune affichée en vient. */
export function originPart(ds: DatasetLike, origins: readonly (Pick<Commune, 'origin'> | null | undefined)[]): ProvPart | null {
  if (ds.origin !== 'real') return null;
  const methods = Object.keys(ds.meta.origin_methods ?? {});
  const fromGrid = origins.some((c) => !!c?.origin && methods.includes(c.origin.method));
  return fromGrid ? part('Point de départ', [sourceTag('GEO02', ds.sources)]) : null;
}

/** Arrêt de référence d'un pôle (« arrêt le plus desservi … GTFS IDFM ») : TRA01 à la date de service. */
export function stopPart(ds: DatasetLike, pole: Pick<Pole, 'point'>): ProvPart | null {
  if (ds.origin !== 'real' || !/\bGTFS\b/.test(pole.point.method)) return null;
  return part(null, [sourceTag('TRA01', ds.sources, { serviceDate: ds.meta.service_date })]);
}

/** Flux domicile - lieu de travail (EMP02) : code et millésime lus dans context/{insee}.json. */
export function flowsPart(sources: readonly SourceEntry[], ctxs: readonly (ContextFile | null | undefined)[]): ProvPart | null {
  const f = ctxs.find((c) => c?.flows_to_poles)?.flows_to_poles;
  return f ? part(null, [sourceTag(f.source, sources, { year: f.year })], null, METHODS.flows) : null;
}

/**
 * Forfait Navigo (COST01) : le code est en tête du texte publié (`cost.transit_source` :
 * « COST01 - IDFM, page … »). Rien si le texte ne commence pas par un code.
 */
export function costPart(sources: readonly SourceEntry[], transitSource: string | null | undefined): ProvPart | null {
  const code = /^([A-Z][A-Z0-9-]*\d)\s+-\s/.exec(transitSource ?? '')?.[1];
  return code ? part(null, [sourceTag(code, sources)]) : null;
}

/** Une source citée par son seul code (COST02 des tickets, ENV01 du carbone) : rien si elle n'est pas publiée. */
export function codePart(sources: readonly SourceEntry[], code: string, method?: string): ProvPart | null {
  return part(null, [sourceTag(code, sources)], null, method);
}

/** Onglet du halo : code et millésime du bloc de context/{insee}.json lu par l'onglet. */
export function haloPart(sources: readonly SourceEntry[], ctx: ContextFile | null | undefined, dim: HaloContextDimension): ProvPart | null {
  const block = dim === 'age' ? ctx?.population_age : dim === 'commute' ? ctx?.commute_mode_by_sex : ctx?.income;
  return block ? part(null, [sourceTag(block.source, sources, { year: block.year })]) : null;
}

/** « composition communale au 01/01/2026 » : la date est lue dans le millésime publié de la source (GEO05), jamais écrite ici. */
function compositionPeriod(code: string, sources: readonly SourceEntry[]): string | null {
  const date = /\b(\d{2}\/\d{2}\/\d{4})\b/.exec(mainEntry(code, sources)?.millesime ?? '')?.[1];
  return date ? `composition communale au ${date}` : null;
}

/**
 * Onglet « Chômage » du halo (D-048) : taux de l'Insee (SOC02) au trimestre publié et composition communale des zones
 * d'emploi (GEO05) ; le trimestre, son caractère provisoire et la date de parution sont lus dans territoire.json.
 */
export function chomagePart(sources: readonly SourceEntry[], file: TerritoireFile | null | undefined, method?: string): ProvPart | null {
  if (!file) return null;
  const c = file.chomage;
  const published = frDate(c.published);
  const period = `${quarterLabel(c.quarter)}${c.provisional ? ' (provisoire)' : ''}${published ? `, paru le ${published}` : ''}`;
  const zones = compositionPeriod('GEO05', sources);
  return part('Chômage', [sourceTag('SOC02', sources, { period }), sourceTag('GEO05', sources, zones ? { period: zones } : {})], null, method);
}

/** Bulle de la journée-type (D-048) : enquête Emploi (EMP05), année et date de parution lues dans territoire.json. */
export function workTimePart(sources: readonly SourceEntry[], file: TerritoireFile | null | undefined, method?: string): ProvPart | null {
  if (!file) return null;
  const t = file.temps_de_travail;
  const published = frDate(t.published);
  return part('Temps de travail', [sourceTag('EMP05', sources, { period: `enquête Emploi ${t.year}${published ? `, paru le ${published}` : ''}` })], null, method);
}

/** Polarité SDRIF-E (D-048) : fichier de la Région et de l'Institut Paris Region (GEO06). */
export function polarityPart(sources: readonly SourceEntry[], file: TerritoireFile | null | undefined, method?: string): ProvPart | null {
  return file ? part('Polarité', [sourceTag('GEO06', sources)], null, method) : null;
}

/** Carte miroir : contours (GEO01), disques posés sur l'arrêt de référence (TRA01) et aire des postes. */
export function mapProvenance(ds: DatasetLike, mode: ModeId): ProvPart[] {
  if (ds.origin !== 'real') return [];
  return [
    part('Contours', [sourceTag('GEO01', ds.sources)]),
    part('Disques', [sourceTag('TRA01', ds.sources, { serviceDate: ds.meta.service_date })]),
    jobsPart(ds, null, 'Aire'),
    travelPart(ds, mode),
  ].filter((p): p is ProvPart => !!p);
}

/* ------------------------------------------------------------------ panneau de preuve : heure creuse, modes */

/** Heure creuse (départ à l'heure du bloc `offpeak`) : mêmes horaires et mêmes rues que les temps TC du ciel. */
export function offpeakPart(ds: DatasetLike): ProvPart | null {
  const p = travelPart(ds, 'transit', 'Heure creuse');
  return p ? { ...p, method: METHODS.offpeak } : null;
}

/** Autres trajets (D-055) : mêmes horaires et mêmes rues que les itinéraires du panneau, règle de choix des onglets. */
export function alternativesPart(ds: DatasetLike): ProvPart | null {
  const p = travelPart(ds, 'transit', 'Autres trajets');
  return p ? { ...p, method: METHODS.alternatives } : null;
}

/** Une ligne de « Comparer les modes » : ce qui est lu pour fabriquer ses cases. */
export interface ModeRowSources {
  mode: ModeId;
  cost: string | null;
  carbon: string | null;
}

/**
 * « Comparer les modes » : durées de chaque mode affiché, prix au ticket (COST02) et carbone (ENV01) du TC,
 * consommation et prix de l'énergie des véhicules (codes lus dans `meta.vehicles`) seulement si une case
 * de coût ou de carbone est remplie.
 */
export function modesParts(ds: DatasetLike, rows: readonly ModeRowSources[]): ProvPart[] {
  if (ds.origin !== 'real' || rows.length === 0) return [];
  const codes = [...new Set(rows.flatMap((r) => travelCodes(r.mode, ds.meta)))];
  const times = part(
    'Durées',
    codes.map((c) => sourceTag(c, ds.sources, c === 'TRA01' ? { serviceDate: ds.meta.service_date } : {})),
    engineFor(codes, ds.sources),
    METHODS.modes,
  );
  const ticket = rows.some((r) => r.mode === 'transit' && r.cost) ? part('Coût des transports en commun', [sourceTag('COST02', ds.sources)], null, METHODS.tickets) : null;
  const carbon = rows.some((r) => r.mode === 'transit' && r.carbon) ? part('Carbone des transports en commun', [sourceTag('ENV01', ds.sources)], null, METHODS.carbon) : null;
  // Carbone voiture (audit d'affichage du 10/11, lot 4) : facteur ADEME des véhicules, code lu dans meta.car_costs.carbon
  const carCarbonCode = ds.meta.car_costs?.carbon?.source_id;
  const carCarbon =
    carCarbonCode && rows.some((r) => (r.mode === 'car' || r.mode === 'car_traffic') && r.carbon) ? part('Carbone voiture', [sourceTag(carCarbonCode, ds.sources)]) : null;
  const carRows = rows.some((r) => (r.mode === 'car' || r.mode === 'car_traffic') && r.cost);
  const vehicleTags: (SourceTag | null)[] = [];
  if (carRows) {
    for (const v of (ds.meta.vehicles ?? []).filter((x) => (x.family ?? 'car') === 'car')) {
      vehicleTags.push(sourceTag(v.consumption_source?.source_id, ds.sources, { year: v.consumption_source?.year }));
      vehicleTags.push(sourceTag(v.price_source?.source_id, ds.sources));
    }
  }
  const uniq = vehicleTags.filter((t, i, a): t is SourceTag => !!t && a.findIndex((x) => x?.code === t.code) === i);
  return [times, ticket, carbon, uniq.length ? part('Coût voiture', uniq) : null, carCarbon].filter((p): p is ProvPart => !!p);
}

/**
 * Sources de l'accessibilité déclarée du réglage « Mes besoins » : les codes sont ceux que 06n publie dans
 * `meta.needs.sources` (TRA01, TRA03, TRA04), jamais une liste écrite ici ; un code absent de sources.json ne produit rien.
 * Rien si le réglage n'est pas publié ou si le jeu est une démo.
 */
export function needsPart(ds: Pick<Dataset, 'origin' | 'meta' | 'sources'>): ProvPart | null {
  if (ds.origin !== 'real' || !ds.meta.needs) return null;
  return part(
    'Ce que déclarent les sources',
    ds.meta.needs.sources.map((c) => sourceTag(c, ds.sources, c === 'TRA01' ? { serviceDate: ds.meta.service_date } : {})),
  );
}
