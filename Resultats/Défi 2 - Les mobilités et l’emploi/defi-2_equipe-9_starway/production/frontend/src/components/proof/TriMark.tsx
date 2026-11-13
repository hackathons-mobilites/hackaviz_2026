import { triChart } from '../../theme/tokens';

/**
 * Triangle des graphiques du panneau (lot 4, D-051) : ALLER = pointe vers la droite, RETOUR = pointe vers la gauche. Plein quand la
 * durée tient dans le temps choisi, vide (contour seul) au-delà : la forme et le remplissage portent le sens, la couleur seule ne le porte
 * jamais. Ni point plein ni anneau : le halo les emploie pour les femmes et les hommes.
 */
export function TriMark({ dir, x, y, filled, stroke, size = triChart.markPx }: { dir: 'out' | 'ret'; x: number; y: number; filled: boolean; stroke: string; size?: number }) {
  const s = dir === 'out' ? size : -size;
  const d = `M${x - s} ${y - size} L${x + s} ${y} L${x - s} ${y + size} Z`;
  return <path d={d} fill={filled ? stroke : 'none'} stroke={stroke} strokeWidth={triChart.strokePx} strokeLinejoin="round" />;
}
