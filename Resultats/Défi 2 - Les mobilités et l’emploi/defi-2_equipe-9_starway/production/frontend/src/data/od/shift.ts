/**
 * Horaires de poste libres (D-019) : fonctions PURES. Toutes les bornes viennent de od/index.json
 * (`starts`, `ends`, `grid.step_min`) ; aucune heure n'est écrite en dur.
 */
import { formatClock, parseClock } from '../proof';
import type { DayType } from '../types';
import type { OdIndex, OdTimeSegment } from './types';

export interface Shift {
  /** Début du poste, minutes depuis minuit (l'aller arrive avant) */
  start: number;
  /**
   * Fin du poste, minutes depuis minuit (le retour part à cette heure). Une fin AVANT le début est
   * le matin suivant (poste de nuit, `isNightShape`) : le retour est alors lu dans les horaires du
   * MÊME mardi type, à cette heure du matin (méthode, docs/limites.md).
   */
  end: number;
}

/**
 * Fenêtre du travail de nuit en droit du travail français (Code du travail, art. L3122-2, en vigueur
 * depuis le 10/08/2016) : la période de travail de nuit « commence au plus tôt à 21 heures et s'achève
 * au plus tard à 7 heures ». Un poste est de nuit s'il tient dans cette fenêtre : début à 21h ou après,
 * fin le lendemain à 7h au plus tard. Ce n'est pas un choix d'interface : c'est la définition légale,
 * sans seuil d'équipe. Minutes depuis minuit.
 */
export const NIGHT_WINDOW = { from: 21 * 60, until: 7 * 60 } as const;

/**
 * Forme d'un poste de nuit (sans les bornes de la table) : la fin est le lendemain matin, donc avant
 * le début, et le poste tient dans `NIGHT_WINDOW`. Pure, sans od/index.json : sert au parsing d'URL.
 */
export function isNightShape(start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && end < start && start >= NIGHT_WINDOW.from && end <= NIGHT_WINDOW.until;
}

/** Le poste finit-il le lendemain matin ? (fin avant le début) */
export function endsNextDay(s: Pick<Shift, 'start' | 'end'>): boolean {
  return s.end < s.start;
}

/** Bornes d'un poste de nuit : début dans [startMin, startMax], fin (lendemain matin) dans [endMin, endMax]. */
export interface NightBounds {
  startMin: number;
  startMax: number;
  endMin: number;
  endMax: number;
}

/**
 * Bornes utilisables des sélecteurs. Les bornes publiées sont `starts.first..starts.last` et
 * `ends.first..ends.last` ; la règle E > S les resserre : un début n'est proposé que s'il existe au
 * moins une fin après lui (S <= ends.last - pas), une fin que s'il existe un début avant elle
 * (E >= starts.first + pas). Les bornes publiées restent dans `published`.
 */
export interface ShiftBounds {
  step: number;
  startMin: number;
  startMax: number;
  endMin: number;
  endMax: number;
  published: { startMin: number; startMax: number; endMin: number; endMax: number };
  /**
   * Postes de nuit (fin le lendemain matin) : `NIGHT_WINDOW` resserrée par les bornes publiées ; null
   * si aucun début ou aucune fin publiés n'y tombe. Le début lit la série aller (tout début de poste
   * publié), la fin lit la série retour déjà présente dans la table : rien à recalculer.
   */
  night: NightBounds | null;
}

function clock(value: string, field: string): number {
  const m = parseClock(value);
  if (m == null) throw new Error(`od/index.json : heure illisible pour ${field} (${value})`);
  return m;
}

/** Bornes des sélecteurs depuis l'index ; null si aucun poste n'est possible (jeu incohérent). */
export function shiftBounds(index: Pick<OdIndex, 'starts' | 'ends' | 'grid'>): ShiftBounds | null {
  const step = index.grid.step_min;
  if (!Number.isInteger(step) || step <= 0) return null;
  const published = {
    startMin: clock(index.starts.first, 'starts.first'),
    startMax: clock(index.starts.last, 'starts.last'),
    endMin: clock(index.ends.first, 'ends.first'),
    endMax: clock(index.ends.last, 'ends.last'),
  };
  const startMax = Math.min(published.startMax, published.endMax - step);
  const endMin = Math.max(published.endMin, published.startMin + step);
  if (startMax < published.startMin || endMin > published.endMax) return null;
  return { step, startMin: published.startMin, startMax, endMin, endMax: published.endMax, published, night: nightBounds(step, published) };
}

/** Plus petite valeur de la grille (`from` + k pas) supérieure ou égale à `v`. */
const gridCeil = (v: number, from: number, step: number) => from + Math.ceil((v - from) / step) * step;
/** Plus grande valeur de la grille (`from` + k pas) inférieure ou égale à `v`. */
const gridFloor = (v: number, from: number, step: number) => from + Math.floor((v - from) / step) * step;

