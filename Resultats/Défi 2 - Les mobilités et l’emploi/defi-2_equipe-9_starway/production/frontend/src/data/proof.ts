/**
 * Panneau de preuve : fonctions PURES (sans React ni DOM).
 * Tout ce qui est affiché vient de poles.json, communes.json, meta.json, access/{insee}.json et
 * context/{insee}.json. Les heures d'arrivée sont DÉRIVÉES (départ + durée), jamais supposées.
 */
import type { PoleState } from './accessibility';
import type { Commune, CommuneOrigin, ContextFile, ContextStatus, FlowToPole, NullReason, Pole, SourceEntry } from './types';
import { OSM_CREDIT } from './attribution';
import { walkClause } from './walkSettings';

export { walkDistanceText } from './walkSettings';

/* ------------------------------------------------------------------ heures */

/**
 * Heure lue dans la matrice : "HH:MM", "HH:MM:SS", "AAAA-MM-JJ HH:MM:SS" ou ISO "AAAA-MM-JJTHH:MM…".
 * Renvoie des minutes depuis minuit, ou null si illisible.
 */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 495 → « 8h15 », 540 → « 9h », 1441 → « 0h01 » (au-delà de minuit, on revient à 0h). */
export function formatClock(minutes: number): string {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ verdict */

export type LegIssue = 'ok' | 'too_long' | 'none';

export interface ProofVerdict {
  kind: 'accessible' | 'blocked' | 'unknown';
  out: LegIssue;
  ret: LegIssue;
  /** Titre court (« Retour trop long »…) */
  title: string;
  /** Explication mesurée, une phrase */
  detail: string;
}

function leg(v: number | null, budget: number): LegIssue {
  if (v == null) return 'none';
  return v <= budget ? 'ok' : 'too_long';
}

/**
 * Horizon de recherche publié (meta.max_trip_min) en texte : 120 → « 2 h », 90 → « 90 min ».
 * null si absent ou illisible : on n'affiche alors aucune borne (jamais de valeur par défaut).
 */
export function tripLimitText(maxTripMin: number | null | undefined): string | null {
  if (typeof maxTripMin !== 'number' || !Number.isFinite(maxTripMin) || maxTripMin <= 0) return null;
  const n = Math.round(maxTripMin);
  return n % 60 === 0 ? `${n / 60}\u00a0h` : `${n}\u00a0min`;
}

/** « en moins de 2 h » si l'horizon est publié, sinon rien. */
export function withinLimit(maxTripMin: number | null | undefined): string {
  const t = tripLimitText(maxTripMin);
  return t ? ` en moins de ${t}` : '';
}

/** Sens d'un trajet : aller (arriver avant le début du poste) ou retour (partir après la fin). */
export type TripLeg = 'out' | 'ret';

/**
 * « Aucun trajet » dit exactement ce que le calcul a cherché (docs/methodologie.md, `reason`) :
 * - aller : aucun départ de la grille, dans les `max_trip_min` qui précèdent le début du poste,
 *   n'arrive à l'heure ;
 * - retour : aucune arrivée dans les `max_trip_min` qui suivent la fin du poste (attente comprise) ;
 * - mode indépendant de l'heure (marche, vélo, voiture, Vélib') : aucun trajet de `max_trip_min` ou moins.
 * TC (D-024) : le réglage de marche est cité (« avec au plus 3 km à pied à chaque bout », distance
 * `leg_limit_m` du réglage en vigueur), parce que le résultat en dépend. Sans borne publiée, aucune
 * durée n'est citée ; sans réglage, aucune distance.
 */
export function noTripText(leg: TripLeg, maxTripMin: number | null | undefined, timeDependent = true, walkLegM?: number | null): string {
  const t = tripLimitText(maxTripMin);
  const w = walkClause(walkLegM);
  const tail = w ? `, ${w}` : '';
  if (!timeDependent) return `${t ? `aucun trajet trouvé en ${t} ou moins` : 'aucun trajet trouvé'}${tail}`;
  if (leg === 'out') {
    return `${t ? `aucun départ dans les ${t} avant le début du poste n’arrive à l’heure` : 'aucun départ trouvé qui arrive avant le début du poste'}${tail}`;
  }
  return `${t ? `aucune arrivée trouvée dans les ${t} après la fin du poste` : 'aucune arrivée trouvée après la fin du poste'}${tail}`;
}

/** Ce dont les textes de raison ont besoin, tout lu dans meta.json. */
export interface ReasonContext {
  maxTripMin?: number | null;
  /** false : mode indépendant de l'heure (marche, vélo, voiture, Vélib') */
  timeDependent?: boolean;
  /** TC (D-024) : distance de chaque trajet à pied du réglage en vigueur (`leg_limit_m`) ; absent : non citée */
  walkLegM?: number | null;
}

/** Contexte des raisons depuis meta.json et le réglage de marche en vigueur (SkyView.walkSetting). */
export function reasonContext(
  meta: { max_trip_min?: number } | null | undefined,
  timeDependent = true,
  walkSetting?: { leg_limit_m: number } | null,
): ReasonContext {
  return { maxTripMin: meta?.max_trip_min ?? null, timeDependent, walkLegM: walkSetting?.leg_limit_m ?? null };
}

/**
 * Raison(s) d'un pôle non accessible, sens par sens, en une ligne (liste du ciel, infobulle,
 * aria-label, carte miroir) : texte du premier sens nul (convention `reasonLeg`).
 * null si aucun sens n'est nul ou si aucune raison n'est publiée.
 */
export function stateReasonText(state: Pick<PoleState, 'out' | 'ret' | 'reason'>, ctx: ReasonContext = {}): string | null {
  if (!state.reason || (state.out != null && state.ret != null)) return null;
  return reasonText(state.reason, ctx.maxTripMin, reasonLeg(state), ctx.timeDependent ?? true, ctx.walkLegM);
}

/** Sens auquel s'applique la raison d'un pôle (la raison vaut dès que `out` ou `ret` est nul). */
export function reasonLeg(state: Pick<PoleState, 'out' | 'ret'>): TripLeg {
  return state.out == null ? 'out' : 'ret';
}

export function reasonText(
  reason: NullReason,
  maxTripMin: number | null | undefined,
  leg: TripLeg = 'out',
  timeDependent = true,
  walkLegM?: number | null,
): string {
  switch (reason) {
    case 'no_trip_within_120':
      return noTripText(leg, maxTripMin, timeDependent, walkLegM);
    case 'no_service_at_hour':
      return 'pas de service à cette heure';
    case 'origin_not_snapped':
      return 'point de départ non raccordé au réseau';
    case 'not_computed':
      return 'non calculé';
  }
}

/**
 * Verdict dans les contraintes choisies, avec la raison MESURÉE :
 * aller trop long, retour trop long, les deux, ou aucun trajet trouvé (sens par sens).
 */
export function proofVerdict(
  state: Pick<PoleState, 'status' | 'out' | 'ret' | 'reason'>,
  budget: number,
  maxTripMin?: number | null,
  /** false : mode indépendant de l'heure (marche, vélo, voiture, Vélib'), pas de début ni de fin de poste à citer */
  timeDependent = true,
  /** TC (D-024) : distance `leg_limit_m` du réglage de marche en vigueur, citée quand un sens est nul */
  walkLegM?: number | null,
): ProofVerdict {
  if (state.status === 'unknown') {
    return {
      kind: 'unknown',
      out: 'none',
      ret: 'none',
      title: 'Non calculé',
      detail: 'Aucun temps de trajet n’est encore disponible pour ce scénario.',
    };
  }
  const o = leg(state.out, budget);
  const r = leg(state.ret, budget);
  if (o === 'ok' && r === 'ok') {
    return {
      kind: 'accessible',
      out: o,
      ret: r,
      title: `Accessible aller et retour en ${budget} min ou moins par sens`,
      detail: `Aller ${state.out} min et retour ${state.ret} min : chacun en ${budget} min ou moins.`,
    };
  }
  const reason = (l: TripLeg) => (state.reason ? reasonText(state.reason, maxTripMin, l, timeDependent, walkLegM) : 'aucun trajet trouvé');
  const part = (name: 'aller' | 'retour', issue: LegIssue, v: number | null): string | null => {
    if (issue === 'too_long') return `${name} ${v} min (${v! - budget} min au-delà)`;
    if (issue === 'none') return `${name} : ${reason(name === 'aller' ? 'out' : 'ret')}`;
    return null;
  };
  const OUT: Record<LegIssue, string> = { ok: '', too_long: 'aller trop long', none: 'aucun trajet trouvé à l’aller' };
  const RET: Record<LegIssue, string> = { ok: '', too_long: 'retour trop long', none: 'aucun trajet trouvé au retour' };
  const t =
    o === 'too_long' && r === 'too_long'
      ? 'aller et retour trop longs'
      : o === 'none' && r === 'none'
        ? 'aucun trajet trouvé'
        : [OUT[o], RET[r]].filter(Boolean).join(', ');
  const title = `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  const parts = [part('aller', o, state.out), part('retour', r, state.ret)].filter((x): x is string => !!x);
  const sentence = parts.join(' ; ');
  return {
    kind: 'blocked',
    out: o,
    ret: r,
    title,
    detail: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}, avec ${budget} min au plus par sens.`,
  };
}

