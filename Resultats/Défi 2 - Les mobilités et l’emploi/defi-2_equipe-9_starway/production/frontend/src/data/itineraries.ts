/**
 * Itinéraires TC détaillés du panneau de preuve (D-028, adoptée le 03/11) : types et textes, fonctions PURES.
 *
 * Contrat : `itineraries/{insee}.json.gz` (réglage de marche par défaut, `meta.itineraries_communes`) et
 * `{meta.itineraries_variants[réglage].dir}/{insee}.json.gz` (autres réglages, 04/11), un fichier par commune,
 * JSON compressé en gzip, écrit par `pipeline/starway/itin_export.py` (06h --publish, puis 06t). Ailleurs, les
 * blocs qui en dépendent (transports utilisés, coût au ticket, carbone) sont remplacés par une phrase qui dit
 * pourquoi. Rien n'est jamais remplacé par une valeur d'attente.
 *
 * Champs par ligne PUBLIÉS depuis le 04/11 sur chaque tronçon en TC : `air_conditioning` (TRA03) et
 * `punctuality` (QS01, valeur et mois, ou valeur nulle et raison). PAS ENCORE exportés : `accessibility`
 * (TRA03), `station_from` / `station_to` (TRA04) (filtre handicap en attente). Un champ absent n'affiche
 * aucune ligne ; un champ présent mais vide affiche « non renseigné(e) », jamais « non ».
 */
import { nbsp } from './format';
import { seriesAt } from './seriesGuard';
import type { DayType, DayTypeId, LineFactsMeta, Meta } from './types';

/** Famille de mode d'un tronçon (`itineraries.ROUTE_TYPE_KIND`, rail distingué par l'exploitant GTFS). */
export type ItinLegKind =
  | 'walk'
  | 'metro'
  | 'rer'
  | 'train'
  | 'ter'
  | 'rail'
  | 'tram'
  | 'bus'
  | 'trolleybus'
  | 'cable'
  | 'cable_tram'
  | 'funicular'
  | 'monorail'
  | 'ferry';

/** Référentiel des lignes IDFM (TRA03), champ `air_conditioning` (déclaration de la ligne, pas du véhicule). */
export type AirConditioning = 'true' | 'partial' | 'false' | 'unknown';
/** Référentiel des lignes IDFM (TRA03), champ `accessibility` (déclaration de la ligne). */
export type LineAccessibility = 'true' | 'false' | 'unknown';

/** Niveau d'une gare dans « Accessibilité en gare » (TRA04) : libellé exact du jeu, jamais résumé. */
export interface StationLevel {
  level?: number | null;
  label: string | null;
  comment?: string | null;
}

/** Ponctualité mensuelle de la ligne (QS01, SNCF Voyageurs) : RER et Transilien seulement. */
export interface LinePunctuality {
  /** Part des voyageurs arrivés avec moins de 5 min de retard (%) */
  value_pct: number | null;
  /** Mois du taux, "AAAA-MM" */
  month: string | null;
  /** Taux nul : `no_open_data` (métro, tram, bus, TER, ligne V) ou `month_not_published` */
  reason?: string | null;
}

/** Un tronçon (`itin_export.leg_json`). */
export interface ItinLeg {
  m: ItinLegKind | null;
  /** "HH:MM" */
  dep: string;
  arr: string;
  min: number;
  dist_m: number | null;
  /** Marche : access | egress | transfer | direct */
  role?: string | null;
  from?: string | null;
  to?: string | null;
  line?: string | null;
  color?: string | null;
  text_color?: string | null;
  route_type?: number | null;
  agency?: string | null;
  wait_min?: number | null;
  /** GTFS : véhicule de la course, quai de montée, quai de descente (true / false / null = non renseigné) */
  wc_trip?: boolean | null;
  wc_from?: boolean | null;
  wc_to?: boolean | null;
  /**
   * Course à la demande (GTFS : réservation obligatoire, pickup_type ou drop_off_type = 2, règle de
   * réservation) : présent et vrai seulement dans ce cas. Horaire théorique du GTFS, distance non publiée.
   */
  on_demand?: boolean;
  /** Publiés depuis le 04/11 (TRA03, QS01) sur chaque tronçon en TC */
  air_conditioning?: AirConditioning | null;
  punctuality?: LinePunctuality | null;
  /* --- proposés (proposition-panneau-preuve.md § 8.2), pas encore exportés --- */
  accessibility?: LineAccessibility | null;
  station_from?: StationLevel | null;
  station_to?: StationLevel | null;
}

