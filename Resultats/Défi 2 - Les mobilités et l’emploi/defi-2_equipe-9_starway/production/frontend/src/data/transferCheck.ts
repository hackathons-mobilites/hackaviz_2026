/**
 * Correspondances plus courtes que le minimum officiel (D-031, option c, appliquée le 04/11) : types et
 * textes, fonctions PURES.
 *
 * Contrat : `itineraries/{insee}.json` en `itineraries-2`, écrit par `pipeline/scripts/06t_export_transfer_check.py`
 * à partir du contrôle `07h_transfer_times_check.py` ; chaque trajet `status: ok` porte `transfer_check`, le fichier
 * porte `transfer_check_meta`, et `meta.transfer_check` annonce le marquage. Rien n'est recalculé ici : le ciel et
 * les durées publiées ne changent pas. Un verdict allumé est « à vérifier » si un sens a une correspondance trop
 * courte et que sa borne (même itinéraire recalé sur les mêmes lignes en respectant les minimums) dépasse le budget,
 * ou n'existe pas : règle de 07h, valable pour tout budget de la jauge (D-018). La borne est pessimiste : le
 * calculateur d'IDFM trouve souvent un autre itinéraire, plus rapide. « À vérifier » n'est pas « faux ».
 */
import type { ItinTrip } from './itineraries';

/** `gtfs` : fichier transfers.txt des horaires IDFM ; `navitia` : durée du calculateur d'IDFM (même arrêt). */
export type TransferSource = 'gtfs' | 'navitia';
export type TransferTripStatus = 'short' | 'verified' | 'partly_unverified' | 'no_transfer';
/** Pas de borne : aucune course des mêmes lignes, au-delà de l'horizon de calcul, ou départ hors de la fenêtre. */
export type BoundReason = 'no_run' | 'over_max' | 'over_lookback';

export interface ShortTransfer {
  /** Quai de descente (nom GTFS) */
  at: string;
  /** Quai de montée */
  to: string;
  /** Départ du tronçon suivant moins arrivée du précédent (s) */
  available_s: number;
  min_s: number;
  source: TransferSource;
}

export interface TransferCheck {
  status: TransferTripStatus;
  short?: ShortTransfer[];
  /** Correspondances sans minimum connu (ni ligne transfers.txt, ni durée Navitia) */
  unverified?: number;
  /** Trajet `short` : borne recalée (min) ; null avec `bound_reason` */
  bound_min?: number | null;
  bound_reason?: BoundReason;
}

/** `meta.transfer_check` et `transfer_check_meta` des fichiers. */
export interface TransferCheckMeta {
  rule: 'gtfs' | 'reference';
  checked_at: string;
  service_date: string;
  walk_setting: string;
  sources: string[];
  contract?: string;
}

type Side = 'out' | 'ret';

/** Annonce du marquage dans meta.json (absente : rien n'est affiché, ni marque ni phrase). */
export function transferCheckMeta(meta: unknown): TransferCheckMeta | null {
  const tc = (meta as { transfer_check?: unknown } | null)?.transfer_check as Partial<TransferCheckMeta> | undefined;
  return tc && (tc.rule === 'gtfs' || tc.rule === 'reference') && typeof tc.checked_at === 'string' ? (tc as TransferCheckMeta) : null;
}

const STATUSES: readonly TransferTripStatus[] = ['short', 'verified', 'partly_unverified', 'no_transfer'];

/** Marque d'un trajet publié, seulement si elle suit le contrat (sinon null : rien d'affiché). */
export function transferCheckOf(trip: ItinTrip | null | undefined): TransferCheck | null {
  const tc = (trip as { transfer_check?: unknown } | null | undefined)?.transfer_check as Partial<TransferCheck> | undefined;
  if (!tc || !STATUSES.includes(tc.status as TransferTripStatus)) return null;
  if (tc.status === 'short' && (!Array.isArray(tc.short) || tc.short.length === 0)) return null;
  return tc as TransferCheck;
}