function nightBounds(step: number, p: ShiftBounds['published']): NightBounds | null {
  const startMin = gridCeil(Math.max(p.startMin, NIGHT_WINDOW.from), p.startMin, step);
  const startMax = p.startMax;
  const endMin = gridCeil(p.endMin, p.endMin, step);
  const endMax = gridFloor(Math.min(p.endMax, NIGHT_WINDOW.until), p.endMin, step);
  if (startMin > startMax || endMin > endMax) return null;
  return { startMin, startMax, endMin, endMax };
}

const onStep = (v: number, from: number, step: number) => Number.isInteger(v) && (v - from) % step === 0;

/** Un début de poste calculable (pas de la grille, dans les bornes). */
export function isValidStart(b: ShiftBounds, start: number): boolean {
  return onStep(start, b.startMin, b.step) && start >= b.startMin && start <= b.startMax;
}

/** Une fin de poste calculable (pas de la grille, dans les bornes). */
export function isValidEnd(b: ShiftBounds, end: number): boolean {
  return onStep(end, b.endMin, b.step) && end >= b.endMin && end <= b.endMax;
}

/**
 * Début et fin calculables. Poste du jour : E > S (la grille s'arrête à `ends.last`, donc pas de fin
 * après 22h le jour même). Poste de nuit : fin le lendemain matin (E < S), dans `NIGHT_WINDOW` et dans
 * les bornes publiées (`b.night`) ; toute autre fin avant le début est refusée.
 */
export function isValidShift(b: ShiftBounds, s: Shift): boolean {
  if (endsNextDay(s)) return isValidNightShift(b, s);
  return isValidStart(b, s.start) && isValidEnd(b, s.end) && s.end > s.start;
}

/** Un poste de nuit calculable : début et fin sur la grille, dans la fenêtre légale et les bornes publiées. */
export function isValidNightShift(b: ShiftBounds, s: Shift): boolean {
  const n = b.night;
  if (!n || !isNightShape(s.start, s.end)) return false;
  return onStep(s.start, b.published.startMin, b.step) && s.start >= n.startMin && s.start <= n.startMax && onStep(s.end, b.published.endMin, b.step) && s.end >= n.endMin && s.end <= n.endMax;
}

/** Tous les débuts proposables, au pas de la grille. */
export function startOptions(b: ShiftBounds): number[] {
  const out: number[] = [];
  for (let t = b.startMin; t <= b.startMax; t += b.step) out.push(t);
  return out;
}

/** Toutes les fins proposables, au pas de la grille (sans filtre E > S : voir `changeShift`). */
export function endOptions(b: ShiftBounds): number[] {
  const out: number[] = [];
  for (let t = b.endMin; t <= b.endMax; t += b.step) out.push(t);
  return out;
}

function snap(v: number, from: number, to: number, step: number): number {
  const k = Math.round((v - from) / step);
  return Math.min(to, Math.max(from, from + k * step));
}

export interface ShiftChange {
  shift: Shift;
  /** L'autre borne a été déplacée pour garder E > S */
  adjusted: 'start' | 'end' | null;
}

/**
 * Applique un changement de début OU de fin, ramené sur la grille et dans les bornes. Si la règle
 * E > S n'est plus vraie, l'AUTRE borne est poussée d'un pas (le choix de l'utilisateur est gardé)
 * et `adjusted` le dit (à annoncer à l'écran et au lecteur d'écran).
 *
 * Poste de nuit (fin le lendemain matin) : début et fin restent chacun dans leurs bornes de nuit
 * (`b.night`), l'un n'a aucun effet sur l'autre (la fin est le lendemain) : jamais d'ajustement.
 * Passer du jour à la nuit, ou l'inverse, est un choix explicite : `setNightShift`.
 */
export function changeShift(b: ShiftBounds, current: Shift, change: { start: number } | { end: number }): ShiftChange {
  const n = b.night;
  if (n && endsNextDay(current)) {
    if ('start' in change) return { shift: { start: snap(change.start, n.startMin, n.startMax, b.step), end: current.end }, adjusted: null };
    return { shift: { start: current.start, end: snap(change.end, n.endMin, n.endMax, b.step) }, adjusted: null };
  }
  if ('start' in change) {
    const start = snap(change.start, b.startMin, b.startMax, b.step);
    if (current.end > start && isValidEnd(b, current.end)) return { shift: { start, end: current.end }, adjusted: null };
    return { shift: { start, end: snap(start + b.step, b.endMin, b.endMax, b.step) }, adjusted: 'end' };
  }
  const end = snap(change.end, b.endMin, b.endMax, b.step);
  if (end > current.start && isValidStart(b, current.start)) return { shift: { start: current.start, end }, adjusted: null };
  return { shift: { start: snap(end - b.step, b.startMin, b.startMax, b.step), end }, adjusted: 'start' };
}

