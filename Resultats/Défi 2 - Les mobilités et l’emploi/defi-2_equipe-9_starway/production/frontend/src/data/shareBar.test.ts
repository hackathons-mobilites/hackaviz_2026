import { describe, expect, it } from 'vitest';
import { shareFraction } from './shareBar';

describe('shareFraction (barre fine d’une part)', () => {
  it('pourcentage publié (0 à 100) en part de 0 à 1', () => {
    expect(shareFraction(98.8)).toBeCloseTo(0.988, 6);
    expect(shareFraction(0)).toBe(0);
    expect(shareFraction(100)).toBe(1);
  });

  it('borne sans jamais inventer : au-delà de 100 ou sous 0, bornée', () => {
    expect(shareFraction(104)).toBe(1);
    expect(shareFraction(-3)).toBe(0);
  });

  it('une valeur absente ou non finie ne dessine aucune barre', () => {
    expect(shareFraction(null)).toBeNull();
    expect(shareFraction(undefined)).toBeNull();
    expect(shareFraction(Number.NaN)).toBeNull();
  });
});
