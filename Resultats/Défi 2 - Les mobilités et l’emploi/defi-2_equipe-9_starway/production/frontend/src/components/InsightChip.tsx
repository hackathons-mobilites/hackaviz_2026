import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { INSIGHT_TITLE } from '../data/insights';
import { useReservedRect } from '../store/overlayRects';
import { openInsight, scenarioMatchesInsight, useInsightChip } from '../store/insightPlayer';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { InsightIcon } from './Insights';

/**
 * Puce de la découverte ouverte (L-03) : « Découverte · Éclipse horaire · Revoir · Fermer », en haut
 * du ciel. Elle disparaît dès que le scénario affiché n'est plus celui de la découverte.
 */
export function InsightChip() {
  const active = useInsightChip((s) => s.active);
  const setActive = useInsightChip((s) => s.setActive);
  const scenario = useSkyStore((s) => s.scenario);
  const touring = useSkyStore((s) => s.tour.status !== 'idle');
  const ref = useRef<HTMLDivElement>(null);
  const show = !!active && !touring;
  useReservedRect('insight-chip', ref, show);

  useEffect(() => {
    if (active && !scenarioMatchesInsight(active)) setActive(null);
  }, [active, scenario, setActive]);

  return (
    <AnimatePresence>
      {show && active && (
        <m.div
          key={active.id}
          ref={ref}
          className="insight-chip"
          role="group"
          aria-label="Découverte ouverte"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
        >
          <InsightIcon kind={active.kind} />
          <span className="insight-chip-text">
            Découverte · <strong>{INSIGHT_TITLE[active.kind] ?? active.kind}</strong>
          </span>
          <button type="button" className="insight-chip-btn" onClick={() => void openInsight(active)}>
            Revoir
          </button>
          <button type="button" className="insight-chip-btn" onClick={() => setActive(null)} aria-label="Fermer le rappel de la découverte">
            Fermer
          </button>
        </m.div>
      )}
    </AnimatePresence>
  );
}
