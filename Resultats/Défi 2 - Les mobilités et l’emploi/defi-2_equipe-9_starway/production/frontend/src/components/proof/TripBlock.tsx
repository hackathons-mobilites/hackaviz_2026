import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CARBON_GUARD, itineraryDeltaText, ticketFact, type ItinTrip } from '../../data/itineraries';
import { METHODS } from '../../data/provenance';
import { ticketBreakdown } from '../../data/costBreakdown';
import { stripDecisionCodes } from '../../data/proof';
import { tripBandModel, tripBandScale } from '../../data/tripBand';
import { carbonTile, costTile, durationTile, roundTripLine } from '../../data/tripTiles';
import type { DayTypeId, LineFactsMeta } from '../../data/types';
import { useProvenanceStore } from '../../store/provenanceStore';
import { useSkyStore } from '../../store/useSkyStore';
import { walkSettingPhrase, walkSettingsMeta } from '../../data/walkSettings';
import { AlternativesSourceNote, CodeSourceNote } from '../provenance/ProofNotes';
import { useEffectiveSubscriptions } from '../subscriptions/useEffectiveSubscriptions';
import { useSubscriptionsFile } from '../subscriptions/useSubscriptionsFile';
import {
  ALT_CALC_METHOD,
  ALT_CALC_TIP,
  ALT_EARLIER_GAP_TEXT,
  ALT_MISMATCH_TEXT,
  ALT_STATE_TEXT,
  ALT_TABS,
  alternativesSource,
  asItinTrip,
  cellOf,
  compareText,
  coverageLetter,
  earlierDeparturesGap,
  resolveAlternatives,
  ridesOf,
  sameAsCalcText,
  transfersText,
  tripCost,
  type AltDir,
  type AlternativesCoverage,
  type AlternativesFile,
  type AltTabId,
  type ResolvedAlternatives,
} from './alternatives/alternatives';
import { loadCommuneAlternatives, loadCoverage } from './alternatives/loadAlternatives';
import { ProofTransports } from './ProofTransports';
import { NeedsTripSummary } from './ProofNeeds';
import { CostDonut } from './CostDonut';
import { SourceTip } from './SourceTip';
import { TipLines } from './TipLines';
import { TripTiles } from './TripTiles';
import './alternatives/alternatives.css';
import './tripTiles.css';

/** Autres trajets (D-055) de la fiche : null quand ils ne s'appliquent pas (comparaison, horaires libres, astre non détaillé). */
export interface AltKey {
  insee: string;
  poleId: string;
  dayId: DayTypeId;
  /**
   * Réglage de marche du scénario (clé de meta.walk_settings) : null = réglage par défaut. Hors défaut, les autres trajets sont lus dans
   * le dossier de ce réglage (`alternatives_{id}/`, phase G) s'il est publié et que la case y est calculée
   */
  walkKey: string | null;
}

interface Props {
  outTrip: ItinTrip | null;
  retTrip: ItinTrip | null;
  alt: AltKey | null;
  /** Vue commune par commune : l'itinéraire est un exemple vers l'arrêt d'ancrage du pôle (garde courte dans le titre) */
  example: boolean;
  /** Phrase « Exemple de trajet vers … » (au « i » du titre, D-064) */
  exampleNote: string | null;
  /** Phrase de l'arrêt d'affichage, par sens (au « i » du titre) */
  stopNotes: { out: string | null; ret: string | null };
  texts?: LineFactsMeta['texts'];
}

/** Ce que le bloc lit des autres trajets : la couverture et le fichier du dossier retenu (réglage du scénario ou défaut). */
interface AltData {
  coverage: AlternativesCoverage | null;
  file: AlternativesFile | null;
  ready: boolean;
  /** Réglage hors défaut sans trajets publiés pour cette case (dossier absent, autre réglage, case pas encore calculée) : repli */
  walkFallback: boolean;
  /** Réglage hors défaut lu dans son dossier : « réglage de marche confort : pas plus de 1 km à pied » (libellé publié) */
  walkNote: string | null;
}

