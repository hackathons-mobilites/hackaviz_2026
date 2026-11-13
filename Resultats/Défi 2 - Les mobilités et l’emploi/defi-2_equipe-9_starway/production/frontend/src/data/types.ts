/**
 * Contrats pipeline → front. Miroir de
 * docs/contrats-donnees.md :
 * toute modification d'un contrat met à jour les deux côtés dans la même tâche.
 *
 * Conventions : minutes et postes en entiers ; `null` = non calculable (avec une raison) ;
 * jamais de 0 de substitution.
 */

import type { NeedsMeta } from './needs';

export type DayTypeId = 'd06' | 'd09' | 'd14';
/**
 * `car_traffic` (D-029) : voiture avec le trafic moyen DiRIF, DÉDUITE côté front de `car` et de
 * `meta.car_congestion` (data/congestion.ts) ; aucune série `car_traffic` n'est publiée dans access/.
 */
export type ModeId = 'transit' | 'bike_transit' | 'bike' | 'walk' | 'car' | 'car_traffic' | 'velib';

export interface DayType {
  id: DayTypeId;
  label: string;
  /** "HH:MM" - heure de prise de poste (l'aller arrive avant) */
  start: string;
  /** "HH:MM" - heure de fin (le retour part après) */
  end: string;
}

export interface ModeDef {
  id: ModeId;
  label: string;
}

export interface Meta {
  processing_version: string;
  generated_at: string;
  service_date: string;
  gtfs_downloaded_at: string;
  day_types: DayType[];
  budgets: number[];
  modes: ModeDef[];
  story_communes: string[];
  /** Communes pour lesquelles access/{insee}.json existe (optionnel) */
  access_communes?: string[];
  /**
   * PROPOSÉ par le front (D-028, à écrire par 06h si le contrat est adopté) : communes pour lesquelles
   * itineraries/{insee}.json existe. Absent : aucun fichier n'est demandé (pas de 404), les blocs
   * « Transports utilisés », coût au ticket et carbone restent masqués.
   */
  itineraries_communes?: string[];
  /**
   * Itinéraires des autres réglages de marche (D-024, écrit par 06h / 06t, 04/11) : réglage → dossier,
   * communes publiées et marquage D-031 du jeu. Absent : détail affiché pour le réglage par défaut seulement.
   */
  itineraries_variants?: Record<string, ItinerariesVariant>;
  /** Format des fichiers d'itinéraires (04/11 : `{insee}.json.gz`, gzip). Absent : `{insee}.json`. */
  itineraries_format?: { suffix: string; encoding: string };
  /** Faits par ligne des itinéraires (climatisation TRA03, ponctualité QS01, 04/11) : sources, mois, textes. */
  line_facts?: LineFactsMeta;
  /**
   * Modes publiés pour une partie des origines seulement (écrit par 06, D-014) : mode → origines
   * publiées, éventuellement vide. Un mode absent est publié pour toutes les origines.
   */
  mode_coverage?: Partial<Record<ModeId, string[]>>;
  /** « Mes besoins » (écrit par 06n) : textes, libellés des niveaux de gare et sources de `a11y` ; absent : réglage masqué */
  needs?: NeedsMeta;
  /** État des découvertes (écrit par 06) ; insights.json ne contient que les types « ok » */
  insights?: InsightsStatus;
  /** Libellé complet de chaque méthode du point de départ (code → texte), D-017 */
  origin_methods?: Record<string, string>;
  /**
   * Horizon de recherche des trajets (min, paramètre r5py `max_time` du pipeline) : borne de
   * « aucun trajet trouvé en moins de N ». Optionnel : absent = la borne n'est pas affichée.
   */
  max_trip_min?: number;
  /**
   * Pas de la grille des départs aller du calcul (min, écrit par 06) : pas de la jauge du budget
   * (D-018). Optionnel : absent (ancien jeu) = boutons `budgets`.
   */
  outbound_step_min?: number;
  /**
   * Vitesses du calcul (km/h, réglages r5py de pipeline/starway/config.py, écrites par 06, L-06a).
   * Absent : la distance équivalente « ≈ N km à pied » n'est pas affichée (rien en dur).
   */
  speeds?: SpeedsMeta;
  /**
   * Réglages de marche des TC (D-024), choisis par l'équipe (pas des données). Le réglage `default`
   * est publié dans access/{insee}.json `modes.transit`, chaque autre sous `variants.{key}.transit`.
   * Absent : le réglage est masqué (L-07).
   */
  walk_settings?: WalkSettingsMeta;
  /** Mode Vélib' (D-027) : avertissement à afficher tel quel, texte hors zone, source. Absent : rien. */
  velib?: VelibMeta;
  /** Identité du jeu de temps de trajet publié (contrôle de l'audio de la visite) */
  dataset_id?: string | null;
  /** Indices DiRIF du mode `car_traffic` (D-029, écrit par 06). Absent : le mode n'est pas proposé. */
  car_congestion?: CarCongestionMeta;
  /** Véhicules et coût de l'énergie (D-029, écrit par 06). Absent : aucun coût voiture. */
  vehicles?: VehicleMeta[];
  /** Formule, ce qui n'est pas compté, état des distances corrigées (D-029). */
  car_costs?: CarCostsMeta;
  /**
   * Ciel des pôles des fichiers calculés (écrit par 06) : nombre de pôles, fichier de pôles et sha256, règles de
   * correspondance. Les séries de access/ et d'itineraries/ sont indexées comme ces pôles ; le front ne les lit
   * jamais par position.
   */
  access_sky?: { sky: string; poles: number; poles_file?: string; poles_sha256?: string; transfer_rules?: string };
  sources: string;
}

