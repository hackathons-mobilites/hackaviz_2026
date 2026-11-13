import { describe, expect, it } from 'vitest';
import { colorVision } from '../theme/tokens';
import { initialColorVision, withoutColorVisionParam } from './colorVision';

describe('réglage « couleurs adaptées au daltonisme » au chargement', () => {
  it('défaut : coupé', () => {
    expect(colorVision.defaultOn).toBe(false);
    expect(initialColorVision('', null)).toBe(false);
  });

  it('choix mémorisé', () => {
    expect(initialColorVision('', 'on')).toBe(true);
    expect(initialColorVision('', 'off')).toBe(false);
    expect(initialColorVision('', 'n’importe quoi')).toBe(colorVision.defaultOn);
  });

  it('?cv= prime sur le choix mémorisé', () => {
    expect(initialColorVision('?cv=1', 'off')).toBe(true);
    expect(initialColorVision('?cv=0', 'on')).toBe(false);
  });

  it('vidéo (?record=1) : palette normale, sauf ?cv=1 explicite', () => {
    expect(initialColorVision('?record=1', 'on')).toBe(false);
    expect(initialColorVision('?record=1&cv=1', 'off')).toBe(true);
  });

  it('?cv= retiré de l’adresse, le scénario et les autres paramètres gardés dans leur ordre', () => {
    expect(withoutColorVisionParam('?o=93048&cv=1&d=d09&b=45&m=transit')).toBe('?o=93048&d=d09&b=45&m=transit');
    expect(withoutColorVisionParam('?cv=0')).toBe('');
    expect(withoutColorVisionParam('?o=93048&sound=0')).toBe('?o=93048&sound=0');
  });
});
