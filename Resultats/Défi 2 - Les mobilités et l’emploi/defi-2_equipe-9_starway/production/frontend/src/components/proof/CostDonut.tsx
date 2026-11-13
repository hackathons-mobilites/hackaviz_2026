import { useId } from 'react';
import { breakdownSentence, type CostBreakdown } from '../../data/costBreakdown';
import { euro } from '../../data/carCostChart';
import './costDonut.css';

const R = 40;
const CIRC = 2 * Math.PI * R;
/** Petit blanc entre deux parts (unités du tracé) : elles se distinguent sans reposer sur la couleur seule */
const GAP = 1.6;

/**
 * Anneau des dépenses d'un sens (demande de Nicolas du 12/11), dans le « i » de la tuile Coût : une part par dépense, le total au centre,
 * la légende écrite à côté (pourcentage, libellé, montant). La part ne repose jamais sur la seule couleur : première part pleine,
 * deuxième hachurée, troisième pointillée. Aucune couleur de verdict (cyan réservé à l'accessible, or au gain démontré).
 * Un lecteur d'écran lit la phrase (`breakdownSentence`), pas le dessin.
 */
export function CostDonut({ breakdown, title }: { breakdown: CostBreakdown; title: string }) {
  const id = useId().replace(/:/g, '');
  const solo = breakdown.slices.length === 1;
  // Début de chaque part (en % déjà dessinés avant elle) : calculé sans réaffecter de variable pendant le rendu
  const arcs = breakdown.slices.map((s, i) => {
    const before = breakdown.slices.slice(0, i).reduce((sum, x) => sum + x.pct, 0);
    const len = (s.pct / 100) * CIRC;
    const shown = Math.max(len - GAP, 0.1);
    return { s, i, dash: solo ? `${CIRC} 0` : `${shown} ${CIRC - shown}`, dashOffset: -((before / 100) * CIRC) };
  });
  return (
    <figure className="cost-donut" aria-label={title}>
      <svg className="cost-donut-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--cd-bg)" />
            <rect width="2.2" height="5" fill="var(--cd-1)" />
          </pattern>
          <pattern id={`${id}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="var(--cd-bg)" />
            <circle cx="2.5" cy="2.5" r="1.3" fill="var(--cd-1)" />
          </pattern>
        </defs>
        <circle cx="50" cy="50" r={R} className="cost-donut-track" />
        {arcs.map(({ s, i, dash, dashOffset }) => {
          const paint = i === 0 && !s.hatched ? 'var(--cd-1)' : s.hatched ? `url(#${id}-hatch)` : `url(#${id}-dots)`;
          return <circle key={s.id} cx="50" cy="50" r={R} className="cost-donut-arc" stroke={paint} strokeDasharray={dash} strokeDashoffset={dashOffset} transform="rotate(-90 50 50)" />;
        })}
        <text x="50" y="50" className="cost-donut-total" textAnchor="middle" dominantBaseline="central">
          {euro(breakdown.totalEur)}
        </text>
      </svg>
      <figcaption className="cost-donut-legend">
        <ul>
          {breakdown.slices.map((s, i) => (
            <li key={s.id}>
              <span className={`cost-donut-swatch is-${i === 0 && !s.hatched ? 'solid' : s.hatched ? 'hatch' : 'dots'}`} aria-hidden="true" />
              <span className="cost-donut-pct">{s.pct}&nbsp;%</span> <span className="cost-donut-label">{s.label}</span>
              <span className="cost-donut-eur"> {s.detail ? `${s.detail}, ` : ''}{euro(s.eur)}</span>
            </li>
          ))}
        </ul>
        {breakdown.note && <p className="cost-donut-note">{breakdown.note}</p>}
        <span className="sr-only">{breakdownSentence(breakdown)}</span>
      </figcaption>
    </figure>
  );
}