/** meta.itineraries_variants.{réglage} (04/11). */
export interface ItinerariesVariant {
  /** Dossier sous data/ (ex. « itineraries_walk1000 ») */
  dir: string;
  walk_setting: string;
  communes: string[];
  /** Marquage D-031 (c) du jeu, même forme que meta.transfer_check ; absent : non marqué */
  transfer_check?: unknown;
}

/** meta.line_facts (04/11) : bloc commun des fichiers d'itinéraires et textes à afficher. */
export interface LineFactsMeta {
  sources: string[];
  tra03_snapshot: string | null;
  /** Mois des taux de ponctualité, "AAAA-MM" */
  punctuality_month: string | null;
  qs01_updated: string | null;
  texts: {
    air_conditioning: { label: string; values: Record<string, string>; definition: string };
    punctuality: {
      label: string;
      definition: string;
      no_open_data: string;
      month_not_published: string;
      shared_lines: string[];
      shared_text: string;
    };
    licence: string;
  };
}

/** Une tranche horaire mesurée par la DiRIF (meta.car_congestion.periods). */
export interface CongestionPeriod {
  id: string;
  /** "HH:MM" */
  start: string;
  end: string;
  /** Indice de temps de parcours (temps / temps fluide), lu sur le graphique, ± uncertainty */
  index: number;
}

/** meta.car_congestion (D-029) : contrat dans contrats-donnees.md. */
export interface CarCongestionMeta {
  mode: 'car_traffic';
  base_mode: 'car';
  source_id: string;
  publisher: string;
  title: string;
  url: string | null;
  month: string;
  scope: string;
  network: string;
  days: string;
  uncertainty: number;
  periods: CongestionPeriod[];
  day_types: Partial<Record<DayTypeId, { out: string | null; ret: string | null; out_reason?: string; ret_reason?: string }>>;
  texts: { no_period: string; outside_period: string; choice: string; label: string };
  decision?: string;
}

/** Facteur carbone ADEME d'une énergie (ENV02, Base Carbone), recopié dans meta.vehicles. */
export interface Co2Source {
  source_id: string;
  version: string;
  element_id: string;
  name: string;
  unit: string;
  total: number;
  posts?: Record<string, number>;
  validity?: string;
}

