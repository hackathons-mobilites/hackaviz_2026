/**
 * Libellés COURTS d'affichage (ciel, barre). Les noms longs de poles.json / meta.json restent
 * dans le panneau de preuve, les aria-label et la page Sources.
 */
import type { ModeId, Pole } from './types';

const POLE_SHORT: Record<string, string> = {
  P_PARIS_QCA: 'Paris QCA',
  P_PARIS_RG: 'Paris Rive gauche',
  P_PARIS_EST: 'Paris Centre-est',
  P_DEFENSE: 'La Défense',
  P_BOULOGNE: 'Boulogne-Issy',
  P_PLAINE: 'Plaine Commune',
  P_ROISSY: 'Roissy-CDG',
  P_ORLY: 'Orly-Rungis',
  P_CRETEIL: 'Créteil',
  P_SACLAY: 'Massy-Saclay',
  P_VERSAILLES: 'Versailles-Vélizy',
  P_SQY: 'Saint-Quentin-en-Y.',
  P_MARNE: 'Marne-la-Vallée',
  P_CERGY: 'Cergy-Pontoise',
  P_EVRY: 'Évry',
};

/** Nom court d'un pôle (ciel) : D-030 name_short s'il existe, sinon table POLE_SHORT, sinon nom sans parenthèse. */
export function poleShortName(pole: Pick<Pole, 'id' | 'name' | 'name_short'>): string {
  return pole.name_short ?? POLE_SHORT[pole.id] ?? pole.name.replace(/\s*\(.*\)\s*$/, '');
}

/**
 * Nom d'un mode dans le menu des modes et les listes (retour de Cyril, validé par Nicolas le 11/11) : des mots simples, sans
 * sigle ; les sigles et la méthode (DiRIF, route vide) sont au « i » « Précision sur ce mode ». Dans une phrase : MODE_PHRASE.
 */
export const MODE_SHORT: Record<ModeId, string> = {
  transit: 'Transports en commun',
  bike_transit: 'Vélo + transports en commun',
  bike: 'Vélo',
  walk: 'Marche',
  car: 'Voiture, route vide',
  car_traffic: 'Voiture, trafic moyen',
  velib: "Vélib'",
};

/**
 * Journées-types : première ligne du « i » du segment 6h-14h / 9h-17h / 14h-22h (audit de vérité du 11/11, règle 8 : les horaires sont
 * des scénarios hypothétiques). Même idée que la fiche « journée-type » de l'Aide.
 */
export const DAY_TYPES_HYPOTHETICAL = "Ces journées-types sont des scénarios hypothétiques, pas les horaires réels d'un salarié.";

/** Nom d'un mode dans une phrase (« horaires libres : transports en commun seulement ») : vocabulaire d'interface. */
export const MODE_PHRASE: Record<ModeId, string> = {
  transit: 'transports en commun',
  bike_transit: 'vélo + transports en commun',
  bike: 'vélo',
  walk: 'marche',
  car: 'voiture (route vide)',
  car_traffic: 'voiture (trafic moyen DiRIF)',
  velib: "Vélib'",
};

/** « a », « a et b », « a, b et c » */
export function frenchJoin(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;
}

