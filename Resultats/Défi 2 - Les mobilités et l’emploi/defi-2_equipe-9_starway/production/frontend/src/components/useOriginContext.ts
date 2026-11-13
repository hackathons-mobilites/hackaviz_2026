import { useEffect } from 'react';
import { loadContext } from '../data/loaders';
import type { ContextFile } from '../data/types';
import { useSkyStore } from '../store/useSkyStore';

/**
 * context/{insee}.json de la commune d'origine, chargé à la demande (cache du loader) et rangé dans
 * le store. undefined = en cours, null = absent (mode démo ou fichier manquant).
 */
export function useOriginContext(insee: string | null | undefined): ContextFile | null | undefined {
  const dataset = useSkyStore((s) => s.dataset);
  const ctx = useSkyStore((s) => (insee ? s.contexts[insee] : undefined));
  const known = useSkyStore((s) => !!insee && insee in s.contexts);

  useEffect(() => {
    if (!dataset || !insee || known) return;
    let alive = true;
    void loadContext(dataset, insee).then((file) => {
      if (!alive) return;
      useSkyStore.setState((s) => (insee in s.contexts ? s : { contexts: { ...s.contexts, [insee]: file } }));
    });
    return () => {
      alive = false;
    };
  }, [dataset, insee, known]);

  return insee ? ctx : null;
}
