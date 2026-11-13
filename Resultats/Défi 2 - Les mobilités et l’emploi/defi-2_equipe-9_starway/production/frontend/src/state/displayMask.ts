/**
 * Acte 0 : étapes de la révélation du ciel et masque d'affichage (motion-spec, D-021).
 * Module PUR (sans React ni store) : le ciel, la couche DOM, le résumé lu par les lecteurs d'écran,
 * la légende et le compteur lisent tous la même vue affichée, passée par ce masque.
 *
 * Règle de vérité : aucun état d'accessibilité (ni cyan, ni tirets, ni chiffre, ni annonce) avant le
 * temps D (`light`) ET le chargement des temps de trajet de la commune.
 */
import type { AccessFile, Dataset } from '../data/types';
import type { Scenario } from './scenario';
import { buildSkyView, type OdViewInput, type SkyView } from './skyView';

/** title : écran titre ; pose : les astres se posent ; origin : votre commune ; light : allumage ; done : fini */
export type IntroStep = 'title' | 'pose' | 'origin' | 'light' | 'done';

export const INTRO_STEPS: readonly IntroStep[] = ['title', 'pose', 'origin', 'light', 'done'];

/** true si la révélation a atteint (ou dépassé) l'étape `step`. */
export function introAtLeast(intro: IntroStep, step: IntroStep): boolean {
  return INTRO_STEPS.indexOf(intro) >= INTRO_STEPS.indexOf(step);
}

export interface DisplayMask {
  /** Astres montés et posés (perles), couche DOM des pôles */
  poles: boolean;
  /** Étoile-guide, nom de la commune, barre de scénario, barre du haut */
  origin: boolean;
  /** Étape d'allumage atteinte (les états réels attendent aussi les données : `lightsShown`) */
  light: boolean;
  /** Révélation finie : pôle sélectionné, halo, or, panneaux */
  done: boolean;
}

/** Masque d'affichage d'une étape de la révélation (table de la motion-spec, Acte 0). */
export function selectDisplayMask(intro: IntroStep): DisplayMask {
  return {
    poles: introAtLeast(intro, 'pose'),
    origin: introAtLeast(intro, 'origin'),
    light: introAtLeast(intro, 'light'),
    done: intro === 'done',
  };
}

/**
 * Les états réels d'accessibilité peuvent-ils être montrés ? Après la révélation : toujours (le
 * scénario affiché n'est remplacé qu'une fois ses fichiers chargés). Pendant l'étape `light` :
 * seulement quand plus aucun fichier n'est en chargement et que celui de la commune est arrivé.
 */
export function lightsShown(
  intro: IntroStep,
  origin: string | null,
  access: Readonly<Record<string, AccessFile | null>>,
  loadingOrigin: string | null,
): boolean {
  if (intro === 'done') return true;
  if (intro !== 'light') return false;
  return loadingOrigin === null && (origin === null || origin in access);
}

/**
 * Scénario affiché : sans commune avant le temps C (pas d'étoile-guide), sans pôle sélectionné ni
 * halo avant la fin de la révélation (filante, panneau de preuve et halo attendent `done`).
 */
export function displayedScenario(scenario: Scenario, intro: IntroStep): Scenario {
  if (intro === 'done') return scenario;
  const mask = selectDisplayMask(intro);
  return { ...scenario, origin: mask.origin ? scenario.origin : null, pole: null, halo: null };
}

/**
 * Vue affichée = vue réelle passée par le masque. `origin` remplace la commune du scénario (ciel B
 * du diptyque : commune de comparaison). Avant les données, le ciel est neutre (perles).
 */
export function buildDisplayedView(
  dataset: Dataset,
  scenario: Scenario,
  access: Readonly<Record<string, AccessFile | null>>,
  revealed: boolean,
  intro: IntroStep,
  loadingOrigin: string | null,
  od: OdViewInput | null = null,
): SkyView {
  const shown = displayedScenario(scenario, intro);
  const lights = lightsShown(intro, scenario.origin, access, loadingOrigin);
  const view = buildSkyView(dataset, shown, access, revealed && lights, od);
  // Avant l'allumage, aucun résultat n'est lu, pas même l'absence de fichier
  return lights ? view : { ...view, accessMissing: false };
}
