import { useEffect, useState } from 'react';
import { loadPublicOffers, loadPublicOffersList } from '../../data/publicOffersLoad';
import type { PublicOffersFile, PublicOffersList } from '../../data/publicOffers';
import { useSkyStore } from '../../store/useSkyStore';

export type PublicOffersState = { status: 'loading' } | { status: 'ready'; file: PublicOffersFile } | { status: 'unavailable' };
export type PublicOffersListState = { status: 'loading' } | { status: 'ready'; list: PublicOffersList } | { status: 'unavailable' };

const LOADING = { status: 'loading' } as const;
const UNAVAILABLE = { status: 'unavailable' } as const;

/** service_public.json (D-036), chargé une fois (20 Ko) ; « unavailable » sans fichier valide. */
export function usePublicOffers(enabled: boolean): PublicOffersState {
  const dataset = useSkyStore((s) => s.dataset);
  const [state, setState] = useState<PublicOffersState>(LOADING);
  useEffect(() => {
    if (!dataset || !enabled) return;
    let alive = true;
    void loadPublicOffers(dataset).then((file) => {
      if (alive) setState(file ? { status: 'ready', file } : UNAVAILABLE);
    });
    return () => {
      alive = false;
    };
  }, [dataset, enabled]);
  return enabled ? state : LOADING;
}

/** Liste des offres, chargée seulement quand le pli « Voir les offres » est ouvert. */
export function usePublicOffersList(file: PublicOffersFile, enabled: boolean): PublicOffersListState {
  const [state, setState] = useState<PublicOffersListState>(LOADING);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadPublicOffersList(file).then((list) => {
      if (alive) setState(list ? { status: 'ready', list } : UNAVAILABLE);
    });
    return () => {
      alive = false;
    };
  }, [file, enabled]);
  return enabled ? state : LOADING;
}
