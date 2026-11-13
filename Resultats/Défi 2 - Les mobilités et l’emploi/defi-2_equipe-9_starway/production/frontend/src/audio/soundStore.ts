import { create } from 'zustand';
import { sound } from '../theme/tokens';
import { initialSoundOn, initialVoiceOn } from './cues';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}

/** Choix mémorisé (« on » / « off ») ; null si absent ou stockage indisponible (navigation privée). */
export function readStoredSound(): string | null {
  return readStored(sound.storageKey);
}

export function writeStoredSound(on: boolean): void {
  writeStored(sound.storageKey, on);
}

interface SoundState {
  /** Son d'ambiance voulu par l'utilisateur (fond et bruitages ; il ne joue qu'après un geste) */
  on: boolean;
  /** Bouton son : mémorise le choix */
  setOn: (on: boolean) => void;
  /** Voix de la visite (narration enregistrée), indépendante du son d'ambiance */
  voice: boolean;
  /** Contrôle « Voix » de la barre de la visite : mémorise le choix */
  setVoice: (on: boolean) => void;
}

/**
 * État du son, hors du store du ciel (le son n'est pas un scénario : il n'entre ni dans l'URL ni dans
 * la visite). Initialisé depuis `?sound=`, `?voice=`, `?record=` et `localStorage` (cues.initialSoundOn,
 * cues.initialVoiceOn).
 */
export const useSoundStore = create<SoundState>()((set) => ({
  on: typeof window !== 'undefined' ? initialSoundOn(window.location.search, readStoredSound()) : false,
  setOn: (on) => {
    writeStoredSound(on);
    set({ on });
  },
  voice:
    typeof window !== 'undefined'
      ? initialVoiceOn(window.location.search, readStored(sound.voice.storageKey))
      : sound.voice.defaultOn,
  setVoice: (voice) => {
    writeStored(sound.voice.storageKey, voice);
    set({ voice });
  },
}));
