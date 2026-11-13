/**
 * Effets du ciel déclenchés par une étape de visite (fonction pure, testée) :
 * - changement de journée-type sans aucun pôle qui bascule → carte « silence » ;
 * - pôle suivi (TourStep.focusPole) → étoile filante une fois le ciel posé.
 */
import type { Scenario } from '../state/scenario';
import type { TourStep } from './types';

export interface TransitionSummary {
  cause: string;
  eclipse: 1 | -1 | null;
}

export interface StepEffects {
  silence: boolean;
  shootPole: string | null;
}

export function stepEffects(
  prevDay: string | null,
  nextDay: string,
  report: TransitionSummary | null,
  focusPole: string | null | undefined,
): StepEffects {
  const dayChanged = prevDay != null && prevDay !== nextDay;
  // Le voile n'est joué que si au moins un pôle bascule : eclipse = null après un changement de journée
  // veut dire que rien n'a changé dans le ciel.
  const silence = dayChanged && !!report && report.cause === 'day' && report.eclipse === null;
  return { silence, shootPole: focusPole ?? null };
}

/**
 * L'état demandé par l'étape n'est plus celui du ciel (ex. pôle de l'étape refermé). Le budget d'une étape à glisser part du plus petit
 * cran (`budgetSweep`) : il n'est pas comparé. Ne dit rien de l'auteur du changement : le contrôleur y ajoute le compteur d'interactions.
 */
export function stepUndone(step: Pick<TourStep, 'state' | 'budgetSweep'>, scenario: Partial<Scenario>): boolean {
  return Object.entries(step.state).some(
    ([key, want]) => !(key === 'budget' && step.budgetSweep) && (scenario[key as keyof Scenario] ?? null) !== (want ?? null),
  );
}
