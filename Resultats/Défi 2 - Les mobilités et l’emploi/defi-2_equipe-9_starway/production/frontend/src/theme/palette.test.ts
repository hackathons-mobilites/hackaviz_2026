import { describe, expect, it } from 'vitest';
import { contrast, deltaE00, over, worstCase } from './cvd';
import { palette } from './palette';
import { color, colorCv, haloPalette, haloPaletteCv, pixiColor } from './tokens';

const bg = color.bg;
const panel = color.panel;
/** Disque « hors de portée » tel qu'il est vu : gris-bleu à 0,7 sur le fond */
const offDisc = over(color.dim, 0.7, bg);
const lum = (a: string, b: string) => worstCase(a, b, contrast);
const dE = (a: string, b: string) => worstCase(a, b, deltaE00);

describe('palette(cv) : le mode daltonien ne change que l’or, le halo et la carte', () => {
  it('palette normale = jetons de tokens.ts', () => {
    const p = palette(false);
    expect(p.color).toBe(color);
    expect(p.pixiColor).toBe(pixiColor);
    expect(p.haloPalette).toBe(haloPalette);
  });

  it('mode daltonien : seules les clés prévues diffèrent', () => {
    const n = palette(false);
    const cv = palette(true);
    const diff = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    expect(diff(n.color, cv.color)).toEqual(['gain']);
    expect(diff(n.pixiColor, cv.pixiColor)).toEqual(['gain']);
    expect(diff(n.haloPalette, cv.haloPalette).sort()).toEqual(['bike', 'car', 'other', 'transit']);
    // le cyan, les gris, le blanc lunaire et l'étoile-guide ne bougent pas
    for (const k of ['accessible', 'dim', 'dimRing', 'neutral', 'guide', 'accent', 'bg'] as const) expect(cv.color[k]).toBe(color[k]);
  });

  it('Pixi et CSS disent la même couleur', () => {
    const cv = palette(true);
    expect(`#${cv.pixiColor.gain.toString(16).toUpperCase()}`).toBe(cv.color.gain);
  });
});

describe('contrastes du mode daltonien (minimum de la vision normale et des trois simulations)', () => {
  const amber = colorCv.gain;

  it('or ambre contre le cyan : au moins 1,5:1 de luminance (1,18:1 avec l’or normal)', () => {
    expect(lum(color.accessible, color.gain)).toBeLessThan(1.2);
    expect(lum(color.accessible, amber)).toBeGreaterThanOrEqual(1.5);
    expect(dE(color.accessible, amber)).toBeGreaterThan(dE(color.accessible, color.gain));
  });

  it('or ambre lisible en texte sur le fond et sur le panneau (≥ 4,5:1, vision normale)', () => {
    expect(contrast(amber, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(amber, panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('or ambre contre le disque hors de portée et l’étoile-guide : élément graphique distinct', () => {
    expect(lum(amber, offDisc)).toBeGreaterThanOrEqual(3);
    expect(lum(amber, color.guide)).toBeGreaterThan(lum(color.gain, color.guide));
  });

  it('seconde orbite ambre (alpha 0,75) visible sur le fond (≥ 3:1)', () => {
    expect(lum(over(amber, 0.75, bg), bg)).toBeGreaterThanOrEqual(3);
  });

  it('halo : chaque arc ≥ 3:1 sur le panneau (élément graphique, vision normale)', () => {
    for (const [k, v] of Object.entries(haloPaletteCv)) {
      expect(contrast(v, panel), k).toBeGreaterThanOrEqual(3);
    }
  });

  it('halo : deux arcs voisins (ordre TC, voiture, vélo, marche, autre) ≥ 1,4:1 dans les trois simulations', () => {
    const order = ['transit', 'car', 'bike', 'walk', 'other'] as const;
    for (let i = 0; i < order.length; i++) {
      const a = haloPaletteCv[order[i]!];
      const b = haloPaletteCv[order[(i + 1) % order.length]!];
      expect(lum(a, b), `${order[i]} / ${order[(i + 1) % order.length]}`).toBeGreaterThanOrEqual(1.4);
    }
    // voiture / vélo : le point faible de la palette normale
    expect(lum(haloPalette.car, haloPalette.bike)).toBeLessThan(1.2);
  });

  it('carte : territoire accessible contre hors de portée, remplissage et trait renforcés', () => {
    const off = over(color.dim, 0.22, bg);
    const n = palette(false).mirror;
    const cv = palette(true).mirror;
    expect(lum(over(color.accessible, n.accessibleFillOpacity, bg), off)).toBeLessThan(1.3);
    expect(lum(over(color.accessible, cv.accessibleFillOpacity, bg), off)).toBeGreaterThanOrEqual(1.9);
    expect(lum(over(color.accessible, cv.accessibleStrokeOpacity, bg), color.dimRing)).toBeGreaterThanOrEqual(2.4);
  });
});
