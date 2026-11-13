/**
 * Réglage « Ce qu'il me faut sur mon trajet » (version finale du 05/11/2026, D-034, décision de Nicolas) : on ne classe
 * plus les personnes par handicap. Cinq cases, mots validés avec Sara ; chacune se lit dans une source ouverte, tronçon
 * par tronçon. Fonctions PURES ; la règle du ciel (une marque) est dans `needsSky.ts`.
 *
 * Contrat : champ `a11y` de chaque tronçon en TC des fichiers `itineraries/{insee}.json` (`wc_trip`, `wc_from`, `wc_to`
 * de 06h ; `a11y` de 06n) et bloc `meta.needs` (sources, libellés exacts des niveaux de TRA04), écrits par
 * `pipeline/scripts/06n_export_needs.py` (`starway/needs.py`, sous-contrat `needs-1`). Les textes sont ceux de ce
 * fichier : « accessible » n'y figure que dans les libellés de TRA04, recopiés par le pipeline (`station_levels`).
 *
 * Règle de vérité : jamais « accessible » ni « sûr » comme verdict de trajet. Seulement ce que chaque source déclare ; une
 * valeur absente est « non renseigné », jamais « non ».
 */
import type { ItinLeg } from './itineraries';
import { mainEntry, shortDate } from './provenance';
import type { SourceEntry } from './types';

/** Les cinq cases, dans l'ordre d'affichage. 1 à 3 peuvent marquer un astre ; 4 et 5 jamais (légende et panneau). */
export type NeedId = 'wc_trip' | 'wc_stops' | 'station' | 'ac' | 'audio' | 'visual';

/** Valeur d'un champ de ligne (référentiel des lignes IDFM, TRA03) ; `null` : ligne absente du référentiel. */
export type A11yValue = 'true' | 'false' | 'partial' | 'unknown' | null;

/** Gare du jeu « Accessibilité en gare » (TRA04) : niveau et commentaire de la source. */
export interface A11yStation {
  level: number;
  comment?: string;
}

/** Champ `a11y` d'un tronçon en TC (`needs.NeedsFacts.leg_a11y`). */
export interface LegA11y {
  line: A11yValue;
  audio: A11yValue;
  visual: A11yValue;
  /** Présents pour un tronçon ferré ou un quai du jeu ; `null` : gare absente du jeu */
  st_from?: A11yStation | null;
  st_to?: A11yStation | null;
}

/** `meta.needs` (écrit par 06n) */
export interface NeedsMeta {
  contract: string;
  /** Codes du manifeste des sources lues (TRA01, TRA03, TRA04) */
  sources: string[];
  /** Identifiants des cases publiés par le pipeline (informatif : le front affiche toujours les cinq cases) */
  needs?: string[];
  /** Libellé exact de chaque niveau de TRA04 (niveau → libellé) */
  station_levels: Record<string, string>;
}

/** Tronçon avec son champ `a11y` (ajouté par 06n) */
export type NeedsLeg = ItinLeg & { a11y?: LegA11y };

/** Libellés des cinq cases : mots validés avec Sara, à reprendre tels quels. */
export const NEED_LABEL: Record<NeedId, string> = {
  wc_trip: 'Véhicules déclarés adaptés au fauteuil roulant',
  wc_stops: 'Arrêts déclarés adaptés au fauteuil roulant',
  station: "Gares sans réservation d'assistance",
  ac: 'Lignes déclarées climatisées',
  audio: 'Annonces sonores',
  visual: 'Annonces visuelles',
};

/** Ce que chaque case lit, en une phrase (aide du réglage) : la source, jamais un verdict. */
export const NEED_HINT: Record<NeedId, string> = {
  wc_trip: 'GTFS IDFM, course',
  wc_stops: 'GTFS IDFM, quais de montée et de descente',
  station: 'IDFM, accessibilité en gare, niveaux 4 et 6',
  ac: 'référentiel des lignes IDFM, climatisation déclarée',
  audio: 'référentiel des lignes IDFM',
  visual: 'référentiel des lignes IDFM',
};

/**
 * Hors mode sources (D-033, lot 6) : ce que la case précise, sans le nom de la source ; `null` quand l'aide ne disait que la source.
 * Le mode sources affiche `NEED_HINT` tel quel.
 */
export const NEED_HINT_PLAIN: Record<NeedId, string | null> = {
  wc_trip: 'course',
  wc_stops: 'quais de montée et de descente',
  station: 'niveaux 4 et 6',
  ac: null,
  audio: null,
  visual: null,
};

