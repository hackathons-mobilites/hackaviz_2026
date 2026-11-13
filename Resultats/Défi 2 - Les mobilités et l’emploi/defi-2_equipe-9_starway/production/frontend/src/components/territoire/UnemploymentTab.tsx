import { useState } from 'react';
import { useProvenanceStore } from '../../store/provenanceStore';
import { stripJitter } from '../../data/incomeRank';
import { METHODS } from '../../data/provenance';
import {
  CHOMAGE_DENOMINATOR,
  CHOMAGE_NOTES,
  chomageSource,
  communeTerritoire,
  evolutionDescription,
  lastRate,
  provisionalNote,
  rateText,
  stripDescription,
  zoneLabel,
  zoneRank,
  zoneRankSentence,
  zoneRateLine,
  zoneRates,
  zoneSeries,
  type CommuneTerritoire,
  type TerritoireFile,
} from '../../data/territoire';
import { color, incomeStrip, territoireChart as G } from '../../theme/tokens';
import { evolutionReading, zoneStripReading } from '../../data/chartReading';
import { ChartReadingTip } from '../ChartReadingTip';
import { InfoTip } from '../InfoTip';
import { TipLines } from '../proof/TipLines';
import { ChomageSourceNote } from '../provenance/ProofNotes';
import './territoire.css';
import { useTerritoire } from './useTerritoire';

export interface TerritoireSide {
  insee: string;
  name: string;
  /** « A » ou « B » en diptyque, rien sinon */
  tag?: 'A' | 'B';
}

interface Resolved extends TerritoireSide {
  terr: CommuneTerritoire | null;
}

/** « A · Montreuil : » en diptyque, rien sinon */
const prefix = (s: TerritoireSide): string => (s.tag ? `${s.tag} · ${s.name} : ` : '');

/**
 * Bande des zones d'emploi : un point par zone à son taux du dernier trimestre (axe horizontal, du plus bas au plus haut ; la hauteur d'un
 * point ne porte aucune donnée), la zone de la commune choisie (A et B en diptyque) marquée par un trait et un point couleur de l'étoile-guide.
 * Même dessin que « Niveau de vie ». Survol d'un point : son nom et son taux s'écrivent sous la bande (le tableau des valeurs, plus bas, donne
 * les mêmes lignes au clavier). Jamais cyan ni or.
 */
/** Citation de l'Insee (« Source : Insee », date de parution) : mode sources seulement (D-033), toujours dans « Sources & limites ». */
function ChomageCitation({ file }: { file: TerritoireFile }) {
  const on = useProvenanceStore((s) => s.on);
  return on ? <p>{chomageSource(file.chomage)}</p> : null;
}

function ZoneStrip({ file, sides, active, onActive }: { file: TerritoireFile; sides: readonly Resolved[]; active: string | null; onActive: (id: string | null) => void }) {
  const rates = zoneRates(file);
  const lo = rates[0]!.rate;
  const hi = rates[rates.length - 1]!.rate;
  const x = (v: number) => G.pad + ((v - lo) / (hi - lo || 1)) * (G.width - 2 * G.pad);
  const marks = new Map<string, { rate: number; tags: string[] }>();
  for (const s of sides) {
    if (!s.terr) continue;
    const m = marks.get(s.terr.zoneId) ?? { rate: lastRate(s.terr.zone), tags: [] };
    if (s.tag) m.tags.push(s.tag);
    marks.set(s.terr.zoneId, m);
  }
  const described = sides.flatMap((s) => (s.terr ? [{ ...(s.tag ? { tag: s.tag } : {}), name: s.name, zoneId: s.terr.zoneId }] : []));
  return (
    <figure className="income-strip terr-strip">
      <figcaption>
        <span className="income-strip-title">Taux de chômage des zones d'emploi</span>
        {/* « Comment lire ce graphique » : cas de la zone de la commune affichée (« Un point par zone d'emploi… » y est rangé, mots inchangés) */}
        <ChartReadingTip
          chart="taux de chômage des zones d'emploi"
          reading={zoneStripReading(
            file,
            sides.map((s) => ({ name: s.name, ...(s.tag ? { tag: s.tag } : {}), zoneId: s.terr?.zoneId ?? null })),
          )}
        />
      </figcaption>
      <svg viewBox={`0 0 ${G.width} ${G.stripH}`} width="100%" role="img" aria-label={stripDescription(file, described)}>
        {rates.map((z, i) => (
          <circle
            key={z.id}
            cx={x(z.rate)}
            cy={G.bandTop + stripJitter(i) * G.bandH}
            r={active === z.id ? G.dotR + 1.2 : G.dotR}
            fill={color.textDim}
            fillOpacity={active === z.id ? 1 : incomeStrip.dotOpacity}
          />
        ))}
        {[...marks.entries()].map(([id, m]) => (
          <g key={id}>
            <line x1={x(m.rate)} x2={x(m.rate)} y1={G.bandTop - 6} y2={G.bandTop + G.bandH + 4} stroke={color.guide} strokeWidth={1.5} />
            <circle cx={x(m.rate)} cy={G.bandTop + G.bandH / 2} r={G.markR} fill={color.guide} stroke={color.panel} strokeWidth={1} />
            {m.tags.length > 0 && (
              <text x={x(m.rate)} y={G.bandTop - 8} textAnchor="middle" className="income-strip-tag">
                {m.tags.join(' ')}
              </text>
            )}
          </g>
        ))}
        {/* Zones de survol, au-dessus du dessin (les points sont petits) */}
        {rates.map((z, i) => (
          <circle
            key={`hit-${z.id}`}
            cx={x(z.rate)}
            cy={G.bandTop + stripJitter(i) * G.bandH}
            r={G.dotHitR}
            fill="transparent"
            onPointerEnter={() => onActive(z.id)}
            onPointerLeave={() => onActive(null)}
          />
        ))}
        <text x={G.pad} y={G.stripH - 4} className="income-strip-axis">
          {rateText(lo)}
        </text>
        <text x={G.width - G.pad} y={G.stripH - 4} textAnchor="end" className="income-strip-axis">
          {rateText(hi)}
        </text>
      </svg>
      <p className="terr-active" aria-hidden="true">
        {active && file.chomage.zones[active] ? zoneRateLine(file.chomage.zones[active]!.name, lastRate(file.chomage.zones[active]!)) : ''}
      </p>
    </figure>
  );
}

