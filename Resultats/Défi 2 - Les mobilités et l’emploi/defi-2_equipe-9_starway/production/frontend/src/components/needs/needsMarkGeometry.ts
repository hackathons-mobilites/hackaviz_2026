import { needsMark, poleLook } from '../../theme/tokens';

/** Centre du losange de marque pour un astre d'écran (x, y, rayon r) : au bord de son anneau d'état, dans la direction `needsMark.angle`. */
export function needsMarkCenter(x: number, y: number, r: number): { x: number; y: number } {
  const d = r + poleLook.ringGap + needsMark.gap + needsMark.size;
  const a = (needsMark.angle * Math.PI) / 180;
  return { x: x + d * Math.cos(a), y: y + d * Math.sin(a) };
}

/** Losange de demi-diagonale `s` centré en (cx, cy), en points SVG. */
export function diamondPoints(cx: number, cy: number, s: number): string {
  return `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`;
}
