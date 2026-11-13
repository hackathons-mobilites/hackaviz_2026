/**
 * Trajets alternatifs du panneau de preuve (D-055, contrat `alternatives-1`) : types et fonctions PURES.
 *
 * Quatre états strictement distincts, par commune, astre, journée et sens : plusieurs trajets, « Calculé, pas d'autre trajet »,
 * « Calcul fait, non affiché » (la case est calculée, mais le trajet A de ce calcul n'est pas l'itinéraire publié : on ne mélange
 * pas deux calculs) et « Pas encore calculé ». Une donnée absente (couverture, fichier, case) donne toujours « Pas encore calculé »,
 * jamais « pas d'autre trajet » ; une case calculée n'est jamais écrite « Pas encore calculé ». A n'est pas répété dans ce contrat :
 * il se lit dans `itineraries/`, au même indice, et `a_lines` vérifie qu'il s'agit bien du même trajet.
 *
 * A s'appelle « Trajet retenu » (retour de Cyril du 11/11, avant « Trajet du calcul »), pas « le plus rapide » : c'est l'itinéraire publié, dont la durée est la plus proche du temps du
 * calcul, et la recherche plus large trouve parfois un trajet B ou C plus court au même départ (méthodologie, § 5 unvicies).
 *
 * Le coût est celui de `data/subscriptions.ts` (abonnements) appliqué à `tickets.cost_eur` (D-028) : un prix inconnu reste inconnu.
 */
import { formatInt } from '../../../data/format';
import type { ItinCo2, ItinLeg, ItinTickets, ItinTrip } from '../../../data/itineraries';
import { seriesAt } from '../../../data/seriesGuard';
import { formatEur, r2, transitLegCost, type ExtraTitle, type LegCost, type SubscriptionsFile, type TransitOption } from '../../../data/subscriptions';
import type { DayTypeId } from '../../../data/types';

export type AltDir = 'out' | 'ret';
export type AltTabId = 'A' | 'B' | 'C';

export const CALC_WITH = 'calcule_avec_alternatives';
export const CALC_WITHOUT = 'calcule_sans_alternative';

/**
 * Libellés des onglets, dans l'ordre (le mot « recommandé » n'est pas employé : aucune donnée ne le définit, D-055). A n'est pas
 * « le plus rapide » : B ou C peut être plus court, et la comparaison le dit (« x min de moins »).
 */
export const ALT_TABS: readonly { id: AltTabId; label: string }[] = [
  { id: 'A', label: 'Trajet retenu' },
  { id: 'B', label: 'Le moins cher' },
  { id: 'C', label: 'Le moins de correspondances' },
];

/** Un trajet du contrat : les champs d'`itineraries/`, sans `status` (B et C sont toujours calculés). */
export interface AltTrip {
  dep: string;
  arr: string;
  min: number;
  rides: number;
  wait_min?: number;
  walk_m?: number | null;
  legs: ItinLeg[];
  tickets: ItinTickets;
  co2_g: ItinCo2;
}

export type AltSlot = AltTrip | { same_as: 'B' } | null;

export interface AltCell {
  state: string;
  a_lines?: (string | null)[];
  B?: AltSlot;
  C?: AltSlot;
  status?: string;
}

export interface AlternativesCoverage {
  contract: string;
  walk_setting?: string;
  suboptimal_min?: number;
  setting_note?: string;
  /** Dossier normal : « réglage de marche « confort » non calculé » ; dossier d'un autre réglage (phase G) : null, rien n'est affiché */
  comfort_note?: string | null;
  poles: string[];
  days: string[];
  dirs: string[];
  /** null = aucune case calculée ; sinon `{ jour: { sens: « une lettre par astre » } }` (`a`, `s`, `n`) */
  communes: Record<string, Record<string, Record<string, string>> | null>;
}