export const NEED_ORDER: readonly NeedId[] = ['wc_trip', 'wc_stops', 'station', 'ac', 'audio', 'visual'];

/**
 * Cases qui peuvent marquer un astre sur le ciel. Les trois premières sont le miroir de `starway.needs.SKY_BOXES` ; `ac` (demande de Nicolas
 * du 12/11 : « transport climatisé uniquement ») n'existe que dans le front : elle lit `air_conditioning` de chaque tronçon (TRA03, publié par 06h).
 */
export const SKY_NEEDS: readonly NeedId[] = ['wc_trip', 'wc_stops', 'station', 'ac'];

/** Cases sans donnée ouverte : affichées grisées, jamais cochables. */
export const NEED_GREYED: readonly { id: string; label: string }[] = [
  { id: 'lift', label: 'Ascenseur de la rue au quai' },
  { id: 'escalators', label: 'Escalators' },
  { id: 'tactile', label: 'Guidage au sol' },
];
export const NEED_GREYED_TEXT = 'pas de donnée ouverte';

export const NEEDS_TITLE = "Ce qu'il me faut sur mon trajet";

/** Libellé du résumé « Ce que déclarent les sources sur ce trajet (aller | retour) », dans le bloc du trajet ou dans le pli des besoins (lot 3) */
export function needsTripLabel(side: 'out' | 'ret'): string {
  return `Ce que déclarent les sources sur ce trajet (${side === 'out' ? 'aller' : 'retour'})`;
}

/** Clé de mémorisation du choix (navigateur). La v3 remplace la clé du 04/11 (classement par handicap), purgée. */
export const NEEDS_STORAGE_KEY = 'starway.needs.v3';
export const NEEDS_LEGACY_STORAGE_KEY = 'starway.needs';

/**
 * Besoins mémorisés : liste JSON d'identifiants ; tout ce qui n'est pas une des cinq cases est ignoré, sans doublon,
 * dans l'ordre du réglage.
 */
export function parseStoredNeeds(raw: string | null | undefined): NeedId[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return NEED_ORDER.filter((id) => list.includes(id));
}

export function serializeNeeds(selected: readonly NeedId[]): string {
  return JSON.stringify(NEED_ORDER.filter((id) => selected.includes(id)));
}

/** Valeurs lues dans une source, en texte ; absent ou inconnu : « non renseigné », jamais « non ». */
export const VALUE_TEXT: Record<string, string> = {
  true: 'oui',
  false: 'non',
  partial: 'partiel',
  unknown: 'non renseigné',
  null: 'non renseigné',
};

export function valueText(v: unknown): string {
  const key = v === true ? 'true' : v === false ? 'false' : typeof v === 'string' ? v : 'null';
  return VALUE_TEXT[key] ?? VALUE_TEXT.null!;
}

/** Gare : libellé exact du niveau (TRA04), jamais résumé ; niveau inconnu du jeu publié : « non renseigné ». */
export function stationText(s: A11yStation | null | undefined, meta: Pick<NeedsMeta, 'station_levels'> | null | undefined): string {
  if (!s) return VALUE_TEXT.null!;
  const label = meta?.station_levels[String(s.level)];
  if (!label) return VALUE_TEXT.null!;
  return s.comment ? `${label} (${s.comment})` : label;
}

/** Sources lues, avec leur nom court et leur date de relevé (sources.json) : « avec sa date » dans le panneau. */
export const SOURCE_LABEL = {
  TRA01: 'GTFS IDFM',
  TRA03: 'référentiel des lignes IDFM',
  TRA04: 'accessibilité en gare IDFM',
} as const;
export type NeedsSourceCode = keyof typeof SOURCE_LABEL;

/** Date de relevé de chaque source lue (« 03/11/2026 »), lue dans sources.json ; une source absente est omise. */
export function needsSourceDates(sources: readonly SourceEntry[] | null | undefined): Partial<Record<NeedsSourceCode, string>> {
  const out: Partial<Record<NeedsSourceCode, string>> = {};
  for (const code of Object.keys(SOURCE_LABEL) as NeedsSourceCode[]) {
    const d = shortDate(mainEntry(code, sources ?? [])?.date_extraction);
    if (d) out[code] = d;
  }
  return out;
}

/**
 * Texte fixe du réglage : « Ce que déclarent les sources à telle date. À confirmer avant de partir. » La date est
 * celle de chaque relevé ; sans date publiée, la phrase reste sans date (rien n'est inventé).
 */
