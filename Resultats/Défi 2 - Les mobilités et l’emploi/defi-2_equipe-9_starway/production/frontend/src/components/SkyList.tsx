import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isTimeDependent, listOrder, STATUS_RANK, statusCounts, type PoleStatus } from '../data/accessibility';
import { formatInt, formatMinutes, formatPercent, statusLabel } from '../data/format';
import { GAIN_MARK, isGained } from '../data/gain';
import { poleShortName } from '../data/labels';
import { astreBassinLine, astreBassinSentence } from '../data/astreBassin';
import { SkySourceNote } from './provenance/ProofNotes';
import { CalcMethodNote } from './provenance/MethodNote';
import { formatShift } from '../data/od/shift';
import { reachedCommunes } from '../data/od/sky';
import { poleShareState, selfJobsLine } from '../data/od/summaryText';
import { reasonContext, stateReasonText } from '../data/proof';
import { walkSettingPhrase } from '../data/walkSettings';
import { VelibWarning } from './VelibWarning';
import { useSkyView } from '../store/selectors';
import { highlightPole } from '../store/skyBridge';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { useReservedRect } from '../store/overlayRects';
import { useFeaturesStore } from './featuresStore';
import { StatusGlyph, type GlyphKind } from './StatusGlyph';

type SortKey = 'status' | 'name' | 'jobs' | 'out' | 'ret';

/** Communes atteintes montrées d'abord (le reste à la demande) : rythme de lecture, pas une donnée */
const COMMUNES_FIRST = 30;

/** Libellés courts de la liste (la ligne complète est lue par le lecteur d'écran). */
const STATUS_SHORT: Record<PoleStatus, string> = {
  accessible: 'Accessible aller et retour',
  out_only: 'Aller possible, retour hors de portée',
  none: 'Hors de portée',
  unknown: 'Non calculé',
};

/**
 * « Lire le ciel en liste » : alternative textuelle du ciel, mêmes données et mêmes fonctions
 * (computePoleStates). Chaque ligne porte l'état du pôle avec le glyphe de l'astre (forme + texte,
 * jamais la couleur seule ; cyan réservé à « accessible »). Accessibles d'abord par défaut.
 *
 * Panneau NON modal (pas de voile) : la barre de scénario reste utilisable et la liste suit le ciel
 * à chaque changement ; survoler ou parcourir une ligne au clavier surligne l'astre correspondant.
 * Rendu dans .app (portail) : le panneau ne dépend pas du contexte d'empilement de la barre du haut.
 */
