import { describe, expect, it } from 'vitest';
import { color, haloPalette } from './tokens';

/** Luminance relative WCAG d'une couleur #RRGGBB */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** Teinte HSL (degrés) */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('palette du halo (L-12)', () => {
  it('TC en lavande pâle, vélo en lavande : plus aucun bleu clair près du cyan « accessible »', () => {
    expect(haloPalette.transit).toBe('#C9B8FF');
    expect(haloPalette.bike).toBe('#9D86E8');
    const cyan = hue(color.accessible);
    for (const c of [haloPalette.transit, haloPalette.bike]) {
      const d = Math.abs(hue(c) - cyan);
      expect(Math.min(d, 360 - d)).toBeGreaterThan(45);
    }
  });
  it('l’arc du taux de pauvreté se détache de la piste qui le prolonge (≥ 3:1, WCAG 1.4.11)', () => {
    expect(contrast(haloPalette.income, haloPalette.track)).toBeGreaterThanOrEqual(3);
  });
  it('les arcs des âges (anneau plein, sans piste visible) se détachent du panneau (≥ 3:1)', () => {
    for (const c of haloPalette.age) expect(contrast(c, color.panel)).toBeGreaterThanOrEqual(3);
  });
});
