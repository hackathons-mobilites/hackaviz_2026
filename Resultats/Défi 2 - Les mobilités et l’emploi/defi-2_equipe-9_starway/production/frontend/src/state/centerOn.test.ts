import { describe, expect, it } from 'vitest';
import { shouldCloseSheet } from '../components/useBottomSheet';
import { project } from './camera';
import { cameraCenteredOn } from './centerOn';

describe('centrer sur un pôle', () => {
  it('le pôle arrive au centre de la zone visible, au zoom demandé', () => {
    const area = { x: 0, y: 72, w: 1100, h: 700 };
    const c = cameraCenteredOn({ x: 300, y: 200 }, 2, area);
    expect(c.k).toBe(2);
    expect(project(c, { x: 300, y: 200 })).toEqual({ x: 550, y: 422 });
  });
});

describe('feuille du bas', () => {
  it('se ferme au-delà de 90 px ou sur un geste rapide vers le bas', () => {
    expect(shouldCloseSheet(120, 0)).toBe(true);
    expect(shouldCloseSheet(30, 900)).toBe(true);
    expect(shouldCloseSheet(30, 100)).toBe(false);
    expect(shouldCloseSheet(-40, 900)).toBe(false);
  });
});