/** 90 → « 1 min 30 », 300 → « 5 min », 184 → « 3 min 04 », 45 → « 45 s » (espaces insécables). */
export function secondsText(s: number): string {
  const v = Math.max(0, Math.round(s));
  if (v < 60) return `${v}\u00a0s`;
  const m = Math.floor(v / 60);
  const r = v % 60;
  return r === 0 ? `${m}\u00a0min` : `${m}\u00a0min\u00a0${String(r).padStart(2, '0')}`;
}

const sideWord = (side: Side) => (side === 'out' ? 'Aller' : 'Retour');

/** « à La Défense » (même quai ou même nom), sinon « entre Auber et Haussmann Saint-Lazare ». */
function placeText(t: Pick<ShortTransfer, 'at' | 'to'>): string {
  return t.at === t.to ? `à ${t.at}` : `entre ${t.at} et ${t.to}`;
}

/**
 * Une phrase par correspondance trop courte : « Retour : correspondance de 3 min 04 à La Défense : le
 * calculateur d'IDFM en exige 5 min ; ce trajet peut être plus long. » La source du minimum est dite.
 */
export function shortTransferText(t: ShortTransfer, side: Side): string {
  const min = secondsText(t.min_s);
  const rule = t.source === 'navitia' ? `le calculateur d'IDFM en exige ${min}` : `le minimum publié par IDFM est de ${min}`;
  return `${sideWord(side)} : correspondance de ${secondsText(t.available_s)} ${placeText(t)} : ${rule} ; ce trajet peut être plus long.`;
}

/** Pourquoi il n'y a pas de borne (raison publiée par 07h), phrase complète. */
function noBoundText(reason: BoundReason | undefined, side: Side, maxTripMin: number | null | undefined): string {
  const head = `${sideWord(side)} : en respectant les minimums d’IDFM`;
  switch (reason) {
    case 'over_max':
      return typeof maxTripMin === 'number' && maxTripMin > 0
        ? `${head}, le même trajet dépasserait ${maxTripMin}\u00a0min.`
        : `${head}, le même trajet dépasserait la durée maximale du calcul.`;
    case 'over_lookback':
      return `${head}, il faudrait partir plus tôt que les départs étudiés par le calcul.`;
    case 'no_run':
    default:
      return side === 'out'
        ? `${head}, aucune course des mêmes lignes n’arrive avant le début du poste.`
        : `${head}, aucune course des mêmes lignes ne permet de finir ce trajet ce jour-là.`;
  }
}

export interface SideRisk {
  side: Side;
  /** Borne (min) ; null : aucune borne (voir `reason`) */
  bound: number | null;
  reason?: BoundReason;
  /** La borne dépasse le budget (ou n'existe pas) : le verdict allumé est à vérifier */
  atRisk: boolean;
}

/** Sens qui ont une correspondance trop courte, avec leur borne, et s'ils mettent le verdict à vérifier au budget. */
export function sideRisks(out: TransferCheck | null, ret: TransferCheck | null, budget: number): SideRisk[] {
  const res: SideRisk[] = [];
  for (const [side, tc] of [
    ['out', out],
    ['ret', ret],
  ] as const) {
    if (!tc || tc.status !== 'short') continue;
    const b = typeof tc.bound_min === 'number' && Number.isFinite(tc.bound_min) ? tc.bound_min : null;
    res.push({ side, bound: b, reason: b == null ? tc.bound_reason : undefined, atRisk: b == null || b > budget });
  }
  return res;
}

/** Verdict allumé (aller et retour dans le budget) à vérifier : règle de 07h (`verdict_at_risk`). */
export function verdictAtRisk(lit: boolean, out: TransferCheck | null, ret: TransferCheck | null, budget: number): boolean {
  return lit && sideRisks(out, ret, budget).some((r) => r.atRisk);
}

/** Marque discrète de l'en-tête (texte, pas seulement une couleur). */
export const RISK_BADGE_TEXT = 'À vérifier : correspondance plus courte que le minimum d’IDFM';

/**
 * Phrase de la borne d'un sens. Avec `budget` (verdict allumé de la matrice) : dit si la borne dépasse le budget ;
 * sans (table commune par commune : le verdict ne vient pas de cet itinéraire), la borne seule.
 */
