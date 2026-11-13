import { describe, expect, it } from 'vitest';
import type { Pole } from '../data/types';
import { skyLayout } from '../theme/tokens';
import { computeFrame, makeRadius, relaxPoles, sizeKeyValues, skyBounds, toScreen } from './layout';

describe('ciel non déformé et cadré sur les données', () => {
  it('même échelle en x et en y, carré unité centré par défaut', () => {
    const f = computeFrame(1920, 1080, 120);
    const a = toScreen(f, { x: 0, y: 0 });
    const b = toScreen(f, { x: 1, y: 0 });
    const c = toScreen(f, { x: 0, y: 1 });
    expect(b.x - a.x).toBeCloseTo(c.y - a.y);
    const mid = toScreen(f, { x: 0.5, y: 0.5 });
    expect(mid.x).toBeCloseTo(f.x + f.w / 2);
    expect(mid.y).toBeCloseTo(f.y + f.h / 2);
  });
  it('emprise : uniforme, centrée, et plus grande que le carré unité', () => {
    const bounds = skyBounds([{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }], 0);
    expect(bounds).toEqual({ x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.8 });
    const f = computeFrame(1920, 1080, 120, bounds);
    const a = toScreen(f, { x: 0.2, y: 0.3 });
    const b = toScreen(f, { x: 0.7, y: 0.3 });
    const c = toScreen(f, { x: 0.2, y: 0.8 });
    expect(b.x - a.x).toBeCloseTo(c.y - a.y);
    const mid = toScreen(f, { x: 0.45, y: 0.55 });
    expect(mid.x).toBeCloseTo(f.x + f.w / 2);
    expect(mid.y).toBeCloseTo(f.y + f.h / 2);
    expect(c.y - a.y).toBeCloseTo(f.h);
  });
});

describe('aire ∝ postes, plancher garanti sans fausser les proportions', () => {
  const pole = (jobs: number | null) => ({ jobs }) as Pole;
  const poles = [pole(835130), pole(364343), pole(42707), pole(null)];
  it.each([
    [390, 844, 144],
    [390, 400, -24],
    [1920, 1080, 110],
  ])('écran %i×%i : ratio des aires = ratio des postes, plus petit ≥ plancher', (w, h, bar) => {
    const r = makeRadius(poles, computeFrame(w, h, bar));
    const a = (j: number) => r(j) ** 2;
    expect(a(835130) / a(42707)).toBeCloseTo(835130 / 42707, 6);
    expect(a(364343) / a(42707)).toBeCloseTo(364343 / 42707, 6);
    expect(r(42707)).toBeGreaterThanOrEqual(skyLayout.minPoleRadius - 1e-9);
  });
});


describe('relaxation fixe des pôles de Paris (L-23)', () => {
  const g = (id: string, x: number, y: number, r: number, index: number) => ({ index, id, x, y, r });
  const contour = (r: number) => r + 5;
  // Positions de Paris à 1280 x 720 (cadre du ciel du 03/11) : contours qui se chevauchent
  const base = [g('P_PARIS_QCA', 600, 269, 23.3, 0), g('P_PARIS_RG', 597, 322, 19.5, 1), g('P_PARIS_EST', 629, 297, 19.7, 2), g('P_DEFENSE', 549, 261, 15.4, 3)];
  const ids = ['P_PARIS_QCA', 'P_PARIS_RG', 'P_PARIS_EST'];
  it('écart minimal entre contours, rayons inchangés, autres pôles immobiles', () => {
    const out = relaxPoles(base, ids, contour, 4, 60);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const a = out[i]!;
        const b = out[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(contour(a.r) + contour(b.r) + 4 - 0.5);
      }
    expect(out.map((p) => p.r)).toEqual(base.map((p) => p.r));
    expect(out[3]).toEqual(base[3]);
    // et des contours voisins (La Défense, fixe)
    for (let i = 0; i < 3; i++) {
      const a = out[i]!;
      const o = out[3]!;
      expect(Math.hypot(a.x - o.x, a.y - o.y)).toBeGreaterThanOrEqual(contour(a.r) + contour(o.r) + 4 - 0.5);
    }
  });
  it('déterministe : mêmes entrées, mêmes positions (ciel stable entre scénarios)', () => {
    expect(relaxPoles(base, ids, contour, 4, 60)).toEqual(relaxPoles(base, ids, contour, 4, 60));
  });
  it('déplacement de quelques pixels seulement', () => {
    const out = relaxPoles(base, ids, contour, 4, 60);
    for (let i = 0; i < 3; i++) expect(Math.hypot(out[i]!.x - base[i]!.x, out[i]!.y - base[i]!.y)).toBeLessThan(16);
  });
});

describe('clé de taille de la légende (L-17)', () => {
  it('deux valeurs rondes qui encadrent les postes des pôles', () => {
    // postes de poles.json au 03/11 : 42 707 à 835 130
    expect(sizeKeyValues([42707, 92450, 364343, 835130])).toEqual([50000, 500000]);
    expect(sizeKeyValues([1200, 18000])).toEqual([2000, 10000]);
  });
  it('valeur exacte gardée, postes inconnus ignorés', () => {
    expect(sizeKeyValues([100000, null, 1000000, 0])).toEqual([100000, 1000000]);
  });
  it('une seule valeur si elles se confondent, aucune sans postes', () => {
    expect(sizeKeyValues([60000, 90000])).toEqual([50000]);
    expect(sizeKeyValues([null, undefined])).toEqual([]);
  });
});
