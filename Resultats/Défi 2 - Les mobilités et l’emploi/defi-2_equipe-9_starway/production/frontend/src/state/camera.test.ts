import { describe, expect, it } from 'vitest';
import { clampCamera, decorCamera, IDENTITY, panBy, project, zoomAt } from './camera';

describe('caméra', () => {
  it('le point sous le curseur reste fixe', () => {
    const c = zoomAt(IDENTITY, 2, 300, 200, 1000, 800);
    const world = { x: 300, y: 200 };
    expect(project(c, world)).toEqual({ x: 300, y: 200 });
    expect(c.k).toBe(2);
  });
  it('bornes 1× - 6× et le ciel ne sort pas de l’écran', () => {
    expect(zoomAt(IDENTITY, 100, 0, 0, 1000, 800).k).toBe(6);
    expect(zoomAt(IDENTITY, 0.1, 0, 0, 1000, 800)).toEqual(IDENTITY);
    const c = panBy({ k: 2, x: 0, y: 0 }, 500, -5000, 1000, 800);
    expect(c).toEqual({ k: 2, x: 0, y: -800 });
    expect(clampCamera({ k: 1, x: 40, y: -40 }, 1000, 800)).toEqual(IDENTITY);
  });
  it('décor : même point focal, zoom atténué', () => {
    const c = zoomAt(IDENTITY, 4, 500, 400, 1000, 800);
    const d = decorCamera(c, 0.5);
    expect(d.k).toBeCloseTo(2);
    expect(project(d, { x: 500, y: 400 }).x).toBeCloseTo(500);
  });
});

describe('cadrage initial (mobile)', () => {
  it('cadre la boîte au centre, zoom plafonné, sans sortir du ciel', async () => {
    const { fitCamera } = await import('./camera');
    const c = fitCamera({ x0: 150, y0: 200, x1: 250, y1: 300 }, { x: 0, y: 0, w: 390, h: 500 }, { width: 390, height: 844 }, 2);
    expect(c.k).toBe(2);
    expect(c.x).toBeCloseTo(195 - 200 * 2);
  });
});
