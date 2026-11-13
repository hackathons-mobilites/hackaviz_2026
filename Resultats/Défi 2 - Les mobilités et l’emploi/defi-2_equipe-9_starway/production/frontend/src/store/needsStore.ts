import { create } from 'zustand';
import { NEEDS_LEGACY_STORAGE_KEY, NEEDS_STORAGE_KEY, parseStoredNeeds, serializeNeeds, type NeedId } from '../data/needs';

function readStored(): string | null {
  try {
    // Version finale du 05/11 : le choix du 04/11 (classement par handicap) est effacé du navigateur, jamais relu
    window.localStorage.removeItem(NEEDS_LEGACY_STORAGE_KEY);
    return window.localStorage.getItem(NEEDS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(selected: readonly NeedId[]): boolean {
  try {
    window.localStorage.setItem(NEEDS_STORAGE_KEY, serializeNeeds(selected));
    return true;
  } catch {
    /* stockage indisponible (navigation privée) : le choix vaut pour la session */
    return false;
  }
}

interface NeedsState {
  /** Cases cochées de « Ce qu'il me faut sur mon trajet » */
  selected: NeedId[];
  /** Enregistre les cases du dialogue « Mes réglages » (ce navigateur seulement) ; false si le navigateur a refusé de les garder */
  save: (selected: readonly NeedId[]) => boolean;
}

/**
 * Réglage « Ce qu'il me faut sur mon trajet », hors du store du ciel comme le son et le daltonisme : ce n'est pas un
 * scénario. Les choix restent dans ce navigateur (localStorage), JAMAIS dans l'URL, dans un lien copié, dans la visite
 * ni dans l'enregistrement vidéo. Ils ne changent aucune donnée, aucun état d'astre, aucune position ni taille : ils
 * choisissent ce que le panneau dit de chaque tronçon et si un calque de marque est posé sur le ciel. Le daltonisme n'en
 * fait pas partie : c'est un réglage d'affichage (barre du haut).
 */
export const useNeedsStore = create<NeedsState>()((set) => ({
  selected: typeof window === 'undefined' ? [] : parseStoredNeeds(readStored()),
  save: (selected) => {
    set({ selected: [...selected] });
    return writeStored(selected);
  },
}));
