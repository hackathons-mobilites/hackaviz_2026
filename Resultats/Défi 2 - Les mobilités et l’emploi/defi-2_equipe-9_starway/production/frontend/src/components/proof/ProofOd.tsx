import type { ReactNode } from 'react';
import type { PoleOdPart } from '../../data/accessibility';
import type { OdResult } from '../../data/od/compute';
import { HERO_LEGS_METHOD, odCommuneRows, odHeroLegsText, odShareSummary } from '../../data/od/proofOd';
import { communeChartModel } from '../../data/od/communeChart';
import { endsNextDay, nightNetworkSources } from '../../data/od/shift';
import { nightReturnNote, odScenarioStatusText, odTextContext, odWalkLimitNote } from '../../data/od/texts';
import type { OdIndex } from '../../data/od/types';
import { formatInt } from '../../data/format';
import { serviceWeekday } from '../../data/proof';
import type { Commune, Pole } from '../../data/types';
import { useSkyStore } from '../../store/useSkyStore';
import { CalcMethodNote, NightNetworkMethodNote, NightReturnMethodNote } from '../provenance/MethodNote';
import { CodeSourceNote } from '../provenance/ProofNotes';
import { StatusGlyph, type GlyphKind } from '../StatusGlyph';
import { CommunePolarityTags } from '../territoire/Polarity';
import { odShareReading } from '../../data/chartReading';
import { ChartReadingTip } from '../ChartReadingTip';
import { InfoTip } from '../InfoTip';
import { TipLines } from './TipLines';
import { CommuneChart } from './CommuneChart';
import { ShareBar } from './ShareBar';
import { useSourcesOn } from './useSourcesOn';
import { shareFraction } from '../../data/shareBar';
import { usePalette } from '../../store/colorVisionStore';

const GLYPH: Record<string, GlyphKind> = { accessible: 'accessible', out_only: 'out_only', blocked: 'none', unknown: 'unknown', self: 'neutral' };

/**
 * Horaires libres / table commune par commune (D-019) : à la place du bloc « Temps de trajet », la
 * part des postes du pôle atteinte aller ET retour, puis chaque commune du pôle avec son aller
 * (départ, durée) et son retour. Textes de `data/od/texts.ts`, rien n'est réécrit ici.
 */
