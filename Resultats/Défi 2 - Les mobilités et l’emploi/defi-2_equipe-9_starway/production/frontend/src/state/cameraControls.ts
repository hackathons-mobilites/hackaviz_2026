/**
 * Commandes de caméra partagées (molette, pincement, glisser, boutons, double-clic).
 * Animation douce via anime.js ; immédiate en mouvement réduit. Pas d'inertie.
 */
import { animate, type JSAnimation } from 'animejs';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { clampCamera, IDENTITY, panBy, zoomAt, type Camera } from './camera';

let running: JSAnimation | null = null;

function size() {
  return { w: window.innerWidth, h: window.innerHeight };
}

export function setCameraNow(c: Camera): void {
  running?.pause();
  running = null;
  const { w, h } = size();
  useSkyStore.getState().setCamera(clampCamera(c, w, h));
}

export function animateCameraTo(target: Camera): void {
  const s = useSkyStore.getState();
  const { w, h } = size();
  const to = clampCamera(target, w, h);
  running?.pause();
  if (selectReducedMotion(s)) {
    s.setCamera(to);
    return;
  }
  const from = { ...s.camera };
  const p = { t: 0 };
  running = animate(p, {
    t: 1,
    duration: motion.ui * 1.3,
    ease: motion.easing.ui,
    onUpdate: () => {
      // interpolation en log pour le zoom (vitesse perçue constante)
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * p.t);
      const x = from.x + (to.x - from.x) * p.t;
      const y = from.y + (to.y - from.y) * p.t;
      useSkyStore.getState().setCamera({ k, x, y });
    },
  });
}

/** Zoom par facteur autour d'un point écran (par défaut : centre du ciel). */
export function zoomBy(factor: number, px?: number, py?: number, animated = true): void {
  const { w, h } = size();
  const c = useSkyStore.getState().camera;
  const next = zoomAt(c, factor, px ?? w / 2, py ?? h / 2, w, h);
  if (animated) animateCameraTo(next);
  else setCameraNow(next);
}

export function panCamera(dx: number, dy: number): void {
  const { w, h } = size();
  setCameraNow(panBy(useSkyStore.getState().camera, dx, dy, w, h));
}

export function resetCamera(): void {
  animateCameraTo(IDENTITY);
}
