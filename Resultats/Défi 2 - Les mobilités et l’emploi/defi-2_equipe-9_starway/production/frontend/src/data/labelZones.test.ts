import { describe, expect, it } from 'vitest';
import { labelTouches, nearestFreeLabel, placeAvoidingZones, type LabelItem } from './labelZones';
import { placeWithLeaders, type LabelBox } from './labels';

/* Noms du ciel sous les éléments d'interface (arbitrage du 05/11, mobile 390 px) : seuls les noms qui tombent sous une zone
   bougent, aucun nom n'est perdu tant qu'une place libre existe, la règle d'origine reste celle de `placeWithLeaders`. */
const pane = { x: 0, y: 0, w: 390, h: 500 };
const edges: LabelBox[] = [
  { index: -2000, x: -1000, y: -1000, w: 1000, h: 3000 },
  { index: -2001, x: 390, y: -1000, w: 1000, h: 3000 },
  { index: -2002, x: 0, y: -1000, w: 390, h: 1000 },
  { index: -2003, x: 0, y: 500, w: 390, h: 1000 },
];
const disc = (i: number, cx: number, cy: number, r: number): LabelBox => ({ index: -1 - i, x: cx - r - 5, y: cy - r - 5, w: 2 * (r + 5), h: 2 * (r + 5) });
const item = (index: number, cx: number, cy: number, r = 10, w = 70): LabelItem => ({ index, cx, cy, r, w, h: 16 });

const items = [item(0, 330, 100), item(1, 100, 100), item(2, 200, 250), item(3, 330, 400), item(4, 60, 420)];
const discs = items.map((it) => disc(it.index, it.cx, it.cy, it.r));
const reserved = [...edges, ...discs];

describe('placeAvoidingZones', () => {
  it('sans zone : exactement la règle d’origine', () => {
    expect(placeAvoidingZones(items, reserved, [])).toEqual(placeWithLeaders(items, reserved));
  });

  it('une zone que personne ne touche : exactement la règle d’origine', () => {
    const far = [{ x: 150, y: 460, w: 20, h: 20 }];
    const base = placeWithLeaders(items, reserved);
    expect(base.every((b) => !far.some((z) => labelTouches(b, z)))).toBe(true);
    expect(placeAvoidingZones(items, reserved, far)).toEqual(base);
  });

  it('seul le nom sous la zone bouge ; les autres gardent leur place ; aucun nom perdu', () => {
    const base = placeWithLeaders(items, reserved);
    const target = base.find((b) => b.index === 0)!;
    const zone = { x: target.x - 4, y: target.y - 4, w: target.w + 8, h: target.h + 8 };
    const out = placeAvoidingZones(items, reserved, [zone], { bounds: pane, step: 4 });
    expect(out.map((b) => b.index).sort()).toEqual(base.map((b) => b.index).sort()); // aucun nom perdu
    const moved = out.filter((b) => {
      const was = base.find((x) => x.index === b.index)!;
      return was.x !== b.x || was.y !== b.y;
    });
    expect(moved.map((b) => b.index)).toEqual(touching(base, zone));
    expect(out.every((b) => !labelTouches(b, zone))).toBe(true); // plus rien sous la zone
    // pas de recouvrement entre deux noms ni avec un disque
    for (const a of out) {
      for (const b of [...out.filter((o) => o !== a), ...discs]) expect(labelTouches(a, b, 0)).toBe(false);
    }
  });

  it('même ordre que les astres demandés', () => {
    const zone = { x: 0, y: 0, w: 390, h: 60 };
    const out = placeAvoidingZones(items, reserved, [zone], { bounds: pane, step: 4 });
    expect(out.map((b) => b.index)).toEqual(items.filter((it) => out.some((b) => b.index === it.index)).map((it) => it.index));
  });
});

function touching(base: { index: number; x: number; y: number; w: number; h: number }[], zone: { x: number; y: number; w: number; h: number }): number[] {
  return base.filter((b) => labelTouches(b, zone)).map((b) => b.index);
}

describe('nearestFreeLabel (dernier recours, tout le volet)', () => {
  it('trouve la place libre la plus proche et pose un trait de rappel', () => {
    const it0 = item(0, 200, 250);
    const blocked: LabelBox[] = [...edges, disc(0, 200, 250, 10), { index: -9, x: 120, y: 200, w: 160, h: 100 }];
    const got = nearestFreeLabel(it0, blocked, [], pane, 4)!;
    expect(got).toBeTruthy();
    expect(blocked.every((b) => !labelTouches(got, b))).toBe(true);
    expect(got.leader).toBeTruthy();
  });
  it('aucune place : null (jamais un nom posé sur un obstacle)', () => {
    const it0 = item(0, 200, 250);
    const all: LabelBox = { index: -9, x: -10, y: -10, w: 420, h: 520 };
    expect(nearestFreeLabel(it0, [all], [], pane, 4)).toBeNull();
  });
});
