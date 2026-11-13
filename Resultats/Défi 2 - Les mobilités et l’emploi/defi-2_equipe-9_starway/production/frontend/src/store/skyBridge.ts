/**
 * Pont minimal entre le store et le moteur du ciel (sans importer PixiJS) :
 * SkyEngine enregistre ici une fonction qui résout à la fin de la transition en cours.
 * La visite guidée s'y synchronise.
 */
type Waiter = () => Promise<void>;
let waiter: Waiter | null = null;

let markReady: (() => void) | null = null;
const skyReady = new Promise<void>((resolve) => (markReady = resolve));

export function registerSkyWaiter(fn: Waiter | null): void {
  waiter = fn;
  if (fn) markReady?.();
}

/** Résout quand le moteur du ciel est prêt pour la première fois (mode enregistrement). */
export function whenSkyReady(): Promise<void> {
  return skyReady;
}

export function waitForSky(): Promise<void> {
  return waiter ? waiter() : Promise.resolve();
}

/** Surlignage d'un astre depuis la couche DOM (focus clavier, survol). */
// Plusieurs moteurs en diptyque : survoler un pôle dans A surligne son homologue dans B.
type Highlighter = (index: number | null) => void;
const highlighters = new Set<Highlighter>();

/** Enregistre un moteur ; renvoie la fonction de désinscription. */
export function registerSkyHighlighter(fn: Highlighter): () => void {
  highlighters.add(fn);
  return () => highlighters.delete(fn);
}

export function highlightPole(index: number | null): void {
  highlighters.forEach((fn) => fn(index));
}

/** Mesure de performance (affichée avec ?fps=1). */
let fpsReader: (() => number) | null = null;
export function registerFpsReader(fn: (() => number) | null): void {
  fpsReader = fn;
}
export function readFps(): number | null {
  return fpsReader ? fpsReader() : null;
}

/** Effets du ciel pilotables par la visite (moteur A) : bilan de transition, étoile filante. */
export interface SkyEffects {
  lastTransition: () => { cause: string; changed: number; lost: string[]; eclipse: 1 | -1 | null } | null;
  playShootingStar: (poleId: string) => Promise<void>;
}
let effects: SkyEffects | null = null;

export function registerSkyEffects(fx: SkyEffects | null): void {
  effects = fx;
}

export function skyEffects(): SkyEffects | null {
  return effects;
}

/**
 * Événements du ciel A (D-026, design sonore) : ce que le moteur vient RÉELLEMENT de jouer, pour que le
 * son l'accompagne sans rien décider. x = position à l'écran en fraction de la largeur (0 à 1),
 * delay = départ de l'effet visuel (ms depuis l'événement). Aucune logique métier ici.
 */
export type SkyEvent =
  | {
      type: 'transition';
      cause: 'init' | 'origin' | 'filter' | 'day' | 'scrub';
      reduced: boolean;
      /** Pôles qui s'allument (accessibles), dans l'ordre d'allumage */
      lit: { x: number; delay: number }[];
      /** Nombre de pôles perdus (silence) et départ de la première bascule (ms) */
      lost: number;
      lostDelay: number;
      /** Voile d'éclipse joué : 1 = de gauche à droite, -1 = de droite à gauche */
      eclipse: 1 | -1 | null;
      /** Changement de journée-type avec au moins un pôle qui bascule (voile joué ou fondu réduit) */
      dayFlip: boolean;
      /** Le silence visuel (ambiance figée) est joué */
      silence: boolean;
    }
  | { type: 'guide'; x: number; reduced: boolean }
  | {
      type: 'shooting';
      reduced: boolean;
      fromX: number;
      toX: number;
      /** Arcs de la filante (shootingLegs) : sens, fraction parcourue, réussite */
      legs: { dir: 'out' | 'back'; end: number; ok: boolean }[];
    }
  | { type: 'gain'; reduced: boolean; gold: { x: number; delay: number }[] };

const skyListeners = new Set<(e: SkyEvent) => void>();

/** Abonnement aux événements du ciel ; renvoie la fonction de désinscription. */
export function onSkyEvent(fn: (e: SkyEvent) => void): () => void {
  skyListeners.add(fn);
  return () => skyListeners.delete(fn);
}

export function emitSkyEvent(e: SkyEvent): void {
  skyListeners.forEach((fn) => fn(e));
}
