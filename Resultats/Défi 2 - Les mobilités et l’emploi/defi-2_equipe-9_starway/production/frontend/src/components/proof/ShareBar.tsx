import { triChart as T, shareBar as S } from '../../theme/tokens';
import './commChart.css';


/**
 * Barre fine d'une part (lot 4, D-051) : une piste en contour et un remplissage de la part, ET le chiffre écrit à côté (c'est le
 * chiffre qui fait foi, la barre le montre ; jamais de camembert). Décorative (`aria-hidden`) ; `title` est l'info-bulle du survol.
 * `fraction` de 0 à 1. Couleur : cyan pour une part accessible, perle pour une donnée neutre.
 */
export function ShareBar({ fraction, color, title }: { fraction: number | null; color: string; title: string }) {
  if (fraction == null) return null;
  return (
    <svg className="pf-sb" viewBox={`0 0 ${T.width} ${S.barPx}`} width="100%" height={S.barPx} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <title>{title}</title>
      <rect x={0.5} y={0.5} width={T.width - 1} height={S.barPx - 1} rx={(S.barPx - 1) / 2} className="pf-sb-track" fill="none" strokeWidth={1} />
      <rect x={0} y={0} width={fraction * T.width} height={S.barPx} rx={S.barPx / 2} fill={color} />
    </svg>
  );
}