export interface AlternativesFile {
  insee: string;
  contract: string;
  walk_setting?: string;
  /**
   * Dossier d'un réglage autre que le défaut (phase G, ajout du 11/11) : la recherche de départs plus tôt a-t-elle été faite pour
   * cette journée (null : réseau pas calculé) ? Déduit par 06w des paliers finis de la source. Absent dans `alternatives/`.
   */
  earlier_departures?: Partial<Record<DayTypeId, boolean | null>>;
  /** Même chose pour le réglage normal (sources de la phase F), écrit dans le même fichier quand 06w les a lues */
  earlier_departures_normal?: Partial<Record<DayTypeId, boolean | null>>;
  poles: string[];
  days: Partial<Record<DayTypeId, Partial<Record<AltDir, AltCell[]>>>>;
}

/**
 * Écart de palier 2 du réglage confort (11/11) : phrase du « i » des autres trajets quand, pour cette commune et cette journée, les
 * départs plus tôt ont été cherchés en réglage normal et pas dans le réglage lu.
 */
export const ALT_EARLIER_GAP_TEXT =
  "Pour cette commune, en réglage confort, les départs plus tôt n'ont pas été cherchés : il peut y avoir moins d'autres trajets qu'en réglage normal.";

/**
 * Vrai seulement si le fichier dit « non cherché » pour ce réglage et « cherché » pour le réglage normal, à cette journée. Champ
 * absent, null ou fichier du réglage normal : faux (rien n'est écrit).
 */
export function earlierDeparturesGap(file: AlternativesFile | null | undefined, day: DayTypeId): boolean {
  return file?.earlier_departures?.[day] === false && file?.earlier_departures_normal?.[day] === true;
}

export function isCoverageFile(v: unknown): v is AlternativesCoverage {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<AlternativesCoverage>;
  return typeof f.contract === 'string' && f.contract.startsWith('alternatives-coverage-') && Array.isArray(f.poles) && !!f.communes && typeof f.communes === 'object';
}

export function isAlternativesFile(v: unknown): v is AlternativesFile {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<AlternativesFile>;
  return (
    typeof f.contract === 'string' &&
    f.contract.startsWith('alternatives-') &&
    !f.contract.startsWith('alternatives-coverage-') &&
    Array.isArray(f.poles) &&
    !!f.days &&
    typeof f.days === 'object'
  );
}

/**
 * Dossier des autres trajets d'un réglage de marche (D-024, contrat phase G) : réglage par défaut (null) → `alternatives`, autre
 * réglage → `alternatives_{id}` (« comfort » → `alternatives_comfort`), dérivé de l'identifiant publié dans meta.walk_settings.
 * null si l'identifiant n'est pas un nom de dossier sûr (rien n'est alors demandé).
 */
export function alternativesDir(walkSettingId: string | null | undefined): string | null {
  if (!walkSettingId) return 'alternatives';
  return /^[a-z0-9_]+$/.test(walkSettingId) ? `alternatives_${walkSettingId}` : null;
}

/**
 * Un fichier lu dans le dossier d'un réglage autre que le défaut doit dire ce réglage (`walk_setting`, couverture et fichier de
 * commune) : sinon il est traité comme non publié. Réglage par défaut (null) : aucune exigence, comportement d'avant la phase G.
 */
export function matchesWalkSetting(v: { walk_setting?: string } | null | undefined, walkSettingId: string | null | undefined): boolean {
  if (!v) return false;
  return !walkSettingId || v.walk_setting === walkSettingId;
}

/**
 * En réglage de marche autre que le défaut : la couverture de ce réglage sert-elle pour cet astre et cette journée ? Oui si elle est
 * publiée (et du bon réglage, vérifié au chargement) et qu'au moins un sens y est calculé. Sinon (404, commune ou case pas encore
 * calculée) : repli sur le comportement d'avant la phase G (« calculés pour le réglage de marche normal » et le bouton).
 */
export function walkCoverageUsable(cov: AlternativesCoverage | null | undefined, insee: string, poleId: string, day: DayTypeId): boolean {
  if (!cov) return false;
  return coverageLetter(cov, insee, poleId, day, 'out') !== 'n' || coverageLetter(cov, insee, poleId, day, 'ret') !== 'n';
}

