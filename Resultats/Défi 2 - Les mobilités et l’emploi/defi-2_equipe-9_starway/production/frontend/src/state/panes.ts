/**
 * Volets du ciel : un seul ciel, ou le diptyque (acte 3) côte à côte, ou empilé sur mobile.
 * Les deux ciels ont toujours la même taille : mêmes positions relatives, mêmes tailles d'astres.
 */
export const STACK_MAX_WIDTH = 760;

export interface Pane {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Marge basse passée à computeFrame (barre de scénario, ou rien si la barre est hors du volet) */
  bottomInset: number;
  /** Marge haute imposée (diptyque empilé) */
  topInset?: number;
}

/** Marge basse minimale d'un volet sans barre : computeFrame ajoute 40 px, on vise 16 px. */
const NO_BAR = -24;

export function paneFor(side: 'A' | 'B', split: boolean, vw: number, vh: number, bar: number): Pane {
  if (!split) return { left: 0, top: 0, width: vw, height: vh, bottomInset: bar };
  if (vw > STACK_MAX_WIDTH) {
    return { left: side === 'B' ? vw / 2 : 0, top: 0, width: vw / 2, height: vh, bottomInset: bar };
  }
  // Mobile : A en haut, B en bas, tous deux au-dessus de la barre de scénario.
  const h = Math.max(0, (vh - bar) / 2);
  return side === 'A'
    ? { left: 0, top: 0, width: vw, height: h, bottomInset: NO_BAR, topInset: 64 }
    : { left: 0, top: h, width: vw, height: h, bottomInset: NO_BAR, topInset: 36 };
}

/**
 * Repère de bord pour un point hors du volet (étoile-guide hors champ après un zoom) :
 * position sur le bord (marge `inset`) dans la direction réelle depuis le centre, et angle.
 * null si le point est visible.
 */
export function edgeMarker(
  p: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  inset = 24,
): { x: number; y: number; angle: number } | null {
  const x0 = rect.left + inset;
  const y0 = rect.top + inset;
  const x1 = rect.left + rect.width - inset;
  const y1 = rect.top + rect.height - inset;
  if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) return null;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const tx = dx !== 0 ? (dx > 0 ? (x1 - cx) / dx : (x0 - cx) / dx) : Infinity;
  const ty = dy !== 0 ? (dy > 0 ? (y1 - cy) / dy : (y0 - cy) / dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}

/**
 * Garde un repère de bord ENTIER dans le volet : son centre `c` est ramené pour que la boîte (largeur `w`, hauteur `h`)
 * reste à `margin` px des bords. Un repère plus large que le volet reste centré. Mobile 390 px : « Provins » n'est plus coupé.
 */
export function keepMarkerInside(
  c: { x: number; y: number },
  size: { w: number; h: number },
  rect: { left: number; top: number; width: number; height: number },
  margin = 0,
): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
  return {
    x: clamp(c.x, rect.left + margin + size.w / 2, rect.left + rect.width - margin - size.w / 2),
    y: clamp(c.y, rect.top + margin + size.h / 2, rect.top + rect.height - margin - size.h / 2),
  };
}

/**
 * Écarte un repère de bord (centre `c`, taille `size`) d'une boîte qu'il recouvrirait (le nom de l'étoile-guide) : il glisse
 * le long du bord, sous ou sur la boîte à `gap` px, du côté le plus proche qui reste dans `rect` ; sans place, il ne bouge pas.
 */
export function nudgeMarkerFrom(
  c: { x: number; y: number },
  size: { w: number; h: number },
  rect: { left: number; top: number; width: number; height: number },
  margin: number,
  obstacle: { x: number; y: number; w: number; h: number } | null | undefined,
  gap: number,
): { x: number; y: number } {
  if (!obstacle) return c;
  const touches = (y: number) =>
    c.x - size.w / 2 < obstacle.x + obstacle.w + gap &&
    c.x + size.w / 2 > obstacle.x - gap &&
    y - size.h / 2 < obstacle.y + obstacle.h + gap &&
    y + size.h / 2 > obstacle.y - gap;
  if (!touches(c.y)) return c;
  const inside = (y: number) => y - size.h / 2 >= rect.top + margin && y + size.h / 2 <= rect.top + rect.height - margin;
  const below = obstacle.y + obstacle.h + gap + size.h / 2;
  const above = obstacle.y - gap - size.h / 2;
  const options = [below, above].filter(inside).sort((a, b) => Math.abs(a - c.y) - Math.abs(b - c.y));
  return options.length ? { x: c.x, y: options[0]! } : c;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Emprise de l'étoile-guide et de son nom (posé collé, de part et d'autre) : une carte qui la touche
 * cacherait le point de départ du récit (critique v0.6 § 6).
 */
export function guideFootprint(guide: { x: number; y: number; labelW: number }, star = 22, labelH = 18): Box {
  const half = star + guide.labelW;
  return { x: guide.x - half, y: guide.y - star - labelH, w: half * 2, h: (star + labelH) * 2 };
}

export const boxesOverlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export type CardPlacement = 'left' | 'right' | 'chip';

/**
 * Où poser une carte du ciel (contraste du jour) : à gauche par défaut ; si elle y cacherait
 * l'étoile-guide ou son nom, du côté opposé ; si ce côté est pris (panneau de preuve, liste) ou la
 * cache aussi, repliée en puce. Le ciel, lui, ne bouge jamais.
 */
export function cardPlacement(
  guide: { x: number; y: number; labelW: number } | null,
  left: Box,
  right: Box,
  rightBusy: boolean,
): CardPlacement {
  if (!guide) return 'left';
  const fp = guideFootprint(guide);
  if (!boxesOverlap(fp, left)) return 'left';
  if (!rightBusy && !boxesOverlap(fp, right)) return 'right';
  return 'chip';
}

/**
 * Côté du panneau du halo (ou de toute grande carte latérale) : opposé à l'étoile-guide, pour que le
 * panneau ne cache jamais l'étoile dont il parle. À droite seulement si la droite est libre.
 */
export function sidePanelSide(guideX: number | null, vw: number, rightBusy: boolean): 'left' | 'right' {
  if (guideX == null || rightBusy) return 'left';
  return guideX < vw / 2 ? 'right' : 'left';
}