export function SkyList({ open, onClose }: { open: boolean; onClose: () => void }) {
  const view = useSkyView();
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const accessFiles = useSkyStore((s) => s.access);
  const tourActive = useSkyStore((s) => s.tour.status !== 'idle');
  // Or du gain démontré : dit dans la liste aussi (glyphe à seconde orbite + mots), jamais par la seule couleur
  const gainReport = useSkyStore((s) => s.gainReport);
  const split = useSkyStore((s) => !!s.scenario.compare);
  const mapOpen = useFeaturesStore((s) => s.mapOpen);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  /** Communes atteintes montrées (table OD) : les premières, puis toutes à la demande */
  const [communeLimit, setCommuneLimit] = useState(COMMUNES_FIRST);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Zone réservée du ciel (L-02) : aucun nom sous la liste, le contraste du jour s'en écarte
  useReservedRect('list', panelRef, open);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => closeRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      // le panneau de preuve et les sources se ferment d'abord
      const st = useSkyStore.getState();
      if (e.key === 'Escape' && !st.scenario.pole && !st.sourcesOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      highlightPole(null);
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, [open, onClose]);

  // La carte miroir et la visite prennent tout l'écran : la liste se referme
  useEffect(() => {
    if (open && (mapOpen || tourActive)) onClose();
  }, [open, mapOpen, tourActive, onClose]);

  const hasResult = !!view && !!view.origin && !view.neutral && view.totals.hasData;
  /** Table OD (D-019) : part atteinte par pôle (colonnes « Atteints » et « Part ») au lieu des temps d'un arrêt */
  const odMode = hasResult && view?.basis === 'od';
  const odResult = view?.od ?? null;
  const reached = useMemo(() => (odMode ? reachedCommunes(odResult) : []), [odMode, odResult]);
  const communeList = view?.dataset.communes;
  const names = useMemo(() => new Map((communeList ?? []).map((c) => [c.insee, c.name] as const)), [communeList]);

  const rows = useMemo(() => {
    if (!view) return [];
    const { poles } = view.dataset;
    let order: number[];
    if (sort.key === 'status') {
      order = hasResult ? listOrder(poles, view.states) : poles.map((_, i) => i).sort((a, b) => (poles[b]!.jobs ?? -1) - (poles[a]!.jobs ?? -1));
      if (sort.dir === -1) order.reverse();
    } else {
      const val = (i: number): number | string => {
        const st = view.states[i]!;
        switch (sort.key) {
          case 'name':
            return poles[i]!.name;
          case 'jobs':
            return poles[i]!.jobs ?? -1;
          case 'out':
            // table OD : postes atteints (le plus grand d'abord, comme « Postes »)
            if (st.od) return -st.od.reached;
            return hasResult ? (st.out ?? Infinity) : 0;
          default:
            if (st.od) return -(st.od.share ?? -1);
            return hasResult ? (st.ret ?? Infinity) : 0;
        }
      };
      order = poles
        .map((_, i) => i)
        .sort((a, b) => {
          const va = val(a);
          const vb = val(b);
          const c = typeof va === 'string' ? va.localeCompare(String(vb), 'fr') : (va as number) - (vb as number);
          return c * sort.dir || STATUS_RANK[view.states[a]!.status] - STATUS_RANK[view.states[b]!.status] || a - b;
        });
    }
    return order.map((i) => ({ index: i, pole: poles[i]!, state: view.states[i]! }));
  }, [view, sort, hasResult]);

  if (!view) return null;
  const { budget } = view.scenario;
  const counts = statusCounts(view.states);
  const timeDependent = isTimeDependent(view.origin ? accessFiles[view.origin.insee] : null, view.scenario.mode, view.scenario.day);
  // Raisons : le réglage de marche des TC en vigueur est cité (D-024)
  const reasons = reasonContext(view.dataset.meta, timeDependent, view.walkSetting);
  const walkTxt = view.walkSetting ? ` (${walkSettingPhrase(view.walkSetting)} à chaque bout)` : '';
  const velibWarning = view.scenario.mode === 'velib' ? view.dataset.meta.velib?.warning : undefined;
  const dayLabel =
    odMode && view.od
      ? `horaires ${formatShift({ start: view.od.scenario.start, end: view.od.scenario.end })}`
      : `journée-type ${view.dataset.meta.day_types.find((d) => d.id === view.scenario.day)?.label ?? view.scenario.day}`;
  const modeLabel = (view.dataset.meta.modes.find((x) => x.id === view.scenario.mode)?.label ?? view.scenario.mode).toLowerCase();
  /** « Votre commune : N postes, trajet non mesuré » : à part, hors du total et des pourcentages (4.1) */
  const selfLine = odMode && view.totals.od ? selfJobsLine(view.totals.od.selfJobs) : null;
  const header = (key: SortKey, label: string, className?: string) => {
    const active = sort.key === key;
    return (
      <th scope="col" className={className} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => setSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : key === 'jobs' ? -1 : 1 })}>
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
        </button>
      </th>
    );
  };

  const time = (v: number | null) => (
    <td className={`mono col-num ${!hasResult || v == null || v > budget ? 'is-over' : ''}`}>
      {!hasResult ? '-' : formatMinutes(v)}
      {hasResult && v != null && v > budget && <span className="sr-only"> (au-delà de {budget} min)</span>}
    </td>
  );

  const panel = (
    <AnimatePresence>
      {open && (
        <m.section
          ref={panelRef}
          className="sky-list-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="sky-list-title"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
          onPointerLeave={() => highlightPole(null)}
        >
          <header className="sky-list-head">
            <h2 id="sky-list-title">Le ciel en liste</h2>
            <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Fermer la liste" aria-keyshortcuts="Escape">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <p className="sky-list-scenario">
            {view.origin
              ? `Depuis ${view.origin.name}, ${dayLabel}, ${modeLabel}${walkTxt}, aller et retour en ${budget} min ou moins par sens.`
              : 'Aucune commune de départ choisie : seuls les postes sont indiqués.'}
          </p>
          {velibWarning && <VelibWarning text={velibWarning} className="sky-list-velib" />}
          {odMode && view.totals.od && (
            <p className="sky-list-scenario">
              Toutes les communes d'Île-de-France sont des destinations : chaque astre s'éclaire selon la part de ses postes atteinte aller et retour (
              {formatInt(view.totals.od.reachedAll)} postes atteints sur {formatInt(view.totals.od.measurableJobs)}, dans{' '}
              {formatInt(view.totals.od.reachedCommunes)} communes sur {formatInt(view.totals.od.communes)}).
              {selfLine ? ` ${selfLine}, hors du total et des pourcentages.` : ''}
            </p>
          )}
          {hasResult && !odMode ? (
            <ul className="sky-list-counts" aria-label="Pôles par état">
              <li className="is-on">
                <StatusGlyph kind="accessible" size={16} />
                <span>
                  <strong>{counts.accessible}</strong> accessible{counts.accessible > 1 ? 's' : ''} aller et retour
                  {view.totals.jobs != null && ` (${formatInt(view.totals.jobs)} postes)`}
                </span>
              </li>
              {counts.out_only > 0 && (
                <li>
                  <StatusGlyph kind="out_only" size={16} />
                  <span>
                    <strong>{counts.out_only}</strong> aller possible, retour hors de portée
                  </span>
                </li>
              )}
              <li>
                <StatusGlyph kind="none" size={16} />
                <span>
                  <strong>{counts.none}</strong> hors de portée
                </span>
              </li>
              {counts.unknown > 0 && (
                <li>
                  <StatusGlyph kind="unknown" size={16} />
                  <span>
                    <strong>{counts.unknown}</strong> non calculé{counts.unknown > 1 ? 's' : ''}
                  </span>
                </li>
              )}
            </ul>
          ) : (
            view.origin && !odMode && <p className="sky-list-scenario">Aucun résultat affiché pour ce scénario : le ciel est neutre.</p>
          )}
          <div className="sky-list-body">
            <table className="sky-table">
              <caption className="sr-only">
                Pôles d'emploi, triables par colonne. Survoler ou parcourir une ligne surligne l'astre dans le ciel ; Entrée ouvre le panneau de preuve.
              </caption>
              <thead>
                <tr>
                  {header('status', 'État', 'col-state')}
                  {header('name', 'Pôle')}
                  {header('jobs', 'Postes', 'col-num')}
                  {header('out', odMode ? 'Atteints' : 'Aller', 'col-num')}
                  {header('ret', odMode ? 'Part' : 'Retour', 'col-num')}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ index, pole, state }) => {
                  const kind: GlyphKind = hasResult ? state.status : 'neutral';
                  const why = hasResult && (state.status === 'none' || state.status === 'out_only') ? stateReasonText(state, reasons) : null;
                  const gained = hasResult && !state.od && state.status === 'accessible' && isGained(gainReport, pole.id, split);
                  const label =
                    (!hasResult ? 'Pas de résultat' : state.od ? poleShareState(state.od) : STATUS_SHORT[state.status]) + (gained ? ` · ${GAIN_MARK}` : '');
                  return (
                    <tr
                      key={pole.id}
                      className={`sky-row row-${kind}`}
                      onPointerEnter={() => highlightPole(index)}
                      onPointerLeave={() => highlightPole(null)}
                    >
                      <td className="col-state">
                        {state.od && hasResult && state.status === 'accessible' ? (
                          <StatusGlyph kind="part" share={state.od.share ?? 0} size={18} />
                        ) : (
                          <StatusGlyph kind={gained ? 'gain' : kind} size={18} />
                        )}
                      </td>
                      <th scope="row">
                        <button
                          type="button"
                          className="link-btn"
                          onFocus={() => highlightPole(index)}
                          onBlur={() => highlightPole(null)}
                          aria-label={`${pole.name_official ?? pole.name} : ${hasResult ? (state.od ? poleShareState(state.od) : statusLabel[state.status]) : 'pas de résultat'}${gained ? ` (${GAIN_MARK})` : ''}${why ? ` (${why})` : ''}.${astreBassinSentence(pole) ? ` ${astreBassinSentence(pole)}` : ''} Ouvrir le panneau de preuve.`}
                          onClick={() => {
                            onClose();
                            void applyScenario({ pole: pole.id });
                          }}
                        >
                          {poleShortName(pole)}
                        </button>
                        <span className="sky-row-state" aria-hidden="true">
                          {label}
                          {why && ` (${why})`}
                        </span>
                        {astreBassinLine(pole) && (
                          <span className="sky-row-state" aria-hidden="true">
                            {astreBassinLine(pole)}
                          </span>
                        )}
                      </th>
                      <td className="mono col-num">{pole.jobs == null ? 'n.d.' : formatInt(pole.jobs)}</td>
                      {state.od ? (
                        <>
                          <td className="mono col-num">{formatInt(state.od.reached)}</td>
                          <td className="mono col-num">{state.od.share != null ? formatPercent(state.od.share * 100) : '-'}</td>
                        </>
                      ) : (
                        <>
                          {time(state.out)}
                          {time(state.ret)}
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Mode provenance : postes et temps de trajet de tout le tableau, une seule ligne */}
            <SkySourceNote mode={view.scenario.mode} />
            {odMode && <CalcMethodNote timeDependent={!!odResult?.timeDependent} className="sky-list-prov" />}
            {odMode && (
              <section className="sky-communes" aria-labelledby="sky-communes-title">
                <h3 id="sky-communes-title">Communes atteintes aller et retour ({formatInt(reached.length)}), par postes salariés (INSEE)</h3>
                {reached.length === 0 ? (
                  <p className="sky-list-scenario">Aucune commune atteinte aller et retour en {budget} min ou moins par sens.</p>
                ) : (
                  <table className="sky-table sky-communes-table">
                    <caption className="sr-only">Communes atteintes, triées par postes décroissants, avec le temps aller et le temps retour.</caption>
                    <thead>
                      <tr>
                        <th scope="col">Commune</th>
                        <th scope="col" className="col-num">
                          Postes
                        </th>
                        <th scope="col" className="col-num">
                          Aller
                        </th>
                        <th scope="col" className="col-num">
                          Retour
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reached.slice(0, communeLimit).map((c) => {
                        const pole = c.pole != null ? view.dataset.poles[c.pole] : undefined;
                        return (
                          <tr key={c.insee}>
                            <th scope="row">
                              {names.get(c.insee) ?? c.insee}
                              {pole && <span className="sky-row-state">pôle {poleShortName(pole)}</span>}
                            </th>
                            <td className="mono col-num">{formatInt(c.jobs)}</td>
                            <td className="mono col-num">{formatMinutes(c.out)}</td>
                            <td className="mono col-num">{formatMinutes(c.ret)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {reached.length > communeLimit && (
                  <button type="button" className="btn sky-communes-more" onClick={() => setCommuneLimit(reached.length)}>
                    Afficher les {formatInt(reached.length)} communes
                  </button>
                )}
              </section>
            )}
          </div>
        </m.section>
      )}
    </AnimatePresence>
  );
  // dans .app (variables --banner-h, --bar-h), hors de la barre du haut et de son contexte d'empilement
  return createPortal(panel, document.querySelector('.app') ?? document.body);
}