/**
 * Dossier des autres trajets que lit le bloc « Trajet » (phase G). `walkKey` : réglage de marche du scénario (null = défaut) ; `walkId` :
 * son identifiant publié dans meta.walk_settings (null s'il n'y est pas) ; `walkCov` : la couverture de ce réglage, null si absente
 * (404), refusée ou pas encore chargée. `walk` : on lit le dossier du réglage ; `fallback` : réglage hors défaut sans trajets pour cette
 * case, le bloc dit « calculés pour le réglage de marche normal » et propose d'y passer ; `default` : dossier `alternatives/`.
 */
export function alternativesSource(a: {
  walkKey: string | null;
  walkId: string | null;
  walkCov: AlternativesCoverage | null | undefined;
  insee: string;
  poleId: string;
  day: DayTypeId;
}): 'default' | 'walk' | 'fallback' {
  if (!a.walkKey) return 'default';
  return a.walkId && walkCoverageUsable(a.walkCov, a.insee, a.poleId, a.day) ? 'walk' : 'fallback';
}

/** Lettre d'une case : `n` dès qu'une information manque (commune, astre, journée, sens, série d'une autre longueur). */
export function coverageLetter(cov: AlternativesCoverage, insee: string, poleId: string, day: DayTypeId, dir: AltDir): 'a' | 's' | 'n' {
  const i = cov.poles.indexOf(poleId);
  if (i < 0) return 'n';
  const series = cov.communes[insee]?.[day]?.[dir];
  if (typeof series !== 'string' || series.length !== cov.poles.length) return 'n';
  const letter = series[i];
  return letter === 'a' || letter === 's' ? letter : 'n';
}

/** Case du fichier de la commune, lue par l'identifiant de l'astre, jamais par une position supposée. */
export function cellOf(file: AlternativesFile | null | undefined, poleId: string, day: DayTypeId, dir: AltDir): AltCell | null {
  if (!file) return null;
  const i = file.poles.indexOf(poleId);
  return i < 0 ? null : seriesAt(file.poles.length, file.days[day]?.[dir], i);
}

/** Suite des lignes de TC d'un trajet, dans l'ordre (la marche n'en fait pas partie). */
export function linesOf(trip: Pick<ItinTrip, 'legs'>): (string | null)[] {
  return (trip.legs ?? []).filter((l) => l.m !== 'walk').map((l) => l.line ?? null);
}

export function sameLines(a: readonly (string | null)[], b: readonly (string | null)[]): boolean {
  return a.length === b.length && a.every((x, i) => (x ?? null) === (b[i] ?? null));
}

function isTrip(s: AltSlot | undefined): s is AltTrip {
  return !!s && 'legs' in s && Array.isArray(s.legs);
}

/** Pourquoi une case calculée n'est pas affichée : le calcul ne retrouve pas l'itinéraire publié, ou il n'y a pas d'itinéraire publié. */
export type AltMismatch = 'other_trip' | 'no_published_trip';

/** Phrases des états sans onglets (une seule source pour le composant, les tests et le vérificateur d'affichage). */
export const ALT_STATE_TEXT = {
  without: "Calculé, pas d'autre trajet",
  pending: 'Pas encore calculé',
  mismatch: 'Calcul fait, non affiché',
} as const;

export const ALT_MISMATCH_TEXT: Record<AltMismatch, string> = {
  other_trip: "ce calcul ne retrouve pas l'itinéraire du panneau",
  no_published_trip: "le panneau n'a pas d'itinéraire détaillé pour ce sens",
};

/** Explication de l'onglet A (bulle « i » des autres trajets). */
export const ALT_CALC_TIP =
  "Le trajet qui sert à dire si le pôle est à portée, aller et retour : ce n'est pas toujours le moins cher ni celui avec le moins de correspondances.";

/** Méthode de l'onglet A, écrite en plus avec le mode sources (D-055 : durée la plus proche du temps calculé ; un autre onglet peut être plus court). */
export const ALT_CALC_METHOD =
  "Itinéraire retenu parce que sa durée est la plus proche du temps de trajet calculé. Un autre onglet peut être plus court.";