/**
 * Évolution du taux d'une zone, du premier au dernier trimestre publié : UNE courbe sur UN axe qui part de 0, rien d'autre. Le dernier point
 * est creux tant que le dernier trimestre est provisoire. La zone est celle de la composition communale de 2020 sur toute la série (note).
 */
function Evolution({ file, zoneId, title }: { file: TerritoireFile; zoneId: string; title: string }) {
  const series = zoneSeries(file, zoneId);
  const description = evolutionDescription(file, zoneId);
  if (series.length < 2 || !description) return null;
  const n = series.length;
  const max = Math.ceil(Math.max(...series.map((p) => p.rate)));
  const right = G.width - G.pad - G.trendEndPx;
  const xx = (i: number) => G.pad + (i / (n - 1)) * (right - G.pad);
  const yy = (v: number) => G.trendBase - (v / max) * (G.trendBase - G.trendTop);
  const last = series[n - 1]!;
  const firstYear = series[0]!.quarter.slice(0, 4);
  const lastYear = last.quarter.slice(0, 4);
  return (
    <figure className="terr-trend">
      <figcaption className="chart-read-row">
        <span>
          {title} : de {firstYear} à {lastYear}
        </span>
        {/* « Comment lire ce graphique » : cas de cette zone (la note du découpage 2020 y est rangée, mots inchangés) */}
        <ChartReadingTip chart={`évolution du taux de chômage, ${zoneLabel(file.chomage.zones[zoneId]!.name)}`} reading={evolutionReading(file, zoneId)} />
      </figcaption>
      <svg viewBox={`0 0 ${G.width} ${G.trendH}`} width="100%" role="img" aria-label={description}>
        <line x1={G.pad} x2={right} y1={G.trendBase} y2={G.trendBase} stroke={color.dimRing} strokeOpacity={0.5} />
        <polyline points={series.map((p, i) => `${xx(i).toFixed(1)},${yy(p.rate).toFixed(1)}`).join(' ')} fill="none" stroke={color.neutral} strokeWidth={G.lineW} strokeLinejoin="round" />
        <circle
          cx={xx(n - 1)}
          cy={yy(last.rate)}
          r={G.endR}
          fill={file.chomage.provisional ? color.panel : color.guide}
          stroke={color.guide}
          strokeWidth={file.chomage.provisional ? 1.5 : 0}
        />
        <text x={xx(n - 1) + 7} y={yy(last.rate) + 4} className="income-strip-axis">
          {rateText(last.rate)}
        </text>
        <text x={G.pad} y={G.trendH - 4} className="income-strip-axis">
          {firstYear}
        </text>
        <text x={right} y={G.trendH - 4} textAnchor="end" className="income-strip-axis">
          {lastYear}
        </text>
        <text x={G.pad} y={G.trendBase - 4} className="income-strip-axis">
          0
        </text>
      </svg>
    </figure>
  );
}

