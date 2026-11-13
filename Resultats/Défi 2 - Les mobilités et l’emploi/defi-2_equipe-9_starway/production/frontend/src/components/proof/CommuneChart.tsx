import { scaleLinear } from 'd3-scale';
import { useId, useState } from 'react';
import { communeChartReading } from '../../data/chartReading';
import type { CommuneChartModel, CommuneChartRow } from '../../data/od/communeChart';
import { formatInt } from '../../data/format';
import { usePalette } from '../../store/colorVisionStore';
import { triChart as T } from '../../theme/tokens';
import { ChartReadingTip } from '../ChartReadingTip';
import { TriMark } from './TriMark';
import './commChart.css';

/**
 * Graphique des communes du pôle (lot 4, D-051), dans le pli « Communes du pôle » : une ligne par commune, triée par postes ; ALLER
 * (triangle vers la droite) en haut de la ligne, RETOUR (triangle vers la gauche) en bas, sur un axe commun qui part de 0 ; trait pointillé
 * au temps choisi ; triangle plein dans le temps choisi, vide au-delà ; postes à droite. Cyan seulement pour une commune accessible aller
 * et retour, perle sinon. Un sens sans durée est ÉCRIT (« Aucun trajet », « Non calculé »), jamais dessiné.
 *
 * Accessibilité : le dessin est décoratif (`aria-hidden`) ; le tableau qui suit, lu par les lecteurs d'écran, porte les mêmes phrases que
 * la liste d'avant. Ses lignes prennent le focus clavier : la ligne du dessin s'éclaire et la phrase complète s'affiche (comme au survol).
 * Échap la ferme. Aucune animation : rien à réduire en mouvement réduit.
 */