export interface ItinTickets {
  metro_train_rer: number | null;
  bus_tram: number | null;
  airport: number | null;
  cost_eur: number | null;
  /** ok | unknown | street_transfer_unverified */
  status: string;
  reasons?: string[];
}

export interface ItinCo2 {
  value: number | null;
  status: string;
  reason?: string | null;
}

export type ItinStatus = 'ok' | 'no_trip_in_matrix' | 'no_itinerary_found' | 'point_not_snapped' | 'not_computed';

/** Un sens d'un couple (commune, pôle, journée) (`itin_export.trip_json`). */
export interface ItinTrip {
  status: ItinStatus | string;
  reason?: string | null;
  dep?: string;
  arr?: string;
  min?: number;
  /** Durée de la matrice (celle du verdict et du ciel) */
  matrix_min?: number;
  /** Durée de l'itinéraire moins celle de la matrice (min) */
  delta_min?: number;
  rides?: number;
  wait_min?: number;
  walk_m?: number | null;
  legs?: ItinLeg[];
  tickets?: ItinTickets;
  co2_g?: ItinCo2;
}

/** Heure creuse (`offpeak`, 06h, réglage par défaut) : départ fixe choisi par l'équipe, pas une donnée. */
export interface ItinOffpeak {
  /** "HH:MM" */
  dep: string;
  out: (number | null)[];
  ret: (number | null)[];
  reason: (string | null)[];
}

export interface ItinerariesFile {
  insee: string;
  contract: string;
  walk_setting?: string;
  /** Ordre des pôles (celui de poles.json) */
  poles: string[];
  days: Partial<Record<DayTypeId, { out?: ItinTrip[]; ret?: ItinTrip[] }>>;
  offpeak?: ItinOffpeak;
}

/**
 * Dossier, communes et suffixe des itinéraires d'un réglage de marche (null = défaut) : `itineraries/`
 * et `meta.itineraries_communes`, ou `meta.itineraries_variants[clé]`. null si rien n'est publié.
 */
export function itinerariesSource(
  meta: Pick<Meta, 'itineraries_communes' | 'itineraries_variants' | 'itineraries_format'>,
  walkKey: string | null | undefined,
): { dir: string; communes: string[]; suffix: string } | null {
  const suffix = meta.itineraries_format?.suffix ?? '.json';
  if (!walkKey) return Array.isArray(meta.itineraries_communes) ? { dir: 'itineraries', communes: meta.itineraries_communes, suffix } : null;
  const v = meta.itineraries_variants?.[walkKey];
  if (!v || typeof v.dir !== 'string' || !/^[a-z0-9_]+$/.test(v.dir) || !Array.isArray(v.communes)) return null;
  return { dir: v.dir, communes: v.communes, suffix };
}

/** Le fichier suit-il un contrat d'itinéraires lisible par ce front ? */
export function isItinerariesFile(v: unknown): v is ItinerariesFile {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<ItinerariesFile>;
  return typeof f.contract === 'string' && f.contract.startsWith('itineraries-') && Array.isArray(f.poles) && !!f.days && typeof f.days === 'object';
}

/**
 * Itinéraire détaillé d'un sens, seulement s'il est calculé (`status: ok`, au moins un tronçon).
 * Tout autre cas : null (le bloc reste masqué ; le verdict du panneau vient de la matrice).
 */
