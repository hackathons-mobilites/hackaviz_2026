import { useEffect, useState } from 'react';
import type { BmoFile } from '../../data/bmo';
import { loadBmo } from '../../data/loaders';
import { useSkyStore } from '../../store/useSkyStore';

export type BmoState = { status: 'loading' } | { status: 'ready'; file: BmoFile } | { status: 'unavailable' };

const LOADING: BmoState = { status: 'loading' };
const UNAVAILABLE: BmoState = { status: 'unavailable' };

/** bmo.json (D-035), chargé une fois quand `enabled` (astre rattaché à un bassin d'emploi) ; « unavailable » sans fichier valide. */
export function useBmo(enabled: boolean): BmoState {
  const dataset = useSkyStore((s) => s.dataset);
  const [state, setState] = useState<BmoState>(LOADING);
  useEffect(() => {
    if (!dataset || !enabled) return;
    let alive = true;
    void loadBmo(dataset).then((file) => {
      if (alive) setState(file ? { status: 'ready', file } : UNAVAILABLE);
    });
    return () => {
      alive = false;
    };
  }, [dataset, enabled]);
  return enabled ? state : LOADING;
}
