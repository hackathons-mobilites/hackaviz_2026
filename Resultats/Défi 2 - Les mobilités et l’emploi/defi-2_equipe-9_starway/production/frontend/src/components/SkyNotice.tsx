import { AnimatePresence, motion as m } from 'motion/react';
import { useViewport } from '../hooks/useViewport';
import { shortCommuneName } from '../data/proof';
import { modeMissingMessage } from '../data/coverage';
import { skyNoticeTitle } from '../data/skyNotice';
import { computeFrame } from '../sky/layout';
import { useSkyView } from '../store/selectors';
import { selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';

/**
 * Carte centrée sur le ciel quand aucun résultat n'est affiché pour la commune choisie
 * (pas de matrice publiée, ou journée / mode non calculés). Le ciel reste neutre derrière.
 */
/** Suggestions affichées au plus (le reste se trouve par la recherche) */
const MAX_SUGGESTIONS = 6;

export function SkyNotice() {
  const view = useSkyView();
  const viewport = useViewport();
  const bottom = useSkyStore(selectSkyBottom);
  const tourActive = useSkyStore((s) => s.tour.status !== 'idle');
  const phase = useSkyStore((s) => s.phase);
  const applyScenario = useSkyStore((s) => s.applyScenario);
  const show =
    !!view && phase === 'explore' && !tourActive && !!view.origin && !view.neutral && !view.totals.hasData && !view.scenario.compare;
  const frame = computeFrame(viewport.width, viewport.height, bottom);
  const meta = view?.dataset.meta;
  // Vélib' hors zone (D-027) : le texte publié, et les communes qui ont une station en suggestions
  const velibOut = !!view && view.scenario.mode === 'velib' && !!modeMissingMessage(view.dataset.meta, 'velib', view.origin?.insee ?? null, '');
  // 44 astres (D-030) : ce mode n'est pas encore recalculé vers les 44 astres, pour aucune commune : pas de suggestion
  const astres44 = useSkyStore((s) => s.astres44);
  const odFailed = useSkyStore((s) => s.odFailed);
  const pool = astres44 ? [] : velibOut ? (meta?.mode_coverage?.velib ?? []) : (meta?.access_communes ?? []);
  const computed = view
    ? pool.map((insee) => view.dataset.communes.find((c) => c.insee === insee)).filter((c): c is NonNullable<typeof c> => !!c)
    : [];

  const computedCount = view?.dataset.meta.access_communes?.length ?? 0;
  const title = view?.origin
    ? skyNoticeTitle({
        name: shortCommuneName(view.origin.name),
        poleCount: view.totals.poleCount,
        computedCount,
        communeCount: view.dataset.communes.length,
        odFailed: astres44 && odFailed,
        velibOutOfZone: velibOut ? (meta?.velib?.out_of_zone ?? null) : null,
        astres44,
        accessMissing: view.accessMissing,
        walkMissing: view.walkMissing,
      })
    : '';
  return (
    <AnimatePresence>
      {show && view && (
        <m.div
          key={`${view.origin!.insee}-${view.scenario.mode}-${view.scenario.day}-${view.scenario.walk ?? ""}`}
          className="sky-notice"
          role="status"
          style={{ left: frame.x + frame.w / 2, top: frame.y + frame.h / 2 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
        >
          <p className="sky-notice-title">{title}</p>
          <p className="sky-notice-body">
            Le ciel montre les {view.totals.poleCount} pôles d'emploi, aux mêmes places pour tous.
          </p>
          {computed.length > 0 && (
            <div className="sky-notice-chips">
              {computed.slice(0, MAX_SUGGESTIONS).map((c) => (
                <button key={c.insee} type="button" className="chip" onClick={() => void applyScenario({ origin: c.insee, pole: null })}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {computed.length > MAX_SUGGESTIONS && (
            <button
              type="button"
              className="link-btn sky-notice-search"
              onClick={() => {
                // Commune choisie : le bouton ouvre la recherche ; aucune commune : le champ est déjà là
                const start = document.querySelector<HTMLElement>('.bar-origin .commune-pick, .bar-origin input[role="combobox"]');
                start?.focus();
                start?.click();
              }}
            >
              Rechercher parmi les {computed.length} communes {velibOut ? 'qui ont une station Vélib\'' : 'calculées'}
            </button>
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
}
