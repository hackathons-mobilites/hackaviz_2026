import { useState } from 'react';
import { gainSummaryText } from '../data/gain';
import { LOADING_MESSAGE, skySummary } from '../data/summary';
import { formatShift } from '../data/od/shift';
import { odSkySummary } from '../data/od/summaryText';
import { useDisplayedView, useReveal } from '../store/selectors';
import { useSkyStore } from '../store/useSkyStore';

/**
 * Alternative textuelle de l'état du ciel : la SEULE zone annoncée aux lecteurs d'écran pour le ciel
 * (le compteur n'en a plus). Elle lit la vue affichée (Acte 0) : rien avant l'allumage, et la valeur
 * ne change pas pendant un glisser de la jauge (une annonce au relâchement).
 */
export function SkySummary() {
  const view = useDisplayedView();
  const { mask, lights } = useReveal();
  const loading = useSkyStore((s) => s.loadingOrigin);
  const scrub = useSkyStore((s) => s.budgetScrub);
  const gain = useSkyStore((s) => s.gainReport);
  const split = useSkyStore((s) => !!s.scenario.compare);

  let text = '';
  if (view && lights) {
    const { meta } = view.dataset;
    const odText =
      view.basis === 'od' && view.od && view.origin
        ? odSkySummary({
            originName: view.origin.name,
            shiftLabel: formatShift({ start: view.od.scenario.start, end: view.od.scenario.end }),
            modeLabel: meta.modes.find((m) => m.id === view.scenario.mode)?.label ?? view.scenario.mode,
            budget: view.scenario.budget,
            totals: view.totals,
          })
        : null;
    text = odText ?? skySummary({
      originName: view.origin?.name ?? null,
      dayLabel: meta.day_types.find((d) => d.id === view.scenario.day)?.label ?? view.scenario.day,
      modeLabel: meta.modes.find((m) => m.id === view.scenario.mode)?.label ?? view.scenario.mode,
      budget: view.scenario.budget,
      totals: view.totals,
      accessMissing: view.accessMissing,
      accessCommunes: meta.access_communes,
    });
    // Or du gain démontré (audit point 2) : dit en mots, pas seulement par la couleur
    const gainJobs = gain?.gained.length
      ? view.dataset.poles.filter((p) => gain.gained.includes(p.id)).reduce<number | null>((t, p) => (t == null || p.jobs == null ? null : t + p.jobs), 0)
      : null;
    const gainText = gainSummaryText(gain, gainJobs, split);
    if (gainText) text = `${text} ${gainText}`;
  } else if (view && mask.light && loading) {
    text = LOADING_MESSAGE;
  }
  // Pendant le glisser, le texte reste celui d'avant le geste : la zone ne parle pas à chaque cran
  const [held, setHeld] = useState(text);
  if (!scrub && held !== text) setHeld(text);
  const shown = scrub ? held : text;

  return (
    <p className="sr-only" aria-live="polite">
      {shown}
    </p>
  );
}
