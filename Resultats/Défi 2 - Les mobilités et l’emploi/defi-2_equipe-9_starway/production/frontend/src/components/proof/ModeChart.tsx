import { scaleLinear } from 'd3-scale';
import { useId } from 'react';
import { modeChartReading } from '../../data/chartReading';
import { wrapLabel, type ModeChartModel } from '../../data/modeChart';
import type { ModeId } from '../../data/types';
import { usePalette } from '../../store/colorVisionStore';
import { triChart as T, tripBand as B } from '../../theme/tokens';
import { ChartReadingTip } from '../ChartReadingTip';
import { TriMark } from './TriMark';
import './commChart.css';

/**
 * Graphique des moyens de transport (lot 4, D-051), au-dessus du tableau complet qui reste : une ligne par mode, triée par le temps aller
 * + retour, triangle aller (vers la droite) en haut, retour (vers la gauche) en bas, sur un axe qui part de 0. Perle (donnée neutre), tous
 * pleins : ni ligne de budget ni verdict (ils sont dans le tableau). « Aucun trajet » et « Non calculé » sont écrits, jamais dessinés.
 * Décoratif (`aria-hidden`) : le tableau juste dessous porte les mêmes valeurs ; survol d'une ligne du dessin ou focus d'une ligne du
 * tableau (`active`, `onActive` : état commun tenu par le bloc) éclairent la ligne et affichent la phrase.
 */
export function ModeChart({ model, title, active, onActive, verdicts = true }: { model: ModeChartModel; title: string; active: ModeId | null; onActive: (m: ModeId | null) => void; /** Le tableau porte-t-il un verdict ? (pas en commune par commune) */ verdicts?: boolean }) {
  const stroke = usePalette().color.neutral;
  const clipId = `${useId()}-lbl`;
  const { rows, axisMax } = model;
  const plotL = T.labelWidePx;
  // Nombre de caractères d'un nom par ligne : largeur de la colonne sur la largeur moyenne d'un caractère (jeton de la bande du trajet)
  const maxChars = Math.floor((T.labelWidePx - T.markPx) / (T.fontPx * B.charEm));
  const plotR = T.width - T.markPx;
  const x = scaleLinear().domain([0, axisMax || 1]).range([plotL, plotR]);
  const bodyH = rows.length * T.rowPx;
  const H = bodyH + T.axisPx;
  const on = rows.findIndex((r) => r.mode === active);

  const leg = (r: (typeof rows)[number], dir: 'out' | 'ret', y: number) => {
    const l = r[dir];
    if (l.minutes == null) {
      return (
        <text x={plotL + T.markPx} y={y} dominantBaseline="central" className="pf-cc-written" fontSize={T.fontPx - 1}>
          {l.written}
        </text>
      );
    }
    const cx = x(l.minutes);
    const right = cx <= (plotL + plotR) / 2;
    return (
      <g>
        <TriMark dir={dir} x={cx} y={y} filled stroke={stroke} />
        <text x={right ? cx + T.markPx + 3 : cx - T.markPx - 3} y={y} textAnchor={right ? 'start' : 'end'} dominantBaseline="central" className="pf-cc-min" fontSize={T.fontPx - 1}>
          {l.minutes}
        </text>
      </g>
    );
  };

  return (
    <figure className="pf-cc" onKeyDown={(e) => e.key === 'Escape' && onActive(null)}>
      <figcaption className="pf-cc-title chart-read-row">
        <span>{title}</span>
        {/* « Comment lire ce graphique » : la ligne du haut, la plus longue et le ciel affiché, lus dans le modèle (« Le verdict est dans le tableau. » y est rangé) */}
        <ChartReadingTip chart="temps de trajet par moyen de transport" reading={modeChartReading(model, { verdicts })} placement="top" />
      </figcaption>
      <p className="pf-cc-key">
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
          <TriMark dir="out" x={7} y={6} filled stroke={stroke} />
        </svg>{' '}
        aller en haut,{' '}
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
          <TriMark dir="ret" x={7} y={6} filled stroke={stroke} />
        </svg>{' '}
        retour en bas, en minutes.
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
              <g key={r.mode} onMouseEnter={() => onActive(r.mode)} onMouseLeave={() => onActive(null)}>
                <rect x={0} y={top} width={T.width} height={T.rowPx} className={r.mode === active ? 'pf-cc-hit pf-cc-on' : 'pf-cc-hit'} />
                <text x={0} y={top + T.rowPx / 2 - ((wrapLabel(r.label, maxChars).length - 1) * T.fontPx) / 2} className="pf-cc-name" fontSize={T.fontPx} clipPath={`url(#${clipId})`} dominantBaseline="central">
                  {wrapLabel(r.label, maxChars).map((line, k) => (
                    <tspan key={k} x={0} dy={k === 0 ? 0 : T.fontPx}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {leg(r, 'out', top + T.laneOutPx)}
                {leg(r, 'ret', top + T.laneRetPx)}
              </g>
            );
          })}
          <line x1={plotL} x2={plotR} y1={bodyH} y2={bodyH} className="pf-cc-axis" strokeWidth={T.strokePx / 2} />
          <text x={plotL} y={bodyH + T.fontPx + 3} className="pf-cc-tick" fontSize={T.fontPx - 1}>
            0
          </text>
          {axisMax > 0 && (
            <text x={plotR} y={bodyH + T.fontPx + 3} textAnchor="end" className="pf-cc-tick" fontSize={T.fontPx - 1}>
              {axisMax} min
            </text>
          )}
        </svg>
        {on >= 0 && (
          <div className="pf-cc-tip" role="presentation" style={{ top: `${((on + 1) * T.rowPx + T.hitPad) / H * 100}%` }}>
            {rows[on]!.sentence}
          </div>
        )}
      </div>
    </figure>
  );
}