/* ------------------------------------------------------------------ trajets */

export interface LegTimes {
  /** Minutes depuis minuit ; null si inconnu */
  depart: number | null;
  arrive: number | null;
}

/**
 * Aller : départ = champ `dep` de la matrice (le plus tardif qui arrive avant le début du poste) ;
 * arrivée = départ + durée. Sans `dep`, seule la contrainte « avant le début » est connue.
 */
export function outboundTimes(dep: string | null | undefined, out: number | null): LegTimes {
  const d = parseClock(dep);
  return { depart: d, arrive: d != null && out != null ? d + out : null };
}

/** Retour : départ à la fin du poste (journée-type), arrivée = fin + durée (attente comprise). */
export function returnTimes(end: string, ret: number | null): LegTimes {
  const e = parseClock(end);
  return { depart: e, arrive: e != null && ret != null ? e + ret : null };
}

/** Domaine commun des barres aller / retour : [0, max(aller, retour, budget)] (dérivé des données). */
export function barDomain(out: number | null, ret: number | null, budget: number): number {
  return Math.max(budget, out ?? 0, ret ?? 0);
}

/** 495 → « 08:15 » (heures du bloc « Temps de trajet » de la maquette ; au-delà de minuit, retour à 00:00). */
export function formatHHMM(minutes: number): string {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** « 08:15 → 08:57 » ; null si le départ ou l'arrivée n'est pas connu (rien n'est supposé). */
export function clockRange(t: LegTimes): string | null {
  if (t.depart == null || t.arrive == null) return null;
  return `${formatHHMM(t.depart)} → ${formatHHMM(t.arrive)}`;
}

/* ------------------------------------------------------------------ en-tête et badge (maquette) */

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** "2026-11-17" → « mardi » (jour de la semaine de la date de service, calendrier grégorien) ; null si illisible. */
export function serviceWeekday(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  return WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] ?? null;
}

/** « 9h-17h » depuis deux heures "HH:MM" (texte brut en repli si illisible). */
export function shiftText(start: string, end: string): string {
  const s = parseClock(start);
  const e = parseClock(end);
  return `${s == null ? start : formatClock(s)}-${e == null ? end : formatClock(e)}`;
}

export interface ContextLineInput {
  /** Noms courts des communes de départ (une, ou deux en diptyque) */
  origins: readonly string[];
  /** « 9h-17h » ; absent : non cité */
  shift?: string | null;
  /** Journée-type (scénario) ou horaires libres (D-019) */
  shiftKind?: 'day_type' | 'free';
  /** meta.service_date : jour de la semaine des horaires IDFM utilisés */
  serviceDate?: string | null;
  /** false : marche, vélo, voiture, Vélib' (aucun horaire dans le calcul) */
  timeDependent: boolean;
}

/**
 * Sous-titre de l'en-tête : « Depuis Montreuil · journée 9h-17h · mardi type ». Le jour vient de
 * meta.service_date (horaires théoriques d'un jour de semaine). Un mode sans horaire s'arrête à « Depuis Montreuil » (audit d'affichage
 * du 11/11, P4 : « Durée indépendante de l'heure » est dite une fois, dans « Méthode et sources »).
 */
export function proofContextLine(i: ContextLineInput): string {
  const parts: string[] = [];
  if (i.origins.length) parts.push(`Depuis ${i.origins.join(' et ')}`);
  if (!i.timeDependent) return parts.join(' · ');
  if (i.shift) parts.push(i.shiftKind === 'free' ? `horaires ${i.shift}` : `journée ${i.shift}`);
  const wd = serviceWeekday(i.serviceDate);
  if (wd) parts.push(`${wd} type`);
  return parts.join(' · ');
}

export type BadgeKind = 'accessible' | 'out_only' | 'in_only' | 'blocked' | 'unknown';

export interface ProofBadge {
  kind: BadgeKind;
  text: string;
}

/**
 * Badge d'état de l'en-tête, toujours égal au verdict : « Accessible · aller et retour ≤ 45 min »,
 * sinon le titre exact du verdict (« Retour trop long », « Aucun trajet trouvé au retour »…).
 * `out_only` : l'aller tient, pas le retour ; `in_only` : le retour tient, pas l'aller.
 */
export function proofBadge(v: ProofVerdict, budget: number): ProofBadge {
  if (v.kind === 'accessible') return { kind: 'accessible', text: `Accessible · aller et retour ≤ ${budget}\u00a0min` };
  if (v.kind === 'unknown') return { kind: 'unknown', text: v.title };
  const kind: BadgeKind = v.out === 'ok' ? 'out_only' : v.ret === 'ok' ? 'in_only' : 'blocked';
  return { kind, text: v.title };
}

export interface LongestLeg {
  leg: TripLeg;
  minutes: number;
  within: boolean;
  /** Remplissage de la barre (0 à 1) : minutes / max(minutes, temps choisi) */
  fill: number;
  /** Position du repère du temps choisi (0 à 1) */
  mark: number;
  text: string;
}

/**
 * Sens le plus long, comparé au temps choisi par sens : « Sens le plus long : 42 min, pour 45 min au
 * plus par sens ». null si un sens n'a pas de durée (le verdict dit alors pourquoi) : pas de barre
 * fabriquée. Égalité : l'aller.
 */
export function longestLeg(out: number | null, ret: number | null, budget: number): LongestLeg | null {
  if (out == null || ret == null || !(budget > 0)) return null;
  const leg: TripLeg = ret > out ? 'ret' : 'out';
  const minutes = Math.max(out, ret);
  const within = minutes <= budget;
  const domain = Math.max(minutes, budget);
  const over = within ? '' : ` (${minutes - budget}\u00a0min au-delà)`;
  return {
    leg,
    minutes,
    within,
    fill: minutes / domain,
    mark: budget / domain,
    text: `Sens le plus long : ${minutes}\u00a0min${over}, pour ${budget}\u00a0min au plus par sens`,
  };
}

/* ------------------------------------------------------------------ communes du pôle */

/** « Paris 8e Arrondissement » → « Paris 8e » (affichage court, le code INSEE reste la clé). */
export function shortCommuneName(name: string): string {
  return name.replace(/\s+Arrondissement$/i, '');
}

/** Point de départ publié par le pipeline (D-017), s'il existe et qu'il est lisible ; sinon null. */
export function calcOrigin(commune: Pick<Commune, 'origin'> | null | undefined): CommuneOrigin | null {
  const o = commune?.origin;
  if (!o || typeof o.lon !== 'number' || typeof o.lat !== 'number' || !Number.isFinite(o.lon) || !Number.isFinite(o.lat)) return null;
  return o;
}

/**
 * Pied du panneau de preuve : le texte suit toujours la donnée publiée.
 * - `origin` présent : « Point de départ du calcul : » + libellé de meta.origin_methods[method]
 *   (le code brut en repli, jamais un libellé deviné) ;
 * - sinon : le calcul part du centre de la commune (API Géo).
 */
export function originPointPhrase(
  commune: Pick<Commune, 'origin'>,
  originMethods: Readonly<Record<string, string>> | undefined,
  /** Sans mode sources (D-033) : `false` retire la parenthèse qui nomme la source (lot 6) */
  withSource = true,
): string {
  const o = calcOrigin(commune);
  if (!o) return withSource ? 'Point de départ du calcul : centre de la commune (API Géo)' : 'Point de départ du calcul : centre de la commune';
  const label = originMethods?.[o.method];
  const text = `Point de départ du calcul : ${label ?? `méthode « ${o.method} »`}`;
  return withSource ? text : stripSourceParen(text);
}

/**
 * Sans mode sources (D-033) : retire d'une phrase publiée une parenthèse qui commence par le nom d'un producteur (« (INSEE Filosofi 2021,
 * carreaux de 200 m) »). Une parenthèse qui dit autre chose reste. Fonction PURE.
 */
export function stripSourceParen(text: string): string {
  return text.replace(/\s*\((?:INSEE|API Géo|ADEME|IDFM|GTFS)\b[^)]*\)/g, '');
}