/** Une entrée de meta.vehicles (D-029) : voitures et deux-roues thermiques. */
export interface VehicleMeta {
  id: string;
  label: string;
  /** « car » ou « two_wheeler » (absent dans les jeux d'avant le 04/11 : voiture) */
  family?: 'car' | 'two_wheeler';
  energy: string;
  unit: string;
  consumption_per_100km: number;
  consumption_source: { source_id: string; year: number; text: string };
  price_eur_per_unit: number;
  price_source: { source_id: string; text: string; read_at?: string | null; valid_from?: string; median?: number; stations_with_price?: number };
  cost_eur_per_km: number;
  /** Classe de péage (1 voitures, 5 motos) */
  toll_class: number;
  /** Carbone au km (kg CO2e) = consommation / 100 x facteur ENV02 ; null : non publié */
  co2_kg_per_km?: number | null;
  co2_kg_per_unit?: number;
  co2_source?: Co2Source;
  /** Deux-roues : même temps que la voiture, phrase à afficher */
  time?: { same_as: string; text: string; source_url?: string };
  status: string;
}

export interface CarCostsMeta {
  formula: string;
  label: string;
  /** Libellé de la part énergie (« Carburant ou électricité seuls ») */
  energy_label?: string;
  not_included: string[];
  rounding: string;
  carbon?: { formula: string; unit: string; rounding: string; occupancy: string; perimeter: string; tc_comparison: string; source_id: string };
  two_wheelers?: { time: string; source_url?: string; electric: string };
  distances: { status: 'ok' | 'pending' | 'refused'; reason?: string; car_speed_mps?: number };
  tolls?: { status: 'ok' | 'pending'; reason?: string; file?: string; contract?: string };
}

/**
 * Cellule `car_trip.toll` d'un sens : [] = aucun péage (sûr) ; [[entrée, sortie], ...] = passages
 * (indices de tolls.json `points`) ; { s, p } = péage inconnu (statut, points en cause) ; null = pas de trajet.
 */
export type TollCell = [number, number][] | { s: string; p: number[] } | null;

/** access/{insee}.json `car_trip` (D-029) : seulement si les distances corrigées sont publiées. */
export interface CarTrip {
  dist_m: { out: (number | null)[]; ret: (number | null)[] };
  reason: { out: (string | null)[]; ret: (string | null)[] };
  /** Péages traversés par sens (contrat tolls-1) ; absent dans les jeux d'avant le 04/11 */
  toll?: { out: TollCell[]; ret: TollCell[] };
}

/** Un point de péage de tolls.json (registre starway/toll_tariffs.py). */
export interface TollPoint {
  id: string;
  label: string;
  road: string;
  operator: string;
  system: string;
  pricing: string;
  status: string;
  reason?: string;
  notice?: string;
  /** Crédit du producteur du tarif (« tarif © VINCI Autoroutes 2026 »), points tarifés seulement, toujours affiché (D-060) */
  credit?: string;
}

/** Grille d'un couple (entrée, sortie), d'une classe, d'un tarif et d'un jour (-1, 0, +1 autour du jour de service). */
export interface TollGrid {
  e: number;
  s: number;
  c: number;
  t: string;
  d?: number;
  /** [début min, fin min, prix EUR] depuis minuit, sans trou de 0 à 1440 */
  slots?: [number, number, number][];
  status?: 'interdit';
  reason?: string;
}

/** tolls.json (contrat tolls-1, D-029), chargé à la demande par le panneau de preuve. */
export interface TollsFile {
  contract: string;
  processing_version: string;
  service_date: string;
  days: Record<string, { date: string; weekday: string; types: Record<string, string> }>;
  points: TollPoint[];
  grids: TollGrid[];
  status_texts: Record<string, string>;
  classes: Record<string, string>;
  tariffs: Record<string, string>;
  rule: Record<string, string>;
  not_applied: string[];
  sources: { source_id: string; title: string; url: string; read_at: string; licence: string }[];
}

/** meta.speeds (L-06a) : vitesses constantes du calcul, km/h */
export interface SpeedsMeta {
  walk_kmh?: number | null;
  bike_kmh?: number | null;
}

/** Un réglage de marche de meta.walk_settings.settings (D-024). */
export interface WalkSetting {
  /** Identifiant (« normal », « comfort ») : paramètre d'URL `w` */
  id: string;
  /** Libellé publié, affiché tel quel (« normal : jusqu'à 3 km à pied ») */
  label: string;
  /** Distance maximale de chaque trajet à pied d'un trajet TC (accès et sortie), m */
  leg_limit_m: number;
  /** La même limite en minutes (distance / speeds.walk_kmh, arrondi supérieur) */
  max_time_walking_min: number;
  /** Clé de access/{insee}.json `variants` ; null = réglage publié dans `modes` (défaut) */
  key: string | null;
  r5_version?: string;
  r5_jar_sha256?: string;
  dataset_id?: string;
}

