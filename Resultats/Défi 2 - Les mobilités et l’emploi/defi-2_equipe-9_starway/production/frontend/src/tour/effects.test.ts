import { describe, expect, it } from 'vitest';
import { stepEffects, stepUndone } from './effects';

describe('stepUndone : état de l’étape défait', () => {
  it('pôle de l’étape refermé : défait', () => {
    expect(stepUndone({ state: { pole: 'P1' } }, { pole: null })).toBe(true);
  });
  it('pôle de l’étape toujours ouvert : intact', () => {
    expect(stepUndone({ state: { pole: 'P1' } }, { pole: 'P1', budget: 45 })).toBe(false);
  });
  it('étape sans état (carte) : intacte', () => {
    expect(stepUndone({ state: {} }, { pole: null })).toBe(false);
  });
  it('null et absent se valent', () => {
    expect(stepUndone({ state: { compare: null } }, {})).toBe(false);
  });
  it('budget d’une étape à glisser : jamais comparé (il part du plus petit cran)', () => {
    expect(stepUndone({ state: { budget: 60 }, budgetSweep: { from: 'min' } }, { budget: 30 })).toBe(false);
    expect(stepUndone({ state: { budget: 60 } }, { budget: 30 })).toBe(true);
  });
});

describe('effets d’étape de la visite', () => {
  it('changement de journée sans bascule : silence', () => {
    expect(stepEffects('d09', 'd06', { cause: 'day', eclipse: null }, null)).toEqual({ silence: true, shootPole: null });
  });
  it('changement de journée avec voile : pas de silence', () => {
    expect(stepEffects('d09', 'd06', { cause: 'day', eclipse: -1 }, null).silence).toBe(false);
  });
  it('même journée : jamais de silence, même sans voile', () => {
    expect(stepEffects('d09', 'd09', { cause: 'filter', eclipse: null }, 'P_CRETEIL')).toEqual({ silence: false, shootPole: 'P_CRETEIL' });
  });
  it('pas de bilan (moteur absent) : pas de silence inventé', () => {
    expect(stepEffects('d09', 'd14', null, null).silence).toBe(false);
  });
});
