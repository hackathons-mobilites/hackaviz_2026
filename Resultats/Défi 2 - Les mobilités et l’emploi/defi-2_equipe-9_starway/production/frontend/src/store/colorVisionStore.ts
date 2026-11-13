import { create } from 'zustand';
import { initialColorVision, withoutColorVisionParam } from '../state/colorVision';
import { palette, type Palette } from '../theme/palette';
import { colorVision } from '../theme/tokens';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(colorVision.storageKey);
  } catch {
    return null;
  }
}

function writeStored(on: boolean): void {
  try {
    window.localStorage.setItem(colorVision.storageKey, on ? 'on' : 'off');
  } catch {
    /* stockage indisponible (navigation privée) : le choix vaut pour la session */
  }
}

/** Attribut lu par le CSS (`[data-cv='1']` : `--gain`, territoires de la carte). */
function applyToDocument(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.dataset.cv = '1';
  else delete document.documentElement.dataset.cv;
}

interface ColorVisionState {
  /** Couleurs adaptées au daltonisme */
  on: boolean;
  /** Bouton de l'en-tête : mémorise le choix */
  setOn: (on: boolean) => void;
}

function initial(): boolean {
  if (typeof window === 'undefined') return colorVision.defaultOn;
  const on = initialColorVision(window.location.search, readStored());
  // `?cv=` lu : retiré de la barre d'adresse (les liens copiés n'imposent pas ma palette)
  const search = withoutColorVisionParam(window.location.search);
  if (search !== window.location.search) {
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    } catch {
      /* historique indisponible : sans conséquence */
    }
  }
  applyToDocument(on);
  return on;
}

/**
 * Réglage d'affichage, hors du store du ciel (ce n'est pas un scénario : ni URL écrite, ni visite).
 * Le changement est immédiat, sans transition : rien ne s'allume ni ne s'éteint.
 */
export const useColorVisionStore = create<ColorVisionState>()((set) => ({
  on: initial(),
  setOn: (on) => {
    writeStored(on);
    applyToDocument(on);
    set({ on });
  },
}));

/** Palette affichée (DOM : SVG de la légende, du panneau de preuve, du halo). */
export function usePalette(): Palette {
  return palette(useColorVisionStore((s) => s.on));
}
