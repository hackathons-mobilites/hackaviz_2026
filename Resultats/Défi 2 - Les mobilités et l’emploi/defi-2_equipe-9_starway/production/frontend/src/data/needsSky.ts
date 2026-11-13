/**
 * Règle du ciel de « Ce qu'il me faut sur mon trajet » (version finale du 05/11/2026, D-034). Fonctions PURES, copie
 * conforme de `pipeline/starway/needs.py` (mêmes cas de test : `needsRuleCases.json`, lus par vitest et par pytest).
 *
 * UNE SEULE marque sur le ciel : un astre est marqué seulement si TOUTES les cases cochées parmi les quatre premières
 * (véhicules, arrêts, gares) sont déclarées remplies sur TOUT le trajet le plus rapide, aller ET retour, journée et
 * réglage de marche du scénario. Les cases 4 et 5 (annonces) ne marquent jamais : légende et panneau seulement.
 * Un trajet sans gare ferrée ne bloque pas la case des gares. Sara peut changer cette règle jusqu'au 06/11 au soir :
 * c'est `starMarked` (et sa jumelle Python), rien d'autre.
 *
 * La marque est un calque à part : elle ne lit ni ne change la position, la taille ni la luminosité d'un astre, et
 * n'éteint ni ne retire aucune étoile (test `needsSky.test.ts`).
 */
import { itineraryAvailability, itineraryDay, itineraryOf, itinerariesSource, type ItinerariesFile, type ItinTrip, type ItinUnavailable } from './itineraries';
import { SKY_NEEDS, NEED_LABEL, NEED_ORDER, NEEDS_ALWAYS_TEXT, NEEDS_NO_MARK_TEXT, NEEDS_NO_STATION_TEXT, NEEDS_SIGNS_TEXT, type NeedId, type NeedsLeg } from './needs';
import type { DayTypeId, Meta } from './types';

/** État d'une case sur tout un trajet (un sens). */
export type BoxState =
  | 'filled' // déclaré rempli sur tout le trajet
  | 'not_filled' // au moins une source déclare le contraire (« non », « partiel », gare de niveau 1 ou 3)
  | 'not_stated' // au moins une valeur absente d'une source (« non renseigné »), aucune déclaration contraire
  | 'no_station' // case des gares : aucune gare du jeu TRA04 sur le trajet (ne bloque pas)
  | 'no_ride'; // aucun tronçon en TC : les sources ne déclarent rien

/** TRA04 : niveaux 4 et 6 = gare sans réservation d'assistance (case remplie) ; 3 et 1 = case non remplie. */
export const STATION_FILLED_LEVELS: readonly number[] = [4, 6];
export const STATION_NOT_FILLED_LEVELS: readonly number[] = [1, 3];

type Legs = readonly NeedsLeg[] | null | undefined;

const rides = (legs: Legs): NeedsLeg[] => (legs ?? []).filter((l) => l.m != null && l.m !== 'walk');

/** Toutes remplies : remplie ; une déclaration contraire : non remplie ; sinon (absence) : non renseigné. */
function combine(states: readonly BoxState[]): BoxState {
  if (states.some((s) => s === 'not_filled')) return 'not_filled';
  if (states.every((s) => s === 'filled')) return 'filled';
  return 'not_stated';
}

/** GTFS (`wc_*`) : vrai = déclaré adapté, faux = déclaré non adapté, absent (0 ou vide dans le GTFS) = non renseigné. */
const flag = (v: unknown): BoxState => (v === true ? 'filled' : v === false ? 'not_filled' : 'not_stated');

/** TRA03 : « true » = déclaré ; « false » et « partial » = non remplie ; « unknown », vide ou ligne absente = non renseigné. */
const sign = (v: unknown): BoxState => (v === 'true' ? 'filled' : v === 'false' || v === 'partial' ? 'not_filled' : 'not_stated');

/** TRA04 : niveaux 4 et 6 = rempli ; 3 et 1 = non rempli ; gare absente du jeu ou niveau inconnu = non renseigné. */
function station(s: { level?: number } | null | undefined): BoxState {
  const level = s?.level;
  if (level != null && STATION_FILLED_LEVELS.includes(level)) return 'filled';
  if (level != null && STATION_NOT_FILLED_LEVELS.includes(level)) return 'not_filled';
  return 'not_stated';
}

