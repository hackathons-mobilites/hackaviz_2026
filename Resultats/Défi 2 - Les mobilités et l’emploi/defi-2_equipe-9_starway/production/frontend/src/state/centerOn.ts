/**
 * « Centrer sur ce pôle » (panneau de preuve) et recadrage mobile quand une feuille du bas s'ouvre.
 * Zoom d'INTERFACE : seule la caméra bouge, jamais la position ni la taille d'un astre.
 */
import { computeFrame, datasetBounds, poleGeometry } from '../sky/layout';
import { selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { ZOOM_MAX, type Camera } from './camera';
import { animateCameraTo } from './cameraControls';

/** Zoom minimal appliqué par « Centrer » (le zoom courant est gardé s'il est plus fort). */
export const CENTER_ZOOM = 2;

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caméra qui place le point p (px écran à k = 1) au centre de la zone visible. */
export function cameraCenteredOn(p: { x: number; y: number }, k: number, area: Area): Camera {
  return { k, x: area.x + area.w / 2 - p.x * k, y: area.y + area.h / 2 - p.y * k };
}

/** Position à k = 1 du pôle d'index i dans le ciel seul (même cadre que le moteur A). */
export function poleSkyPoint(i: number): { x: number; y: number } | null {
  const s = useSkyStore.getState();
  if (!s.dataset) return null;
  const frame = computeFrame(window.innerWidth, window.innerHeight, selectSkyBottom(s), datasetBounds(s.dataset));
  const g = poleGeometry(s.dataset.poles, frame, s.astres44)[i];
  return g ? { x: g.x, y: g.y } : null;
}

/**
 * Centre le pôle d'index i dans `area` (zone non couverte par le panneau). `minZoom` = 1 garde le
 * zoom courant (recadrage mobile), CENTER_ZOOM rapproche (bouton « Centrer sur ce pôle »).
 */
export function centerOnPole(i: number, area: Area, minZoom = CENTER_ZOOM): void {
  const p = poleSkyPoint(i);
  if (!p || area.w <= 0 || area.h <= 0) return;
  const k = Math.min(ZOOM_MAX, Math.max(useSkyStore.getState().camera.k, minZoom));
  animateCameraTo(cameraCenteredOn(p, k, area));
}