/** Sans mode sources (D-033) : retire les codes de décision (« (D-024) », « , D-029 ») d'un texte publié. Fonction PURE. */
export function stripDecisionCodes(text: string): string {
  return stripPersonalNotes(text).replace(/\s*\(D-\d{3}\)/g, '').replace(/,\s*D-\d{3}\b/g, '');
}

/** Retire d'un texte publié les mentions d'une consigne d'un membre de l'équipe (« (demande de Nicolas, ...) ») : jamais à l'écran, mode sources compris. Fonction PURE. */
export function stripPersonalNotes(text: string): string {
  return text
    .replace(/\s*\((?:D-\d{3}[^()]*?,\s*)?(?:demande|décision|choix) de Nicolas[^)]*\)/g, '')
    .replace(/\bpar Nicolas\b/g, "par l'équipe")
    .replace(/\bde Nicolas\b/g, "de l'équipe");
}

/** Portée du forfait sans la redite « identique pour toutes les communes » (déjà dite dans la phrase). */
export function costScopeNote(scope: string | null | undefined): string | null {
  if (!scope) return null;
  const rest = scope.replace(/^\s*identique pour toutes les communes\s*(?:;\s*|$)/i, '').trim();
  if (!rest) return null;
  return `${rest.charAt(0).toUpperCase()}${rest.slice(1)}${/[.!?]$/.test(rest) ? '' : '.'}`;
}

