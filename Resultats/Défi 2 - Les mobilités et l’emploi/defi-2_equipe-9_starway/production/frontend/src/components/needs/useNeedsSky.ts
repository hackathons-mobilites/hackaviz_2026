import { useMemo } from 'react';
import { skyNeeds, markedPoles, needsSkyWhy, sameAstres, type NeedsLegendState } from '../../data/needsSky';
import { itineraryDay } from '../../data/itineraries';
import { useDisplayedView } from '../../store/selectors';
import { useSkyStore } from '../../store/useSkyStore';
import { useItineraries } from '../proof/useItineraries';
import { useNeedsSelected } from '../proof/useNeedsMeta';

export interface NeedsSky {
  legend: NeedsLegendState;
  /** Identifiants des astres marqués du ciel affiché (vide sans marque) */
  marked: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * « Ce qu'il me faut sur mon trajet » sur le ciel affiché (ciel A seulement) : quels astres portent la marque, et ce que
 * la légende doit dire. Lit le fichier d'itinéraires de la commune (le trajet le plus rapide, aller ET retour, de la
 * journée et du réglage de marche du scénario) ; ne modifie rien du ciel. Aucune case cochée : aucun chargement.
 */
export function useNeedsSky(): NeedsSky {
  const view = useDisplayedView('A');
  const selected = useNeedsSelected();
  const split = useSkyStore((s) => !!s.scenario.compare);
  const sky = skyNeeds(selected);
  const meta = view?.dataset.meta;
  const od = view?.basis === 'od' ? view.od : null;
  const shift = od ? { start: od.scenario.start, end: od.scenario.end } : view?.scenario.shift ?? null;
  const walkKey = view?.walkSetting?.key ?? null;
  const origin = view?.origin?.insee ?? null;
  const why =
    view && meta && selected.length > 0 && sky.length > 0
      ? needsSkyWhy({ meta, mode: view.scenario.mode, day: view.scenario.day, shift, walkKey, origin, split })
      : null;
  const wanted = !!view && sky.length > 0 && !!origin && why === null;
  const file = useItineraries(origin, wanted, walkKey);
  const poleIds = useMemo(() => view?.dataset.poles.map((p) => p.id) ?? [], [view?.dataset.poles]);
  const day = view && meta ? itineraryDay(meta.day_types, view.scenario.day, shift) : null;
  const budget = view?.scenario.budget ?? 0;
  const aligned = sameAstres(file, poleIds);
  const marked = useMemo(
    () => (wanted && file && aligned ? new Set(markedPoles({ selected, file, poleIds, day, budget })) : EMPTY),
    [wanted, file, aligned, selected, poleIds, day, budget],
  );
  if (!view || selected.length === 0) return { legend: { kind: 'none' }, marked: EMPTY };
  if (sky.length === 0) return { legend: { kind: 'signs_only' }, marked: EMPTY };
  if (why) return { legend: { kind: 'unavailable', why }, marked: EMPTY };
  if (!file) return { legend: { kind: 'unavailable', why: 'loading' }, marked: EMPTY };
  if (!aligned) return { legend: { kind: 'unavailable', why: 'pending' }, marked: EMPTY };
  return { legend: { kind: 'ready', marked: marked.size, total: poleIds.length }, marked };
}