export function itineraryOf(file: ItinerariesFile | null | undefined, poleId: string, day: DayTypeId, leg: 'out' | 'ret'): ItinTrip | null {
  if (!isItinerariesFile(file)) return null;
  const i = file.poles.indexOf(poleId);
  if (i < 0) return null;
  // Garde de longueur (arbitrage du 05/11) : les trajets se lisent par position de `file.poles`, la série doit en avoir autant
  const t = seriesAt(file.poles.length, file.days[day]?.[leg], i);
  if (!t || t.status !== 'ok' || !Array.isArray(t.legs) || t.legs.length === 0) return null;
  return t;
}

/* ------------------------------------------------------------------ textes par tronçon */

const KIND_LABEL: Record<ItinLegKind, string> = {
  walk: 'Marche',
  metro: 'Métro',
  rer: 'RER',
  train: 'Transilien',
  ter: 'TER',
  rail: 'Train',
  tram: 'Tram',
  bus: 'Bus',
  trolleybus: 'Trolleybus',
  cable: 'Câble',
  cable_tram: 'Tramway à câble',
  funicular: 'Funiculaire',
  monorail: 'Monorail',
  ferry: 'Navette fluviale',
};

/** « RER A », « Métro 14 », « Bus 129 », « Marche » ; famille inconnue : « Ligne X ». */
export function legTitle(leg: Pick<ItinLeg, 'm' | 'line'>): string {
  const kind = leg.m ? KIND_LABEL[leg.m] : null;
  if (leg.m === 'walk') return 'Marche';
  if (kind && leg.line) return `${kind} ${leg.line}`;
  return kind ?? (leg.line ? `Ligne ${leg.line}` : 'Ligne non renseignée');
}

/** 450 → « 450 m », 2300 → « 2,3 km » ; null si inconnu. */
export function distanceText(m: number | null | undefined): string | null {
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return null;
  if (m < 1000) return `${Math.round(m)}\u00a0m`;
  return `${(Math.round(m / 100) / 10).toString().replace('.', ',')}\u00a0km`;
}

/** Durée d'un tronçon en minutes entières (arrondi à la minute la plus proche, au moins 1). */
export function legMinutes(min: number): number {
  return Math.max(1, Math.round(min));
}

const AC_TEXT: Record<AirConditioning, string> = { true: 'oui', partial: 'partielle', false: 'non', unknown: 'non renseignée' };
const ACCESS_TEXT: Record<LineAccessibility, string> = { true: 'oui', false: 'non', unknown: 'non renseigné' };

/** Faits publiés pour une ligne de TC, une phrase par source ; aucun fait déduit. */
export function lineFacts(leg: ItinLeg, texts?: LineFactsMeta['texts']): string[] {
  if (leg.m === 'walk' || leg.m == null) return [];
  const out: string[] = [];
  if (leg.on_demand === true) out.push('Transport à la demande : réservation obligatoire, horaire théorique du GTFS (IDFM)');
  if (leg.air_conditioning !== undefined) {
    out.push(`Climatisation (déclarée à IDFM) : ${AC_TEXT[leg.air_conditioning ?? 'unknown'] ?? AC_TEXT.unknown}`);
  }
  if (leg.accessibility !== undefined) {
    out.push(`Ligne déclarée accessible (IDFM) : ${ACCESS_TEXT[leg.accessibility ?? 'unknown'] ?? ACCESS_TEXT.unknown}`);
  }
  const station = (name: string, s: StationLevel | null | undefined) => {
    if (s === undefined) return;
    const label = s?.label?.trim();
    out.push(`${name} (IDFM) : ${label ? label : 'niveau non renseigné'}${s?.comment ? ` (${s.comment})` : ''}`);
  };
  station('Gare de montée', leg.station_from);
  station('Gare de descente', leg.station_to);
  const p = punctualityText(leg, texts);
  if (p) out.push(p);
  return out;
}

/**
 * Climatisation et ponctualité d'une ligne, phrases complètes, mots de `lineFacts` (retours KBS du 10/11) : elles quittent
 * le pli « Arrêts et horaires du trajet », dont le titre ne les promet pas, pour la bulle « i » de la liste visible des lignes.
 */