/**
 * Couverture et fichier de la commune des autres trajets : demandés à l'ouverture de la fiche (bloc en haut), mis en cache. Phase G :
 * hors réglage de marche par défaut, on lit `alternatives_{id}/` (404 toléré par `loadCoverage`, `walk_setting` vérifié) quand la case
 * y est calculée dans au moins un sens ; sinon repli sur la phrase « calculés pour le réglage de marche normal » et son bouton.
 */
function useAlternatives(alt: AltKey | null): AltData {
  const dataset = useSkyStore((s) => s.dataset);
  const [coverage, setCoverage] = useState<AlternativesCoverage | null | undefined>(undefined);
  const on = !!alt;
  useEffect(() => {
    if (!on || !dataset) return;
    let alive = true;
    void loadCoverage(dataset).then((c) => {
      if (alive) setCoverage(c);
    });
    return () => {
      alive = false;
    };
  }, [on, dataset]);
  const walkKey = alt?.walkKey ?? null;
  const walkSetting = useSkyStore((s) => (walkKey ? (walkSettingsMeta(s.dataset?.meta)?.settings.find((x) => x.key === walkKey) ?? null) : null));
  const walkId = walkSetting?.id ?? null;
  const [walkCov, setWalkCov] = useState<{ id: string; data: AlternativesCoverage | null } | null>(null);
  useEffect(() => {
    if (!dataset || !walkId) return;
    let alive = true;
    void loadCoverage(dataset, fetch, walkId).then((data) => {
      if (alive) setWalkCov({ id: walkId, data });
    });
    return () => {
      alive = false;
    };
  }, [dataset, walkId]);
  const walkCovData = walkId && walkCov?.id === walkId ? walkCov.data : null;
  // Réglage absent de meta.walk_settings : rien à attendre, repli immédiat
  const walkCovLoading = !!walkId && walkCov?.id !== walkId;
  const source = alt ? alternativesSource({ walkKey, walkId, walkCov: walkCovData, insee: alt.insee, poleId: alt.poleId, day: alt.dayId }) : 'default';
  const useWalk = source === 'walk';
  const walkFallback = source === 'fallback';
  const active = useWalk ? walkCovData : (coverage ?? null);
  const fileSetting = useWalk ? walkId : null;

  const insee = alt?.insee ?? null;
  const out = active && alt ? coverageLetter(active, alt.insee, alt.poleId, alt.dayId, 'out') : 'n';
  const ret = active && alt ? coverageLetter(active, alt.insee, alt.poleId, alt.dayId, 'ret') : 'n';
  const fileNeeded = !!active && !!alt && !walkCovLoading && !walkFallback && (out !== 'n' || ret !== 'n');
  const fileKey = `${fileSetting ?? ''}|${insee ?? ''}`;
  const [file, setFile] = useState<{ key: string; data: AlternativesFile | null } | null>(null);
  useEffect(() => {
    if (!fileNeeded || !dataset || !insee) return;
    let alive = true;
    void loadCommuneAlternatives(dataset, insee, fetch, fileSetting).then((data) => {
      if (alive) setFile({ key: fileKey, data });
    });
    return () => {
      alive = false;
    };
  }, [fileNeeded, dataset, insee, fileSetting, fileKey]);
  const fileData = file && file.key === fileKey ? file.data : null;
  return {
    coverage: active,
    file: fileData,
    ready: coverage !== undefined && !walkCovLoading && (!fileNeeded || file?.key === fileKey),
    walkFallback,
    walkNote: useWalk ? walkSettingPhrase(walkSetting) : null,
  };
}

/**
 * Bloc « Trajet » (demande de Nicolas du 11/11, D-066) : UN seul bloc en haut de la fiche, à la place de « Transports utilisés (aller) »,
 * « (retour) » et des « Autres trajets » du pli « Coût et carbone », qui montraient deux fois le même trajet. Bascule Aller / Retour
 * (chaque bouton porte sa durée), ligne « aller et retour » du trajet retenu, onglets « Trajet retenu » / « Le moins cher » / « Le moins
 * de correspondances » quand d'autres trajets existent (D-055), tuiles Durée, Coût, Carbone, puis la bande, les lignes et « Arrêts et
 * horaires du trajet » du sens choisi (`ProofTransports` sans son titre). Le verdict d'accessibilité reste en tête de fiche.
 */