export interface ResolvedAlternatives {
  state: 'with' | 'without' | 'mismatch' | 'pending';
  /** Seulement pour `mismatch` */
  mismatch?: AltMismatch;
  /** Trajet A de `itineraries/` (null s'il n'y en a pas) */
  a: ItinTrip | null;
  /** null : mêmes lignes que A, ou pas d'autre trajet */
  b: AltTrip | null;
  c: AltTrip | null;
  cSameAsB: boolean;
}

/**
 * Règle de vérité : un seul chemin mène à « plusieurs trajets » ou à « pas d'autre trajet », celui où la couverture, la case et
 * l'itinéraire A publié racontent la même chose. Case calculée (lettre et état de la case d'accord) dont le trajet A n'est pas
 * l'itinéraire publié : « Calcul fait, non affiché », avec sa raison. Dans tous les autres cas : « Pas encore calculé ».
 */
export function resolveAlternatives(p: { letter: 'a' | 's' | 'n' | null | undefined; cell: AltCell | null | undefined; a: ItinTrip | null }): ResolvedAlternatives {
  const pending: ResolvedAlternatives = { state: 'pending', a: p.a, b: null, c: null, cSameAsB: false };
  const { letter, cell, a } = p;
  if ((letter !== 'a' && letter !== 's') || !cell) return pending;
  if (cell.state !== (letter === 'a' ? CALC_WITH : CALC_WITHOUT)) return pending;
  const mismatch = (why: AltMismatch): ResolvedAlternatives => ({ ...pending, state: 'mismatch', mismatch: why });
  if (!Array.isArray(cell.a_lines)) {
    // Calculé, aucun trajet du tout pour ce sens (`status`, seulement en `s`) : « pas d'autre trajet » si l'itinéraire publié n'en a
    // pas non plus ; s'il en a un, ce calcul ne le retrouve pas
    if (letter !== 's') return pending;
    return a ? mismatch('other_trip') : { ...pending, state: 'without' };
  }
  if (!a) return mismatch('no_published_trip');
  if (!sameLines(cell.a_lines, linesOf(a))) return mismatch('other_trip');
  if (letter === 's') return { ...pending, state: 'without' };
  const b = isTrip(cell.B) ? cell.B : null;
  const cSameAsB = !!cell.C && 'same_as' in cell.C && cell.C.same_as === 'B' && !!b;
  const c = cSameAsB ? b : isTrip(cell.C) ? cell.C : null;
  if (!b && !c) return pending;
  return { state: 'with', a, b, c, cSameAsB };
}

/** B et C sont calculés (pas de `status` dans le contrat) : forme attendue par les fonctions d'`itineraries` et par `TripBand`. */
export function asItinTrip(t: AltTrip): ItinTrip {
  return { ...t, status: 'ok' };
}

/** Ce que la personne paie pour ce sens, selon son abonnement (null : tickets à l'unité). */
export function tripCost(trip: ItinTrip, option: TransitOption | null, file: SubscriptionsFile | null): LegCost {
  return transitLegCost(trip, option, file?.transit.extra_titles ?? {}, file?.transit.unpriced_agencies ?? {});
}

export interface FactText {
  value: string;
  note: string | null;
}

/** Prix d'un trajet : un prix inconnu est écrit tel quel, jamais 0, jamais estimé. */
export function costText(c: LegCost, option: TransitOption | null, extra: Record<string, ExtraTitle>, ticketDetail: string | null): FactText {
  const label = option?.label ?? 'abonnement';
  if (c.extra_eur === null || c.status === 'unknown' || c.status === 'no_trip') {
    return { value: 'Prix inconnu', note: c.reasons.length ? `${c.reasons.join(' ; ')}.` : null };
  }
  const value = formatEur(c.extra_eur);
  if (c.status === 'included') return { value, note: `Inclus dans votre ${label}.` };
  if (c.status === 'extra') {
    const what = c.items.map((i) => `${i.count > 1 ? `${i.count} x ` : ''}${extra[i.title]?.label ?? i.title}`).join(', ');
    return { value, note: `En plus de votre ${label} : ${what}, non couvert.` };
  }
  return { value, note: `Au ticket, plein tarif${ticketDetail ? ` (${ticketDetail})` : ''}${c.street_transfer_unverified ? ', correspondance par la rue à vérifier' : ''}.` };
}

