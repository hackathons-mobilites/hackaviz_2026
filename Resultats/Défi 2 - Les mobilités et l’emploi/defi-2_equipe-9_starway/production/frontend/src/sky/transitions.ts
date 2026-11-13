/**
 * Chorégraphie des changements d'état des astres (motion-spec.md).
 * Le plan (qui bascule, quand) est calculé par une fonction pure ; anime.js l'exécute.
 */
import { animate } from 'animejs';
import { lightingOrder, type PoleState, type PoleStatus } from '../data/accessibility';
import { goldDelta } from '../data/gain';
import type { Pole } from '../data/types';
import { partRing, type PartRing } from '../data/od/sky';
import { color, eclipse, motion, reveal, shooting as shootingTokens, silence as silenceTokens } from '../theme/tokens';
import type { PoleGeometry } from './layout';

/** 'scrub' = glisser de la jauge du budget : fondu court, sans décalage (la transition complète suit au relâchement). */
export type TransitionCause = 'init' | 'origin' | 'filter' | 'day' | 'scrub';

/**
 * Réglages des moments « wow » (critique v0.4, sections 3 et 4 f) : source unique dans
 * `theme/tokens.ts` (`shooting`, `silence`, `eclipse.holdAfter`), réexposés ici sous le nom `fx`.
 */
export const fx = {
  shooting: shootingTokens,
  silence: silenceTokens,
  eclipse: { holdAfter: eclipse.holdAfter },
} as const;

/** Sens du voile : 1 = de gauche à droite (journée plus tardive), -1 = de droite à gauche (plus matinale). */
export type EclipseDirection = 1 | -1;