/**
 * État d'une case sur TOUS les tronçons en TC d'un trajet (un sens). Case des gares : seules comptent les gares présentes
 * dans le tronçon (`st_from` / `st_to`, publiées par 06n pour un tronçon ferré ou un quai du jeu) ; sans aucune gare,
 * `no_station` ne bloque pas. Un tronçon en TC sans `a11y` (06n non appliqué) ne permet pas d'affirmer l'absence de
 * gare : `not_stated`.
 */
export function boxState(box: NeedId, legs: Legs): BoxState {
  const r = rides(legs);
  if (r.length === 0) return 'no_ride';
  switch (box) {
    case 'wc_trip':
      return combine(r.map((l) => flag(l.wc_trip)));
    case 'wc_stops':
      return combine(r.flatMap((l) => [flag(l.wc_from), flag(l.wc_to)]));
    case 'ac':
      // « transport climatisé uniquement » : la ligne est déclarée climatisée sur chaque tronçon en TC ; « partiel » : non remplie
      return combine(r.map((l) => sign(l.air_conditioning)));
    case 'audio':
      return combine(r.map((l) => sign(l.a11y?.audio)));
    case 'visual':
      return combine(r.map((l) => sign(l.a11y?.visual)));
    case 'station': {
      if (r.some((l) => !l.a11y)) return 'not_stated';
      // on ne lit que les clés présentes (un tronçon ferré ou un quai du jeu porte st_from et st_to, `null` = gare absente)
      const present = r.flatMap((l) => (['st_from', 'st_to'] as const).filter((k) => k in l.a11y!).map((k) => l.a11y![k]));
      return present.length > 0 ? combine(present.map((s) => station(s))) : 'no_station';
    }
  }
}

export function tripBoxes(legs: Legs): Record<NeedId, BoxState> {
  return Object.fromEntries((['wc_trip', 'wc_stops', 'station', 'ac', 'audio', 'visual'] as const).map((b) => [b, boxState(b, legs)])) as Record<NeedId, BoxState>;
}

/** Cases cochées qui comptent pour la marque du ciel (1 à 3), dans l'ordre du réglage. */
export const skyNeeds = (selected: readonly NeedId[]): NeedId[] => SKY_NEEDS.filter((b) => selected.includes(b));

/**
 * L'astre est-il marqué ? Seulement si, parmi les cases cochées 1, 2 et 3, TOUTES sont déclarées remplies sur tout le
 * trajet le plus rapide, ALLER ET RETOUR. Aucune case 1 à 3 cochée (seulement 4 et 5, ou rien) : jamais de marque. Un
 * sens sans tronçon en TC (marche seule) ou absent : pas de marque. Sans gare ferrée, la case 3 n'empêche pas la marque.
 */
export function starMarked(outLegs: Legs, retLegs: Legs, selected: readonly NeedId[]): boolean {
  const sel = skyNeeds(selected);
  if (sel.length === 0) return false;
  return [outLegs, retLegs].every((legs) => sel.every((b) => {
    const s = boxState(b, legs);
    return s === 'filled' || s === 'no_station';
  }));
}

/* ------------------------------------------------------------------ le ciel affiché : quels astres, pourquoi pas */

/** Raison pour laquelle aucune marque n'est calculée (la légende la dit). */
export type NeedsSkyWhy = ItinUnavailable | 'pending' | 'no_origin';

/** Durée du verdict d'un sens (celle de la matrice, sinon celle de l'itinéraire) ; null si absente. */
const tripMinutes = (t: ItinTrip): number | null => (typeof t.matrix_min === 'number' ? t.matrix_min : typeof t.min === 'number' ? t.min : null);

/**
 * Le couple de trajets (aller, retour) d'un astre porte-t-il la marque ? Les deux sens doivent être détaillés, tenir dans
 * le budget du scénario (durée du verdict) et satisfaire `starMarked`. Choix à valider avec Sara : le budget est exigé
 * pour ne pas marquer un astre « hors de portée » ; pour le retirer, supprimer les deux lignes `budget` ci-dessous.
 */