function UnemploymentBody({ file, sides }: { file: TerritoireFile; sides: readonly TerritoireSide[] }) {
  const [active, setActive] = useState<string | null>(null);
  const resolved: Resolved[] = sides.map((s) => ({ ...s, terr: communeTerritoire(file, s.insee) }));
  const withData = resolved.filter((s): s is Resolved & { terr: CommuneTerritoire } => !!s.terr);
  const zoneIds = [...new Set(withData.map((s) => s.terr.zoneId))];
  const rates = zoneRates(file);
  const marked = new Set(zoneIds);
  const provisional = provisionalNote(file.chomage);
  const on = useProvenanceStore((st) => st.on);
  // Règle d'affichage finale du 11/11 (H12, H13, D1) : sans mode sources, la portée, le dénominateur complet et le trimestre provisoire sont
  // dans le « i » du taux de la zone (mots inchangés) ; restent écrits la valeur, « (provisoire) » (garde V6) et une base courte
  const notes = [...(withData.length > 0 ? [`Dénominateur : ${CHOMAGE_DENOMINATOR}.`] : []), ...CHOMAGE_NOTES, ...(provisional ? [provisional] : [])];
  const firstWithData = withData[0]?.insee;
  return (
    <div className="halo-visual terr-chomage">
      {resolved.map((s) =>
        s.terr ? (
          <p key={s.insee} className="terr-val">
            <span>
              {s.tag && <span className="income-tag">{s.tag}</span>}
              {zoneLabel(s.terr.zone.name)}
            </span>
            <b className="mono">
              {rateText(lastRate(s.terr.zone))}
              {file.chomage.provisional ? ' (provisoire)' : ''}
            </b>
            {!on && s.insee === firstWithData && (
              <InfoTip label="Portée de cette statistique" placement="top">
                <TipLines lines={notes} />
              </InfoTip>
            )}
          </p>
        ) : (
          <p key={s.insee} className="halo-hidden">
            {prefix(s)}repère de chômage non disponible pour cette commune.
          </p>
        ),
      )}
      {withData.length > 0 && <ZoneStrip file={file} sides={resolved} active={active} onActive={setActive} />}
      {withData.map((s) => {
        const rank = zoneRank(file, s.terr.zoneId);
        return rank ? (
          <p key={s.insee} className="terr-sentence">
            {prefix(s)}
            {zoneRankSentence(rank)}
          </p>
        ) : null;
      })}
      {withData.length > 0 && (
        <div className="terr-rows">
          {withData.map((s) =>
            s.terr.department ? (
              <p key={s.insee} className="terr-val">
                <span>
                  {s.tag && <span className="income-tag">{s.tag}</span>}
                  Département : {s.terr.department.name}
                </span>
                <b className="mono">{rateText(s.terr.department.rate)}</b>
              </p>
            ) : null,
          )}
          <p className="terr-val">
            <span>Région : {file.chomage.region.name}</span>
            <b className="mono">{rateText(file.chomage.region.rate)}</b>
          </p>
        </div>
      )}
      {zoneIds.map((id) => {
        const names = withData.filter((s) => s.terr.zoneId === id);
        const title = `Évolution, ${zoneLabel(file.chomage.zones[id]!.name)}${names.some((n) => n.tag) ? ` (${names.map((n) => n.tag).join(' et ')})` : ''}`;
        return <Evolution key={id} file={file} zoneId={id} title={title} />;
      })}
      {/* EVOLUTION_NOTE (découpage 2020) : dans le « i » de chaque courbe depuis le 10/11 */}
      <details className="halo-details terr-list">
        <summary>Valeurs par zone d'emploi</summary>
        <ul className="halo-legend no-swatch" aria-label="Taux de chômage par zone d'emploi d'Île-de-France">
          {rates.map((z) => (
            <li
              key={z.id}
              tabIndex={0}
              className={marked.has(z.id) ? 'is-mark' : ''}
              onFocus={() => setActive(z.id)}
              onBlur={() => setActive((a) => (a === z.id ? null : a))}
            >
              <span className="halo-label">{zoneLabel(z.name)}</span>
              <span className="halo-value mono">{rateText(z.rate)}</span>
            </li>
          ))}
        </ul>
      </details>
      {/* Audit d'affichage du 11/11 : sans mode sources, une base courte (règle de vérité 5) ; le dénominateur complet, la mesure au lieu de
          résidence et aucun lien de cause, le trimestre provisoire sont au « i » du taux de la zone ; en mode sources, écrits ici, avec la source et la date. La maille (« Un point par zone… », zone plus large que la commune) et le découpage 2020
          sont dans les « i » « Comment lire ce graphique » de la bande et de la courbe. */}
      <div className="terr-notes">
        {on ? (
          notes.map((n) => <p key={n}>{n}</p>)
        ) : withData.length > 0 ? (
          <p>Sur la population active estimée au lieu de résidence.</p>
        ) : null}
        <ChomageCitation file={file} />
      </div>
      <ChomageSourceNote file={file} method={METHODS.chomage} className="terr-prov" />
    </div>
  );
}

/**
 * Onglet « Chômage » de « Derrière notre étoile » (D-048, T3) : le taux de chômage de la zone d'emploi, du département et de la région de la
 * commune de DÉPART (le taux est mesuré au lieu de résidence : il parle des habitants de la commune, jamais d'un astre). Descriptif : aucune
 * couleur de verdict, aucun seuil, aucun lien de cause avec l'accessibilité ni avec les étoiles. Les notes (zone plus large que la commune et
 * différente des bassins de France Travail, trimestre provisoire, source et date) sont toujours visibles. Tout vient de territoire.json.
 */
export function UnemploymentTab({ sides }: { sides: readonly TerritoireSide[] }) {
  const state = useTerritoire();
  if (state.status === 'loading') return <p className="halo-hidden">Chargement…</p>;
  if (state.status === 'unavailable') return <p className="halo-hidden">Repères de chômage indisponibles.</p>;
  return <UnemploymentBody file={state.file} sides={sides} />;
}
