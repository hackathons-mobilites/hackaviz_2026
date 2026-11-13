/**
 * Contrat D-019 (proposée) : `od/index.json` + `od/o/{insee}.bin` (SWOD v1).
 * Miroir de docs/contrats-donnees.md, section « D-019 ».
 * Jeu À CÔTÉ de `access/` : rien ici ne remplace les types de `../types.ts`.
 */

/** Modes de la table OD (le vélo + TC n'y est pas : il reste servi par access/, D-014). */
export type OdModeId = 'transit' | 'walk' | 'bike' | 'car';

export interface OdModeDef {
  id: OdModeId;
  /** Code du mode dans les sections des fichiers binaires */
  code: number;
  /** series = dépend de l'heure (229 départs) ; scalar = une durée par sens */
  kind: 'series' | 'scalar';
}

export interface OdCoverage {
  /** Nombre d'origines calculées pour ce mode */
  origins: number;
  /** Complétude DU MODE (seule à lire : `index.complete` dit « les quatre modes complets ») */
  complete: boolean;
  /** Liste des origines calculées, présente seulement si le mode est partiel */
  computed?: string[];
  /** « not_computed » : mode annoncé mais pas encore exporté dans ce dossier (aucune valeur publiée) */
  status?: string;
  reason?: string;
}

/** Réglage de marche du dossier (D-024, contrat « Variantes de marche D-024 ») : lu ici, jamais dans le nom du dossier. */
export interface OdWalkSetting {
  /** = meta.walk_settings.settings[].id (« normal », « comfort ») ; `r5_default` pour od/ */
  id: string;
  nature?: string;
  limit_m?: number;
  egress_limit_m?: number | null;
  access_limit_min?: number | null;
  applies_to?: string[];
  rule?: string;
  r5_jar?: string;
  r5_jar_sha256?: string;
  r5_version?: string;
}

export interface OdIndex {
  processing_version: string;
  decision?: string;
  generated_at: string;
  dataset_id: string | null;
  service_date: string;
  /**
   * true = les QUATRE modes sont complets. Ne dit rien d'un mode seul : complétude d'un mode =
   * `coverage[mode].complete` (publié le 03/11 : TC complet, `complete` false tant que marche, vélo,
   * voiture ne sont pas exportés).
   */
  complete: boolean;
  format: { name: string; version: number; path: string; endianness: string; compression: string };
  /** Grille des départs mesurés, "HH:MM" */
  grid: { first: string; last: string; step_min: number; n_slots: number };
  /** Bornes des débuts de poste calculables, "HH:MM" */
  starts: { first: string; last: string };
  /** Bornes des fins de poste calculables, "HH:MM" */
  ends: { first: string; last: string };
  outbound_lookback_min: number;
  max_trip_min: number;
  sentinels: Record<string, string>;
  modes: OdModeDef[];
  coverage: Partial<Record<OdModeId, OdCoverage>>;
  /** "all" ou la liste des origines qui ont un fichier */
  files: 'all' | string[];
  /** Ordre des destinations (index utilisé dans les fichiers binaires) */
  communes: string[];
  /** Postes salariés (INSEE, EMP01), alignés sur `communes` */
  jobs: number[];
  /** Index du pôle dans poles.json, null hors pôle, aligné sur `communes` */
  pole_of: (number | null)[];
  jobs_source: string;
  /** Même ordre que poles.json ; `jobs` = somme des postes des communes du pôle */
  poles: { id: string; jobs: number }[];
  /** Trajet d'une commune vers elle-même : jamais publié (règle proposée, à valider par Nicolas) */
  self_pair: { status: string; reason?: string; rule?: string };
  dest_point_rule?: string;
  origin_point_rule?: string;
  /**
   * Limite de marche finale de R5 (D-023) : `not_applied` = joue à l'aller comme au retour, sans
   * marquage (od/) ; `setting` = limite voulue par le réglage de marche du dossier (D-024).
   */
  walk_limit?: { status: 'applied' | 'not_applied' | 'setting'; limit_m: number; detail?: string };
  /** Réglage de marche du dossier (D-024) ; absent des anciens exports */
  walk_setting?: OdWalkSetting;
  /** D'où vient chaque mode (dossier interne du pipeline) */
  source_by_mode?: Partial<Record<OdModeId, string>>;
  /** D-040 : grille assemblée de trois tables (matin et soir sur le réseau de nuit, jour sur le GTFS d'origine) ; absent des anciens exports */
  time_segments?: OdTimeSegments;
  volume?: unknown;
}

/** Une plage de départs de la grille assemblée et le réseau sur lequel elle est calculée (`name` : matin, jour ou soir). */
export interface OdTimeSegment {
  name: string;
  from: string;
  to: string;
  n_slots: number;
  gtfs_source: string;
  gtfs_sha256?: string | null;
}

export interface OdTimeSegments {
  decision?: string;
  rule?: string;
  same_typical_day?: string;
  segments: OdTimeSegment[];
}