export function boundText(r: SideRisk, budget: number | null, maxTripMin: number | null | undefined): string {
  const who = r.side === 'out' ? "l'aller" : 'le retour';
  if (r.bound == null) return noBoundText(r.reason, r.side, maxTripMin);
  const head = `En respectant les minimums d’IDFM par les mêmes lignes, ${who} prendrait au plus ${r.bound}\u00a0min`;
  if (budget == null) return `${head}.`;
  return r.bound > budget ? `${head}, au-delà de ${budget}\u00a0min.` : `${head} : il reste dans les ${budget}\u00a0min.`;
}

/** Garde de la borne, toujours affichée avec un verdict à vérifier. */
export const RISK_GUARD =
  'Il reste allumé (durées du calcul) : en respectant les minimums d’IDFM, le même trajet ne tiendrait pas dans le temps choisi. Cette borne est pessimiste, le calculateur d’IDFM trouve souvent un autre itinéraire, plus rapide. À vérifier ne veut pas dire faux.';

/** Résumé d'un sens sans correspondance trop courte ; null s'il n'y a rien à dire (aucune correspondance). */
export function statusText(tc: TransferCheck | null, side: Side): string | null {
  if (!tc) return null;
  const s = side === 'out' ? 'aller' : 'retour';
  if (tc.status === 'verified') return `Correspondances (${s}) : toutes respectent le minimum d’IDFM.`;
  if (tc.status === 'partly_unverified') {
    const n = tc.unverified ?? 0;
    return `Correspondances (${s}) : aucune trop courte ; ${n > 1 ? `${n} sans minimum connu` : 'une sans minimum connu'} (ni dans les horaires IDFM, ni relevé auprès de son calculateur).`;
  }
  return null;
}

/** Source des minimums (texte affiché sous le bloc), selon la règle et les sources réellement citées. */
export function minimumSourceText(meta: TransferCheckMeta, sources: readonly TransferSource[]): string {
  const parts: string[] = [];
  if (sources.includes('gtfs')) parts.push('minimum publié par IDFM pour chaque couple de quais (horaires GTFS, fichier transfers.txt)');
  if (sources.includes('navitia')) parts.push("au même arrêt, durée de correspondance du calculateur d'IDFM (Navitia, API PRIM)");
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta.checked_at);
  const when = date ? `, contrôle du ${date[3]}/${date[2]}/${date[1]}` : '';
  return parts.length ? `Source : ${parts.join(' ; ')}${when}.` : `Contrôle des correspondances${when}.`;
}

/** Code de `sources.json` des horaires GTFS d'IDFM (transfers.txt). */
const GTFS_CODE = 'TRA01';
/** Repli si `meta.transfer_check.sources` ne cite pas les réponses « connections » de Navitia (ligne TRA02B du manifeste, contrat du 10/11). */
const NAVITIA_FALLBACK_CODE = 'TRA02B';

/**
 * Codes de `sources.json` à citer pour les minimums réellement utilisés, lus dans `meta.transfer_check.sources`
 * (contrat itineraries-2) : `gtfs` cite TRA01 ; `navitia` cite le code du manifeste publié à côté de TRA01
 * (TRA02B depuis le 10/11), à défaut TRA02B. Aucune source utilisée : TRA01 (règle du contrôle).
 */
export function transferSourceCodes(meta: TransferCheckMeta, used: readonly TransferSource[]): string[] {
  const listed = Array.isArray(meta.sources) ? meta.sources.filter((c): c is string => typeof c === 'string') : [];
  const navitia = listed.find((c) => c !== GTFS_CODE) ?? NAVITIA_FALLBACK_CODE;
  const codes = (used.length ? used : (['gtfs'] as const)).map((s) => (s === 'navitia' ? navitia : GTFS_CODE));
  return [...new Set(codes)];
}

/** Horaires libres (table commune par commune) : les correspondances ne sont pas contrôlées, et on le dit. */
export const SHIFT_NOT_COVERED_TEXT =
  'Correspondances non contrôlées pour ces horaires : le contrôle des minimums d’IDFM porte sur les itinéraires des journées-types.';

/** Commune par commune : le contrôle porte sur l'exemple de trajet, pas sur les temps vers chaque commune. */
export const OD_SCOPE_TEXT = 'Contrôle fait sur cet exemple de trajet seulement : les temps vers chaque commune du pôle ne sont pas contrôlés.';
