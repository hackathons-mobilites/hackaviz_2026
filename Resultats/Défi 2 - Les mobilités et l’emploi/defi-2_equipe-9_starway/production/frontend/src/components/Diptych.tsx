import { motion as m } from 'motion/react';
import { useMemo } from 'react';
import { computeDelta } from '../data/accessibility';
import { diptychReading } from '../data/chartReading';
import { formatInt } from '../data/format';
import { missingAccessMessage } from '../data/summary';
import { useDisplayedView, useReveal, type SkyView } from '../store/selectors';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { useViewport } from '../hooks/useViewport';
import { STACK_MAX_WIDTH } from '../state/panes';
import { ChartReadingTip } from './ChartReadingTip';
import { CommuneSearch } from './CommuneSearch';

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatInt(Math.abs(n))}`;
}

/**
 * Commune B et sortie de la comparaison, dans l'en-tête du ciel B (retours du testeur KBS, 10/11) : le nom de B est un
 * sélecteur de commune, comme celui de A dans la barre ; « Quitter la comparaison » revient au ciel de A (l'URL perd `vs`).
 * Le focus va alors au sélecteur de A ; l'annonce aux lecteurs d'écran est faite par la barre du scénario, toujours montée.
 * Pendant la visite, l'en-tête reste un simple nom : la visite pilote le scénario.
 */
function CompareCommune({ view }: { view: SkyView }) {
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const origin = useSkyStore((s) => s.scenario.origin);
  const all = view.dataset.communes;
  // Liste stable (l'index de recherche n'est construit qu'une fois par commune A)
  const others = useMemo(() => all.filter((c) => c.insee !== origin), [all, origin]);
  return (
    <div className="pane-compare-pick">
      <CommuneSearch
        communes={others}
        value={view.origin}
        label="Comparer avec"
        placeholder="Seconde commune…"
        onSelect={(c) => void applyScenario({ compare: c.insee })}
      />
    </div>
  );
}

function QuitCompare() {
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const quit = () => {
    document.querySelector<HTMLButtonElement>('.bar-origin .commune-pick')?.focus();
    void applyScenario({ compare: null });
  };
  return (
    <button type="button" className="btn btn-ghost pane-quit" onClick={quit}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      Quitter la comparaison
    </button>
  );
}

function PaneHeader({ view, side, lights }: { view: SkyView; side: 'A' | 'B'; lights: boolean }) {
  const t = view.totals;
  const touring = useSkyStore((s) => s.tour.status !== 'idle');
  const controls = side === 'B' && !touring && !!view.origin;
  return (
    <div className={`pane-head pane-head-${side}${controls ? ' has-controls' : ''}`}>
      <span className="pane-tag">{side}</span>
      {controls ? <CompareCommune view={view} /> : <strong>{view.origin?.name ?? 'Commune'}</strong>}
      {!lights ? null : view.accessMissing ? (
        <span className="pane-msg">{missingAccessMessage(view.dataset.meta.access_communes)}</span>
      ) : t.hasData && view.basis === 'od' && t.od ? (
        <span className="pane-stat mono">
          {formatInt(t.od.reachedAll)} postes salariés (INSEE) atteints aller et retour · {formatInt(t.od.reachedCommunes)} communes
        </span>
      ) : t.hasData ? (
        <span className="pane-stat mono">
          {t.accessibleCount}/{t.poleCount} pôles accessibles aller et retour · {t.jobs == null ? 'n.d.' : formatInt(t.jobs)} postes salariés (INSEE)
        </span>
      ) : (
        <span className="pane-msg">Non calculé pour ce scénario</span>
      )}
      {controls && <QuitCompare />}
    </div>
  );
}

/** Acte 3 - deux horizons : en-têtes des deux ciels, séparateur et écart B - A. */
export function Diptych() {
  // Vues AFFICHÉES (Acte 0) : aucun écart chiffré avant l'allumage des deux ciels
  const a = useDisplayedView('A');
  const b = useDisplayedView('B');
  const { lights } = useReveal();
  const stacked = useViewport().width <= STACK_MAX_WIDTH;
  if (!a || !b) return null;
  const both = a.totals.hasData && b.totals.hasData;
  // Table OD (D-019) : écart de postes et de communes atteints (mêmes destinations des deux côtés)
  const odA = a.basis === 'od' ? a.totals.od : undefined;
  const odB = b.basis === 'od' ? b.totals.od : undefined;
  const odDelta = both && odA && odB ? { jobs: odB.reachedAll - odA.reachedAll, communes: odB.reachedCommunes - odA.reachedCommunes } : null;
  // On ne compare jamais deux bases de calcul différentes
  const d = both && !odDelta && a.basis === b.basis ? computeDelta(a.dataset.poles, a.states, b.states) : null;
  // « Comment lire ce graphique » des deux ciels : hors de la zone annoncée (role="status"), à côté de l'écart ; cas lu dans les totaux affichés
  const tip = (
    <ChartReadingTip
      chart="deux ciels, A et B"
      placement="top"
      reading={diptychReading(
        { name: a.origin?.name ?? 'A', totals: a.totals, od: a.basis === 'od' },
        { name: b.origin?.name ?? 'B', totals: b.totals, od: b.basis === 'od' },
        a.scenario.budget,
      )}
    />
  );
  return (
    <>
      <m.div
        className="split-divider"
        aria-hidden="true"
        initial={stacked ? { scaleX: 0 } : { scaleY: 0 }}
        animate={stacked ? { scaleX: 1 } : { scaleY: 1 }}
        transition={{ duration: 0.5, ease: motion.cssEasing.ui }}
      />
      <PaneHeader view={a} side="A" lights={lights} />
      <PaneHeader view={b} side="B" lights={lights} />
      {odDelta && (
        <div className="split-delta">
          <p className="split-delta-text" role="status">
            B par rapport à A : <strong className="mono">{signed(odDelta.jobs)}</strong> postes salariés (INSEE) atteints,{' '}
            <strong className="mono">{signed(odDelta.communes)}</strong> commune{Math.abs(odDelta.communes) > 1 ? 's' : ''}
          </p>
          {tip}
        </div>
      )}
      {d && (
        <div className="split-delta">
        <p className="split-delta-text" role="status">
          B par rapport à A : <strong className="mono">{signed(d.polesDelta)}</strong> pôle{Math.abs(d.polesDelta) > 1 ? 's' : ''}
          {d.jobsDelta != null && (
            <>
              , <strong className="mono">{signed(d.jobsDelta)}</strong> postes salariés (INSEE)
            </>
          )}
          {d.excluded.length > 0 &&
            ` (hors ${d.excluded.length} pôle${d.excluded.length > 1 ? 's' : ''} non calculé${d.excluded.length > 1 ? 's' : ''} d'un côté)`}
        </p>
          {tip}
        </div>
      )}
    </>
  );
}
