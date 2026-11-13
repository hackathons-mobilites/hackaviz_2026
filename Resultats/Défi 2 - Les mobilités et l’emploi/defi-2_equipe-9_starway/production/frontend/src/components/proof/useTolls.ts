import { useEffect, useState } from 'react';
import { loadTolls } from '../../data/loaders';
import type { TollsFile } from '../../data/types';
import { useSkyStore } from '../../store/useSkyStore';

/** tolls.json (D-029), chargé une fois quand `enabled` (panneau de preuve en voiture) ; null avant ou sans fichier. */
export function useTolls(enabled: boolean): TollsFile | null {
  const dataset = useSkyStore((s) => s.dataset);
  const [file, setFile] = useState<TollsFile | null>(null);
  useEffect(() => {
    if (!dataset || !enabled) return;
    let alive = true;
    void loadTolls(dataset).then((f) => {
      if (alive) setFile(f);
    });
    return () => {
      alive = false;
    };
  }, [dataset, enabled]);
  return enabled ? file : null;
}
