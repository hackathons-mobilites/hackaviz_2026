import { scaleLinear } from 'd3-scale';
import type { ReactNode } from 'react';
import { trafficChartReading } from '../../data/chartReading';
import type { TrafficChartModel } from '../../data/trafficChart';
import { ChartReadingTip } from '../ChartReadingTip';
import { usePalette } from '../../store/colorVisionStore';
import { trafficChart as TC, triChart as T } from '../../theme/tokens';
import './commChart.css';

/**
 * Graphique « Voiture : route vide et trafic moyen » (lot 4, D-051) : une ligne par sens, le temps route vide en POINT VIDE, le temps
 * avec le trafic moyen en POINT PLEIN, reliés, sur un axe qui part de 0 ; l'indice de la tranche est écrit à droite. Sans indice
 * applicable, seul le point vide est dessiné et la ligne l'écrit ; sans trajet, rien n'est dessiné. Perle (donnée neutre), aucun cyan,
 * aucun or. Décoratif (`aria-hidden`) : la liste des sens, hors de l'écran, mêmes phrases qu'avant, est lue par les lecteurs d'écran ; ses
 * lignes prennent le focus clavier. Aucune animation.
 */
export function TrafficChart({
  model,
  title,
  active,
  onActive,
  children,
}: {
  model: TrafficChartModel;
  title: string;
  active: string | null;
  onActive: (label: string | null) => void;
  children: ReactNode;
}) {
  const stroke = usePalette().color.neutral;
  const { rows, axisMax } = model;
  const plotL = TC.labelPx;
  const plotR = T.width - TC.indexPx;
  const x = scaleLinear().domain([0, axisMax || 1]).range([plotL, plotR]);
  const bodyH = rows.length * TC.rowPx;
  const H = bodyH + TC.axisPx;
  const on = rows.findIndex((r) => r.label === active);

  return (
    <figure className="pf-cc" onKeyDown={(e) => e.key === 'Escape' && onActive(null)}>
      <figcaption className="pf-cc-title chart-read-row">
        <span>{title}</span>
        {/* « Comment lire ce graphique » : les deux sens, lus dans le modèle */}
        <ChartReadingTip chart="voiture, route vide et trafic moyen" reading={trafficChartReading(model)} placement="top" />
      </figcaption>
      <p className="pf-cc-key">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <circle cx="6" cy="6" r={TC.dotPx} fill="none" stroke={stroke} strokeWidth={T.strokePx} />
        </svg>{' '}
        route vide,{' '}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <circle cx="6" cy="6" r={TC.dotPx} fill={stroke} stroke={stroke} strokeWidth={T.strokePx} />
        </svg>{' '}
        trafic moyen (estimation), en minutes.
      </p>
      <div className="pf-cc-plot">
        <svg viewBox={`0 0 ${T.width} ${H}`} width="100%" aria-hidden="true" focusable="false" className="pf-cc-svg">
          {rows.map((r, i) => {
            const cy = i * TC.rowPx + TC.rowPx / 2;
            return (
              <g key={r.label} onMouseEnter={() => onActive(r.label)} onMouseLeave={() => onActive(null)}>
                <rect x={0} y={i * TC.rowPx} width={T.width} height={TC.rowPx} className={r.label === active ? 'pf-cc-hit pf-cc-on' : 'pf-cc-hit'} />
                <text x={0} y={cy} dominantBaseline="central" className="pf-cc-name" fontSize={T.fontPx}>
                  {r.label}
                </text>
                {r.free != null && (
                  <>
                    {r.traffic != null && <line x1={x(r.free)} x2={x(r.traffic)} y1={cy} y2={cy} stroke={stroke} strokeWidth={T.strokePx} />}
                    <circle cx={x(r.free)} cy={cy} r={TC.dotPx} fill="none" stroke={stroke} strokeWidth={T.strokePx} />
                    {r.traffic != null && <circle cx={x(r.traffic)} cy={cy} r={TC.dotPx} fill={stroke} stroke={stroke} strokeWidth={T.strokePx} />}
                    <text x={x(r.free) - TC.dotPx - 3} y={cy} textAnchor="end" dominantBaseline="central" className="pf-cc-min" fontSize={T.fontPx - 1}>
                      {r.free}
                    </text>
                    {r.traffic != null && (
                      <text x={x(r.traffic) + TC.dotPx + 3} y={cy} dominantBaseline="central" className="pf-cc-min" fontSize={T.fontPx - 1}>
                        {r.traffic}
                      </text>
                    )}
                  </>
                )}
                <text x={T.width} y={cy} textAnchor="end" dominantBaseline="central" className="pf-cc-jobs" fontSize={T.fontPx - 1}>
                  {r.indexText ?? r.written}
                </text>
              </g>
            );
          })}
          <line x1={plotL} x2={plotR} y1={bodyH} y2={bodyH} className="pf-cc-axis" strokeWidth={T.strokePx / 2} />
          <text x={plotL} y={bodyH + T.fontPx + 2} className="pf-cc-tick" fontSize={T.fontPx - 1}>
            0
          </text>
          {axisMax > 0 && (
            <text x={plotR} y={bodyH + T.fontPx + 2} textAnchor="end" className="pf-cc-tick" fontSize={T.fontPx - 1}>
              {axisMax} min
            </text>
          )}
        </svg>
        {on >= 0 && (
          <div className="pf-cc-tip" role="presentation" style={{ top: `${(((on + 1) * TC.rowPx) / H) * 100}%` }}>
            {rows[on]!.sentence}
          </div>
        )}
      </div>
      <div className="pf-sr-clip">{children}</div>
    </figure>
  );
}