export function pairMarked(out: ItinTrip | null | undefined, ret: ItinTrip | null | undefined, selected: readonly NeedId[], budget: number): boolean {
  if (!out || !ret) return false;
  const mo = tripMinutes(out);
  const mr = tripMinutes(ret);
  if (mo == null || mr == null || mo > budget || mr > budget) return false;
  return starMarked(out.legs as NeedsLeg[] | undefined, ret.legs as NeedsLeg[] | undefined, selected);
}

/** Les astres du fichier d'itinéraires sont-ils ceux du ciel affiché (mêmes identifiants, même ordre) ? */
export function sameAstres(file: Pick<ItinerariesFile, 'poles'> | null | undefined, poleIds: readonly string[]): boolean {
  return !!file && file.poles.length === poleIds.length && file.poles.every((id, i) => id === poleIds[i]);
}

/**
 * Astres marqués du ciel affiché : ceux dont les deux sens (aller ET retour) ont un trajet le plus rapide détaillé et pour
 * lesquels `pairMarked` est vrai. Rien d'autre n'est lu.
 */
export function markedPoles(p: {
  selected: readonly NeedId[];
  file: ItinerariesFile | null | undefined;
  poleIds: readonly string[];
  day: DayTypeId | null;
  budget: number;
}): string[] {
  if (skyNeeds(p.selected).length === 0 || !p.file || !p.day || !sameAstres(p.file, p.poleIds)) return [];
  return p.poleIds.filter((id) =>
    pairMarked(itineraryOf(p.file, id, p.day!, 'out'), itineraryOf(p.file, id, p.day!, 'ret'), p.selected, p.budget),
  );
}

/**
 * Pourquoi aucune marque n'est calculable pour ce ciel (même règle que le détail du trajet du panneau : TC, journée-type,
 * réglage de marche publié, commune publiée, hors diptyque), ou null si elle l'est.
 */
export function needsSkyWhy(p: {
  meta: Pick<Meta, 'day_types' | 'itineraries_communes' | 'itineraries_variants' | 'itineraries_format'>;
  mode: string;
  day: DayTypeId;
  shift: { start: number; end: number } | null;
  walkKey: string | null;
  origin: string | null;
  split: boolean;
}): NeedsSkyWhy | null {
  if (!p.origin) return 'no_origin';
  const src = itinerariesSource(p.meta, p.walkKey);
  return itineraryAvailability({
    mode: p.mode,
    walkKey: p.walkKey,
    day: itineraryDay(p.meta.day_types, p.day, p.shift),
    split: p.split,
    listed: !!src?.communes.includes(p.origin),
    walkPublished: !!src,
  });
}

/* ------------------------------------------------------------------ légende, calculée sur le ciel affiché */

export type NeedsLegendState =
  | { kind: 'none' } // aucune case cochée : rien dans la légende
  | { kind: 'signs_only' } // seules les annonces sont cochées : aucune marque, la légende le dit
  | { kind: 'unavailable'; why: NeedsSkyWhy | 'loading' } // pas de marque calculable
  | { kind: 'ready'; marked: number; total: number };

/** Texte de « aucune marque » selon la raison. */
const WHY_TEXT: Record<NeedsSkyWhy | 'loading', string> = {
  mode: 'Aucune marque : elle ne se calcule que pour les transports en commun.',
  walk: 'Aucune marque : trajets détaillés non publiés pour ce réglage de marche.',
  shift: 'Aucune marque : elle ne se calcule que pour les journées-types.',
  compare: 'Aucune marque en comparaison.',
  not_published: 'Aucune marque : trajets détaillés non publiés pour cette commune.',
  pending: "Aucune marque : trajets pas encore calculés vers ces astres.",
  no_origin: 'Aucune marque : choisissez une commune.',
  loading: 'Calcul de la marque en cours.',
};

export const needsWhyText = (why: NeedsSkyWhy | 'loading'): string => WHY_TEXT[why];

/** « 12 astres sur 44 » : accord du nom, jamais de pourcentage fixe. */
export const astresCountText = (n: number, total: number): string => `${n} ${n > 1 ? 'astres' : 'astre'} sur ${total}`;

/**
 * Phrase de la légende du ciel affiché : « n astres sur 44 : tout ce que vous avez coché est déclaré rempli ». Si des
 * annonces sont aussi cochées, la phrase ne couvre que les quatre premières cases (les annonces ne marquent pas).
 */
