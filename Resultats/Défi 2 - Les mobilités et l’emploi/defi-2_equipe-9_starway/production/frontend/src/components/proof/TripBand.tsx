import { scaleLinear } from 'd3-scale';
import { useId, useState } from 'react';
import { lineFactsShort, type ItinTrip } from '../../data/itineraries';
import type { LineFactsMeta } from '../../data/types';
import { tripBandReading } from '../../data/chartReading';
import { lineInk, tripBandModel, type TripBandSegment } from '../../data/tripBand';
import { ChartReadingTip } from '../ChartReadingTip';
import { usePalette } from '../../store/colorVisionStore';
import { triChart as T, tripBand as B } from '../../theme/tokens';
import { useIsPhone } from '../useBottomSheet';
import './tripBand.css';
import './commChart.css';

/**
 * Bande du trajet (lot 4, D-051) : un sens, à l'échelle du temps. Chaque tronçon est un segment dont la largeur est sa durée : la marche
 * en pointillé, l'attente avant de monter en cadre vide, un véhicule à la couleur GTFS de sa ligne (nom de la ligne dedans) ; la durée
 * est écrite dessous. Aller et retour partagent la même échelle (`scale`, le plus grand des deux totaux). Aucune ligne de budget : c'est
 * un exemple de trajet vers l'arrêt d'un astre, pas un verdict. Un nom ou une durée qui ne tient pas dans son segment n'est pas écrit
 * dans le dessin : il est dans le tableau (hors écran, rangées au focus clavier) et dans « Détail du trajet ».
 */
export function TripBand({ trip, scale, side, texts }: { trip: ItinTrip; scale: number; side: 'out' | 'ret'; texts?: LineFactsMeta['texts'] }) {
  const model = tripBandModel(trip);
  const palette = usePalette().color;
  const uid = useId();
  const fontPx = useIsPhone() ? B.fontPxPhone : B.fontPx;
  const [active, setActive] = useState<number | null>(null);
  if (!model || scale <= 0) return null;
  const x = scaleLinear().domain([0, scale]).range([0, T.width]);
  const H = B.bandPx + B.labelPx;
  const sentence = (s: TripBandSegment) => [s.text, s.leg ? `${s.leg.dep} → ${s.leg.arr}` : null, s.leg ? lineFactsShort(s.leg, texts) : null].filter(Boolean).join(' · ');
  const fits = (w: number, chars: number) => w >= chars * fontPx * B.charEm + 2;
  const on = active != null ? model.segments[active] : null;
  const word = side === 'out' ? 'aller' : 'retour';

  return (
    <figure className="pf-tb" onKeyDown={(e) => e.key === 'Escape' && setActive(null)}>
      {/* « Comment lire ce graphique » : les tronçons de ce sens, lus dans le modèle de la bande */}
      <div className="chart-read-row is-end pf-tb-read">
        <ChartReadingTip chart={`bande du trajet ${word}`} reading={tripBandReading(model, side)} placement="top" />
      </div>
      <div className="pf-tb-plot">
        <svg viewBox={`0 0 ${T.width} ${H}`} width="100%" aria-hidden="true" focusable="false" className="pf-tb-svg">
          {model.segments.map((s, i) => {
            const x0 = x(s.start);
            const w = Math.max(x(s.start + s.minutes) - x0, 1);
            const fill = s.kind === 'ride' ? (s.color ? `#${s.color}` : palette.neutral) : 'none';
            return (
              <g key={`${s.kind}-${i}`} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive((a) => (a === i ? null : a))}>
                <rect
                  x={x0 + 0.5}
                  y={0.5}
                  width={Math.max(w - 1, 0.5)}
                  height={B.bandPx - 1}
                  rx={B.radiusPx}
                  fill={fill}
                  stroke={s.kind === 'ride' ? fill : palette.neutral}
                  strokeWidth={T.strokePx / 2}
                  strokeDasharray={s.kind === 'walk' ? T.dash : undefined}
                  className={i === active ? 'pf-tb-seg pf-tb-on' : 'pf-tb-seg'}
                />
                {s.kind === 'ride' && s.line && fits(w, s.line.length) && (
                  <text x={x0 + w / 2} y={B.bandPx / 2} textAnchor="middle" dominantBaseline="central" fontSize={fontPx} fill={lineInk(fill === 'none' ? palette.neutral : fill, s.textColor ? `#${s.textColor}` : null, palette.bg, palette.text)} className="pf-tb-line">
                    {s.line}
                  </text>
                )}
                {fits(w, s.label.length) && (
                  <text x={x0 + w / 2} y={B.bandPx + B.labelPx / 2 + 1} textAnchor="middle" dominantBaseline="central" fontSize={fontPx} className="pf-tb-min">
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {on && (
          <div className="pf-tb-tip" role="presentation">
            {sentence(on)}
          </div>
        )}
      </div>
      {/* Tableau pour les lecteurs d'écran : un tronçon par ligne (marche, attente, véhicule), atteignable au clavier */}
      <table className="pf-tb-table" role="table">
        <caption>{`Trajet ${word} : durée de chaque tronçon`}</caption>
        <tbody role="rowgroup">
          {model.segments.map((s, i) => (
            <tr key={`${uid}-${i}`} role="row" tabIndex={0} onFocus={() => setActive(i)} onBlur={() => setActive((a) => (a === i ? null : a))}>
              <th scope="row" role="rowheader">
                {s.text}
              </th>
              {s.leg && <td role="cell">{`${s.leg.dep} → ${s.leg.arr}`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