/** Carbone d'un sens (ENV01) : valeur publiée, sinon la raison publiée. */
export function carbonText(co2: ItinCo2 | null | undefined): FactText {
  // V4 (audit du 11/11) : le carbone TC est une estimation (facteur moyen IDFM), jamais une mesure du trajet
  if (co2?.status === 'ok' && typeof co2.value === 'number' && Number.isFinite(co2.value)) return { value: `${formatInt(co2.value)}\u00a0g CO2e (estimation)`, note: null };
  return { value: 'Inconnu', note: co2?.reason ? `Carbone non calculé : ${co2.reason}.` : 'Carbone non calculé.' };
}

/** Nombre de montées d'un trajet : `rides` publié, sinon les tronçons hors marche. */
export function ridesOf(t: Pick<ItinTrip, 'rides' | 'legs'>): number {
  return typeof t.rides === 'number' ? t.rides : (t.legs ?? []).filter((l) => l.m !== 'walk').length;
}

export function transfersText(rides: number): string {
  if (rides <= 0) return 'À pied';
  if (rides === 1) return 'Sans correspondance';
  return rides === 2 ? '1 correspondance' : `${rides - 1} correspondances`;
}

function timeDelta(a: number | undefined, other: number | undefined): string | null {
  if (typeof a !== 'number' || typeof other !== 'number') return null;
  const d = other - a;
  if (d === 0) return 'même durée';
  return `${Math.abs(d)}\u00a0min de ${d > 0 ? 'plus' : 'moins'}`;
}

function priceDelta(a: LegCost, other: LegCost): string | null {
  if (a.extra_eur === null || other.extra_eur === null) return null;
  const d = r2(Math.abs(other.extra_eur - a.extra_eur));
  if (d === 0) return 'même prix';
  return `${formatEur(d)} de ${other.extra_eur > a.extra_eur ? 'plus' : 'moins'}`;
}

function transfersDelta(a: number, other: number): string {
  const d = other - a;
  if (d === 0) return 'autant de correspondances';
  const n = Math.abs(d);
  return `${n} correspondance${n > 1 ? 's' : ''} de ${d > 0 ? 'plus' : 'moins'}`;
}

/**
 * Comparaison courte avec le trajet retenu (A), tirée des données : « Par rapport au trajet retenu : 2,55 € de moins, 15 min
 * de plus. » ; un B ou un C plus court est dit tel quel (« 1 min de moins »). Un écart qui ne peut pas être calculé (prix inconnu)
 * n'est pas écrit. null s'il ne reste rien à dire.
 */
export function compareText(tab: AltTabId, a: ItinTrip, aCost: LegCost, other: ItinTrip, otherCost: LegCost): string | null {
  if (tab === 'A') return null;
  const lead = tab === 'B' ? priceDelta(aCost, otherCost) : transfersDelta(ridesOf(a), ridesOf(other));
  const parts = [lead, timeDelta(a.min, other.min)].filter((p): p is string => !!p);
  return parts.length ? `Par rapport au trajet retenu : ${parts.join(', ')}.` : null;
}

/** Phrase de l'onglet B ou C quand il n'a pas de trajet propre (null dans le contrat : mêmes lignes que A, ou A le bat sur son critère). */
export function sameAsCalcText(tab: 'B' | 'C', a: ItinTrip): string {
  if (tab === 'C') return 'Le trajet retenu est aussi celui qui a le moins de correspondances.';
  return a.tickets?.cost_eur == null ? "Aucun trajet de cette recherche n'a de prix connu." : 'Le trajet retenu est aussi le moins cher.';
}
