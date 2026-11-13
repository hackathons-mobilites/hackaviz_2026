/**
 * Navigation au clavier entre les astres : flèche = astre le plus proche dans cette direction
 * (cône de 90°), sinon rien. Fonction pure.
 */
export type ArrowDir = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const VEC: Record<ArrowDir, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export function nearestInDirection(points: readonly { x: number; y: number }[], from: number, dir: ArrowDir): number | null {
  const o = points[from];
  if (!o) return null;
  const [vx, vy] = VEC[dir];
  let best: number | null = null;
  let bestScore = Infinity;
  points.forEach((p, i) => {
    if (i === from) return;
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const along = dx * vx + dy * vy;
    if (along <= 0) return;
    const across = Math.abs(dx * vy - dy * vx);
    if (across > along) return; // hors du cône de 90°
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
