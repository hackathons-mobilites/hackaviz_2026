import { describe, expect, it } from 'vitest';
import { placeMapLabels, segmentHitsBox, segmentsCross, type MapDisc } from './mapLabels';

const bounds = { x0: 0, y0: 0, x1: 1600, y1: 900 };

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('étiquettes de la carte miroir', () => {
  it('géométrie : croisement de segments et segment dans une boîte', () => {
    expect(segmentsCross({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 10, x2: 10, y2: 0 })).toBe(true);
    expect(segmentsCross({ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 0, y1: 5, x2: 10, y2: 5 })).toBe(false);
    expect(segmentHitsBox({ x1: -5, y1: 5, x2: 15, y2: 5 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(segmentHitsBox({ x1: -5, y1: 20, x2: 15, y2: 20 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('pôle isolé : étiquette proche, sans trait', () => {
    const discs: MapDisc[] = [{ x: 400, y: 400, r: 6 }];
    const [l] = placeMapLabels([{ index: 0, cx: 400, cy: 400, r: 6, w: 80, h: 16 }], discs, { bounds });
    expect(l).toBeDefined();
    expect(l!.leader).toBeUndefined();
  });

  it('amas serré (cœur parisien) : aucune étiquette ne chevauche une autre, un disque ou un trait', () => {
    // quatre gros disques à moins de 40 px les uns des autres, et deux voisins
    const discs: MapDisc[] = [
      { x: 740, y: 290, r: 14 },
      { x: 716, y: 270, r: 11 },
      { x: 748, y: 262, r: 9 },
      { x: 730, y: 300, r: 12 },
      { x: 812, y: 296, r: 4 },
      { x: 760, y: 220, r: 5 },
    ];
    const items = discs.map((d, i) => ({ index: i, cx: d.x, cy: d.y, r: d.r, w: 110, h: 16 }));
    const labels = placeMapLabels(items, discs, { bounds });
    expect(labels).toHaveLength(discs.length);
    for (const a of labels) {
      for (const b of labels) if (a !== b) expect(overlap(a, b)).toBe(false);
      discs.forEach((d, i) => {
        if (i === a.index) return;
        const nx = Math.max(a.x, Math.min(d.x, a.x + a.w));
        const ny = Math.max(a.y, Math.min(d.y, a.y + a.h));
        expect(Math.hypot(d.x - nx, d.y - ny)).toBeGreaterThanOrEqual(d.r);
      });
      if (a.leader) for (const b of labels) if (b !== a) expect(segmentHitsBox(a.leader, b)).toBe(false);
    }
    const leaders = labels.flatMap((l) => (l.leader ? [l.leader] : []));
    for (const a of leaders) for (const b of leaders) if (a !== b) expect(segmentsCross(a, b)).toBe(false);
  });

  it('reste dans le cadre et respecte les zones réservées', () => {
    const discs: MapDisc[] = [{ x: 8, y: 450, r: 6 }];
    const reserved = [{ index: -1, x: 0, y: 460, w: 200, h: 40 }];
    const [l] = placeMapLabels([{ index: 0, cx: 8, cy: 450, r: 6, w: 90, h: 16 }], discs, { bounds, reserved });
    expect(l!.x).toBeGreaterThanOrEqual(0);
    expect(overlap(l!, reserved[0]!)).toBe(false);
  });
});