export function poleCommuneNames(pole: Pick<Pole, 'communes'>, communes: readonly Commune[]): string[] {
  const byInsee = new Map(communes.map((c) => [c.insee, c.name]));
  return pole.communes.map((insee) => shortCommuneName(byInsee.get(insee) ?? insee));
}

/* ------------------------------------------------------------------ flux EMP02 */

export interface FlowFact {
  /** null = aucun flux publié par l'INSEE pour ce couple (jamais un 0 de substitution) */
  flux: number | null;
  share: number | null;
  total: number | null;
  margin: number | null;
  /** ok (≥ 200) | order_of_magnitude (< 200, « ordre de grandeur », règle INSEE) | no_flow_in_file */
  precision: 'ok' | 'order_of_magnitude' | 'no_flow_in_file';
  /** La commune d'origine appartient à ce pôle : le flux compte aussi ceux qui travaillent sur place */
  originInPole: boolean;
  source: string;
  year: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Actifs occupés de la commune qui travaillent déjà dans le pôle (clé `flows_to_poles` de
 * context/{insee}.json). Lecture tolérante (objet par pôle ou liste) ; null si absent ou non diffusable.
 */
export function flowToPole(ctx: ContextFile | null | undefined, poleId: string): FlowFact | null {
  const block = ctx?.flows_to_poles as unknown;
  if (!block) return null;
  let entry: unknown = null;
  let meta: Record<string, unknown> = {};
  const findIn = (list: unknown[]): unknown =>
    list.find((x) => isRecord(x) && (x.pole_id === poleId || x.id === poleId)) ?? null;
  if (Array.isArray(block)) {
    entry = findIn(block);
  } else if (isRecord(block)) {
    meta = block;
    const status = block.status as ContextStatus | undefined;
    if (status && status !== 'ok') return null;
    const poles = block.poles;
    if (Array.isArray(poles)) entry = findIn(poles);
    else if (isRecord(poles)) entry = poles[poleId] ?? null;
    else entry = block[poleId] ?? null;
  }
  if (entry == null) return null;
  const e: Partial<FlowToPole> & Record<string, unknown> = isRecord(entry) ? entry : { flux: num(entry) };
  if (e.status && e.status !== 'ok') return null;
  const flux = num(e.flux);
  const precision =
    e.precision === 'no_flow_in_file' || (flux == null && e.precision == null)
      ? 'no_flow_in_file'
      : e.precision === 'order_of_magnitude'
        ? 'order_of_magnitude'
        : 'ok';
  if (flux == null && precision !== 'no_flow_in_file') return null;
  return {
    flux: precision === 'no_flow_in_file' ? null : flux,
    share: precision === 'no_flow_in_file' ? null : num(e.share_pct),
    total: num(e.actifs_occupes) ?? num(meta.actifs_occupes),
    margin: num(e.margin95),
    precision,
    originInPole: Array.isArray(meta.origin_poles) ? meta.origin_poles.includes(poleId) : meta.origin_pole === poleId,
    source: typeof meta.source === 'string' ? meta.source : 'EMP02',
    year: num(meta.year) ?? num(e.year),
  };
}

/* ------------------------------------------------------------------ coût COST01 */

export interface CostFact {
  monthEur: number;
  /** « forfait Navigo Mois toutes zones (1 à 5), tarif plein » */
  label: string | null;
  source: string;
  url: string | null;
  /** Portée : forfaits zonés, tarifs réduits, prise en charge employeur non modélisés */
  scope: string | null;
}

/** Forfait TC mensuel (COST01). Plus affiché dans le panneau depuis l'audit d'affichage du 10/11 (faux depuis D-032 : le coût est ce qu'on paie en plus) ; gardé pour les tests du contrat context/. */
export function transitCost(ctx: ContextFile | null | undefined, mode: string): CostFact | null {
  if (mode !== 'transit' && mode !== 'bike_transit') return null;
  const c = ctx?.cost;
  if (!c || c.status !== 'ok' || c.transit_month_eur == null) return null;
  return {
    monthEur: c.transit_month_eur,
    label: c.transit_label ?? null,
    source: c.transit_source ?? 'COST01',
    url: c.transit_source_url ?? null,
    scope: c.transit_scope ?? null,
  };
}

/* ------------------------------------------------------------------ sources citées */

/**
 * Libellé de GEO02 (point de départ du calcul, D-017) lu dans sources.json : « INSEE Filosofi 2021,
 * carreaux de 200 m ». null si la source n'est pas publiée.
 */
export function filosofiGridLabel(sources: readonly SourceEntry[]): string | null {
  const entries = sources.filter((s) => s.source_id === 'GEO02');
  if (!entries.length) return null;
  const text = entries.map((s) => `${s.titre} ${s.millesime ?? ''}`).join(' ');
  const year = /Filosofi\s+(\d{4})/i.exec(text)?.[1];
  const grid = /carreau[x]?\s+de\s+(\d+)\s*m\b/i.exec(text)?.[1];
  return `INSEE Filosofi${year ? ` ${year}` : ''}${grid ? `, carreaux de ${grid}\u00a0m` : ''}`;
}

/** Une commune affichée part-elle d'un point publié (D-017) ? Alors GEO02 est une source du calcul. */
export function usesCalcOrigin(communes: readonly (Pick<Commune, 'origin'> | null | undefined)[]): boolean {
  return communes.some((c) => calcOrigin(c) != null);
}

/**
 * Sources du pied du panneau de preuve, lues dans sources.json (repli sur la liste fixe des sources
 * du calcul si sources.json est vide, ex. jeu démo). GEO02 seulement si le point de départ en vient.
 */
export function proofSources(sources: readonly SourceEntry[], communes: readonly (Pick<Commune, 'origin'> | null | undefined)[]): string[] {
  const ids = new Set(sources.map((s) => s.source_id));
  const has = (id: string) => !sources.length || ids.has(id);
  const out: string[] = [];
  if (has('EMP01')) out.push('INSEE Flores (EMP01)');
  if (has('TRA01')) out.push('horaires IDFM (TRA01)');
  if (has('CYC01')) out.push(`${OSM_CREDIT} (CYC01)`);
  if (has('GEO01')) out.push('API Géo (GEO01)');
  const filo = usesCalcOrigin(communes) ? filosofiGridLabel(sources) : null;
  if (filo) out.push(`${filo} (GEO02)`);
  return out;
}