export function needsFixedText(dates: Partial<Record<NeedsSourceCode, string>>): string {
  const entries = (Object.keys(SOURCE_LABEL) as NeedsSourceCode[]).filter((c) => dates[c]).map((c) => [c, dates[c]!] as const);
  const distinct = [...new Set(entries.map(([, d]) => d))];
  let when = '';
  if (distinct.length === 1) when = ` au ${distinct[0]}`;
  else if (distinct.length > 1) when = ` à la date de leur relevé (${entries.map(([c, d]) => `${SOURCE_LABEL[c]} : ${d}`).join(' ; ')})`;
  return `Ce que déclarent les sources${when}. À confirmer avant de partir.`;
}

/** Toujours écrit, partout où le réglage parle d'un trajet. */
export const NEEDS_ALWAYS_TEXT = 'Calcul sur le trajet le plus rapide, un autre trajet peut exister. Ascenseurs non couverts.';

/** Aide de la partie « Ce qu'il me faut sur mon trajet » de « Mes réglages » : ce que produit une case (D-034). */
export const NEEDS_MARK_HELP =
  "Les quatre premières cases posent une marque au bord de l'astre quand tout ce que vous cochez parmi elles est déclaré rempli, aller et retour. Les annonces se lisent dans le panneau d'un astre. Temps et état des astres ne changent pas.";

/** Pas de marque, ou une valeur absente : jamais « non ». */
export const NEEDS_NO_MARK_TEXT = 'Pas de marque : non rempli ou non renseigné.';

/** Un trajet sans gare ferrée ne bloque pas la case des gares (dit dans la légende). */
export const NEEDS_NO_STATION_TEXT = "Un trajet sans gare ferrée ne bloque pas « Gares sans réservation d'assistance ».";

/** Cases 4 et 5 : aucune marque sur le ciel, l'information est dans la légende et dans le panneau. */
export const NEEDS_SIGNS_TEXT = 'Annonces sonores et visuelles : aucune marque sur le ciel, voir le panneau de l\'astre.';

/** Sens des deux champs d'annonces : la documentation des référentiels IDFM, pas la description de la page du jeu. */
export const NEEDS_SIGNS_NOTE =
  "Annonces sonores : champ audiblesigns_available, annonces visuelles : champ visualsigns_available du référentiel des lignes IDFM. Le sens est celui de la documentation des référentiels ; la description de la page du jeu inverse les deux.";

/** Champ général de la ligne (TRA03) : affiché dans le détail, il n'entre dans aucune case. */
export const NEEDS_LINE_LABEL = 'Déclaration générale de la ligne (champ accessibility)';
export const NEEDS_LINE_NOTE =
  "Le champ général de la ligne (TRA03, champ accessibility) n'entre dans aucune case. Pour un bus, IDFM le décrit ainsi : au moins 70 % des arrêts, des véhicules équipés, du personnel formé et une information voyageurs à jour ; les arrêts d'une ligne ne sont pas tous concernés.";

/** Niveau 3 de TRA04 : la description du jeu, sans interprétation. */
export const NEEDS_ASSISTENGARE_NOTE =
  "Gares : niveau 3 = assistance sur réservation (Assist'enGare), obligation de résultat ; sans réservation, obligation de moyens (description du jeu IDFM). Le niveau est celui de la gare, parfois différent selon la ligne (commentaire de la source).";

/**
 * Liens officiels d'assistance : AUCUN pour l'instant. Les pages d'assistance d'IDFM, de la RATP, de SNCF Voyageurs et de
 * Transilien répondent 403 aux outils automatiques (05/11/2026) : un lien n'est ajouté qu'après lecture de la page
 * (date de vérification renseignée). La liste vide n'affiche rien.
 */
export interface AssistanceLink {
  label: string;
  url: string;
  /** Date de lecture de la page par l'équipe (AAAA-MM-JJ) */
  checked: string;
}
export const ASSISTANCE_LINKS: readonly AssistanceLink[] = [];

/** Contexte de lecture d'un tronçon : niveaux de gare (meta.needs) et dates de relevé (sources.json). */
export interface NeedsReadCtx {
  meta: Pick<NeedsMeta, 'station_levels'> | null | undefined;
  dates: Partial<Record<NeedsSourceCode, string>>;
  /** Mode sources (D-033) : `false` retire « (GTFS IDFM, relevé du…) » de chaque ligne. Absent : les sources sont écrites. */
  withSources?: boolean;
}

