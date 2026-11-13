/**
 * Zoom de la carte miroir - fonctions pures (aucun DOM).
 * La carte est projetée une fois (Lambert-93 ajustée au cadre) ; le zoom ne fait que changer la VUE :
 * écran = (x, y) + k · position de la carte à k = 1. Même facteur sur les deux axes : la projection
 * n'est jamais déformée. Les disques, les étiquettes et les traits gardent leur taille à l'écran.
 */
export interface MapView {
  k: number;
  x: number;
  y: number;
}

export interface MapFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAP_IDENTITY: MapView = { k: 1, x: 0, y: 0 };
/** k = 1 : l'Île-de-France entière remplit le cadre (vue d'ensemble) */
export const MAP_ZOOM_MIN = 1;
/** Au plus 8 : le cœur de Paris occupe alors l'écran, au-delà les contours simplifiés se voient trop */
export const MAP_ZOOM_MAX = 8;
/** Pas des boutons et des touches + / - */
export const MAP_ZOOM_STEP = 1.5;
/** Déplacement des flèches, en fraction du petit côté du cadre */
export const MAP_PAN_STEP = 0.12;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Zoom borné et déplacement borné : la carte (le cadre à k = 1, que l'IDF remplit) couvre toujours le
 * cadre ; on ne peut pas la faire sortir de l'écran.
 */
export function clampMapView(v: MapView, f: MapFrame): MapView {
  const k = clamp(v.k, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  return {
    k,
    x: clamp(v.x, (f.x + f.w) * (1 - k), f.x * (1 - k)),
    y: clamp(v.y, (f.y + f.h) * (1 - k), f.y * (1 - k)),
  };
}

/** Zoom d'un facteur en gardant fixe le point écran (px, py) (molette : le point sous le pointeur). */
export function zoomMapAt(v: MapView, factor: number, px: number, py: number, f: MapFrame): MapView {
  const k = clamp(v.k * factor, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  const bx = (px - v.x) / v.k;
  const by = (py - v.y) / v.k;
  return clampMapView({ k, x: px - bx * k, y: py - by * k }, f);
}

/** Zoom autour du centre du cadre (boutons, clavier). */
export function zoomMapCenter(v: MapView, factor: number, f: MapFrame): MapView {
  return zoomMapAt(v, factor, f.x + f.w / 2, f.y + f.h / 2, f);
}

export function panMap(v: MapView, dx: number, dy: number, f: MapFrame): MapView {
  return clampMapView({ k: v.k, x: v.x + dx, y: v.y + dy }, f);
}

/** Position écran d'un point de la carte (coordonnées à k = 1). */
export function applyMapView(v: MapView, p: { x: number; y: number }): { x: number; y: number } {
  return { x: v.x + p.x * v.k, y: v.y + p.y * v.k };
}

/** Même zoom, point amené au centre du cadre (autant que les bornes le permettent). */
export function centerMapOn(v: MapView, p: { x: number; y: number }, f: MapFrame): MapView {
  return clampMapView({ k: v.k, x: f.x + f.w / 2 - p.x * v.k, y: f.y + f.h / 2 - p.y * v.k }, f);
}

/** Le point écran est-il dans le cadre (marge en px, positive = tolérance) ? */
export function inFrame(p: { x: number; y: number }, f: MapFrame, margin = 0): boolean {
  return p.x >= f.x - margin && p.x <= f.x + f.w + margin && p.y >= f.y - margin && p.y <= f.y + f.h + margin;
}

export function isOverview(v: MapView): boolean {
  return v.k <= MAP_ZOOM_MIN + 1e-3;
}
