/**
 * Caméra du ciel (zoom / déplacement) - fonctions pures.
 * Seule la caméra bouge : positions relatives et tailles des astres restent celles des données.
 * Transformation : écran = (x, y) + k · monde. Le ciel (monde = taille de la fenêtre) ne sort jamais de l'écran.
 */
export interface Camera {
  k: number;
  x: number;
  y: number;
}

export const IDENTITY: Camera = { k: 1, x: 0, y: 0 };
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
/** À partir de ce zoom, les noms courts apparaissent (1 = dès l'ouverture, comme la slide) */
export const SEMANTIC_ZOOM = 1;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function clampCamera(c: Camera, w: number, h: number): Camera {
  const k = clamp(c.k, ZOOM_MIN, ZOOM_MAX);
  return { k, x: clamp(c.x, w - w * k, 0), y: clamp(c.y, h - h * k, 0) };
}

/** Zoom d'un facteur en gardant fixe le point écran (px, py). */
export function zoomAt(c: Camera, factor: number, px: number, py: number, w: number, h: number): Camera {
  const k = clamp(c.k * factor, ZOOM_MIN, ZOOM_MAX);
  const wx = (px - c.x) / c.k;
  const wy = (py - c.y) / c.k;
  return clampCamera({ k, x: px - wx * k, y: py - wy * k }, w, h);
}

export function panBy(c: Camera, dx: number, dy: number, w: number, h: number): Camera {
  return clampCamera({ k: c.k, x: c.x + dx, y: c.y + dy }, w, h);
}

/**
 * Zoom des glyphes : les POSITIONS suivent la caméra (×k) mais les disques grossissent moins vite
 * (×k^0,35), le même facteur pour tous les pôles → l'aire reste ∝ postes et les pôles proches se séparent.
 */
export const GLYPH_ZOOM_EXP = 0.35;
export function glyphScale(k: number): number {
  return Math.pow(k, GLYPH_ZOOM_EXP);
}

export function project(c: Camera, p: { x: number; y: number }): { x: number; y: number } {
  return { x: c.x + p.x * c.k, y: c.y + p.y * c.k };
}

/** Caméra partielle pour le décor (profondeur) : même point focal, zoom atténué k^depth. */
export function decorCamera(c: Camera, depth: number): Camera {
  if (c.k <= 1.0001) return IDENTITY;
  const s = Math.pow(c.k, depth);
  const r = (1 - s) / (1 - c.k);
  return { k: s, x: c.x * r, y: c.y * r };
}

/**
 * Caméra qui cadre une boîte (px écran à k = 1) au centre d'une zone, zoom plafonné.
 * Zoom d'INTERFACE (affiché, réglable) : positions et tailles relatives inchangées.
 */
export function fitCamera(
  box: { x0: number; y0: number; x1: number; y1: number },
  area: { x: number; y: number; w: number; h: number },
  viewport: { width: number; height: number },
  maxK: number,
): Camera {
  const bw = Math.max(1, box.x1 - box.x0);
  const bh = Math.max(1, box.y1 - box.y0);
  const k = Math.max(ZOOM_MIN, Math.min(maxK, area.w / bw, area.h / bh));
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return clampCamera({ k, x: area.x + area.w / 2 - cx * k, y: area.y + area.h / 2 - cy * k }, viewport.width, viewport.height);
}
