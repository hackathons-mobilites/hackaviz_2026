import { describe, expect, it } from 'vitest';
import { contrast, deltaE00, hexToRgb, over, rgbToHex, simulate } from './cvd';

describe('outils de mesure des couleurs (mode daltonien)', () => {
  it('contraste WCAG : blanc sur noir 21:1, une couleur contre elle-même 1:1', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#9CEAFF', '#9CEAFF')).toBe(1);
  });

  it('hexadécimal aller-retour et composition par opacité', () => {
    expect(rgbToHex(hexToRgb('#9CEAFF'))).toBe('#9CEAFF');
    expect(over('#FFFFFF', 0, '#080E20')).toBe('#080E20');
    expect(over('#FFFFFF', 1, '#080E20')).toBe('#FFFFFF');
  });

  it('simulation de Machado (2009) : les valeurs mesurées par la DA (motion-spec, « Constat mesuré »)', () => {
    expect(simulate('#9CEAFF', 'protan')).toBe('#DBE5FF');
    expect(simulate('#9CEAFF', 'deutan')).toBe('#CCD9FF');
    expect(simulate('#9CEAFF', 'tritan')).toBe('#74F2F0');
    expect(simulate('#F5B86D', 'deutan')).toBe('#DCC96F');
    expect(simulate('#E8923A', 'protan')).toBe('#AD9A2E');
  });

  it('les gris (R = G = B) restent gris dans les trois simulations', () => {
    for (const t of ['protan', 'deutan', 'tritan'] as const) {
      const [r, g, b] = hexToRgb(simulate('#808080', t));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
    }
  });

  it('CIEDE2000 : nulle pour une même couleur, symétrique, grande pour noir / blanc', () => {
    expect(deltaE00('#9CEAFF', '#9CEAFF')).toBeCloseTo(0, 6);
    expect(deltaE00('#9CEAFF', '#F5B86D')).toBeCloseTo(deltaE00('#F5B86D', '#9CEAFF'), 6);
    expect(deltaE00('#000000', '#FFFFFF')).toBeCloseTo(100, 0);
  });
});
