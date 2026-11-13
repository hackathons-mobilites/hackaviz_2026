import { useMemo } from 'react';
import { formatInt } from '../data/format';
import type { Dataset } from '../data/types';
import { useViewport } from '../hooks/useViewport';
import { glyphScale } from '../state/camera';
import { computeFrame, datasetBounds, makeRadius, sizeKeyValues } from '../sky/layout';
import { selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { color } from '../theme/tokens';

/**
 * Clé de taille (L-17) : deux cercles emboîtés, posés sur la même ligne de base, tracés par la MÊME
 * échelle que les astres du ciel affiché (`makeRadius`, cadre courant, zoom compris). Les deux valeurs
 * sont rondes et encadrent les postes des pôles (`sizeKeyValues`) : des repères de lecture, pas des
 * données. Décrite en texte pour le lecteur d'écran.
 */
export function SizeKey({ dataset }: { dataset: Dataset }) {
  const vp = useViewport();
  const bottom = useSkyStore(selectSkyBottom);
  const k = useSkyStore((s) => s.camera.k);
  const values = useMemo(() => sizeKeyValues(dataset.poles.map((p) => p.jobs)), [dataset]);
  const radius = useMemo(
    () => makeRadius(dataset.poles, computeFrame(vp.width, vp.height, bottom, datasetBounds(dataset))),
    [dataset, vp.width, vp.height, bottom],
  );
  if (!values.length) return null;
  const rs = values.map((v) => radius(v) * glyphScale(k));
  const rMax = Math.max(...rs);
  const pad = 2;
  /** Place des noms au-dessus du plus grand cercle (hauteur des chiffres de 12 px) */
  const head = 10;
  const labelX = 2 * rMax + pad + 10;
  const w = labelX + 110;
  const h = head + 2 * rMax + 2 * pad;
  const base = h - pad;
  const text = values.map((v) => `${formatInt(v)} postes`).join(' et ');
  // noms écartés d'au moins 14 px (petits écrans : cercles proches)
  const labelY: number[] = [];
  [...values.keys()]
    .sort((a, b) => rs[b]! - rs[a]!)
    .forEach((i, n, order) => {
      const y = base - 2 * rs[i]! + 4;
      labelY[i] = n === 0 ? y : Math.max(y, labelY[order[n - 1]!]! + 14);
    });
  return (
    <span className="size-key">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Clé de taille à l'échelle du ciel affiché : cercles de ${text}.`}>
        {values.map((v, i) => {
          const r = rs[i]!;
          const cx = pad + rMax;
          const top = base - 2 * r;
          return (
            <g key={v}>
              <circle cx={cx} cy={base - r} r={r} fill="none" stroke={color.textDim} strokeWidth="1" />
              <line x1={cx} y1={top} x2={labelX - 4} y2={labelY[i]! - 4} stroke={color.textDim} strokeOpacity="0.5" strokeWidth="1" />
              <text x={labelX} y={labelY[i]} fill={color.text} fontSize="12">
                {formatInt(v)}
              </text>
            </g>
          );
        })}
      </svg>
    </span>
  );
}
