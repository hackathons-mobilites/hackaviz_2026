import { describe, expect, it } from 'vitest';
import { nearestInDirection } from './keyNav';

describe('navigation clavier entre astres', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 10 },
    { x: 40, y: 0 },
    { x: 0, y: 80 },
  ];
  it('astre le plus proche dans la direction', () => {
    expect(nearestInDirection(pts, 0, 'ArrowRight')).toBe(2);
    expect(nearestInDirection(pts, 0, 'ArrowDown')).toBe(3);
    expect(nearestInDirection(pts, 0, 'ArrowLeft')).toBeNull();
  });
});
