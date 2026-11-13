import { describe, expect, it } from 'vitest';
import {
  applyMapView,
  centerMapOn,
  clampMapView,
  inFrame,
  MAP_IDENTITY,
  MAP_ZOOM_MAX,
  panMap,
  zoomMapAt,
  zoomMapCenter,
} from './mapZoom';

const f = { x: 100, y: 50, w: 800, h: 600 };

describe('zoom de la carte miroir', () => {
  it('vue d’ensemble : identité, aucun déplacement possible', () => {
    expect(clampMapView(MAP_IDENTITY, f)).toEqual(MAP_IDENTITY);
    expect(panMap(MAP_IDENTITY, 40, -30, f)).toEqual(MAP_IDENTITY);
  });

  it('molette : le point sous le pointeur reste sous le pointeur', () => {
    const p = { x: 300, y: 200 };
    const v = zoomMapAt(MAP_IDENTITY, 2, p.x, p.y, f);
    expect(v.k).toBe(2);
    const back = applyMapView(v, p);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('zoom borné, même facteur sur les deux axes', () => {
    const v = zoomMapCenter(MAP_IDENTITY, 100, f);
    expect(v.k).toBe(MAP_ZOOM_MAX);
    expect(zoomMapCenter(v, 0.001, f)).toEqual(MAP_IDENTITY);
  });

  it('la carte couvre toujours le cadre : ses bords ne rentrent jamais dans le cadre', () => {
    let v = zoomMapCenter(MAP_IDENTITY, 3, f);
    v = panMap(v, 10_000, 10_000, f);
    // coin haut gauche du cadre de la carte (à k = 1) projeté : au plus au coin du cadre
    const tl = applyMapView(v, { x: f.x, y: f.y });
    expect(tl.x).toBeCloseTo(f.x);
    expect(tl.y).toBeCloseTo(f.y);
    v = panMap(v, -20_000, -20_000, f);
    const br = applyMapView(v, { x: f.x + f.w, y: f.y + f.h });
    expect(br.x).toBeCloseTo(f.x + f.w);
    expect(br.y).toBeCloseTo(f.y + f.h);
  });

  it('centrer sur un point garde le zoom et amène le point au centre', () => {
    const v = centerMapOn({ k: 4, x: 0, y: 0 }, { x: 500, y: 350 }, f);
    expect(v.k).toBe(4);
    const c = applyMapView(v, { x: 500, y: 350 });
    expect(c.x).toBeCloseTo(f.x + f.w / 2);
    expect(c.y).toBeCloseTo(f.y + f.h / 2);
  });

  it('point dans le cadre, avec marge', () => {
    expect(inFrame({ x: 100, y: 50 }, f)).toBe(true);
    expect(inFrame({ x: 95, y: 50 }, f)).toBe(false);
    expect(inFrame({ x: 95, y: 50 }, f, 6)).toBe(true);
  });
});