/** meta.walk_settings (écrit par 06, D-024) */
export interface WalkSettingsMeta {
  /** « choix de l'équipe (D-024), pas une donnée » : à dire, jamais présenté comme une mesure */
  nature: string;
  /** id du réglage publié dans `modes` */
  default: string;
  /** Seul mode concerné */
  mode: ModeId;
  /** Trajets à pied limités (« accès depuis le point de départ », « sortie vers le point d'arrivée ») */
  legs?: string[];
  /** Correspondances à pied (limite du moteur, inchangée), m */
  transfer_limit_m?: number;
  /** Règle d'un trajet tout à pied */
  all_walk_trip?: string;
  settings: WalkSetting[];
}

/** meta.velib (écrit par 06, D-027) */
export interface VelibMeta {
  /** Avertissement affiché TEL QUEL (première phrase en gras) */
  warning: string;
  /** Remplace « non calculé pour cette commune » hors de mode_coverage.velib */
  out_of_zone: string;
  source?: string;
  snapshot?: string;
  licence?: string;
  stations?: number;
  origins?: number;
  method?: string;
}

/** Statut d'un type de découverte dans meta.insights.kinds */
export type InsightKindStatus = { status: 'ok'; scope?: string } | { status: 'not_computed'; reason?: string };

export interface InsightsStatus {
  written: boolean;
  kinds: Partial<Record<InsightKind, InsightKindStatus>>;
  /**
   * Découvertes écartées avant le classement (liste, vide depuis D-024) : traçabilité seulement,
   * jamais affichées. `would_be_id` : identifiant qu'elle aurait eu (les suivantes remontent d'un rang).
   */
  excluded?: InsightExclusion[];
  /** Recoupement Navitia publié (écrit par 06 si 07d a tourné) : traçabilité, jamais affiché tel quel */
  crosscheck?: InsightsCrosscheck;
}

/** meta.insights.crosscheck (contrats-donnees.md) */
export interface InsightsCrosscheck {
  file?: string;
  generated_at?: string;
  walk_setting?: string;
  navitia_last_load_at?: string;
  service_date?: string;
  statuses?: string[];
  method?: string;
  published_counts?: Record<string, number>;
}

/**
 * Recoupement Navitia d'une découverte (07d) : `confirmed` (même verdict avec les durées Navitia
 * arrondies à la minute inférieure comme supérieure), `within_one_minute` (le verdict dépend de
 * l'arrondi), `not_checked`. `contradicted` n'est jamais publié (découverte écartée).
 */
export type InsightCrosscheck = 'confirmed' | 'within_one_minute' | 'not_checked';

export interface InsightExclusion {
  would_be_id: string;
  kind: InsightKind;
  scenario: Insight['scenario'];
  cause: string;
  /** cause `navitia_contradicted` : résumé du recoupement dans le dépôt, date, sens TC recoupés */
  crosscheck_file?: string;
  crosscheck_generated_at?: string;
  trips?: { insee: string; pole_id: string; day: DayTypeId; leg: 'out' | 'ret'; starway_min: number | null; navitia_min: number | null }[];
}

export interface SkyPosition {
  /** ∈ [0, 1], position schématique identique pour tous les scénarios */
  x: number;
  y: number;
}

export interface Pole {
  id: string;
  name: string;
  /** D-030 : nom officiel du panneau */
  name_official?: string;
  /** D-030 : nom court pour le ciel (commune ou arrondissement, ex. « Courbevoie », « 1er ») */
  name_short?: string;
  communes: string[];
  /** Postes salariés (INSEE, EMP01). null = non disponible */
  jobs: number | null;
  jobs_year: number;
  jobs_source: string;
  /** `stop_name` : nom de l'arrêt d'affichage de l'astre (jeu des 44 astres, poles.json)  */
  point: { lon: number; lat: number; method: string; stop_name?: string };
  sky: SkyPosition;
  /** D-030 (jeu des 44 astres) : bassin d'emploi France Travail de l'astre ; `source` commence par le code du manifeste (GEO04) */
  bassin?: { code: string; name: string; source: string };
  /** D-030 : code INSEE de la commune qui donne son nom court à l'astre (elle fait partie de `communes`) ; le disque de la carte miroir y est posé */
  name_short_insee?: string;
}