export function lineComfortFacts(leg: ItinLeg, texts?: LineFactsMeta['texts']): string[] {
  if (leg.m === 'walk' || leg.m == null) return [];
  const out: string[] = [];
  if (leg.air_conditioning !== undefined) {
    out.push(`Climatisation (déclarée à IDFM) : ${AC_TEXT[leg.air_conditioning ?? 'unknown'] ?? AC_TEXT.unknown}`);
  }
  const p = punctualityText(leg, texts);
  if (p) out.push(p);
  return out;
}

/** Faits d'une ligne lus dans le pli « Arrêts et horaires du trajet » : ceux de `lineFacts` sans la climatisation ni la ponctualité. */
export function lineStopFacts(leg: ItinLeg, texts?: LineFactsMeta['texts']): string[] {
  const comfort = new Set(lineComfortFacts(leg, texts));
  return lineFacts(leg, texts).filter((f) => !comfort.has(f));
}

/**
 * Version courte des faits publiés d'une ligne (liste visible du panneau) : « climatisation : oui ·
 * ponctualité : 89,4 % (septembre 2026) » ; « ponctualité : pas de donnée ouverte » hors RER et
 * Transilien. Champs absents : null. Les phrases complètes restent dans le détail replié.
 */
export function lineFactsShort(leg: ItinLeg, texts?: LineFactsMeta['texts'], withMonth = true): string | null {
  if (leg.m === 'walk' || leg.m == null) return null;
  const parts: string[] = [];
  if (leg.on_demand === true) parts.push('transport à la demande, sur réservation');
  if (leg.air_conditioning !== undefined) {
    const v = leg.air_conditioning ?? 'unknown';
    parts.push(`climatisation : ${texts?.air_conditioning.values[v] ?? AC_TEXT[v] ?? AC_TEXT.unknown}`);
  }
  const p = leg.punctuality;
  if (p !== undefined) {
    const month = monthText(p?.month);
    const rail = leg.m === 'rer' || leg.m === 'train';
    if (p && rail && p.value_pct != null && Number.isFinite(p.value_pct) && month) {
      // Audit d'affichage du 11/11 (T4) : sous la bande, sans mode sources, le mois est dans le « i » des lignes (`withMonth` faux)
      parts.push(`ponctualité : ${nbsp(pct1.format(p.value_pct))}\u00a0%${withMonth ? ` (${month})` : ''}`);
    } else if (p?.reason === 'month_not_published') {
      parts.push(`ponctualité : ${texts?.punctuality.month_not_published ?? 'mois non publié pour cette ligne'}`);
    } else {
      parts.push('ponctualité : pas de donnée ouverte');
    }
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Une ligne au moins porte-t-elle des faits publiés par TRA03 ou QS01 (mention ODbL à afficher) ? */
export function hasLineFacts(legs: readonly ItinLeg[]): boolean {
  return legs.some((l) => l.m !== 'walk' && (l.air_conditioning !== undefined || l.punctuality !== undefined));
}

/** Mention de licence des faits par ligne (ODbL : attribution et même licence pour la base dérivée). */
export const LINE_FACTS_LICENCE =
  'Climatisation : référentiel des lignes d’Île-de-France Mobilités (TRA03) ; ponctualité : SNCF Voyageurs (QS01) ; deux bases sous licence ODbL. Les fichiers d’itinéraires qui reprennent ces valeurs sont publiés sous la même licence (ODbL).';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** "2026-09" → « septembre 2026 » ; null si illisible. */
export function monthText(ym: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(ym ?? '');
  if (!m) return null;
  const name = MONTHS[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : null;
}

const pct1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

const SHARED_TEXT_DEFAULT =
  'ligne exploitée par la RATP et la SNCF : SNCF Voyageurs ne précise pas si le taux couvre toute la ligne ou seulement sa partie SNCF';

/**
 * Ponctualité de la ligne (QS01, SNCF Voyageurs) : part des voyageurs arrivés avec moins de 5 min de
 * retard, RER et Transilien seulement, toujours avec le mois ; RER A et B : ce que couvre la valeur
 * (lignes RATP et SNCF). Champ publié sans taux : « pas de donnée ouverte » (métro, tram, bus, TER,
 * ligne V) ou « mois non publié ». Champ absent ou taux sans mois : rien.
 */
export function punctualityText(leg: Pick<ItinLeg, 'm' | 'punctuality' | 'line'>, texts?: LineFactsMeta['texts']): string | null {
  const p = leg.punctuality;
  if (p === undefined || leg.m === 'walk' || leg.m == null) return null;
  const rail = leg.m === 'rer' || leg.m === 'train';
  const t = texts?.punctuality;
  if (p && rail && p.value_pct != null && Number.isFinite(p.value_pct)) {
    const month = monthText(p.month);
    if (!month) return null;
    const shared = leg.m === 'rer' && !!leg.line && (t?.shared_lines ?? ['A', 'B']).includes(leg.line);
    const pct = nbsp(pct1.format(p.value_pct));
    return `Ponctualité de la ligne (SNCF Voyageurs, ${month}) : ${pct}\u00a0% des voyageurs arrivés avec moins de 5\u00a0min de retard${shared ? ` (${t?.shared_text ?? SHARED_TEXT_DEFAULT})` : ''}`;
  }
  if (p?.reason === 'month_not_published') return `Ponctualité : ${t?.month_not_published ?? 'mois non publié pour cette ligne'}`;
  if (!p || p.value_pct == null || !rail) return `Ponctualité : ${t?.no_open_data ?? 'pas de donnée ouverte pour cette ligne'}`;
  return null;
}

/**
 * Écart de l'itinéraire détaillé avec la durée du verdict (matrice) : « itinéraire détaillé à 2 min
 * près » ; null si nul ou inconnu.
 */
export function itineraryDeltaText(t: Pick<ItinTrip, 'delta_min'>): string | null {
  const d = t.delta_min;
  if (typeof d !== 'number' || !Number.isFinite(d) || d === 0) return null;
  return `Itinéraire détaillé à ${Math.abs(d)}\u00a0min près de la durée du calcul.`;
}

/* ------------------------------------------------------------------ coût au ticket, carbone */

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

export interface TicketFact {
  eur: number;
  /** « 1 ticket Métro-Train-RER, 1 ticket Bus-Tram » */
  detail: string;
  text: string;
}

/**
 * Coût d'un sens au ticket (plein tarif, sans forfait) : seulement si le pipeline publie un prix sûr
 * (`status: ok`). « À vérifier » (correspondance par la rue) ou inconnu : null, rien n'est affiché.
 */
export function ticketFact(t: ItinTrip | null | undefined, leg: 'out' | 'ret'): TicketFact | null {
  const k = t?.tickets;
  if (!k || k.status !== 'ok' || k.cost_eur == null || !Number.isFinite(k.cost_eur)) return null;
  const parts: string[] = [];
  const add = (n: number | null, name: string) => {
    if (n && n > 0) parts.push(`${n} ticket${n > 1 ? 's' : ''} ${name}`);
  };
  add(k.metro_train_rer, 'Métro-Train-RER');
  add(k.bus_tram, 'Bus-Tram');
  add(k.airport, 'Paris Région <> Aéroports');
  const detail = parts.join(', ');
  const price = nbsp(eur.format(k.cost_eur));
  const side = leg === 'out' ? 'Aller' : 'Retour';
  // Trajet tout à pied (aucun tronçon en TC) : aucun ticket, 0 € publié
  if (parts.length === 0 && k.cost_eur === 0) return { eur: 0, detail: '', text: `${side} : à pied, aucun ticket` };
  return { eur: k.cost_eur, detail, text: `${side} : ${price}${detail ? ` (${detail})` : ''}` };
}

/** « Aller et retour : 5,10 € » : seulement si les deux sens ont un prix sûr (jamais un total partiel). */
export function ticketTotalText(out: TicketFact | null, ret: TicketFact | null): string | null {
  if (!out || !ret) return null;
  return `Aller et retour : ${nbsp(eur.format(Math.round((out.eur + ret.eur) * 100) / 100))}`;
}

/** Pourquoi le prix d'un sens n'est pas affiché (statut publié par 06h) ; null s'il l'est ou s'il n'y a pas de trajet. */
export function ticketNote(t: ItinTrip | null | undefined, leg: 'out' | 'ret'): string | null {
  const k = t?.tickets;
  if (!k || k.status === 'ok') return null;
  const side = leg === 'out' ? 'Aller' : 'Retour';
  if (k.status === 'street_transfer_unverified') return `${side} : prix non affiché, une correspondance par la rue entre deux gares reste à vérifier.`;
  const why = (k.reasons ?? []).filter(Boolean).join(' ; ');
  return `${side} : prix non affiché${why ? ` (${why})` : ''}.`;
}

export interface CarbonFact {
  outG: number;
  retG: number;
  totalG: number;
}

/**
 * Carbone aller + retour (ENV01, facteurs IDFM par mode) : seulement si les DEUX sens ont une valeur
 * publiée (`status: ok`). Un sens sans facteur rend le total nul : jamais un total partiel.
 */
export function carbonFact(out: ItinTrip | null | undefined, ret: ItinTrip | null | undefined): CarbonFact | null {
  const v = (t: ItinTrip | null | undefined) => (t?.co2_g?.status === 'ok' && typeof t.co2_g.value === 'number' && Number.isFinite(t.co2_g.value) ? t.co2_g.value : null);
  const o = v(out);
  const r = v(ret);
  if (o == null || r == null) return null;
  return { outG: o, retG: r, totalG: o + r };
}

/** Pourquoi le carbone n'est pas affiché alors qu'un sens est détaillé (raison publiée, ex. facteur non publié). */
export function carbonNote(out: ItinTrip | null | undefined, ret: ItinTrip | null | undefined): string | null {
  const reasons = [out, ret]
    .filter((t): t is ItinTrip => !!t && !!t.co2_g && t.co2_g.status !== 'ok')
    .map((t) => t.co2_g?.reason)
    .filter((r): r is string => !!r);
  if (reasons.length === 0) return null;
  return `Carbone non calculé : ${[...new Set(reasons)].join(' ; ')}.`;
}

/* ------------------------------------------------------------------ disponibilité du détail */

/**
 * Journée-type de l'itinéraire : celle du scénario en journées-types ; en horaires libres (table OD),
 * seulement si les horaires sont exactement ceux d'une journée-type (minutes depuis minuit). Sinon null.
 */
export function itineraryDay(dayTypes: readonly DayType[], day: DayTypeId, shift: { start: number; end: number } | null): DayTypeId | null {
  if (!shift) return dayTypes.some((d) => d.id === day) ? day : null;
  const min = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? NaN) * 60 + (m ?? NaN);
  };
  return dayTypes.find((d) => min(d.start) === shift.start && min(d.end) === shift.end)?.id ?? null;
}

/** Cas où le détail n'est pas publié : mode, réglage de marche, horaires, diptyque, commune. */
export type ItinUnavailable = 'mode' | 'walk' | 'shift' | 'compare' | 'not_published';

/**
 * `walkPublished` : des itinéraires existent pour ce réglage de marche (variante annoncée dans
 * `meta.itineraries_variants`) ; `listed` : la commune est publiée pour le réglage du scénario.
 */
export function itineraryAvailability(p: {
  mode: string;
  walkKey: string | null | undefined;
  day: DayTypeId | null;
  split: boolean;
  listed: boolean;
  walkPublished?: boolean;
}): ItinUnavailable | null {
  if (p.mode !== 'transit') return 'mode';
  if (p.walkKey && !p.walkPublished) return 'walk';
  if (!p.day) return 'shift';
  if (p.split) return 'compare';
  if (!p.listed) return 'not_published';
  return null;
}

/**
 * Phrase courte qui dit pourquoi le détail du trajet n'est pas affiché. `pending44` : ciel des 44 astres (D-030),
 * où ce qui n'est pas publié pour un réglage ou une commune est « en cours de calcul », jamais une valeur.
 */
export function itineraryUnavailableText(why: ItinUnavailable, p: { dayLabels: string[]; defaultWalkLabel?: string | null; pending44?: boolean }): string {
  const head = 'Détail du trajet, coût au ticket et carbone';
  switch (why) {
    // Audit d'affichage du 10/11 : en voiture, le pli « Coût et carbone » montre un coût et un carbone ; en vélo + TC et en horaires
    // libres, le pli dit lui-même pourquoi le coût et le carbone manquent. La phrase ne parle donc que du détail du trajet.
    case 'mode':
      return 'Détail du trajet : transports en commun seulement.';
    case 'walk':
      return p.pending44
        ? `${head} : en cours de calcul pour les 44 astres avec ce réglage de marche${p.defaultWalkLabel ? ` (publiés pour le réglage « ${p.defaultWalkLabel} »)` : ''}.`
        : `${head} : calculés pour le réglage de marche ${p.defaultWalkLabel ? `« ${p.defaultWalkLabel} »` : 'par défaut'} seulement.`;
    // Audit d'affichage du 11/11 (P28, D9) : la liste des journées-types est sur les boutons de la barre et sur le bouton qui suit
    case 'shift':
      return 'Détail du trajet : non calculé en horaires libres.';
    case 'compare':
      return 'Détail du trajet : affiché pour une seule commune, hors comparaison.';
    case 'not_published':
      return p.pending44 ? `${head} : en cours de calcul pour les 44 astres.` : `${head} : pas encore publiés pour cette commune.`;
  }
}

/** Pourquoi un sens n'a pas de détail alors que le fichier est chargé (statut publié) ; null s'il est détaillé. */
export function tripUnavailableText(t: ItinTrip | null | undefined, leg: 'out' | 'ret', maxTripMin: number | null | undefined): string | null {
  if (!t || (t.status === 'ok' && Array.isArray(t.legs) && t.legs.length > 0)) return null;
  const side = leg === 'out' ? 'Aller' : 'Retour';
  if (t.status === 'no_trip_in_matrix') {
    const lim =
      typeof maxTripMin === 'number' && maxTripMin > 0 ? (maxTripMin % 60 === 0 ? `${maxTripMin / 60}\u00a0h` : `${maxTripMin}\u00a0min`) : null;
    return `${side} : aucun trajet${lim ? ` de ${lim} ou moins` : ''} vers cet arrêt, rien à détailler.`;
  }
  if (t.status === 'no_itinerary_found') return `${side} : détail indisponible (aucun itinéraire retrouvé pour ce trajet).`;
  return `${side} : détail non calculé.`;
}

/** Sens d'un couple dans le fichier chargé, quel que soit son statut (pour dire pourquoi il n'est pas détaillé). */
export function tripEntry(file: ItinerariesFile | null | undefined, poleId: string, day: DayTypeId, leg: 'out' | 'ret'): ItinTrip | null {
  if (!isItinerariesFile(file)) return null;
  const i = file.poles.indexOf(poleId);
  return i < 0 ? null : seriesAt(file.poles.length, file.days[day]?.[leg], i);
}

/**
 * Le fichier de la commune est chargé mais ne contient pas l'astre affiché : le panneau le dit (jamais de silence).
 * Null si le fichier n'est pas chargé (une autre phrase explique pourquoi) ou si l'astre y est.
 */
export function poleUnlistedText(file: ItinerariesFile | null | undefined, poleId: string, pending44: boolean): string | null {
  if (!isItinerariesFile(file) || file.poles.includes(poleId)) return null;
  return pending44
    ? 'Détail du trajet, coût au ticket et carbone : en cours de calcul pour cet astre.'
    : 'Détail du trajet, coût au ticket et carbone : pas encore publiés pour ce pôle.';
}

/**
 * Libellé honnête de l'exemple de trajet en mode commune par commune : l'itinéraire va à l'arrêt
 * d'ancrage du pôle, pas au centre de chaque commune (destinations de la table OD).
 */
export function itineraryExampleNote(stop: string | null, dayLabel: string | null): string {
  return `${itineraryExampleLead(stop, dayLabel)} ${ITINERARY_EXAMPLE_TAIL}`;
}

/**
 * Première phrase de `itineraryExampleNote`, seule au premier niveau du panneau (liste à garder visible, lot 6) ; la seconde va dans
 * « Méthode et sources », la phrase de l'arrêt d'affichage dit déjà que les durées peuvent différer.
 */
export function itineraryExampleLead(stop: string | null, dayLabel: string | null): string {
  const to = stop ? `vers ${stop}, l'arrêt le plus desservi du pôle` : "vers l'arrêt le plus desservi du pôle";
  return `Exemple de trajet ${to}${dayLabel ? `, journée ${dayLabel}` : ''}.`;
}

/** Seconde phrase de la note d'exemple : dans « Méthode et sources » depuis le lot 6. */
export const ITINERARY_EXAMPLE_TAIL = 'Les temps plus haut vont au centre de chaque commune du pôle : ils peuvent différer.';

/** Phrase de méthode de l'itinéraire : dans « Méthode et sources » depuis le lot 6 (elle n'est pas de celles qu'il faut lire sans rien ouvrir). */
export const ITINERARY_METHOD_NOTE = 'Itinéraire calculé avec r5py sur les horaires IDFM : un trajet possible, pas une consigne.';

/**
 * Phrase du bloc « Transports utilisés (aller) » (option A de docs/horaires-nuit.md, 06/11) : l'itinéraire détaillé
 * s'arrête à l'arrêt d'affichage de l'astre (`point.stop_name`, poles.json), alors que la durée du titre est calculée
 * jusqu'au centre de la commune : les deux peuvent différer (constat Maisons-Laffitte vers Paris 16e). Nom absent ou
 * vide : null, la phrase n'est jamais écrite sans nom (rien n'est deviné).
 */
export function itineraryStopNote(stopName: string | null | undefined): string | null {
  const name = stopName?.trim();
  if (!name) return null;
  return `Itinéraire détaillé jusqu'à l'arrêt le plus desservi de l'astre (${name}). La durée du titre est calculée jusqu'au centre de la commune : les deux peuvent différer.`;
}

/**
 * Phrase miroir du bloc « Transports utilisés (retour) » : l'itinéraire détaillé du retour PART de l'arrêt d'affichage
 * de l'astre (04h : `a, b = pole, commune` au retour, le point du pôle est `point` de poles.json, premier tronçon à pied
 * « access » depuis ce point), alors que la durée du titre (table commune par commune) part du centre de la commune de
 * l'astre. Mêmes règles que `itineraryStopNote` : nom absent ou vide, null, rien n'est deviné.
 */
export function itineraryReturnStopNote(stopName: string | null | undefined): string | null {
  const name = stopName?.trim();
  if (!name) return null;
  return `Itinéraire détaillé depuis l'arrêt le plus desservi de l'astre (${name}). La durée du titre est calculée depuis le centre de la commune : les deux peuvent différer.`;
}

/** Phrase de garde du carbone (proposition-panneau-preuve.md § 4), toujours affichée avec la valeur. */
export const CARBON_GUARD =
  'Estimation : distance de chaque tronçon en transport en commun multipliée par le facteur moyen d’émission publié par Île-de-France Mobilités (g CO2e par voyageur et par km ; opérateurs 2019, ADEME pour le bus). Ce facteur dépend du remplissage moyen des véhicules : ce n’est pas une mesure de votre trajet. La marche n’est pas comptée.';
