import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import { motion, pixiColor, poleLook } from '../theme/tokens';
import { OutlineOverlay } from './OutlineOverlay';
import { Poles } from './layers/Poles';

class SvgStub {
  readonly attributes = new Map<string, string>();
  readonly style = {};
  children: SvgStub[] = [];

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  append(...children: SvgStub[]): void {
    this.children.push(...children);
  }

  replaceChildren(): void {
    this.children = [];
  }

  remove(): void {}
}

describe('SVG pole outlines', () => {
  let svg: SvgStub;
  let overlay: OutlineOverlay;
  let poles: Poles;

  beforeEach(() => {
    const host = new SvgStub();
    vi.stubGlobal('document', {
      createElement: () => host,
      createElementNS: () => new SvgStub(),
    });
    overlay = new OutlineOverlay(document.createElement('div'));
    svg = host.children[0]!;
    poles = new Poles(Texture.EMPTY, Texture.EMPTY, Texture.EMPTY, overlay);
    poles.build([{ index: 0, id: 'test', x: 100, y: 120, r: 20 }]);
    Object.assign(poles.animTargets()[0]!, { light: 1, known: 1, appear: 1, neutral: 0 });
  });

  afterEach(() => {
    poles.view.destroy({ children: true });
    overlay.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const ring = (root: SvgStub) => root.children[0]!.children[0]!;

  it.each([0, 0.25, 0.75, 1])('draws the exact reached fraction %s from noon', (reached) => {
    Object.assign(poles.animTargets()[0]!, {
      od: 1, part: { reached, self: 0, unknown: 0, rest: 1 - reached },
    });
    poles.render();
    const group = ring(svg);
    const on = group.children[4]!;
    const part = group.children[6]!;
    expect(on.getAttribute('stroke-opacity')).toBe('0');
    expect(part.getAttribute('pathLength')).toBe('1');
    expect(part.getAttribute('transform')).toBe('rotate(-90)');
    expect(part.getAttribute('stroke-dasharray')).toBe(`${reached} 1`);
    expect(Number(part.getAttribute('stroke-opacity'))).toBe(reached > 0 ? poleLook.ringOnAlpha : 0);
    expect(part.getAttribute('stroke')).toBe(`#${pixiColor.accessible.toString(16)}`);
    const slot = poles.view.children[0]!.children[3]!;
    expect(slot.children[2]!.alpha).toBe(0);
    expect(slot.children[1]!.alpha).toBe(0);
    const remainder = group.children[8]!;
    expect(Number(remainder.getAttribute('opacity'))).toBe(poleLook.partRestAlpha);
    expect(remainder.children[1]!.getAttribute('d')?.includes(' A ')).toBe(reached < 1);
  });

  it('crossfades old and new fractions without changing either arc length', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const state = poles.animTargets()[0]!;
    Object.assign(state, { od: 1, part: { reached: 0.25, self: 0, unknown: 0, rest: 0.75 } });
    poles.render();
    state.part = { reached: 0.75, self: 0, unknown: 0, rest: 0.25 };
    poles.render();
    const [next, previous] = ring(svg).children.slice(5, 7);
    expect(next!.getAttribute('stroke-dasharray')).toBe('0.75 1');
    expect(next!.getAttribute('stroke-opacity')).toBe('0');
    expect(previous!.getAttribute('stroke-dasharray')).toBe('0.25 1');
    expect(Number(previous!.getAttribute('stroke-opacity'))).toBe(poleLook.ringOnAlpha);
    clock.mockReturnValue(1000 + motion.partFade / 2);
    poles.render();
    expect(Number(next!.getAttribute('stroke-opacity'))).toBe(poleLook.ringOnAlpha / 2);
    expect(Number(previous!.getAttribute('stroke-opacity'))).toBe(poleLook.ringOnAlpha / 2);
    for (const remainder of ring(svg).children.slice(7, 9)) {
      expect(Number(remainder.getAttribute('opacity'))).toBe(poleLook.partRestAlpha / 2);
    }
  });

  it('restores all Pixi partial arcs for snapshots, then hides them again', () => {
    Object.assign(poles.animTargets()[0]!, { od: 1, part: { reached: 0.25, self: 0, unknown: 0.25, rest: 0.5 } });
    poles.render();
    const slot = poles.view.children[0]!.children[3]!;
    poles.setSvgOutlines(false);
    expect(slot.children[2]!.alpha).toBe(poleLook.ringOnAlpha);
    expect(slot.children[1]!.alpha).toBe(poleLook.partRestAlpha);
    poles.setSvgOutlines(true);
    expect(slot.children[2]!.alpha).toBe(0);
    expect(slot.children[1]!.alpha).toBe(0);
  });

  it('preserves the self gap, unknown dots and rest dash spacing', () => {
    const part = { reached: 0.25, self: 0.25, unknown: 0.25, rest: 0.25 };
    Object.assign(poles.animTargets()[0]!, { od: 1, part });
    poles.render();
    const remainder = ring(svg).children[8]!;
    const radius = 20 + poleLook.ringGap;
    for (const [path, from, period, fill] of [
      [remainder.children[0]!, 0.5, poleLook.unknownDotPeriod, poleLook.unknownDotFill],
      [remainder.children[1]!, 0.75, poleLook.dashPeriod, 0.55],
    ] as const) {
      const d = path.getAttribute('d')!;
      const count = Math.max(1, Math.round(0.25 * 2 * Math.PI * radius / period));
      expect(d.match(/ A /g)).toHaveLength(count);
      const start = -Math.PI / 2 + from * 2 * Math.PI + (0.25 * 2 * Math.PI / count) * (1 - fill) / 2;
      const coordinates = d.split(' ');
      expect(Number(coordinates[1])).toBeCloseTo(radius * Math.cos(start));
      expect(Number(coordinates[2])).toBeCloseTo(radius * Math.sin(start));
    }
    expect(remainder.children[0]!.getAttribute('stroke-opacity')).toBe('0.9');
  });

  it('keeps whole rings and transforms in sync with the camera', () => {
    poles.setCamera({ k: 2, x: 10, y: 15 }, 1.5);
    poles.render();
    const group = ring(svg);
    expect(group.getAttribute('transform')).toBe('translate(210 255) scale(1.5)');
    expect(Number(group.children[4]!.getAttribute('stroke-opacity'))).toBe(poleLook.ringOnAlpha);
    expect(group.children[5]!.getAttribute('stroke-opacity')).toBe('0');
    expect(group.children[6]!.getAttribute('stroke-opacity')).toBe('0');
  });

  it('does not place an opaque guide socket over the canvas flare', () => {
    expect(svg.children[1]!.children[0]!.children[0]!.getAttribute('fill')).toBe('none');
  });
});