export function TripBlock({ outTrip, retTrip, alt, example, exampleNote, stopNotes, texts }: Props) {
  const [dir, setDir] = useState<AltDir>(outTrip ? 'out' : 'ret');
  const [tab, setTab] = useState<AltTabId>('A');
  const titleId = useId();
  const subs = useSubscriptionsFile();
  // Le choix en vigueur, pas le choix mémorisé : la visite et l'enregistrement vidéo jouent sans abonnement
  const { transit: transitId } = useEffectiveSubscriptions();
  const option = transitId && subs ? (subs.transit.options.find((o) => o.id === transitId) ?? null) : null;
  const provenanceOn = useProvenanceStore((s) => s.on);
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const defaultWalk = useSkyStore((s) => {
    const ws = s.dataset?.meta.walk_settings;
    const label = ws?.settings.find((x) => x.id === ws.default)?.label ?? ws?.default ?? 'normal';
    return label.split(' :')[0]!.trim();
  });
  const { coverage, file, ready, walkFallback, walkNote } = useAlternatives(alt);

  // Un sens sans itinéraire : la bascule ne propose que l'autre (la fiche dit plus haut pourquoi ce sens manque)
  const shownDir: AltDir = dir === 'out' ? (outTrip ? 'out' : 'ret') : retTrip ? 'ret' : 'out';
  const a = shownDir === 'out' ? outTrip : retTrip;
  const resolved: ResolvedAlternatives =
    !alt || !coverage || !ready || walkFallback
      ? resolveAlternatives({ letter: 'n', cell: null, a })
      : resolveAlternatives({ letter: coverageLetter(coverage, alt.insee, alt.poleId, alt.dayId, shownDir), cell: cellOf(file, alt.poleId, alt.dayId, shownDir), a });
  // Les trois onglets sont là dès que la recherche a été calculée (demande de Nicolas du 12/11 : « partout, aller comme retour ») : quand elle
  // n'a trouvé aucun autre trajet, « Le moins cher » et « Le moins de correspondances » disent que le trajet retenu est aussi celui-là
  const withTabs = (resolved.state === 'with' || resolved.state === 'without') && !!resolved.a;
  const shownTab: AltTabId = withTabs ? tab : 'A';
  const other = shownTab === 'B' ? resolved.b : shownTab === 'C' ? resolved.c : null;
  const trip = shownTab === 'A' ? a : other ? asItinTrip(other) : null;

  // Une seule échelle pour tout ce que la bascule et les onglets montrent : passer d'un trajet à l'autre ne change pas la règle
  const scale = tripBandScale(
    ...[outTrip, retTrip, resolved.b && asItinTrip(resolved.b), resolved.c && asItinTrip(resolved.c)].filter((t): t is ItinTrip => !!t).map((t) => tripBandModel(t)),
  );
  const extra = subs?.transit.extra_titles ?? {};
  const costOf = (t: ItinTrip | null) => (t ? tripCost(t, option, subs) : null);
  // Anneau des dépenses (« i » du coût) : seulement au ticket, jamais avec un abonnement qui couvre le trajet
  const breakdown = trip && costOf(trip)?.status === 'tickets' ? ticketBreakdown(trip.tickets, subs?.transit.unit_tickets) : null;
  const rt = roundTripLine({ out: outTrip, ret: retTrip, outCost: costOf(outTrip), retCost: costOf(retTrip), option });
  const compare = trip && shownTab !== 'A' && a ? compareText(shownTab, a, tripCost(a, option, subs), trip, tripCost(trip, option, subs)) : null;

  const delta = a ? itineraryDeltaText(a) : null;
  const tipLines = [exampleNote, shownDir === 'out' ? stopNotes.out : stopNotes.ret, delta].filter((t): t is string => !!t);
  // Écart de palier 2 du confort (Nicolas, 11/11) : départs plus tôt cherchés en normal, pas dans le réglage lu (champs du fichier, 06w)
  const walkLines = [walkNote ? `Calculés pour le ${walkNote}.` : null, alt && !walkFallback && earlierDeparturesGap(file, alt.dayId) ? ALT_EARLIER_GAP_TEXT : null].filter(
    (x): x is string => !!x,
  );
  const settingNote = coverage?.setting_note ? (provenanceOn ? coverage.setting_note : stripDecisionCodes(coverage.setting_note)) : null;

  return (
    <section className="pf-section pf-trip-block" aria-labelledby={titleId}>
      <div className="pf-label-row">
        <h3 className="pf-label" id={titleId}>
          Trajet{example ? ', exemple de trajet' : ''}
        </h3>
        {/* D-064 : d'où part et où arrive l'exemple, l'arrêt et l'écart de durée, mots inchangés, au « i » ; en clair en mode sources */}
        {tipLines.length > 0 && (
          <SourceTip label="D'où part et où arrive cet exemple ?" block>
            <TipLines lines={tipLines} />
          </SourceTip>
        )}
      </div>
      <DirectionToggle dir={shownDir} onChange={setDir} out={outTrip} ret={retTrip} />
      {rt && <p className="pf-trip-rt">{rt}</p>}
      {withTabs && <TabsRow tab={shownTab} onTab={setTab} walkLines={walkLines} comfortNote={coverage?.comfort_note ?? null} methodNote={provenanceOn ? [ALT_CALC_METHOD, settingNote ? `${settingNote.charAt(0).toUpperCase()}${settingNote.slice(1)}.` : null].filter((x): x is string => !!x) : []} />}
      <div className="alt-panel" role={withTabs ? 'tabpanel' : undefined} id={withTabs ? `${titleId}-panel` : undefined} aria-label={withTabs ? ALT_TABS.find((t) => t.id === shownTab)?.label : undefined}>
        {compare && <p className="alt-compare">{compare}</p>}
        {shownTab === 'C' && resolved.cSameAsB && <p className="pf-src">Même trajet que l'onglet « Le moins cher ».</p>}
        {shownTab === 'B' && option && <p className="pf-src">Classé au ticket à l'unité, plein tarif : avec votre abonnement, le prix peut être le même.</p>}
        {trip ? (
          <>
            <TripTiles
              label={`Trajet ${shownDir === 'out' ? 'aller' : 'retour'} : durée, coût et carbone`}
              tiles={[
                { label: 'Durée', tile: durationTile(trip) },
                {
                  label: 'Coût',
                  className: 'pf-cost',
                  tile: costTile(tripCost(trip, option, subs), option, extra, ticketFact(trip, shownDir)?.detail ?? null),
                  extra: breakdown ? <CostDonut breakdown={breakdown} title={`Dépenses du trajet ${shownDir === 'out' ? 'aller' : 'retour'}, en pourcentage du coût`} /> : undefined,
                  tipLabel: 'Quels tickets pour ce trajet ?',
                  note: <CodeSourceNote className="pf-prov" code="COST02" method={METHODS.tickets} />,
                },
                {
                  label: 'Carbone',
                  className: 'pf-carbon',
                  tile: carbonTile(trip.co2_g, CARBON_GUARD),
                  tipLabel: 'Comment ce carbone est-il estimé ?',
                  note: <CodeSourceNote className="pf-prov" code="ENV01" method={METHODS.carbon} />,
                },
              ]}
            />
            <p className="pf-trip-meta">
              {trip.dep} → {trip.arr} · {transfersText(ridesOf(trip))}
            </p>
            {/* Les trois onglets disent la même chose sur « Mes besoins » (12/11) : le résumé du trajet affiché, comme celui du trajet retenu dans son pli */}
            {shownTab !== 'A' && <NeedsTripSummary trip={trip} label={`Mes besoins, ${ALT_TABS.find((t) => t.id === shownTab)?.label.toLowerCase() ?? ''} (${shownDir === 'out' ? 'aller' : 'retour'})`} />}
            <ProofTransports key={`${shownDir}-${shownTab}`} trip={trip} leg={shownDir} bare texts={texts} needs="external" scale={scale > 0 ? scale : undefined} />
          </>
        ) : (
          a && shownTab !== 'A' && <p className="alt-same">{sameAsCalcText(shownTab as 'B' | 'C', a)}</p>
        )}
      </div>
      {alt && coverage && ready && <AltState resolved={resolved} walk={walkFallback} defaultWalk={defaultWalk} onWalk={() => void applyScenario({ walk: null })} />}
      {provenanceOn && withTabs && <p className="pf-prov">Trajets alternatifs : décision D-055, tickets D-028.</p>}
      {withTabs && <AlternativesSourceNote className="pf-prov" />}
    </section>
  );
}

/** Ce qui remplace les onglets : la raison courte (pas d'autre trajet, pas encore calculé, réglage de marche). */
function AltState({ resolved, walk, defaultWalk, onWalk }: { resolved: ResolvedAlternatives; walk: boolean; defaultWalk: string; onWalk: () => void }) {
  if (walk) {
    // Demande de Nicolas (11/11) : réglage de marche hors défaut sans autres trajets publiés pour cette case (phase G : dossier du
    // réglage absent ou case pas encore calculée) : on le dit et on propose le réglage par défaut
    return (
      <p className="alt-state" data-alt-state="walk">
        Autres trajets : calculés pour le réglage de marche {defaultWalk}.{' '}
        <button type="button" className="link-btn" onClick={onWalk}>
          Voir en réglage {defaultWalk}
        </button>
      </p>
    );
  }
  if (resolved.state === 'with') return null;
  const text =
    resolved.state === 'without'
      ? ALT_STATE_TEXT.without
      : resolved.state === 'mismatch' && resolved.mismatch
        ? `${ALT_STATE_TEXT.mismatch} : ${ALT_MISMATCH_TEXT[resolved.mismatch]}`
        : ALT_STATE_TEXT.pending;
  return (
    <p className="alt-state" role="status" data-alt-state={resolved.state}>
      Autres trajets : {text.charAt(0).toLowerCase()}
      {text.slice(1)}.
    </p>
  );
}

/** Bascule Aller / Retour : chaque bouton porte la durée de son sens, un sens sans itinéraire n'est pas proposé. */
function DirectionToggle({ dir, onChange, out, ret }: { dir: AltDir; onChange: (d: AltDir) => void; out: ItinTrip | null; ret: ItinTrip | null }) {
  const sides = (['out', 'ret'] as const).filter((d) => (d === 'out' ? out : ret));
  return (
    <div className="alt-dir" role="group" aria-label="Sens du trajet">
      {sides.map((d) => {
        const t = d === 'out' ? out : ret;
        const min = typeof t?.min === 'number' ? ` · ${t.min}\u00a0min` : '';
        return (
          <button key={d} type="button" className="alt-dir-btn" aria-pressed={dir === d} onClick={() => onChange(d)}>
            {d === 'out' ? 'Aller' : 'Retour'}
            {min}
          </button>
        );
      })}
    </div>
  );
}

/** Onglets des trajets (D-055), « Trajet retenu » expliqué en une phrase (retour de Cyril du 11/11) ; la méthode en plus en mode sources. */
function TabsRow({
  tab,
  onTab,
  walkLines,
  comfortNote,
  methodNote,
}: {
  tab: AltTabId;
  onTab: (t: AltTabId) => void;
  /** Réglage de marche lu et écart de départs plus tôt (phase G), en tête du « i » */
  walkLines: string[];
  comfortNote: string | null;
  methodNote: string[];
}) {
  const base = useId();
  const refs = useRef<Partial<Record<AltTabId, HTMLButtonElement | null>>>({});
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = ALT_TABS.map((t) => t.id);
    const i = ids.indexOf(tab);
    let next: AltTabId | undefined;
    if (e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    if (!next) return;
    e.preventDefault();
    onTab(next);
    refs.current[next]?.focus();
  };
  return (
    <>
      <div className="pf-trip-tabs-row">
        <div className="alt-tabs" role="tablist" aria-label="Trajets proposés" onKeyDown={onKey}>
          {ALT_TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              className="alt-tab"
              data-alt-tab={t.id}
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <SourceTip label="Qu'est-ce que le trajet retenu ?" block>
          <TipLines
            lines={[...walkLines, ALT_CALC_TIP, 'Deux trajets sont différents si leurs suites de lignes diffèrent.', ...(comfortNote ? [`${comfortNote.charAt(0).toUpperCase()}${comfortNote.slice(1)}.`] : [])]}
          />
        </SourceTip>
      </div>
      {methodNote.length > 0 && (
        <p className="pf-src">
          <TipLines lines={methodNote} />
        </p>
      )}
    </>
  );
}