export interface LabelBox {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Évitement des collisions (glouton) : on place les étiquettes par priorité décroissante et on
 * écarte toute étiquette qui en chevaucherait une déjà placée ou une zone réservée.
 */
export function placeLabels(candidates: readonly LabelBox[], reserved: readonly LabelBox[] = [], pad = 4): number[] {
  const placed: LabelBox[] = [...reserved];
  const kept: number[] = [];
  const hit = (a: LabelBox, b: LabelBox) =>
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
  for (const c of candidates) {
    if (placed.some((p) => hit(c, p))) continue;
    placed.push(c);
    kept.push(c.index);
  }
  return kept;
}

/**
 * Variante à positions candidates : pour chaque étiquette (par priorité décroissante), on essaie ses
 * positions dans l'ordre (ex. dessous, droite, gauche, dessus) et on garde la première libre.
 * Une étiquette sans position libre n'est pas affichée : jamais de chevauchement.
 */
export function placeLabelOptions(
  candidates: readonly { index: number; options: readonly Omit<LabelBox, 'index'>[] }[],
  reserved: readonly LabelBox[] = [],
  pad = 4,
): LabelBox[] {
  const placed: LabelBox[] = [...reserved];
  const kept: LabelBox[] = [];
  const hit = (a: Omit<LabelBox, 'index'>, b: LabelBox) =>
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
  for (const c of candidates) {
    const free = c.options.find((o) => !placed.some((p) => hit(o, p)));
    if (!free) continue;
    const box = { index: c.index, ...free };
    placed.push(box);
    kept.push(box);
  }
  return kept;
}

export interface PlacedLabel extends LabelBox {
  /** Trait de rappel (px écran) quand l'étiquette est posée à distance */
  leader?: { x1: number; y1: number; x2: number; y2: number };
}

/** 8 directions : dessous, droite, gauche, dessus, puis les diagonales. */
const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Positions candidates autour d'un point de rayon r, à la distance `gap` du bord, dans 8 directions.
 * Avec `leader`, chaque candidat porte un trait de rappel du bord du point au bord de l'étiquette.
 */
export function ringCandidates(
  cx: number,
  cy: number,
  r: number,
  w: number,
  h: number,
  gap: number,
  leader = false,
): (Omit<LabelBox, 'index'> & { leader?: PlacedLabel['leader'] })[] {
  return DIRS.map(([dx, dy]) => {
    const n = Math.hypot(dx, dy);
    const ux = dx / n;
    const uy = dy / n;
    // point d'ancrage à distance r + gap, l'étiquette est collée à ce point du côté de la direction
    const ax = cx + ux * (r + gap);
    const ay = cy + uy * (r + gap);
    const x = dx > 0 ? ax : dx < 0 ? ax - w : ax - w / 2;
    const y = dy > 0 ? ay : dy < 0 ? ay - h : ay - h / 2;
    const box = { x, y, w, h };
    if (!leader) return box;
    return { ...box, leader: { x1: cx + ux * r, y1: cy + uy * r, x2: ax, y2: ay } };
  });
}

/** Segment [p, q] coupe-t-il le rectangle b (Liang-Barsky) ? */
export function segmentHitsBox(s: { x1: number; y1: number; x2: number; y2: number }, b: Omit<LabelBox, 'index'>): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, s.x1 - b.x) && clip(dx, b.x + b.w - s.x1) && clip(-dy, s.y1 - b.y) && clip(dy, b.y + b.h - s.y1);
}

