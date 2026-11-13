import { useId, type ReactNode } from 'react';
import { recruitChartReading } from '../../data/chartReading';
import type { RecruitChartRow } from '../../data/recruitChart';
import { ChartReadingTip } from '../ChartReadingTip';
import { usePalette } from '../../store/colorVisionStore';
import { barChart as BC, triChart as T, tripBand as B } from '../../theme/tokens';
import './commChart.css';

/**
 * Graphique « Projets de recrutement du bassin » (lot 4, D-051) : une barre par famille de métiers, de la plus grande à la plus petite ;
 * le nom et la valeur écrite en haut de chaque ligne, la barre dessous ; le bout d'une barre « au moins n » est estompé (cases « * » non
 * comptées) ; une famille non diffusée n'a pas de barre, la ligne le dit. Perle (donnée neutre). La longueur est un repère visuel (projets
 * rapportés à la plus grande famille), pas une part. Décoratif (`aria-hidden`) : la liste juste dessous (hors écran), mêmes phrases
 * qu'avant, est le tableau des lecteurs d'écran ; survol d'une ligne, ou focus d'une ligne de la liste, affichent la phrase. Aucune
 * animation. Le sélecteur de famille du bloc est conservé : la famille choisie est soulignée.
 */
export function RecruitChart({
  rows,
  title,
  bassin,
  year,
  active,
  onActive,
  children,
}: {
  rows: readonly RecruitChartRow[];
  title: string;
  /** Nom du bassin d'emploi et année de l'enquête, repris dans le cas du « i » */
  bassin: string;
  year: number | null;
  active: string | null;
  onActive: (code: string | null) => void;
  children: ReactNode;
}) {
  const palette = usePalette().color;
  const uid = useId();
  const gradId = `${uid}-fade`;
  const clipId = `${uid}-nm`;
  const H = rows.length * BC.rowPx;
  const valueW = (r: RecruitChartRow) => r.phrase.length * T.fontPx * B.charEm;
  const on = rows.findIndex((r) => r.code === active);

  return (
    <figure className="pf-cc" onKeyDown={(e) => e.key === 'Escape' && onActive(null)}>
      <figcaption className="pf-cc-title chart-read-row">
        <span>{title}</span>
        {/* « Comment lire ce graphique » : la barre du haut et la plus courte, lues dans les lignes du graphique */}
        <ChartReadingTip chart="projets de recrutement par famille de métiers" reading={recruitChartReading(rows, { bassin, year })} placement="top" />
      </figcaption>
      <div className="pf-cc-plot">
        <svg viewBox={`0 0 ${T.width} ${H}`} width="100%" aria-hidden="true" focusable="false" className="pf-cc-svg">
          <defs>
            <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor={palette.neutral} stopOpacity="1" />
              <stop offset="1" stopColor={palette.neutral} stopOpacity={BC.fadeAlpha} />
            </linearGradient>
          </defs>
          {rows.map((r, i) => {
            const top = i * BC.rowPx;
            const w = r.bar * T.width;
            const solid = r.atLeast ? w * (1 - BC.fadeFrac) : w;
            return (
              <g key={r.code} onMouseEnter={() => onActive(r.code)} onMouseLeave={() => onActive(null)}>
                <clipPath id={`${clipId}-${i}`}>
                  <rect x={0} y={top} width={Math.max(T.width - valueW(r) - T.markPx, 0)} height={BC.rowPx} />
                </clipPath>
                <rect x={0} y={top} width={T.width} height={BC.rowPx} className={r.code === active ? 'pf-cc-hit pf-cc-on' : 'pf-cc-hit'} />
                <text x={0} y={top + BC.textY} dominantBaseline="central" className={r.selected ? 'pf-cc-name pf-rc-sel' : 'pf-cc-name'} fontSize={T.fontPx} clipPath={`url(#${clipId}-${i})`}>
                  {r.label}
                </text>
                <text x={T.width} y={top + BC.textY} textAnchor="end" dominantBaseline="central" className="pf-cc-jobs" fontSize={T.fontPx}>
                  {r.phrase}
                </text>
                {r.n != null && w > 0 && (
                  <>
                    <rect x={0} y={top + BC.barY} width={solid} height={BC.barPx} fill={palette.neutral} />
                    {r.atLeast && <rect x={solid} y={top + BC.barY} width={w - solid} height={BC.barPx} fill={`url(#${gradId})`} />}
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {on >= 0 && (
          <div className="pf-cc-tip" role="presentation" style={{ top: `${(((on + 1) * BC.rowPx) / H) * 100}%` }}>
            {rows[on]!.sentence}
          </div>
        )}
      </div>
      {/* Liste pour les lecteurs d'écran (mêmes phrases qu'avant), hors de l'écran ; ses lignes prennent le focus clavier */}
      <div className="pf-sr-clip">{children}</div>
    </figure>
  );
}