export interface Commune {
  insee: string;
  name: string;
  dep: string;
  lon: number;
  lat: number;
  population: number | null;
  sky: SkyPosition;
  /**
   * Point de départ réel du calcul (D-017, optionnel) : centre de gravité de la population ou centre
   * du carreau habité le plus proche. `method` est un code court ("gravity" | "nearest_inhabited"),
   * libellé complet dans meta.origin_methods. Ne déplace jamais l'étoile-guide dans le ciel.
   */
  origin?: CommuneOrigin | null;
}

export interface CommuneOrigin {
  lon: number;
  lat: number;
  method: string;
}

/**
 * Raison d'une durée nulle (premier sens nul : l'aller s'il est nul, sinon le retour). Depuis D-024, un
 * retour nul en TC est un résultat mesuré (`no_trip_within_120`) dont le texte cite le réglage de marche
 * (`meta.walk_settings`).
 */
export type NullReason = 'no_trip_within_120' | 'no_service_at_hour' | 'origin_not_snapped' | 'not_computed';

/** Durées indexées par position : poles[i] ↔ poles.json[i]. */
export interface AccessSeries {
  out: (number | null)[];
  ret: (number | null)[];
  reason?: (NullReason | null)[];
  /**
   * Heure de départ de l'aller retenue (le plus tardif arrivant avant le début du poste), "HH:MM"
   * (ou horodatage ISO / "AAAA-MM-JJ HH:MM:SS", lu tel quel). Optionnel : absent = non exporté.
   */
  dep?: (string | null)[];
}

/** Clé de journée ; "any" pour les modes indépendants de l'heure (walk, bike, car, velib). */
export type DayKey = DayTypeId | 'any';

export interface AccessFile {
  insee: string;
  processing_version: string;
  modes: Partial<Record<ModeId, Partial<Record<DayKey, AccessSeries>>>>;
  /**
   * Autres réglages de marche (D-024) : clé (`meta.walk_settings.settings[].key`) → séries TC, même
   * contrat que `modes.transit.{day}`. Absent : seul le réglage par défaut est publié.
   */
  variants?: Record<string, { transit: Partial<Record<DayTypeId, AccessSeries>> }>;
  /** Distances routières corrigées et péages traversés (D-029). Absent : aucun coût. */
  car_trip?: CarTrip;
}

export type ContextStatus = 'ok' | 'to_compute' | 'secret' | 'small_sample' | 'not_available' | 'not_computed';

interface ContextBase {
  /** Identifiant de source (GEN04, GEN01, SOC01…) */
  source: string;
  year: number;
  status: ContextStatus;
  /** Dénominateur explicite (actifs occupés ≠ population) */
  denominator?: string;
  /** Unité des parts, ex. "%" */
  unit?: string;
}

export interface PopulationSex extends ContextBase {
  total: number | null;
  /** Parts en % (clé H pour les hommes) */
  shares: { F: number | null; H: number | null };
}

export interface PopulationAge extends ContextBase {
  bins: string[];
  total: number | null;
  shares: number[];
}

export type CommuteMode = 'transit' | 'car' | 'bike' | 'walk' | 'other';

export interface CommuteModeBySex extends ContextBase {
  F: Partial<Record<CommuteMode, number | null>>;
  H: Partial<Record<CommuteMode, number | null>>;
  /** Effectifs (actifs occupés) de chaque sexe */
  totals?: { F: number | null; H: number | null };
  /** Ce que recouvre « other » */
  other_includes?: string[];
  /**
   * Marge d'erreur à 95 % de chaque part (en points), fiche INSEE « La précision des résultats du
   * recensement » ; null si non calculable.
   */
  margin95?: {
    F: Partial<Record<CommuteMode, number | null>>;
    H: Partial<Record<CommuteMode, number | null>>;
  };
  margin95_unit?: string;
  precision_source?: string;
}

