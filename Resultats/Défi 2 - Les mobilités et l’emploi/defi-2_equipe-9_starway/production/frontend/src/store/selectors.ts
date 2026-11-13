import { useMemo } from 'react';
import { buildDisplayedView, lightsShown, selectDisplayMask, type DisplayMask, type IntroStep } from '../state/displayMask';
import { buildSkyView, type SkyView } from '../state/skyView';
import { useOdStore } from './useOdStore';
import { useSkyStore } from './useSkyStore';

export { buildSkyView, type SkyView } from '../state/skyView';
export { introAtLeast, selectDisplayMask, type DisplayMask, type IntroStep } from '../state/displayMask';

/** Vue réelle (réglages du scénario). Pour ce qui est DESSINÉ ou ANNONCÉ, utiliser useDisplayedView. */
export function useSkyView(): SkyView | null {
  const dataset = useSkyStore((s) => s.dataset);
  const scenario = useSkyStore((s) => s.scenario);
  const access = useSkyStore((s) => s.access);
  const revealed = useSkyStore((s) => s.revealed);
  const od = useOdStore((s) => s.shown);
  return useMemo(
    () => (dataset ? buildSkyView(dataset, scenario, access, revealed, od ? { shown: od, side: 'A' } : null) : null),
    [dataset, scenario, access, revealed, od],
  );
}

/** Vue B du diptyque : même scénario, origine = commune de comparaison. */
export function useCompareView(): SkyView | null {
  const dataset = useSkyStore((s) => s.dataset);
  const scenario = useSkyStore((s) => s.scenario);
  const access = useSkyStore((s) => s.access);
  const revealed = useSkyStore((s) => s.revealed);
  const od = useOdStore((s) => s.shown);
  return useMemo(
    () =>
      dataset && scenario.compare
        ? buildSkyView(dataset, { ...scenario, origin: scenario.compare }, access, revealed, od ? { shown: od, side: 'B' } : null)
        : null,
    [dataset, scenario, access, revealed, od],
  );
}

/**
 * Vue AFFICHÉE (Acte 0) : vue réelle passée par le masque de la révélation. Le ciel, la couche DOM,
 * SkySummary, la légende et le compteur la lisent : ce qu'entend le lecteur d'écran est ce que
 * montre le ciel. `side = 'B'` : ciel de la commune de comparaison.
 */
export function useDisplayedView(side: 'A' | 'B' = 'A'): SkyView | null {
  const dataset = useSkyStore((s) => s.dataset);
  const scenario = useSkyStore((s) => s.scenario);
  const access = useSkyStore((s) => s.access);
  const revealed = useSkyStore((s) => s.revealed);
  const intro = useSkyStore((s) => s.intro);
  const loading = useSkyStore((s) => s.loadingOrigin);
  const od = useOdStore((s) => s.shown);
  return useMemo(() => {
    if (!dataset) return null;
    if (side === 'B' && !scenario.compare) return null;
    const sc = side === 'B' ? { ...scenario, origin: scenario.compare } : scenario;
    return buildDisplayedView(dataset, sc, access, revealed, intro, loading, od ? { shown: od, side } : null);
  }, [dataset, scenario, access, revealed, intro, loading, side, od]);
}

export interface RevealState {
  intro: IntroStep;
  mask: DisplayMask;
  /** Les états réels d'accessibilité sont montrés (étape atteinte et données chargées) */
  lights: boolean;
  /** Cartes secondaires permises (contraste du jour, SkyNotice) : révélation finie + temps calme */
  quiet: boolean;
}

export function useReveal(): RevealState {
  const intro = useSkyStore((s) => s.intro);
  const quiet = useSkyStore((s) => s.introQuiet);
  const origin = useSkyStore((s) => s.scenario.origin);
  const access = useSkyStore((s) => s.access);
  const loading = useSkyStore((s) => s.loadingOrigin);
  return useMemo(
    () => ({ intro, mask: selectDisplayMask(intro), lights: lightsShown(intro, origin, access, loading), quiet: intro === 'done' && quiet }),
    [intro, quiet, origin, access, loading],
  );
}
