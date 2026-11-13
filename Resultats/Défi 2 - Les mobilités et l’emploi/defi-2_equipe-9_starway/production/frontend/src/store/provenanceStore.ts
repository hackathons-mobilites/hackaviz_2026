import { create } from 'zustand';
import { initialProvenance } from '../data/provenance';
import { provenance } from '../theme/tokens';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(provenance.storageKey);
  } catch {
    return null;
  }
}

function writeStored(on: boolean): void {
  try {
    window.localStorage.setItem(provenance.storageKey, on ? 'on' : 'off');
  } catch {
    /* stockage indisponible (navigation privée) : le choix vaut pour la session */
  }
}

/** Attribut lu par le CSS et le test de fumée (`<html data-provenance="on">`). */
function reflect(on: boolean): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.provenance = on ? 'on' : 'off';
}

interface ProvenanceState {
  /** Provenance des données affichée sous chaque chiffre */
  on: boolean;
  /** Bouton de la barre du haut : mémorise le choix */
  setOn: (on: boolean) => void;
}

const initial = typeof window !== 'undefined' ? initialProvenance(window.location.search, readStored(), provenance.defaultOn) : provenance.defaultOn;
reflect(initial);

// `?src=` vaut pour la session : retiré de l'adresse une fois lu, pour que « Copier le lien » partage
// le scénario sans la préférence d'affichage (motion-spec, « Affichage »)
if (typeof window !== 'undefined') {
  const q = new URLSearchParams(window.location.search);
  if (q.has('src')) {
    q.delete('src');
    const next = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`);
  }
}

/**
 * Réglage d'affichage « provenance des données », hors du store du ciel comme le son : ce n'est pas un
 * scénario (ni dans l'URL écrite, ni dans la visite, ni dans les liens copiés). Il ne change aucune
 * donnée, aucun état d'astre, aucune position ni taille.
 */
export const useProvenanceStore = create<ProvenanceState>()((set) => ({
  on: initial,
  setOn: (on) => {
    writeStored(on);
    reflect(on);
    set({ on });
  },
}));
