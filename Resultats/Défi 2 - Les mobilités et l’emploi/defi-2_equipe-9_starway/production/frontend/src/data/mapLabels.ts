/**
 * Étiquettes de la carte miroir : même principe que placeWithLeaders (labels.ts, positions proches
 * puis à distance avec trait de rappel), avec trois garanties en plus pour les amas serrés (cœur
 * parisien) :
 * - plusieurs distances de rappel, essayées de la plus proche à la plus lointaine ;
 * - à distance égale, la direction qui s'éloigne du centre de l'amas passe en premier ;
 * - une étiquette ne recouvre aucun disque (halo lumineux compris), et son trait ne traverse ni une
 *   autre étiquette, ni un autre disque, ni un autre trait.
 * Fonction pure (px écran), sans DOM.
 */
import { ringCandidates, type LabelBox, type PlacedLabel } from './labels';

export interface MapDisc {
  x: number;
  y: number;
  r: number;
}

export interface MapLabelItem {
  /** Index du pôle (ordre de poles.json), ou valeur négative pour une étiquette hors pôle */
  index: number;
  cx: number;
  cy: number;
  r: number;
  w: number;
  h: number;
}

export interface MapLabelOptions {
  /** Zone autorisée (les étiquettes restent dans le cadre de la carte) */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Zones déjà occupées (étiquette de la commune d'origine…) */
  reserved?: readonly LabelBox[];
  /** Distances au bord du disque : la première sans trait, les suivantes avec trait de rappel */
  distances?: readonly number[];
  /** Marge entre deux étiquettes (px) */
  pad?: number;
  /** Rayon ajouté aux disques pour tenir compte de leur halo lumineux (px) */
  glow?: number;
}

type Seg = { x1: number; y1: number; x2: number; y2: number };
type Box = Omit<LabelBox, 'index'>;

const DEFAULT_DISTANCES = [4, 22, 40, 60, 84] as const;

function boxesHit(a: Box, b: Box, pad: number): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

function boxHitsDisc(b: Box, d: MapDisc, extra: number): boolean {
  const nx = Math.max(b.x, Math.min(d.x, b.x + b.w));
  const ny = Math.max(b.y, Math.min(d.y, b.y + b.h));
  return Math.hypot(d.x - nx, d.y - ny) < d.r + extra;
}

function segPointDistance(s: Seg, px: number, py: number): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / l2)) : 0;
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsCross(a: Seg, b: Seg): boolean {
  const d1 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segmentHitsBox(s: Seg, b: Box, pad = 0): boolean {
  const x0 = b.x - pad;
  const y0 = b.y - pad;
  const x1 = b.x + b.w + pad;
  const y1 = b.y + b.h + pad;
  const inside = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1;
  if (inside(s.x1, s.y1) || inside(s.x2, s.y2)) return true;
  const edges: Seg[] = [
    { x1: x0, y1: y0, x2: x1, y2: y0 },
    { x1: x1, y1: y0, x2: x1, y2: y1 },
    { x1: x1, y1: y1, x2: x0, y2: y1 },
    { x1: x0, y1: y1, x2: x0, y2: y0 },
  ];
  return edges.some((e) => segmentsCross(s, e));
}

/**
 * Place les étiquettes par priorité (ordre de `items`). Une étiquette sans aucune position valide
 * est omise : le nom reste dans le bouton du disque (aria-label) et dans l'infobulle.
 */
export function placeMapLabels(items: readonly MapLabelItem[], discs: readonly (MapDisc | null)[], opts: MapLabelOptions): PlacedLabel[] {
  const pad = opts.pad ?? 3;
  const glow = opts.glow ?? 6;
  const distances = opts.distances ?? DEFAULT_DISTANCES;
  const { bounds } = opts;
  const solid = discs.filter((d): d is MapDisc => !!d);
  const cx0 = solid.reduce((s, d) => s + d.x, 0) / Math.max(1, solid.length);
  const cy0 = solid.reduce((s, d) => s + d.y, 0) / Math.max(1, solid.length);
  const boxes: Box[] = [...(opts.reserved ?? [])];
  const leaders: Seg[] = [];
  const out: PlacedLabel[] = [];

  for (const it of items) {
    // direction qui s'éloigne de l'amas (sinon : dessous, comme ringCandidates)
    let ox = it.cx - cx0;
    let oy = it.cy - cy0;
    const on = Math.hypot(ox, oy);
    if (on < 1) {
      ox = 0;
      oy = 1;
    } else {
      ox /= on;
      oy /= on;
    }
    const own = (d: MapDisc) => Math.abs(d.x - it.cx) < 0.01 && Math.abs(d.y - it.cy) < 0.01;
    let chosen: (Box & { leader?: Seg }) | null = null;
    for (let k = 0; k < distances.length && !chosen; k++) {
      const cands = ringCandidates(it.cx, it.cy, it.r, it.w, it.h, distances[k]!, k > 0);
      const scored = cands
        .map((c) => {
          const ux = c.x + c.w / 2 - it.cx;
          const uy = c.y + c.h / 2 - it.cy;
          const n = Math.hypot(ux, uy) || 1;
          return { c, score: (ux / n) * ox + (uy / n) * oy };
        })
        // à la distance la plus proche, l'ordre de ringCandidates (dessous, droite…) reste prioritaire
        .sort((a, b) => (k === 0 ? 0 : b.score - a.score));
      for (const { c } of scored) {
        if (c.x < bounds.x0 || c.y < bounds.y0 || c.x + c.w > bounds.x1 || c.y + c.h > bounds.y1) continue;
        if (boxes.some((b) => boxesHit(c, b, pad))) continue;
        if (solid.some((d) => !own(d) && boxHitsDisc(c, d, glow))) continue;
        const lead = c.leader;
        if (lead) {
          if (boxes.some((b) => segmentHitsBox(lead, b, 1))) continue;
          if (solid.some((d) => !own(d) && segPointDistance(lead, d.x, d.y) < d.r + glow / 2)) continue;
          if (leaders.some((l) => segmentsCross(lead, l))) continue;
        }
        chosen = c;
        break;
      }
    }
    if (!chosen) continue;
    const placed: PlacedLabel = { index: it.index, x: chosen.x, y: chosen.y, w: chosen.w, h: chosen.h };
    if (chosen.leader) {
      placed.leader = chosen.leader;
      leaders.push(chosen.leader);
    }
    boxes.push(placed);
    out.push(placed);
  }
  return out;
}