/** « Véhicule déclaré adapté… (GTFS IDFM, relevé du 03/11/2026) » : la parenthèse, avec son espace ; rien hors mode sources. */
const cite = (code: NeedsSourceCode, ctx: NeedsReadCtx): string => {
  if (ctx.withSources === false) return '';
  return ctx.dates[code] ? ` (${SOURCE_LABEL[code]}, relevé du ${ctx.dates[code]})` : ` (${SOURCE_LABEL[code]})`;
};

/** Hors mode sources (D-033) : retire le code d'une source (« TRA03, ») d'une note publiée ici. Fonction PURE. */
export function stripNeedsSourceCodes(text: string): string {
  return text.replace(/\bTRA\d{2},\s*/g, '');
}

/**
 * Lignes affichées pour un tronçon en TC, selon les cases cochées : ce que déclare chaque source, avec son nom et sa
 * date. Aucune ligne pour un tronçon à pied (rien n'est déclaré). Dès qu'une case est cochée, le champ général de la
 * ligne (TRA03) est affiché aussi : il n'entre dans aucune case.
 */
export function legNeedsFacts(leg: NeedsLeg, selected: readonly NeedId[], ctx: NeedsReadCtx): string[] {
  if (leg.m === 'walk' || leg.m == null || selected.length === 0) return [];
  const a = leg.a11y;
  const out: string[] = [];
  if (selected.includes('wc_trip')) {
    out.push(`Véhicule déclaré adapté au fauteuil roulant${cite('TRA01', ctx)} : ${valueText(leg.wc_trip)}`);
  }
  if (selected.includes('wc_stops')) {
    out.push(`Arrêts déclarés adaptés au fauteuil roulant${cite('TRA01', ctx)} : montée ${valueText(leg.wc_from)}, descente ${valueText(leg.wc_to)}`);
  }
  if (selected.includes('station') && a) {
    if ('st_from' in a) out.push(`Gare de montée${cite('TRA04', ctx)} : ${stationText(a.st_from, ctx.meta)}`);
    if ('st_to' in a) out.push(`Gare de descente${cite('TRA04', ctx)} : ${stationText(a.st_to, ctx.meta)}`);
  }
  if (selected.includes('ac')) out.push(`Climatisation déclarée${cite('TRA03', ctx)} : ${valueText(leg.air_conditioning)}`);
  if (selected.includes('audio')) out.push(`Annonces sonores${cite('TRA03', ctx)} : ${valueText(a?.audio)}`);
  if (selected.includes('visual')) out.push(`Annonces visuelles${cite('TRA03', ctx)} : ${valueText(a?.visual)}`);
  out.push(`${NEEDS_LINE_LABEL}${cite('TRA03', ctx)} : ${valueText(a?.line)}`);
  return out;
}

/** Notes de lecture du bloc, selon les cases cochées ; jamais plus que la source. */
export function needsNotes(selected: readonly NeedId[], hasStation: boolean): string[] {
  if (selected.length === 0) return [];
  const out = [NEEDS_ALWAYS_TEXT, NEEDS_LINE_NOTE];
  if (selected.includes('station') && hasStation) out.push(NEEDS_ASSISTENGARE_NOTE);
  if (selected.includes('audio') || selected.includes('visual')) out.push(NEEDS_SIGNS_NOTE);
  return out;
}

/** Mode sources (D-033) : la méthode de la case et de la marque, en clair. */
export const NEEDS_METHOD_TEXT =
  "Méthode : une case est remplie quand toutes les valeurs lues sur tous les tronçons en transport en commun du trajet le plus rapide sont déclarées (véhicules et arrêts : GTFS à 1 ; gares : niveaux 4 et 6 de TRA04 ; annonces et climatisation : « true » de TRA03). « non », « partiel », niveaux 1 et 3 : non remplie ; valeur absente : non renseigné. Un astre est marqué si toutes les cases cochées parmi les quatre premières sont remplies à l'aller et au retour, dans le budget ; sans gare ferrée, la case des gares ne bloque pas. Le champ général de la ligne (TRA03) n'entre dans aucune case.";

/** Un tronçon du trajet porte-t-il une gare de TRA04 ? (pour n'afficher la note Assist'enGare que si elle sert) */
export function tripHasStation(legs: readonly NeedsLeg[] | undefined): boolean {
  return (legs ?? []).some((l) => !!l.a11y && ('st_from' in l.a11y || 'st_to' in l.a11y));
}
