import { useMemo } from 'react';
import { needsSourceDates, type NeedId, type NeedsMeta, type NeedsReadCtx } from '../../data/needs';
import { useNeedsStore } from '../../store/needsStore';
import { useProvenanceStore } from '../../store/provenanceStore';
import { useSkyStore } from '../../store/useSkyStore';
import { isRecordMode } from '../../tour/recordSignal';

/** `meta.needs` publié par 06n (null tant que le pipeline ne l'a pas écrit : le réglage reste masqué). */
export function useNeedsMeta(): NeedsMeta | null {
  return useSkyStore((s) => s.dataset?.meta.needs ?? null);
}

const NONE: readonly NeedId[] = [];

/**
 * Cases cochées EN VIGUEUR : celles du navigateur, sauf pendant la visite guidée et l'enregistrement vidéo
 * (`?record=1`) où le réglage ne s'applique jamais (confidentialité : hors visite). Rien sans `meta.needs`.
 */
export function useNeedsSelected(): readonly NeedId[] {
  const selected = useNeedsStore((s) => s.selected);
  const published = useSkyStore((s) => !!s.dataset?.meta.needs);
  const tourActive = useSkyStore((s) => s.tour.status !== 'idle');
  return published && !tourActive && !isRecordMode() ? selected : NONE;
}

/** Niveaux de gare (meta.needs) et dates de relevé des sources (sources.json), pour lire un tronçon. */
export function useNeedsReadCtx(): NeedsReadCtx {
  const meta = useNeedsMeta();
  const sources = useSkyStore((s) => s.dataset?.sources);
  const withSources = useProvenanceStore((s) => s.on);
  return useMemo(() => ({ meta, dates: needsSourceDates(sources), withSources }), [meta, sources, withSources]);
}