export function ProofOd({
  pole,
  part,
  result,
  index,
  communes,
  view = 'all',
  side = null,
}: {
  pole: Pole;
  part: PoleOdPart | undefined;
  result: OdResult;
  index: Pick<OdIndex, 'max_trip_min' | 'complete' | 'coverage' | 'walk_limit' | 'time_segments' | 'outbound_lookback_min' | 'grid'> | null;
  communes: readonly Commune[];
  /**
   * Lot 3 (D-050) : `hero` = le pourcentage et sa phrase (premier niveau du panneau) ; `communes` = la liste des communes du pôle
   * (pli « Communes du pôle ») ; `all` (défaut) = l'ancien bloc entier.
   */
  view?: 'all' | 'hero' | 'communes';
  /**
   * Comparaison A/B (audit d'affichage du 10/11, lot 5) : une colonne par commune, « A · Maisons-Laffitte » en tête et son badge ;
   * le titre « Postes atteints aller et retour » est alors posé une fois par le panneau, au-dessus des deux colonnes.
   */
  side?: { label: string; badge?: ReactNode } | null;
}) {
  const serviceDate = useSkyStore((s) => s.dataset?.meta.service_date);
  const sourcesOn = useSourcesOn();
  const palette = usePalette().color;
  const statusText = odScenarioStatusText(result.status);
  const share = result.status === 'ok' ? result.poles.find((p) => p.id === pole.id) : undefined;
  const sideHead = side ? (
    <>
      <p className="pf-side-head">{side.label}</p>
      {side.badge}
    </>
  ) : null;
  if (statusText || !share || !index) {
    if (view === 'communes') return side ? <div className="pf-side">{sideHead}<p className="pf-missing">{statusText ?? 'Non calculé pour ce pôle.'}</p></div> : null;
    if (side)
      return (
        <div className="pf-side pf-od">
          {sideHead}
          <p className="pf-missing">{statusText ?? 'Non calculé pour ce pôle.'}</p>
        </div>
      );
    return (
      <section className="pf-section pf-od" aria-labelledby="pf-od-title">
        <h3 className="pf-label" id="pf-od-title">
          Postes atteints aller et retour
        </h3>
        <p className="pf-missing">{statusText ?? 'Non calculé pour ce pôle.'}</p>
      </section>
    );
  }
  const summary = odShareSummary(part ?? share);
  // P10 (audit du 11/11) : sous le grand chiffre, le dénominateur est au « i » de la barre (il y est écrit) ; les vues sans « i » le gardent
  const summaryLine = sourcesOn ? summary.line : summary.lineShort;
  const ctx = odTextContext(index, result.timeDependent, result.scenario.mode);
  const names = new Map(communes.map((c) => [c.insee, c.name]));
  const rows = odCommuneRows(share, names, result.scenario.budget, ctx, result.scenario.end);
  const walkNote = odWalkLimitNote(index, result.timeDependent);
  const heroLegs = view !== 'communes' && !side ? odHeroLegsText(share, names, result.scenario.budget, ctx, result.scenario.end) : null;
  // Poste de nuit en TC : le retour du matin vient des horaires du même mardi type (méthode, docs/limites.md)
  const night = result.timeDependent && endsNextDay({ start: result.scenario.start, end: result.scenario.end });
  // D-040 : réseaux de nuit lus par le poste (matin : TRA01B ; soir : TRA01C), codes lus dans index.time_segments
  const nightSources = result.timeDependent
    ? nightNetworkSources(index.time_segments?.segments, { start: result.scenario.start, end: result.scenario.end }, index.outbound_lookback_min, index.grid.step_min)
    : [];
  const nightNetwork = nightSources.length > 0;
  // Lot 3 : « Accessible aller et retour en N min ou moins par sens » était écrit à CHAQUE commune ; il l'est une fois, en tête de la liste,
  // et une commune accessible n'a plus que son nom, ses postes et ses deux trajets. Les autres états gardent leur phrase.
  const accessibleTitle = rows.find((r) => r.glyph === 'accessible')?.title ?? null;
  // Lot 4 : la part des postes atteints aller et retour, en barre fine sous le chiffre (jamais de camembert) ; le chiffre fait foi
  const bar = (
    <ShareBar fraction={shareFraction(summary.percent == null ? null : (part ?? share).share! * 100)} color={palette.accessible} title={`${summary.percent ?? ''} des postes salariés (INSEE) atteints aller et retour`} />
  );
  const hero = (
    <section className="pf-section pf-od" aria-labelledby="pf-od-title">
      <h3 className="pf-label" id="pf-od-title">
        Postes atteints aller et retour
      </h3>
      {summary.percent && <span className="pf-stat">{summary.percent}</span>}
      <span className="pf-caption">
        {summaryLine}
        {/* « Comment lire ce graphique » de la barre de part : le pourcentage et son dénominateur, lus dans la part du pôle */}
        {summary.percent && (
          <>
            {' '}
            <ChartReadingTip
              chart="part des postes atteints"
              reading={odShareReading({ percent: summary.percent, reached: (part ?? share).reached, measurable: (part ?? share).measurable, year: pole.jobs_year ?? null })}
              placement="top"
            />
          </>
        )}
      </span>
      {bar}
      {/* Demande de Nicolas (12/11) : la durée qui fait le verdict, et ce qui dépasse le temps choisi, lisibles sans rien ouvrir */}
      {/* 13/11 : un « i » dit d'où viennent ces durées et pourquoi l'exemple de trajet, plus bas, peut en donner d'autres */}
      {heroLegs && (
        <p className="pf-od-legs" data-hero-legs>
          {heroLegs}{' '}
          <InfoTip label="Comment ces durées sont calculées" placement="top">
            <TipLines lines={HERO_LEGS_METHOD} />
          </InfoTip>
        </p>
      )}
      {summary.notes.map((n) => (
        <span key={n} className="pf-src">
          {n}
        </span>
      ))}
      <CalcMethodNote timeDependent={result.timeDependent} className="pf-prov" />
    </section>
  );
  const chart = view !== 'all' ? communeChartModel(share, names, result.scenario.budget, ctx, result.scenario.end) : null;
  const list = (
    <>
      {view === 'all' && <p className="pf-label pf-od-sub">Communes du pôle</p>}
      {accessibleTitle && view !== 'all' && (
        <p className="pf-src pf-od-legend">
          <StatusGlyph className="pf-glyph" size={14} kind="accessible" />
          {accessibleTitle}
        </p>
      )}
      {/* Lot 4 : dans le pli, la liste devient un graphique en triangles ; son tableau (mêmes phrases) reste pour les lecteurs d'écran */}
      {chart && <CommuneChart model={chart} title="Temps de trajet par commune, aller et retour" />}
      {/* Polarité SDRIF-E (D-048, T4) : texte perle sous le graphique, seulement pour les communes qui en ont une */}
      {chart && <CommunePolarityTags communes={chart.rows} />}
      {view === 'all' && (
      <ul className="pf-od-list">
        {rows.map((r) => (
          <li key={r.insee}>
            <span className="pf-od-head">
              <StatusGlyph className="pf-glyph" size={14} kind={GLYPH[r.glyph] ?? 'unknown'} />
              <strong>{r.name}</strong>
              <span className="pf-dim">
                {' '}
                · {formatInt(r.jobs)} postes{view !== 'all' && r.glyph === 'accessible' ? '' : ` · ${r.title}`}
              </span>
            </span>
            {r.out && <span className="pf-od-leg">{r.out}</span>}
            {r.ret && <span className="pf-od-leg">{r.ret}</span>}
          </li>
        ))}
      </ul>
      )}
      {walkNote && <p className="pf-src">{walkNote}</p>}
      {night && <p className="pf-src pf-night-note">{nightReturnNote(result.scenario.start, result.scenario.end, serviceWeekday(serviceDate))}</p>}
      {night && <NightReturnMethodNote className="pf-prov" />}
      {nightNetwork && <NightNetworkMethodNote segments={index.time_segments?.segments} className="pf-prov" />}
      {nightSources.map((code) => (
        <CodeSourceNote key={code} code={code} className="pf-prov" />
      ))}
    </>
  );
  if (view === 'hero' && side)
    return (
      <div className="pf-side pf-od">
        {sideHead}
        {summary.percent && <span className="pf-stat">{summary.percent}</span>}
        <span className="pf-caption">{summary.line}</span>
        {bar}
        {summary.notes.map((n) => (
          <span key={n} className="pf-src">
            {n}
          </span>
        ))}
        <CalcMethodNote timeDependent={result.timeDependent} className="pf-prov" />
      </div>
    );
  if (view === 'hero') return hero;
  if (view === 'communes') return <div className="pf-od-communes">{sideHead}{list}</div>;
  return (
    <section className="pf-section pf-od" aria-labelledby="pf-od-title">
      <h3 className="pf-label" id="pf-od-title">
        Postes atteints aller et retour
      </h3>
      {summary.percent && <span className="pf-stat">{summary.percent}</span>}
      <span className="pf-caption">{summary.line}</span>
      {summary.notes.map((n) => (
        <span key={n} className="pf-src">
          {n}
        </span>
      ))}
      <CalcMethodNote timeDependent={result.timeDependent} className="pf-prov" />
      {list}
    </section>
  );
}
