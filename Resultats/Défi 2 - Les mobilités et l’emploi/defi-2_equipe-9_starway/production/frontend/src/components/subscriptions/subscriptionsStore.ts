import { create } from 'zustand';

/**
 * Réglage « Mes abonnements » (D-032 proposée) : mémorisé sur l'appareil comme les autres réglages
 * (localStorage), hors du scénario (ni URL, ni visite) : il ne change que le coût affiché, jamais le ciel.
 * Le dialogue s'appelle « Mes réglages » et regroupe aussi « Ce qu'il me faut sur mon trajet » ; son état d'ouverture
 * reste ici (`dialogOpen`, `openDialog`, `closeDialog`) : le panneau et les onglets de trajets s'en servent déjà.
 * Le choix ne change qu'avec `save` (bouton « Enregistrer »).
 * Les identifiants sont ceux de `subscriptions.json` ; un identifiant inconnu du fichier publié est traité
 * comme « aucun abonnement » à l'affichage (le panneau le dit).
 */
const STORAGE_KEY = 'starway.subscriptions';

export interface SubscriptionChoice {
  /** `transit.options[].id`, ou null : aucun abonnement (tickets à l'unité) */
  transit: string | null;
  /** `velib.offers[].id`, ou null : aucun abonnement Vélib' (Ticket-V à la course) */
  velib: string | null;
}

function readStored(): SubscriptionChoice {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { transit: null, velib: null };
    const v = JSON.parse(raw) as Partial<SubscriptionChoice>;
    return { transit: typeof v.transit === 'string' ? v.transit : null, velib: typeof v.velib === 'string' ? v.velib : null };
  } catch {
    return { transit: null, velib: null };
  }
}

function writeStored(c: SubscriptionChoice): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    return true;
  } catch {
    /* stockage indisponible (navigation privée) : le choix vaut pour la session */
    return false;
  }
}

/** Partie du dialogue « Mes réglages » à montrer à l'ouverture */
export type SettingsSection = 'subs' | 'needs';

interface SubscriptionsState extends SubscriptionChoice {
  dialogOpen: boolean;
  dialogSection: SettingsSection;
  /** Élément qui a ouvert le dialogue : il reprend le focus à la fermeture */
  opener: HTMLElement | null;
  setTransit: (id: string | null) => void;
  setVelib: (id: string | null) => void;
  /** Enregistre le choix du dialogue ; false si le navigateur a refusé de le garder (il vaut alors pour la session) */
  save: (choice: SubscriptionChoice) => boolean;
  openDialog: (opener?: HTMLElement | null, section?: SettingsSection) => void;
  closeDialog: () => void;
}

export const useSubscriptionsStore = create<SubscriptionsState>()((set, get) => ({
  ...(typeof window === 'undefined' ? { transit: null, velib: null } : readStored()),
  dialogOpen: false,
  dialogSection: 'subs',
  opener: null,
  setTransit: (transit) => {
    set({ transit });
    writeStored({ transit, velib: get().velib });
  },
  setVelib: (velib) => {
    set({ velib });
    writeStored({ transit: get().transit, velib });
  },
  save: ({ transit, velib }) => {
    set({ transit, velib });
    return writeStored({ transit, velib });
  },
  openDialog: (opener = null, section = 'subs') => set({ dialogOpen: true, opener, dialogSection: section }),
  closeDialog: () => {
    const { opener } = get();
    set({ dialogOpen: false, opener: null });
    if (opener && document.contains(opener)) window.requestAnimationFrame(() => opener.focus());
  },
}));