export function needsLegendText(state: NeedsLegendState, selected: readonly NeedId[]): string | null {
  switch (state.kind) {
    case 'none':
      return null;
    case 'signs_only':
      return NEEDS_SIGNS_TEXT;
    case 'unavailable':
      return needsWhyText(state.why);
    case 'ready': {
      const onlySky = selected.every((b) => SKY_NEEDS.includes(b));
      return `${astresCountText(state.marked, state.total)} : tout ce que vous avez coché${onlySky ? '' : ' parmi les quatre premières cases'} est déclaré rempli`;
    }
  }
}

/** Détails de la légende (info-bulle) : ce que veut dire l'absence de marque, la case des gares, les annonces. */
export function needsLegendDetails(state: NeedsLegendState, selected: readonly NeedId[], od: boolean): string[] {
  if (state.kind === 'none') return [];
  const out: string[] = [];
  if (state.kind === 'ready') {
    out.push(
      `Marque : un petit losange creux au bord de l'astre. Elle compte les cases cochées parmi « ${NEED_LABEL.wc_trip} », « ${NEED_LABEL.wc_stops} », « ${NEED_LABEL.station} » et « ${NEED_LABEL.ac} » : toutes doivent être déclarées remplies sur tout le trajet le plus rapide, à l'aller et au retour, pour la journée et le réglage de marche du scénario, dans le budget.`,
    );
    out.push(NEEDS_NO_MARK_TEXT);
    if (od) out.push("Trajet vers l'arrêt le plus desservi de l'astre (exemple de trajet), pas vers chaque commune du pôle.");
  }
  if (selected.includes('station')) out.push(NEEDS_NO_STATION_TEXT);
  if (selected.some((b) => b === 'audio' || b === 'visual') && state.kind !== 'signs_only') out.push(NEEDS_SIGNS_TEXT);
  out.push(NEEDS_ALWAYS_TEXT);
  return out;
}

/** Texte lu par les lecteurs d'écran sur un astre marqué : la marque dite en mots, jamais seulement en forme. */
export const NEEDS_MARK_ARIA =
  'marque : tout ce que vous avez coché est déclaré rempli sur le trajet le plus rapide, aller et retour ; à confirmer avant de partir';

/* ------------------------------------------------------------------ panneau de l'astre */

/** État d'une case sur un sens du trajet, en mots (panneau) ; « non renseigné » pour l'absence, jamais « non ». */
export function boxStateText(state: BoxState): string {
  switch (state) {
    case 'filled':
      return 'rempli sur tout le trajet';
    case 'not_filled':
      return 'non rempli : au moins une source déclare le contraire';
    case 'not_stated':
      return 'non renseigné : au moins une valeur absente de la source';
    case 'no_station':
      return 'aucune gare ferrée du jeu sur ce trajet, la case ne bloque pas';
    case 'no_ride':
      return 'aucun transport en commun sur ce trajet, rien de déclaré';
  }
}

/** Une ligne par case cochée pour un sens du trajet : « Annonces sonores : rempli sur tout le trajet ». */
export function tripSummaryLines(legs: Legs, selected: readonly NeedId[]): string[] {
  return NEED_ORDER.filter((b) => selected.includes(b)).map((b) => `${NEED_LABEL[b]} : ${boxStateText(boxState(b, legs))}`);
}

/**
 * Phrase du panneau sur la marque de l'astre (aller ET retour, budget du scénario) ; null si aucune case n'est cochée.
 * Jamais « accessible » : seulement ce que déclarent les sources.
 */
export function astreMarkText(
  out: ItinTrip | null | undefined,
  ret: ItinTrip | null | undefined,
  selected: readonly NeedId[],
  budget: number,
): string | null {
  if (selected.length === 0) return null;
  if (skyNeeds(selected).length === 0) return NEEDS_SIGNS_TEXT;
  if (!out || !ret) return `Aller ou retour non détaillé : pas de marque. ${NEEDS_NO_MARK_TEXT}`;
  return pairMarked(out, ret, selected, budget)
    ? 'Astre marqué : tout ce que vous avez coché parmi les quatre premières cases est déclaré rempli sur le trajet le plus rapide, aller et retour.'
    : NEEDS_NO_MARK_TEXT;
}