/** Deux segments se croisent-ils (intersection propre, extrémités communes exclues) ? */
export function segmentsCross(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Placement en deux temps : position proche (8 directions), sinon position à distance avec trait de
 * rappel. Les traits de rappel qui en croisent un autre, qui traversent le disque ou le nom d'un autre
 * astre sont écartés tant qu'une position sans croisement existe (D-030 : 44 astres) ; sans elle, le
 * nom garde sa position avec croisement : aucun nom n'est perdu pour éviter un croisement. Sans aucune place libre,
 * l'étiquette est omise seulement si `allowDrop` (petits écrans).
 * `fixed` (optionnel, vide par défaut : rien ne change) : noms déjà posés par ailleurs, dont les traits de rappel
 * comptent pour les croisements (ils ne sont pas des obstacles : passer aussi leurs boîtes dans `reserved`).
 */
export function placeWithLeaders(
  items: readonly { index: number; cx: number; cy: number; r: number; w: number; h: number; allowDrop?: boolean }[],
  reserved: readonly LabelBox[],
  near = 5,
  far = 44,
  pad = 3,
  fixed: readonly PlacedLabel[] = [],
): PlacedLabel[] {
  const placed: LabelBox[] = [...reserved];
  const out: PlacedLabel[] = [];
  const hit = (a: Omit<LabelBox, 'index'>, b: LabelBox) =>
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
  for (const it of items) {
    // Proche d'abord, puis à distance croissante avec un trait de rappel (un nom trouve toujours sa place
    // sauf saturation complète de l'écran).
    const options = [
      ...ringCandidates(it.cx, it.cy, it.r, it.w, it.h, near),
      ...ringCandidates(it.cx, it.cy, it.r, it.w, it.h, far, true),
      ...ringCandidates(it.cx, it.cy, it.r, it.w, it.h, far * 2, true),
      ...ringCandidates(it.cx, it.cy, it.r, it.w, it.h, far * 3, true),
    ];
    const free = options.filter((o) => !placed.some((p) => hit(o, p)));
    // le disque de l'astre lui-même (zone réservée -1 - index) n'est pas un obstacle à son propre trait
    const own = -1 - it.index;
    const clean = (o: (typeof options)[number]) =>
      !o.leader ||
      (!out.some((l) => l.leader && segmentsCross(o.leader!, l.leader)) &&
        !fixed.some((l) => l.leader && segmentsCross(o.leader!, l.leader)) &&
        !placed.some((p) => p.index !== own && segmentHitsBox(o.leader!, p)));
    // Distance d'abord (anneau le plus proche qui a une place libre : un trait n'est jamais allongé pour en éviter
    // un autre), puis, dans cet anneau, une position sans croisement ; à défaut la première position libre.
    const ring = free.length ? Math.floor(options.indexOf(free[0]!) / DIRS.length) : 0;
    const inRing = free.filter((o) => Math.floor(options.indexOf(o) / DIRS.length) === ring);
    const pick = inRing.find(clean) ?? inRing[0];
    if (!pick) continue;
    const box: PlacedLabel = { index: it.index, x: pick.x, y: pick.y, w: pick.w, h: pick.h, ...(pick.leader ? { leader: pick.leader } : {}) };
    placed.push(box);
    out.push(box);
  }
  return out;
}

/** Trait de rappel de l'étoile-guide : avec un point de 2 px côté étoile (critique v0.6 § 6). */
export interface GuideLabel extends PlacedLabel {
  /** true = posé à distance (repli ultime), trait de rappel renforcé */
  far: boolean;
}

/**
 * Nom de l'étoile-guide (L-02) : toujours COLLÉ à l'étoile (8 positions proches, écart `near`) et placé
 * avant tout nom de pôle (ce sont les noms des pôles qui se déplacent). Les zones réservées sont les
 * disques des pôles, les bords du volet, les cartes posées sur le ciel. Repli ultime : à `far` px avec
 * un trait de rappel ; si même ce repli est pris, la première position proche à l'intérieur du volet
 * (le nom de la commune n'est jamais omis : c'est le point de départ de tout le récit).
 */
export function placeGuideLabel(
  guide: { x: number; y: number; r: number },
  w: number,
  h: number,
  reserved: readonly LabelBox[],
  inside: (b: Omit<LabelBox, 'index'>) => boolean,
  near = 8,
  far = 44,
  pad = 3,
): GuideLabel {
  const hit = (a: Omit<LabelBox, 'index'>, b: LabelBox) =>
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
  const close = ringCandidates(guide.x, guide.y, guide.r, w, h, near);
  const free = close.find((o) => !reserved.some((p) => hit(o, p)));
  if (free) return { index: -1000, ...free, far: false };
  const away = ringCandidates(guide.x, guide.y, guide.r, w, h, far, true).find((o) => !reserved.some((p) => hit(o, p)));
  if (away) return { index: -1000, x: away.x, y: away.y, w, h, ...(away.leader ? { leader: away.leader } : {}), far: true };
  const fallback = close.find(inside) ?? close[0]!;
  return { index: -1000, ...fallback, far: false };
}
