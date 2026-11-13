import { create } from 'zustand';
import { parseView } from '../state/url';

/**
 * État local des fonctionnalités « carte miroir » et « affiche » (hors scénario : la carte change la
 * vue, jamais l'état du ciel).
 */
export type MirrorPhase = 'sky' | 'entering' | 'map' | 'leaving';

interface FeaturesState {
  /** Demande d'ouverture de la carte (bouton, touche M, panneau de preuve) */
  mapOpen: boolean;
  mapPhase: MirrorPhase;
  /** Diptyque : « Vu depuis A / B » (quels états prennent les territoires) */
  mapSide: 'A' | 'B';
  /** Message bref (toast) : affiche enregistrée, carte indisponible… */
  toast: string | null;
  setMapOpen: (open: boolean) => void;
  setMapPhase: (phase: MirrorPhase) => void;
  setMapSide: (side: 'A' | 'B') => void;
  showToast: (msg: string | null) => void;
}

let toastTimer: number | undefined;

export const useFeaturesStore = create<FeaturesState>()((set) => ({
  // Un lien partagé avec &v=map s'ouvre sur la carte (dès l'entrée dans l'explorateur)
  mapOpen: typeof window !== 'undefined' && parseView(window.location.search) === 'map',
  mapPhase: 'sky',
  mapSide: 'A',
  toast: null,
  setMapOpen: (mapOpen) => set({ mapOpen }),
  setMapPhase: (mapPhase) => set({ mapPhase }),
  setMapSide: (mapSide) => set({ mapSide }),
  showToast: (toast) => {
    window.clearTimeout(toastTimer);
    set({ toast });
    if (toast) toastTimer = window.setTimeout(() => set({ toast: null }), 3200);
  },
}));
