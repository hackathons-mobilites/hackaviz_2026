import { diamondPoints, needsMarkCenter } from './needsMarkGeometry';
import { needsMark } from '../../theme/tokens';
import './needsMarks.css';

/**
 * Calque des marques « Ce qu'il me faut sur mon trajet » (V0, Maia reprendra le visuel) : un losange creux au bord de
 * chaque astre marqué. Calque SVG à part, décoratif (aria-hidden, sans clic) : il ne touche ni à la position, ni à la
 * taille, ni à la luminosité des astres, n'éteint ni ne retire aucune étoile. Le texte de la marque est dans le nom
 * accessible de l'astre (PoleLayer), la légende et le panneau.
 */
export function NeedsMarkLayer({ astres, width, height }: { astres: readonly { x: number; y: number; r: number }[]; width: number; height: number }) {
  if (astres.length === 0) return null;
  return (
    <svg className="needs-marks" aria-hidden="true" focusable="false" width={width} height={height}>
      {astres.map((a, i) => {
        const c = needsMarkCenter(a.x, a.y, a.r);
        const pts = diamondPoints(c.x, c.y, needsMark.size);
        return (
          <g key={i}>
            <polygon points={pts} className="needs-mark-halo" />
            <polygon points={pts} className="needs-mark-shape" />
          </g>
        );
      })}
    </svg>
  );
}

/** Même losange dans la légende (forme identique à celle du ciel). */
export function NeedsMarkGlyph({ size = 20 }: { size?: number }) {
  const pts = diamondPoints(10, 10, needsMark.size * 1.4);
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <polygon points={pts} className="needs-mark-shape" />
    </svg>
  );
}
