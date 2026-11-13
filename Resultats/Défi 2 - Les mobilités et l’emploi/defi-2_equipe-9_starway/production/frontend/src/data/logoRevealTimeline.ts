/**
 * Chronologie de l'animation du logo de l'écran titre (motion-spec, « Le logo se verrouille »). Fonctions PURES :
 * toute la scène est une fonction du temps, ce qui rend l'animation testable et reproductible en vidéo.
 * Aucune donnée ici : ni les étoiles ni la comète de ce logo ne représentent un pôle ou un trajet.
 */
import { logoReveal } from '../theme/tokens';

export interface LogoTimeline {
  /** Instant (ms) où chaque étoile se verrouille ; la dernière lance le recul de la caméra et le mot */
  arrivals: number[];
  finalAt: number;
  /** Début et fin du recul : le symbole, grand et centré, rejoint sa place de logo */
  pullAt: number;
  pullEnd: number;
  /** Instant d'apparition de chaque lettre de STARWAY */
  letterAt: number[];
  /** Début du passage de la lumière sur le mot */
  sweepAt: number;
  /** Fin de l'animation d'ouverture */
  end: number;
  /** Instant où le titre peut commencer à apparaître */
  titleAt: number;
}

export function buildLogoTimeline(t: typeof logoReveal = logoReveal, letters = 7): LogoTimeline {
  const arrivals: number[] = [t.ignite];
  let finalAt: number = t.ignite;
  for (const d of t.segments) {
    finalAt += d;
    arrivals.push(finalAt);
  }
  const pullAt = finalAt + t.finalHold;
  const pullEnd = pullAt + t.camera;
  const letterAt = Array.from({ length: letters }, (_, i) => pullAt + t.letterDelay + i * t.letterStagger);
  const lastLetter = pullAt + t.letterDelay + (letters - 1) * t.letterStagger;
  const sweepAt = pullAt + t.sweepDelay;
  const end = Math.max(lastLetter + t.letterDuration, pullEnd, sweepAt + t.sweep, finalAt + t.shock);
  return { arrivals, finalAt, pullAt, pullEnd, letterAt, sweepAt, end, titleAt: pullAt + t.titleAfterPull };
}

export const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
export const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 3;
export const easeInOut = (u: number): number => {
  const v = clamp01(u);
  return v < 0.5 ? 2 * v * v : 1 - (-2 * v + 2) ** 2 / 2;
};
const easeInOutCubic = (u: number): number => {
  const v = clamp01(u);
  return v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2;
};
/** Bosse de 0 à 1 puis retour à 0, pour les impulsions */
export const bump = (u: number): number => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));
/** Échelle d'une étoile qui se verrouille : part de sa taille en sommeil, dépasse, puis revient à 1 */
export const popScale = (u: number, from: number = logoReveal.dormantScale, peak: number = logoReveal.lockPeak): number => {
  const v = clamp01(u);
  return v < 0.3 ? from + (peak - from) * easeOut(v / 0.3) : peak - (peak - 1) * easeOut((v - 0.3) / 0.7);
};

/** Avancée de la comète à l'instant `t` : segment et part parcourue, ou null hors du parcours. */
export function cometAt(tl: LogoTimeline, t: number): { seg: number; p: number } | null {
  for (let i = 0; i < tl.arrivals.length - 1; i++) {
    const a = tl.arrivals[i] as number;
    const b = tl.arrivals[i + 1] as number;
    if (t >= a && t < b) return { seg: i, p: (t - a) / (b - a) };
  }
  return null;
}

/**
 * Position de la caméra : 0 = symbole grand et centré, 1 = logo à sa place définitive (aucune transformation).
 * `replay` (clic sur le logo) : le logo part de sa place et revient au centre avant de rejouer.
 */
export function cameraAt(tl: LogoTimeline, t: number, replay = false, cameraIn: number = logoReveal.cameraIn): number {
  if (t >= tl.pullEnd) return 1;
  if (t >= tl.pullAt) return easeInOutCubic((t - tl.pullAt) / (tl.pullEnd - tl.pullAt));
  if (replay && t < cameraIn) return 1 - easeInOutCubic(t / cameraIn);
  return 0;
}

export interface SceneFit {
  /** Largeur de la fenêtre (px) */
  viewportWidth: number;
  /** Hauteur (px) de la zone libre pour le symbole, au-dessus des boutons */
  zoneHeight: number;
  /** Taille d'une unité du logo à sa place définitive (px) */
  restUnit: number;
  /** Emprise du symbole, en unités du logo */
  symbol: { width: number; height: number };
}

/** Grossissement de la scène d'ouverture : le symbole tient dans la zone libre, jamais plus petit que le logo. */
export function sceneZoom(f: SceneFit, t: typeof logoReveal = logoReveal): number {
  const width = Math.min(f.viewportWidth * t.sceneWidth, t.sceneMaxWidth);
  const unit = Math.min(width / f.symbol.width, (f.zoneHeight * t.sceneHeight) / f.symbol.height);
  return Math.max(1, unit / f.restUnit);
}
