import { useEffect, useState } from 'react';
import { loadTerritoire } from '../../data/loaders';
import type { TerritoireFile } from '../../data/territoire';
import { useSkyStore } from '../../store/useSkyStore';

export type TerritoireState = { status: 'loading' } | { status: 'ready'; file: TerritoireFile } | { status: 'unavailable' };

const LOADING: TerritoireState = { status: 'loading' };
const UNAVAILABLE: TerritoireState = { status: 'unavailable' };

/** territoire.json (D-048), chargé une fois quand `enabled` ; « unavailable » sans fichier valide (démonstration comprise). */
export function useTerritoire(enabled = true): TerritoireState {
  const dataset = useSkyStore((s) => s.dataset);
  const [state, setState] = useState<TerritoireState>(LOADING);
  useEffect(() => {
    if (!dataset || !enabled) return;
    let alive = true;
    void loadTerritoire(dataset).then((file) => {
      if (alive) setState(file ? { status: 'ready', file } : UNAVAILABLE);
    });
    return () => {
      alive = false;
    };
  }, [dataset, enabled]);
  return enabled ? state : LOADING;
}