/** Heure de début d'une journée-type à partir de son identifiant (d06 → 6, d14 → 14). */
function dayStart(id: string | null | undefined): number | null {
  const m = id ? /(\d+)/.exec(id) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Sens du voile, motivé par la navigation (le temps avance ou recule) et non par la donnée :
 * vers une journée plus tardive, de gauche à droite ; vers une plus matinale, de droite à gauche.
 */
export function eclipseDirection(prevDay: string | null | undefined, nextDay: string | null | undefined): EclipseDirection {
  const a = dayStart(prevDay);
  const b = dayStart(nextDay);
  if (a == null || b == null) return 1;
  return b < a ? -1 : 1;
}

/**
 * Pôles PERDUS entre deux états affichés : accessibles avant, calculés et non accessibles après.
 * Rien si l'un des deux ciels est neutre (aucun résultat affiché) ; un pôle qui devient « non calculé »
 * n'est pas une perte (absence de donnée, pas une différence de la matrice).
 */
export function lostPoles(
  prev: readonly PoleState[] | null | undefined,
  next: readonly PoleState[],
  flags: { prevNeutral?: boolean; nextNeutral?: boolean } = {},
): number[] {
  if (!prev || flags.prevNeutral || flags.nextNeutral) return [];
  const lost: number[] = [];
  next.forEach((s, i) => {
    const before = prev[i];
    if (before?.status === 'accessible' && (s.status === 'out_only' || s.status === 'none')) lost.push(i);
  });
  return lost;
}

/** Forme de l'étoile filante selon l'état réel du pôle. */
export type ShootingKind = 'full' | 'return_half' | 'out_60';

/** Aucune filante sans donnée (« non calculé ») : on ne dessine pas un trajet qui n'existe pas. */
export function shootingKindOf(status: PoleStatus | undefined): ShootingKind | null {
  switch (status) {
    case 'accessible':
      return 'full';
    case 'out_only':
      return 'return_half';
    case 'none':
      return 'out_60';
    default:
      return null;
  }
}

export interface ShootingLeg {
  /** 'out' = aller (arc au-dessus de la corde), 'back' = retour (arc au-dessous) */
  dir: 'out' | 'back';
  /** Fraction du trajet parcourue (la partie non parcourue n'est jamais tracée) */
  end: number;
  /** true = sens réussi dans le budget (laisse une trace fixe) */
  ok: boolean;
}

/**
 * Deux arcs qui dessinent une lentille : « aller ET retour » se voit avant d'être lu.
 * - accessible : aller complet, retour complet ;
 * - retour hors budget : aller complet, le retour s'arrête à 50 % ;
 * - aller hors budget : l'aller s'arrête à 60 %, pas de retour.
 */
export function shootingLegs(kind: ShootingKind): ShootingLeg[] {
  switch (kind) {
    case 'full':
      return [
        { dir: 'out', end: 1, ok: true },
        { dir: 'back', end: 1, ok: true },
      ];
    case 'return_half':
      return [
        { dir: 'out', end: 1, ok: true },
        { dir: 'back', end: 0.5, ok: false },
      ];
    case 'out_60':
      return [{ dir: 'out', end: 0.6, ok: false }];
  }
}

/** Durée totale d'une filante (ms), pour synchroniser la visite. */
export function shootingDuration(kind: ShootingKind, reduced: boolean): number {
  if (reduced) return motion.reduced;
  const legs = shootingLegs(kind);
  const s = fx.shooting;
  let total = 0;
  legs.forEach((l, i) => {
    total += s.leg * Math.max(0.5, l.end) + (l.ok ? 0 : s.failFade);
    // entre deux arcs : pause sur le pôle ; après le dernier arc réussi : la queue se résorbe
    if (i < legs.length - 1) total += s.pause;
    else if (l.ok) total += motion.ui;
  });
  return total;
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Point de contrôle d'un arc entre l'étoile-guide `a` et le pôle `b` : décalé de `curve` × corde,
 * perpendiculairement, au-dessus (vers le haut de l'écran) ou au-dessous. Les deux arcs sont
 * symétriques par rapport à la corde : une métaphore, pas un tracé géographique.
 */
export function arcControl(a: Pt, b: Pt, side: 'above' | 'below', curve: number = fx.shooting.curve): Pt {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  // normale orientée vers le haut de l'écran (y décroissant) ; corde verticale : vers la gauche
  if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const off = len * curve * (side === 'above' ? 1 : -1);
  return { x: mx + nx * off, y: my + ny * off };
}

/** Bézier quadratique. */
export function bezier(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}


export interface PoleStep {
  index: number;
  light: number;
  known: number;
  neutral: number;
  /** 1 = aller possible, retour hors budget ou introuvable (contour mi-plein mi-tirets) */
  outOnly: number;
  /** 1 = astre lu en part (table OD, D-019) : la lumière est portée par le cœur d'aire ∝ postes atteints */
  od: number;
  /** Fractions du contour et du cœur (table OD) ; null hors table OD. Posé sans interpolation. */
  part: PartRing | null;
  delay: number;
  duration: number;
}

/** Inverse de inOutSine : temps normalisé auquel l'easing atteint `e`. */
export function inOutSineInverse(e: number): number {
  const c = Math.min(1, Math.max(0, e));
  return Math.acos(1 - 2 * c) / Math.PI;
}

export interface PlanOptions {
  reduced: boolean;
  screenWidth: number;
  current: readonly PoleTarget[];
  /** Ciel neutre : aucune lumière ni contour d'état */
  neutral?: boolean;
  /** Éclipse : sens du voile (1 = de gauche à droite, -1 = de droite à gauche) */
  direction?: EclipseDirection;
}

export interface PoleTarget {
  light: number;
  known: number;
  /** 1 = ciel neutre (aucune commune, ou ciel pas encore révélé) */
  neutral: number;
  /**
   * 1 = aller dans le budget, retour hors budget ou introuvable (`out_only`). Ne change que la FORME
   * du contour des pôles éteints (moitié haute pleine = aller, moitié basse en tirets = retour) :
   * ni cyan, ni taille, ni position. Absent = 0.
   */
  outOnly?: number;
  /**
   * 1 = astre lu en part (table OD, D-019) : disque en gris-bleu, cœur cyan concentrique d'aire ∝
   * postes atteints (rayon r × √part). Animé (fondu entre les deux lectures). Absent = 0.
   */
  od?: number;
  /**
   * Fractions du cœur et du contour (table OD). JAMAIS interpolées : le cœur ne grandit pas, il
   * change en fondu enchaîné (Poles.ts). Absent ou null = pas de part.
   */
  part?: PartRing | null;
}

function samePart(a: PartRing | null | undefined, b: PartRing | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-4;
  return eq(a.reached, b.reached) && eq(a.self, b.self) && eq(a.unknown, b.unknown);
}

export function targetOf(state: PoleState | undefined, neutral = false): Required<PoleTarget> {
  if (neutral) return { light: 0, known: 0, neutral: 1, outOnly: 0, od: 0, part: null };
  if (!state || state.status === 'unknown') return { light: 0, known: 0, neutral: 0, outOnly: 0, od: 0, part: null };
  const part = state.od ? partRing(state.od) : null;
  return {
    light: state.status === 'accessible' ? 1 : 0,
    known: 1,
    neutral: 0,
    outOnly: state.status === 'out_only' ? 1 : 0,
    od: part ? 1 : 0,
    part,
  };
}

/**
 * - filter / origin / init : allumage par durée aller croissante (stagger), extinction simultanée.
 * - day (éclipse) : chaque astre qui change bascule quand le front du voile le croise.
 * - scrub (glisser de la jauge du budget) et mouvement réduit : fondu court, sans décalage.
 * Les astres dont l'état ne change pas ne sont pas touchés (le silence est un effet).
 */
export function planTransition(
  states: readonly PoleState[],
  geometry: readonly PoleGeometry[],
  cause: TransitionCause,
  opts: PlanOptions,
): PoleStep[] {
  const steps: PoleStep[] = [];
  const order = lightingOrder(states);
  const veilW = opts.screenWidth * eclipse.veilWidth;
  states.forEach((s, i) => {
    const target = targetOf(s, opts.neutral);
    const cur = opts.current[i] ?? { light: 0, known: 0, neutral: 0 };
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;
    if (
      same(cur.light, target.light) &&
      same(cur.known, target.known) &&
      same(cur.neutral, target.neutral) &&
      same(cur.outOnly ?? 0, target.outOnly) &&
      same(cur.od ?? 0, target.od) &&
      // la part ne compte que si l'astre la montre (allumé, lu en part)
      (target.od === 0 || samePart(cur.part, target.part))
    )
      return;
    let delay = 0;
    let duration: number = motion.light;
    if (opts.reduced || cause === 'scrub') {
      duration = motion.reduced;
    } else if (cause === 'day') {
      const x = geometry[i]?.x ?? 0;
      // distance parcourue par le front du voile avant d'atteindre l'astre
      const travel = (opts.direction ?? 1) === 1 ? x : opts.screenWidth - x;
      delay = inOutSineInverse(travel / (opts.screenWidth + veilW)) * motion.eclipse;
      duration = motion.light * 0.6;
    } else if (target.light > cur.light) {
      const rank = order.indexOf(i);
      delay = Math.max(0, rank) * motion.stagger;
    }
    steps.push({ index: i, light: target.light, known: target.known, neutral: target.neutral, outOnly: target.outOnly, od: target.od, part: target.part, delay, duration });
  });
  return steps;
}

/** Exécute le plan ; renvoie la durée totale (ms). */
export function runTransition(targets: PoleTarget[], steps: readonly PoleStep[]): number {
  let end = 0;
  for (const st of steps) {
    const t = targets[st.index];
    if (!t) continue;
    // La part se pose d'un coup (le fondu enchaîné du cœur est fait par Poles.ts, jamais une croissance)
    if (st.od > 0) t.part = st.part;
    animate(t, {
      light: st.light,
      known: st.known,
      neutral: st.neutral,
      outOnly: st.outOnly,
      od: st.od,
      delay: st.delay,
      duration: st.duration,
      ease: motion.easing.light,
    });
    end = Math.max(end, st.delay + st.duration);
  }
  return end;
}

/* ------------------------------------------------------------------ acte 0 : révélation du ciel */

/**
 * Ordre de pose des astres (temps B de la révélation) : rayon décroissant, donc postes salariés
 * (INSEE) décroissants (EMP01, aire ∝ postes) ; égalités départagées par l'identifiant du pôle.
 * L'ordre est une donnée, comme l'ordre d'allumage (durée aller) : aucun autre ordre n'est permis.
 * Renvoie des indices de `geometry` (ordre de poles.json).
 */
export function poseOrder(geometry: readonly Pick<PoleGeometry, 'r' | 'id'>[]): number[] {
  return geometry
    .map((g, i) => ({ i, r: g.r, id: g.id }))
    .sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => x.i);
}

/**
 * Délais de départ de la pose (ms, relatifs au début du temps B), un par rang de `poseOrder` :
 * décalage `min(poleStagger, poseWindow / (n - 1))`, donc une fenêtre de départs de `poseWindow`
 * au plus, quel que soit le nombre de pôles.
 */
export function poseDelays(n: number): number[] {
  if (n <= 0) return [];
  const step = n > 1 ? Math.min(reveal.poleStagger, reveal.poseWindow / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => i * step);
}

/**
 * Durée d'un allumage par durée aller croissante (ms) : dernier délai + durée d'un astre. Le compteur
 * de postes défile sur la même durée, pour finir avec le dernier astre allumé.
 */
export function lightingDuration(litCount: number, reduced = false): number {
  if (reduced) return 0;
  return Math.max(0, litCount - 1) * motion.stagger + motion.light;
}

/** Instants de la révélation (ms depuis le clic, ou depuis le moteur prêt pour un lien partagé). */
export interface RevealTimeline {
  /** B. début de la pose */
  poseAt: number;
  /** B. dernier astre posé */
  poseEnd: number;
  /** C. naissance de l'étoile-guide, entrée de la barre */
  originAt: number;
  /** D. au plus tôt ; l'allumage attend aussi les temps de trajet de la commune */
  lightAt: number;
}

/**
 * Chronologie de la révélation pour `n` pôles (motion-spec, Acte 0). Mouvement réduit (ou version
 * courte d'un lien `&v=map`) : mêmes temps en fondus de 150 ms séparés de 100 ms.
 */
export function revealTimeline(n: number, opts: { shared?: boolean; reduced?: boolean } = {}): RevealTimeline {
  if (opts.reduced) {
    const poseAt = opts.shared ? 0 : motion.reduced;
    const poseEnd = poseAt + motion.reduced;
    const originAt = poseEnd + reveal.beat;
    return { poseAt, poseEnd, originAt, lightAt: originAt + motion.reduced + reveal.beat };
  }
  const poseAt = opts.shared ? reveal.sharedPoseAt : reveal.poseAt;
  const delays = poseDelays(n);
  const poseEnd = poseAt + (delays.at(-1) ?? 0) + (n > 0 ? reveal.poleAppear : 0);
  const originAt = poseEnd + reveal.beat;
  return { poseAt, poseEnd, originAt, lightAt: originAt + motion.guideBirth + reveal.beat };
}

/* ------------------------------------------------------------------ gain démontré (acte 4) */

/** Un scénario affichable : états des pôles et paramètres qui doivent être identiques pour comparer. */
export interface GainView {
  states: readonly PoleState[];
  mode: string;
  day: string;
  budget: number;
  /** Ciel neutre (aucun résultat) : pas de comparaison possible */
  neutral?: boolean;
}

/** Pourquoi aucun or n'est peint. */
export type GainRefusal =
  | 'same_mode' // référence et complément identiques : pas de scénario complémentaire
  | 'different_day' // journées-types différentes : l'écart ne serait pas celui du mode
  | 'different_budget' // budgets différents : idem
  | 'no_data' // l'un des deux ciels est neutre ou sans aucune valeur calculée
  | 'no_commune_transit' // ciel TC commune par commune illisible : rien n'est démontré (D-056)
  | 'length_mismatch' // paniers de pôles différents
  | 'not_displayed'; // le ciel affiché n'est pas le complément (update(complément) d'abord)

export interface GainPlan {
  reason: GainRefusal | null;
  /** Indices (ordre de poles.json) des pôles gagnés, triés par durée aller croissante dans le complément */
  gained: number[];
  /** Indices des pôles perdus (accessibles dans la référence, plus dans le complément) */
  lost: number[];
}

/**
 * Plan du gain démontré, fonction pure : `goldDelta` (D-056), seulement si la comparaison est valide
 * (même journée-type, même budget, modes différents, deux ciels calculés, ciel TC commune par commune lisible).
 * Un pôle « non calculé » dans l'un des deux scénarios n'est ni gagné ni perdu, donc un pôle qui passe
 * de « non calculé » en TC à « accessible » en vélo + TC n'est jamais doré (rien n'est démontré).
 */
export function planGain(poles: readonly Pole[], reference: GainView, complement: GainView, communeTransit: readonly PoleState[] | null): GainPlan {
  const refuse = (reason: GainRefusal): GainPlan => ({ reason, gained: [], lost: [] });
  if (reference.states.length !== poles.length || complement.states.length !== poles.length) return refuse('length_mismatch');
  if (reference.mode === complement.mode) return refuse('same_mode');
  if (reference.day !== complement.day) return refuse('different_day');
  if (reference.budget !== complement.budget) return refuse('different_budget');
  const hasData = (v: GainView) => !v.neutral && v.states.some((s) => s.status !== 'unknown');
  if (!hasData(reference) || !hasData(complement)) return refuse('no_data');
  if (!communeTransit || communeTransit.length !== poles.length) return refuse('no_commune_transit');
  const delta = goldDelta(poles, reference.states, complement.states, communeTransit);
  const index = new Map(poles.map((p, i) => [p.id, i] as const));
  const toIdx = (ids: readonly string[]) => ids.map((id) => index.get(id)).filter((i): i is number => i != null);
  const order = lightingOrder(complement.states);
  const gained = toIdx(delta.gained).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { reason: null, gained, lost: toIdx(delta.lost) };
}

/** Entrée de légende de l'or, à afficher seulement tant qu'un gain est peint (GainReport.legend). */
export interface GainLegend {
  label: string;
  detail: string;
  /** Or de la palette normale ; la légende dessine le glyphe `gain` de la palette affichée (mode daltonien : ambre) */
  color: string;
  /** Forme de « accessible » (disque plein, contour plein) plus une seconde orbite fine (gainMark) */
  glyph: 'filled';
}

export const gainLegend: GainLegend = {
  label: 'Or : gain démontré',
  detail: 'accessible aller et retour avec ce mode, pas en transports en commun seuls, même journée-type et même temps de trajet',
  color: color.gain,
  glyph: 'filled',
};