/**
 * Bascule explicite poste du jour / poste de nuit. Vers la nuit : début et fin actuels ramenés dans les
 * bornes de nuit (le plus proche de chacun), sans valeur choisie par l'équipe ; null si la table n'a pas
 * de poste de nuit. Vers le jour : `fallback` (la journée-type affichée) si elle est calculable, sinon
 * le premier poste du jour possible (début le plus tôt, une fin un pas après).
 */
export function setNightShift(b: ShiftBounds, current: Shift, night: boolean, fallback?: Shift | null): Shift | null {
  if (night) {
    const n = b.night;
    if (!n) return null;
    return { start: snap(current.start, n.startMin, n.startMax, b.step), end: snap(current.end, n.endMin, n.endMax, b.step) };
  }
  if (fallback && !endsNextDay(fallback) && isValidShift(b, fallback)) return fallback;
  return { start: b.startMin, end: snap(b.startMin + b.step, b.endMin, b.endMax, b.step) };
}

/** Journée-type de meta.json (« 09:00 » - « 17:00 ») en horaire libre, si elle est calculable dans ce jeu. */
export function shiftFromDayType(b: ShiftBounds, day: Pick<DayType, 'start' | 'end'>): Shift | null {
  const start = parseClock(day.start);
  const end = parseClock(day.end);
  if (start == null || end == null) return null;
  const s = { start, end };
  return isValidShift(b, s) ? s : null;
}

/** « 9h-17h », « 6h30-14h15 », « 22h-6h » (poste de nuit : la fin est le lendemain ; tiret simple). */
export function formatShift(s: Shift): string {
  return `${formatClock(s.start)}-${formatClock(s.end)}`;
}

/** Minutes dans une journée (unité d'horloge, pas une donnée) */
const DAY_MIN = 24 * 60;

/** Nom du segment calculé sur le GTFS d'origine dans `index.time_segments` ; les autres (matin, soir) sont sur le réseau de nuit. */
export const DAY_SEGMENT = 'jour';

/**
 * Segments hors `jour` (matin, soir) que lit le poste : la fenêtre de l'aller [début - recul, début - pas] en touche un, ou
 * l'heure de fin y tombe (retour lu à cet instant). Vide sans `time_segments` (ancien export) : rien n'est dit de plus que
 * ce que le jeu publie.
 */
export function nightSegmentsUsed<T extends Pick<OdTimeSegment, 'name' | 'from' | 'to'>>(
  segments: readonly T[] | undefined,
  shift: Shift,
  lookback: number,
  step: number,
): T[] {
  if (!segments) return [];
  const lo = shift.start - lookback;
  const hi = shift.start - step;
  return segments.filter((s) => {
    if (s.name === DAY_SEGMENT) return false;
    const a = parseClock(s.from);
    const b = parseClock(s.to);
    if (a == null || b == null) return false;
    return (lo <= b && hi >= a) || (shift.end >= a && shift.end <= b);
  });
}

/** Le poste lit-il des départs calculés sur un réseau de nuit ou du soir (D-040) ? */
export function usesNightNetwork(
  segments: readonly Pick<OdTimeSegment, 'name' | 'from' | 'to'>[] | undefined,
  shift: Shift,
  lookback: number,
  step: number,
): boolean {
  return nightSegmentsUsed(segments, shift, lookback, step).length > 0;
}

/**
 * Codes de source (manifeste, `gtfs_source` de chaque segment lu) des réseaux de nuit que lit le poste, sans doublon, dans
 * l'ordre de la grille : le matin et le soir ne sont pas sur le même GTFS dérivé. Le code vient des données publiées
 * (`index.time_segments`), jamais écrit ici.
 */
export function nightNetworkSources(
  segments: readonly Pick<OdTimeSegment, 'name' | 'from' | 'to' | 'gtfs_source'>[] | undefined,
  shift: Shift,
  lookback: number,
  step: number,
): string[] {
  const codes = nightSegmentsUsed(segments, shift, lookback, step)
    .map((s) => s.gtfs_source)
    .filter((c): c is string => typeof c === 'string' && c !== '');
  return [...new Set(codes)];
}

/** Durée du poste en texte : 480 → « 8 h », 495 → « 8 h 15 », 45 → « 45 min » ; de nuit, jusqu'au lendemain. */
export function shiftLengthText(s: Shift): string {
  const d = s.end - s.start + (endsNextDay(s) ? DAY_MIN : 0);
  const h = Math.floor(d / 60);
  const m = d % 60;
  if (h === 0) return `${m}\u00a0min`;
  return m === 0 ? `${h}\u00a0h` : `${h}\u00a0h\u00a0${String(m).padStart(2, '0')}`;
}