export function CommuneChart({ model, title }: { model: CommuneChartModel; title: string }) {
  const palette = usePalette().color;
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);
  const { rows, budget, axisMax, ticks } = model;
  const plotL = T.labelPx;
  const plotR = T.width - T.jobsPx - T.markPx;
  const x = scaleLinear().domain([0, axisMax]).range([plotL, plotR]);
  const bodyH = rows.length * T.rowPx;
  const H = bodyH + T.axisPx;
  const clipId = `${uid}-lbl`;
  // Une graduation trop proche de la précédente n'est pas écrite (le texte se recouvrirait) : écart minimal tiré de la taille du texte
  const labelled = ticks.filter((t, i) => i === 0 || x(t) - x(ticks[i - 1]!) >= T.fontPx * 4);
  const on = active != null ? rows[active] : null;

  const leg = (r: CommuneChartRow, dir: 'out' | 'ret', y: number) => {
    const l = r[dir];
    const stroke = r.accessible ? palette.accessible : palette.neutral;
    if (l.minutes == null) {
      return l.written ? (
        <text x={plotL + T.markPx} y={y} dominantBaseline="central" className="pf-cc-written" fontSize={T.fontPx - 1}>
          {l.written}
        </text>
      ) : null;
    }
    const cx = x(l.minutes);
    const right = cx <= (plotL + plotR) / 2;
    return (
      <g>
        <TriMark dir={dir} x={cx} y={y} filled={l.within} stroke={stroke} />
        <text x={right ? cx + T.markPx + 3 : cx - T.markPx - 3} y={y} textAnchor={right ? 'start' : 'end'} dominantBaseline="central" className="pf-cc-min" fontSize={T.fontPx - 1}>
          {l.minutes}
        </text>
      </g>
    );
  };

  return (
    <figure className="pf-cc" onKeyDown={(e) => e.key === 'Escape' && setActive(null)}>
      <figcaption className="pf-cc-title chart-read-row">
        <span>{title}</span>
        {/* « Comment lire ce graphique » : la commune du haut et le nombre de communes en cyan, lus dans le modèle */}
        <ChartReadingTip chart="temps de trajet par commune" reading={communeChartReading(model)} placement="top" />
      </figcaption>
      <p className="pf-cc-key">
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
          <TriMark dir="out" x={7} y={6} filled stroke={palette.neutral} />
        </svg>{' '}
        aller en haut,{' '}
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
          <TriMark dir="ret" x={7} y={6} filled stroke={palette.neutral} />
        </svg>{' '}
        retour en bas. Plein : dans les {budget} min par sens ; vide : au-delà.
      </p>
      <div className="pf-cc-plot">
        <svg viewBox={`0 0 ${T.width} ${H}`} width="100%" aria-hidden="true" focusable="false" className="pf-cc-svg">
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={plotL - T.markPx} height={bodyH} />
            </clipPath>
          </defs>
          {rows.map((r, i) => {
            const top = i * T.rowPx;
            return (
              <g key={r.insee} data-insee={r.insee} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive((a) => (a === i ? null : a))}>
                <rect x={0} y={top} width={T.width} height={T.rowPx} className={i === active ? 'pf-cc-hit pf-cc-on' : 'pf-cc-hit'} />
                <text x={0} y={top + T.rowPx / 2} dominantBaseline="central" className="pf-cc-name" fontSize={T.fontPx} clipPath={`url(#${clipId})`}>
                  {r.name}
                </text>
                {r.self ? (
                  <text x={plotL + T.markPx} y={top + T.rowPx / 2} dominantBaseline="central" className="pf-cc-written" fontSize={T.fontPx - 1}>
                    Votre commune, non mesuré
                  </text>
                ) : (
                  <>
                    {leg(r, 'out', top + T.laneOutPx)}
                    {leg(r, 'ret', top + T.laneRetPx)}
                  </>
                )}
                <text x={T.width} y={top + T.rowPx / 2} textAnchor="end" dominantBaseline="central" className="pf-cc-jobs" fontSize={T.fontPx}>
                  {formatInt(r.jobs)}
                </text>
              </g>
            );
          })}
          {/* Axe commun : part de 0 ; trait pointillé au temps choisi */}
          <line x1={plotL} x2={plotR} y1={bodyH} y2={bodyH} className="pf-cc-axis" strokeWidth={T.strokePx / 2} />
          <line x1={x(budget)} x2={x(budget)} y1={0} y2={bodyH} className="pf-cc-budget" strokeWidth={T.strokePx} strokeDasharray={T.dash} />
          {labelled.map((t) => (
            <text key={t} x={x(t)} y={bodyH + T.fontPx + 3} textAnchor={t === 0 ? 'start' : 'middle'} className="pf-cc-tick" fontSize={T.fontPx - 1}>
              {t === budget ? `${t} min` : t}
            </text>
          ))}
          <text x={T.width} y={bodyH + T.fontPx + 3} textAnchor="end" className="pf-cc-tick" fontSize={T.fontPx - 1}>
            postes
          </text>
        </svg>
        {on && (
          <div className="pf-cc-tip" role="presentation" style={{ top: `${(((active ?? 0) + 1) * T.rowPx + T.hitPad) / H * 100}%` }}>
            {on.sentence}
          </div>
        )}
      </div>
      {/* Tableau pour les lecteurs d'écran : mêmes phrases que la liste d'avant, une par ligne ; les lignes prennent le focus clavier */}
      <table className="pf-cc-table" role="table">
        <caption>{title}</caption>
        <tbody role="rowgroup">
          {rows.map((r, i) => (
            <tr key={r.insee} role="row" tabIndex={0} onFocus={() => setActive(i)} onBlur={() => setActive((a) => (a === i ? null : a))}>
              <th scope="row" role="rowheader">
                <strong>{r.name}</strong>
                <span>
                  {' '}
                  · {formatInt(r.jobs)} postes{r.accessible ? '' : ` · ${r.title}`}
                </span>
              </th>
              {r.outText && <td role="cell">{r.outText}</td>}
              {r.retText && <td role="cell">{r.retText}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
