import { useEffect, useState } from 'react';
import { formatInt } from '../data/format';
import { incomeStripReading } from '../data/chartReading';
import { extent, incomeValueText as fmt, rankAmong, rankSentence, stripJitter, valueOf, type IncomeDistribution, type IncomeMeasure } from '../data/incomeRank';
import { color, incomeStrip } from '../theme/tokens';
import { ChartReadingTip } from './ChartReadingTip';

let cache: Promise<IncomeDistribution> | null = null;
/** Répartition lue au build (vite.config.ts) ; chargée à la première ouverture de l'onglet */
function loadDistribution(): Promise<IncomeDistribution> {
  cache ??= import('virtual:income-distribution').then((m) => m.default);
  return cache;
}

export interface IncomeSide {
  insee: string;
  name: string;
  /** « A » ou « B » en diptyque, rien sinon */
  tag?: 'A' | 'B';
}

const W = 300;
const H = 62;
const PAD = 10;
const BAND_TOP = 14;
const BAND_H = 22;

const TITLE: Record<IncomeMeasure, string> = {
  median: 'Niveau de vie médian, par an et par unité de consommation',
  poverty: 'Taux de pauvreté (seuil à 60 % du niveau de vie médian national)',
};

/**
 * Une bande de points : chaque commune ou arrondissement d'Île-de-France dont la valeur est publiée est
 * un point discret à sa valeur (axe horizontal, de la plus petite à la plus grande) ; la hauteur d'un
 * point ne porte aucune donnée. La commune choisie (A et B en diptyque) est marquée par un trait et un
 * point couleur de l'étoile-guide. Pas de valeur régionale : nos données n'en publient pas.
 */
function RankStrip({ measure, dist, sides, denominator }: { measure: IncomeMeasure; dist: IncomeDistribution; sides: readonly IncomeSide[]; denominator: string | null }) {
  const entries = dist[measure];
  const ext = extent(entries);
  if (!ext) return null;
  const [lo, hi] = ext;
  const x = (v: number) => PAD + ((v - lo) / (hi - lo || 1)) * (W - 2 * PAD);
  const sorted = entries.map(([, v]) => v).sort((a, b) => a - b);
  const marks = sides.map((s) => ({ ...s, value: valueOf(entries, s.insee) }));
  const sentences = marks.map((m) =>
    m.value == null
      ? `${m.tag ? `${m.tag} · ${m.name} : ` : ''}${measure === 'median' ? 'niveau de vie médian' : 'taux de pauvreté'} non publié pour cette commune (secret statistique ou effectif trop faible).`
      : `${m.tag ? `${m.tag} · ${m.name} : ` : ''}${rankSentence(measure, rankAmong(entries, m.insee, m.value)) ?? ''}`,
  );
  const label = `${TITLE[measure]} : ${formatInt(entries.length)} communes et arrondissements d'Île-de-France, de ${fmt[measure](lo)} à ${fmt[measure](hi)}. ${sentences.join(' ')}`;
  return (
    <figure className="income-strip">
      <figcaption>
        <span className="income-strip-title">{measure === 'median' ? 'Niveau de vie médian' : 'Taux de pauvreté'}</span>
        {/* « Comment lire ce graphique » : ce que dit chaque élément, puis le cas de la commune affichée (valeurs de la répartition) */}
        <ChartReadingTip
          chart={measure === 'median' ? 'niveau de vie médian' : 'taux de pauvreté'}
          reading={incomeStripReading({ measure, entries, sides, year: dist.year, denominator })}
        />
        {marks.map((m) => (
          <span key={m.insee} className="income-strip-value">
            {m.tag && <span className="income-tag">{m.tag}</span>}
            {m.value == null ? 'non publié' : measure === 'median' ? `${fmt.median(m.value)} par an` : fmt.poverty(m.value)}
          </span>
        ))}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        {sorted.map((v, i) => (
          <circle key={i} cx={x(v)} cy={BAND_TOP + stripJitter(i) * BAND_H} r={1.3} fill={color.textDim} fillOpacity={incomeStrip.dotOpacity} />
        ))}
        {marks.map((m) =>
          m.value == null ? null : (
            <g key={m.insee}>
              <line x1={x(m.value)} x2={x(m.value)} y1={BAND_TOP - 6} y2={BAND_TOP + BAND_H + 4} stroke={color.guide} strokeWidth={1.5} />
              <circle cx={x(m.value)} cy={BAND_TOP + BAND_H / 2} r={3.5} fill={color.guide} stroke={color.panel} strokeWidth={1} />
              {m.tag && (
                <text x={x(m.value)} y={BAND_TOP - 8} textAnchor="middle" className="income-strip-tag">
                  {m.tag}
                </text>
              )}
            </g>
          ),
        )}
        <text x={PAD} y={H - 4} className="income-strip-axis">
          {fmt[measure](lo)}
        </text>
        <text x={W - PAD} y={H - 4} textAnchor="end" className="income-strip-axis">
          {fmt[measure](hi)}
        </text>
      </svg>
      {sentences.map((s, i) => (
        <p key={i} className="income-strip-sentence" aria-hidden="true">
          {s}
        </p>
      ))}
    </figure>
  );
}

/**
 * Onglet « Niveau de vie » (retour de Nicolas du 03/11, remplace l'anneau du taux de pauvreté et le
 * chiffre isolé) : deux bandes, niveau de vie médian puis taux de pauvreté, qui situent la commune parmi
 * les communes et arrondissements d'Île-de-France où la valeur est publiée, avec une phrase dérivée du
 * rang. Le nombre de communes de chaque bande est dit : le taux de pauvreté n'est publié que pour une
 * partie d'entre elles (secret statistique).
 */
export function IncomeRanks({ sides, denominator = null }: { sides: readonly IncomeSide[]; /** Dénominateur écrit sous l'onglet, repris dans le « i » */ denominator?: string | null }) {
  const [dist, setDist] = useState<IncomeDistribution | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadDistribution().then(
      (d) => alive && setDist(d),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (failed) return <p className="halo-hidden">Répartition régionale indisponible.</p>;
  if (!dist) return <p className="halo-hidden">Chargement…</p>;
  return (
    <div className="halo-visual income-ranks">
      <RankStrip measure="median" dist={dist} sides={sides} denominator={denominator} />
      <RankStrip measure="poverty" dist={dist} sides={sides} denominator={denominator} />
      {/* « Un point par commune ou arrondissement… » : rangé dans le « i » de chaque bande (demande de Nicolas du 10/11), mots inchangés */}
    </div>
  );
}