export interface Income extends ContextBase {
  median_living_standard_eur: number | null;
  poverty_rate: number | null;
  median_status?: ContextStatus;
  poverty_rate_status?: ContextStatus;
}

export interface Cost {
  status: ContextStatus;
  method: string;
  transit_month_eur: number | null;
  transit_source?: string;
  transit_label?: string;
  transit_source_url?: string;
  /** Portée du forfait (« identique pour toutes les communes ; … non modélisés ») */
  transit_scope?: string;
  car_reason?: string;
  car_per_trip_eur: Record<string, number> | null;
  car_status?: ContextStatus;
}

/** Actifs occupés de la commune qui travaillent dans un pôle (EMP02, flux domicile - lieu de travail). */
export interface FlowToPole {
  /** Actifs occupés résidant dans la commune et travaillant dans une commune du pôle */
  flux: number | null;
  /** Part de l'ensemble des actifs occupés résidents (%) */
  share_pct?: number | null;
  status?: ContextStatus;
  /** ok (≥ 200) | order_of_magnitude (< 200 : ordre de grandeur, règle INSEE) | no_flow_in_file */
  precision?: 'ok' | 'order_of_magnitude' | 'no_flow_in_file';
  margin95?: number | null;
}

export interface FlowsToPoles extends ContextBase {
  /** Ensemble des actifs occupés résidents (dénominateur des parts) */
  actifs_occupes?: number | null;
  measure?: string;
  /** Pôle auquel appartient la commune d'origine (null sinon) */
  origin_pole?: string | null;
  /** Pôle de la commune par ciel (fichiers `context/`) ; absent dans les anciens fichiers */
  origin_poles?: string[];
  precision_rule?: string;
  note?: string;
  /** Par identifiant de pôle (forme objet) ou liste { pole_id, ... } : le front lit les deux */
  poles: Record<string, FlowToPole> | (FlowToPole & { pole_id: string })[];
}

export interface ContextFile {
  insee: string;
  processing_version?: string;
  flows_to_poles?: FlowsToPoles;
  population_sex?: PopulationSex;
  population_age?: PopulationAge;
  commute_mode_by_sex?: CommuteModeBySex;
  income?: Income;
  cost?: Cost;
}

export type InsightKind = 'eclipse' | 'territorial_gap' | 'bike_gain' | 'late_return';

export interface Insight {
  id: string;
  kind: InsightKind;
  scenario: {
    o: string;
    d: DayTypeId;
    b: number;
    m: ModeId;
    vs: string | null;
    compare_day?: DayTypeId;
  };
  metric: {
    jobs_delta: number | null;
    poles_delta: number | null;
    /** Postes accessibles dans le scénario */
    jobs?: number | null;
    /**
     * Postes accessibles dans le scénario de référence (compare_day, vs ou mode TC). Pour `late_return` :
     * postes des pôles atteints à l'aller dans le budget, retour non exigé (insights.py).
     */
    jobs_ref?: number | null;
  };
  rank: number;
  robust: boolean;
  /** Recoupement Navitia (absent des anciens jeux : comportement d'avant, sans filtre) */
  crosscheck?: InsightCrosscheck;
}

/** Export de data/sources_manifest.csv (sans fichier_local ni sha256). */
export interface SourceEntry {
  source_id: string;
  titre: string;
  url_source: string;
  date_extraction?: string;
  millesime?: string;
  date_service_transport?: string;
  licence: string;
  granularite?: string;
  geographie?: string;
  traitements?: string;
  controles?: string;
  limites?: string;
}

/** Origine du jeu de données affiché. */
export type DataOrigin = 'real' | 'demo';

export interface Dataset {
  origin: DataOrigin;
  /** Pourquoi le mode démo est actif (bandeau) */
  demoReason?: 'query' | 'missing_meta';
  /**
   * Dossier (avec la barre finale) des fichiers calculés vers les pôles du ciel affiché : meta.json, access/,
   * itineraries*, tolls.json, insights.json, subscriptions.json (`data/`). Absent : `data/` (jeux de test).
   */
  base?: string;
  meta: Meta;
  poles: Pole[];
  communes: Commune[];
  insights: Insight[];
  sources: SourceEntry[];
}
