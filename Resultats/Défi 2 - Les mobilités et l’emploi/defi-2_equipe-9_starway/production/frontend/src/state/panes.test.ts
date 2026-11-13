import { describe, expect, it } from 'vitest';
import { cardPlacement, edgeMarker, keepMarkerInside, nudgeMarkerFrom, paneFor, sidePanelSide } from './panes';

describe('volets du diptyque', () => {
  it('côte à côte sur grand écran, même taille', () => {
    const a = paneFor('A', true, 1600, 900, 100);
    const b = paneFor('B', true, 1600, 900, 100);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    expect(b.left).toBe(800);
  });
  it('empilés sur mobile, même taille, au-dessus de la barre', () => {
    const a = paneFor('A', true, 390, 844, 144);
    const b = paneFor('B', true, 390, 844, 144);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    expect(b.top).toBe(a.height);
    expect(b.top + b.height).toBe(844 - 144);
  });
});

describe('repère de bord', () => {
  const rect = { left: 0, top: 0, width: 400, height: 300 };
  it('rien si le point est visible', () => {
    expect(edgeMarker({ x: 200, y: 150 }, rect)).toBeNull();
  });
  it('sur le bord, dans la direction réelle', () => {
    const m = edgeMarker({ x: 1000, y: 150 }, rect)!;
    expect(m.x).toBeCloseTo(376);
    expect(m.y).toBeCloseTo(150);
    expect(m.angle).toBeCloseTo(0);
  });
  it('le repère est ramené entier dans le volet (« Provins » coupé à 390 px)', () => {
    const m = edgeMarker({ x: 1000, y: 150 }, rect)!;
    // repère de 110 px de large : son centre ne peut pas être à moins de 55 + 4 px du bord
    const k = keepMarkerInside(m, { w: 110, h: 44 }, rect, 4);
    expect(k.x).toBeCloseTo(400 - 4 - 55);
    expect(k.x + 55).toBeLessThanOrEqual(400 - 4 + 1e-9);
    expect(k.y).toBeCloseTo(150);
    // en haut à gauche aussi, et un repère déjà entier ne bouge pas
    const tl = keepMarkerInside({ x: 2, y: 2 }, { w: 110, h: 44 }, rect, 4);
    expect([tl.x, tl.y]).toEqual([59, 26]);
    expect(keepMarkerInside({ x: 200, y: 150 }, { w: 110, h: 44 }, rect, 4)).toEqual({ x: 200, y: 150 });
    // plus large que le volet : centré
    expect(keepMarkerInside({ x: 10, y: 10 }, { w: 500, h: 44 }, rect, 4).x).toBe(200);
  });
  it('le repère glisse le long du bord pour ne pas recouvrir le nom de l’étoile', () => {
    const size = { w: 84, h: 44 };
    const marker = { x: 340, y: 150 };
    const label = { x: 160, y: 138, w: 190, h: 24 };
    const n = nudgeMarkerFrom(marker, size, rect, 4, label, 4);
    expect(n.x).toBe(340);
    // il ne touche plus le nom (écart de 4 px) et reste entier dans le volet
    expect(n.y - 22).toBeGreaterThanOrEqual(label.y + label.h + 4);
    expect(n.y + 22).toBeLessThanOrEqual(300 - 4);
    // rien à éviter, ou pas de recouvrement : il ne bouge pas
    expect(nudgeMarkerFrom(marker, size, rect, 4, null, 4)).toEqual(marker);
    expect(nudgeMarkerFrom(marker, size, rect, 4, { x: 10, y: 10, w: 50, h: 20 }, 4)).toEqual(marker);
    // sans place ni dessous ni dessus : il reste où il est
    expect(nudgeMarkerFrom({ x: 340, y: 150 }, { w: 84, h: 44 }, { left: 0, top: 100, width: 400, height: 60 }, 4, { x: 160, y: 120, w: 190, h: 40 }, 4)).toEqual({ x: 340, y: 150 });
  });
});

describe('cartes qui s’écartent de l’étoile-guide (L-02)', () => {
  // Maisons-Laffitte à 1280 x 720 : étoile (522, 223), nom de 130 px
  const guide = { x: 522, y: 223, labelW: 130 };
  const left = { x: 20, y: 96, w: 360, h: 140 };
  const right = { x: 900, y: 96, w: 360, h: 140 };
  it('passe à droite si elle cacherait le nom de la commune', () => {
    expect(cardPlacement(guide, left, right, false)).toBe('right');
  });
  it('repliée en puce si la droite est occupée', () => {
    expect(cardPlacement(guide, left, right, true)).toBe('chip');
  });
  it('reste à gauche si l’étoile est loin', () => {
    expect(cardPlacement({ x: 900, y: 500, labelW: 130 }, left, right, false)).toBe('left');
    expect(cardPlacement(null, left, right, false)).toBe('left');
  });
  it('halo : panneau du côté opposé à l’étoile, à gauche si la droite est prise', () => {
    expect(sidePanelSide(522, 1280, false)).toBe('right');
    expect(sidePanelSide(900, 1280, false)).toBe('left');
    expect(sidePanelSide(522, 1280, true)).toBe('left');
  });
});
