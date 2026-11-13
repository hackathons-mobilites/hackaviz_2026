/**
 * Géométrie du ciel - fonctions pures, partagées par le moteur PixiJS et la couche DOM accessible.
 * Positions et tailles des astres : calculées depuis poles.json, identiques dans tous les scénarios.
 */
import { scaleSqrt } from 'd3-scale';
import type { Pole, SkyPosition } from '../data/types';
import { gainMark, poleLook, sky44, skyLayout, skyRelax } from '../theme/tokens';

export interface SkyFrame {
  width: number;
  height: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Emprise des données (sky.x / sky.y) cadrée dans le cadre */
  bounds: SkyBounds;
}

/** Boîte englobante des positions sky des communes et des pôles (+ marge). */
export interface SkyBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const UNIT_BOUNDS: SkyBounds = { x0: 0, y0: 0, x1: 1, y1: 1 };

/**
 * Emprise réelle des données, calculée une fois par jeu de données : la même pour toutes les
 * communes et tous les scénarios (règle 4 : le ciel est stable).
 */
export function skyBounds(points: readonly SkyPosition[], pad: number = skyLayout.boundsPad): SkyBounds {
  if (!points.length) return UNIT_BOUNDS;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

/**
 * Mise en page téléphone : fenêtre étroite (≤ 430 px), ou fenêtre basse et pas large (≤ 480 px de haut, moins de 1 024 px de large : zoom
 * à 200 %, téléphone à l'horizontale). Même règle que les `@media` : `(max-width: 430px), (max-width: 1023px) and (max-height: 480px)`.
 */
export function isPhoneLayout(width: number, height: number): boolean {
  return width <= 430 || (width <= 1023 && height <= 480);
}

/**
 * Cadre du ciel dans la fenêtre. `barHeight` = hauteur mesurée de la barre de scénario :
 * le ciel se cadre au-dessus (même règle pour le moteur et la couche DOM).
 */
export function computeFrame(
  width: number,
  height: number,
  barHeight?: number,
  bounds: SkyBounds = UNIT_BOUNDS,
  /** Marge haute imposée (diptyque empilé sur mobile) */
  topInset?: number,
): SkyFrame {
  const phone = isPhoneLayout(width, height);
  const narrow = width < 760 || phone;
  const top0 = narrow ? skyLayout.marginTop + 24 : skyLayout.marginTop;
  // Mobile : le ciel commence sous la barre du haut de 52 px
  const top = topInset ?? (phone ? 64 : top0);
  const bottom = barHeight != null ? barHeight + 40 : narrow ? skyLayout.marginBottom + 110 : skyLayout.marginBottom;
  const side = phone ? 12 : Math.max(24, width * skyLayout.marginSide);
  const w = Math.max(100, width - side * 2);
  const h = Math.max(100, height - top - bottom);
  return { width, height, x: side, y: top, w, h, bounds };
}

/**
 * Échelle UNIQUE (la même en x et en y), emprise des données centrée dans le cadre : x et y ne sont jamais étirés différemment,
 * donc les directions et les distances relatives de sky.x / sky.y sont conservées quel que soit l'écran.
 */
export function toScreen(frame: SkyFrame, p: SkyPosition): { x: number; y: number } {
  const b = frame.bounds;
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const s = Math.min(frame.w / bw, frame.h / bh);
  return {
    x: frame.x + (frame.w - s * bw) / 2 + (p.x - b.x0) * s,
    y: frame.y + (frame.h - s * bh) / 2 + (p.y - b.y0) * s,
  };
}

/**
 * Rayon ∝ √postes : l'AIRE du disque est proportionnelle aux postes salariés (INSEE).
 * Domaine [0, max] (ancré à zéro). Pôle aux postes inconnus : rayon minimal (et contour pointillé).
 */
export function makeRadius(poles: readonly Pole[], frame: SkyFrame): (jobs: number | null) => number {
  const known = poles.map((p) => p.jobs).filter((j): j is number => j != null && j > 0);
  const max = Math.max(1, ...known);
  const min = known.length ? Math.min(...known) : max;
  // Rayon max d'écran ; s'il laisserait le plus petit pôle sous le plancher, on l'agrandit pour TOUS
  // (r ∝ √postes conservé, donc l'aire reste strictement ∝ postes, sur tous les écrans et scénarios).
  const rScreen = Math.max(14, Math.min(frame.w, frame.h) * skyLayout.maxPoleRadius);
  const rMax = Math.max(rScreen, skyLayout.minPoleRadius * Math.sqrt(max / min));
  const s = scaleSqrt().domain([0, max]).range([0, rMax]);
  // Postes inconnus : rayon plancher (aucune aire à respecter, contour pointillé « non calculé »).
  return (jobs) => (jobs == null || jobs <= 0 ? skyLayout.minPoleRadius : s(jobs));
}

/**
 * Clé de taille de la légende (L-17) : deux valeurs rondes (1, 2 ou 5 × 10^n) qui encadrent les
 * postes des pôles, la plus grande inférieure ou égale au plus grand pôle, la plus petite supérieure
 * ou égale au plus petit. Dérivées des données, jamais écrites en dur ; ce sont des repères de
 * lecture tracés par la même échelle que les astres, pas des données. Une seule valeur si les deux
 * se confondent, aucune sans postes connus.
 */
export function sizeKeyValues(jobs: readonly (number | null | undefined)[]): number[] {
  const known = jobs.filter((j): j is number => j != null && Number.isFinite(j) && j > 0);
  if (!known.length) return [];
  const min = Math.min(...known);
  const max = Math.max(...known);
  const nice = (n: number, up: boolean): number => {
    const e = Math.floor(Math.log10(n));
    const cands = [-1, 0, 1].flatMap((d) => [1, 2, 5].map((m) => m * 10 ** (e + d))).sort((a, b) => a - b);
    return up ? cands.find((c) => c >= n)! : [...cands].reverse().find((c) => c <= n)!;
  };
  const large = nice(max, false);
  const small = nice(min, true);
  return small < large ? [small, large] : [large];
}

export interface PoleGeometry {
  index: number;
  id: string;
  x: number;
  y: number;
  r: number;
}

/** Troisième argument accepté et ignoré : `MirrorMap.tsx` le passe encore (ciel unique à 44 astres depuis D-054). */
export const poleGeometry: (poles: readonly Pole[], frame: SkyFrame, astres44?: boolean) => PoleGeometry[] = (poles, frame) => {
  const radius = makeRadius(poles, frame);
  const geo = poles.map((p, index) => ({ index, id: p.id, ...toScreen(frame, p.sky), r: radius(p.jobs) }));
  // D-030 (44 astres) : positions brutes du ciel (barycentre des postes), puis relaxation de collision sur les
  // 44 astres, en pixels : déterministe, déplacement minimal, mêmes positions dans tous les scénarios
  // (elle ne dépend que du cadre), rayons et aires inchangés. L'échelle globale n'est pas touchée.
  // sky44.relaxAll (jeton de Maia à régler) : false = positions brutes de la PR n° 19 + zoom automatique (SkyEngine)
  return sky44.relaxAll ? relaxPoles(geo, poles.map((p) => p.id), stateMarkOuter, skyRelax.minGap, RELAX_ALL_MAX_ITERATIONS) : geo;
};

/**
 * Bord extérieur des repères d'état d'un astre de rayon r (px), tiré des jetons de Maia
 * (`poleLook`, `gainMark`, tracés par sky/OutlineOverlay.ts et sky/layers/Poles.ts) : contour d'état à
 * r + ringGap (trait plein, tirets ou points, demi-épaisseur la plus forte), seconde orbite de l'or
 * à r + ringGap + gainMark.gap (demi-épaisseur gainMark.width / 2). Rien d'autre n'est ajouté.
 */
export function stateMarkOuter(r: number): number {
  const ring = Math.max(poleLook.ringWidth, poleLook.ringOffWidth, poleLook.unknownDotWidth) / 2;
  return r + poleLook.ringGap + Math.max(ring, gainMark.gap + gainMark.width / 2);
}

/**
 * Plafond de sécurité des passes de la relaxation des 44 astres : elle s'arrête dès qu'une passe ne
 * déplace plus rien (convergence mesurée en quelques dizaines de passes, `sky/layout44.test.ts`) ;
 * ce n'est pas un réglage visuel.
 */
export const RELAX_ALL_MAX_ITERATIONS = 2000;

/**
 * Relaxation de collision (L-23) : écarte deux à deux les pôles de `ids` dont les contours sont à
 * moins de `minGap` px, chacun de la moitié du manque, le long de la droite qui joint leurs centres ;
 * un pôle de `ids` trop proche d'un autre pôle s'en écarte seul (l'autre reste fixe).
 * Déterministe (ordre de poles.json, nombre d'itérations fixe), sans aléa : mêmes entrées, mêmes
 * positions. Les rayons (donc les aires) ne changent jamais ; les autres pôles ne bougent pas.
 */
export function relaxPoles(
  geo: readonly PoleGeometry[],
  ids: readonly string[],
  contour: (r: number) => number,
  minGap: number,
  iterations: number,
): PoleGeometry[] {
  const out = geo.map((g) => ({ ...g }));
  const moving = out.filter((g) => ids.includes(g.id));
  if (moving.length < 2) return out;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < moving.length; i++) {
      for (let j = i + 1; j < moving.length; j++) {
        const a = moving[i]!;
        const b = moving[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const need = contour(a.r) + contour(b.r) + minGap;
        if (d >= need - 1e-6) continue;
        // centres confondus : direction fixe (vers la droite), jamais aléatoire
        const ux = d > 1e-9 ? dx / d : 1;
        const uy = d > 1e-9 ? dy / d : 0;
        const push = (need - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
      // un pôle de Paris s'écarte aussi des contours voisins des autres pôles, qui ne bougent pas
      for (const o of out) {
        const a = moving[i]!;
        if (ids.includes(o.id)) continue;
        const dx = a.x - o.x;
        const dy = a.y - o.y;
        const d = Math.hypot(dx, dy);
        const need = contour(a.r) + contour(o.r) + minGap;
        if (d >= need - 1e-6 || d < 1e-9) continue;
        a.x += (dx / d) * (need - d);
        a.y += (dy / d) * (need - d);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

const boundsCache = new WeakMap<object, SkyBounds>();

/** Emprise d'un jeu de données (communes + pôles), mémorisée. */
export function datasetBounds(data: { communes: readonly { sky: SkyPosition }[]; poles: readonly { sky: SkyPosition }[] }): SkyBounds {
  let b = boundsCache.get(data);
  if (!b) {
    b = skyBounds([...data.communes.map((c) => c.sky), ...data.poles.map((p) => p.sky)]);
    boundsCache.set(data, b);
  }
  return b;
}

/**
 * Détection de chevauchement pour les astres en mode D-030 (44 astres) :
 * vérifie si deux astres ont leurs disques qui se chevauchent avec une marge (minGap).
 * Retourne le facteur de zoom automatique à appliquer (≥ 1) ; 1 = aucun zoom nécessaire.
 *
 * Stratégie : si au moins une paire se chevauche, appliquer un zoom uniforme k tel que
 * les positions se reculent d'un facteur k (les rayons ne changent pas), créant l'espace nécessaire.
 * Formule : pour deux disques à distance d, avec rayons r_a et r_b, nécessitant r_a + r_b + minGap :
 * on veut d × k = r_a + r_b + minGap → k = (r_a + r_b + minGap) / d
 */
export function detectOverlapZoom(geometry: readonly PoleGeometry[], minGap: number = 8): number {
  if (geometry.length < 2) return 1;
  
  let maxZoom = 1;
  for (let i = 0; i < geometry.length; i++) {
    for (let j = i + 1; j < geometry.length; j++) {
      const a = geometry[i]!;
      const b = geometry[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const needed = a.r + b.r + minGap;
      
      if (d < needed && d > 1e-9) {
        // Cette paire nécessite un zoom
        const k = needed / d;
        maxZoom = Math.max(maxZoom, k);
      } else if (d <= 1e-9) {
        // Centres confondus (très rare) : zoom conservateur
        maxZoom = Math.max(maxZoom, 1.5);
      }
    }
  }
  
  return Math.min(maxZoom, 6); // limiter au ZOOM_MAX existant
}

