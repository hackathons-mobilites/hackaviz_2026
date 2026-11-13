import type { PoleGeometry } from './layout';
import type { PartRing } from '../data/od/sky';
import { gainMark, pixiColor, poleLook, skyLayout } from '../theme/tokens';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface PoleOutline {
  group: SVGGElement;
  on: SVGCircleElement;
  off: SVGCircleElement;
  outTop: SVGPathElement;
  outBottom: SVGPathElement;
  unknown: SVGCircleElement;
  parts: [SVGCircleElement, SVGCircleElement];
  remainders: [PartRemainder, PartRemainder];
  radius: number;
  focus: SVGCircleElement;
  gain: SVGCircleElement;
}

interface PartRemainder {
  group: SVGGElement;
  unknown: SVGPathElement;
  rest: SVGPathElement;
  part: PartRing | null;
}

interface PoleOutlineState {
  onColor: number;
  onAlpha: number;
  offAlpha: number;
  outOnlyAlpha: number;
  unknownAlpha: number;
  focusAlpha: number;
  gainColor: number;
  gainAlpha: number;
}

interface GuideOutline {
  group: SVGGElement;
  outlineScale: SVGGElement;
  outline: SVGCircleElement;
  pulse: SVGCircleElement;
}

function element<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function set(element: SVGElement, name: string, value: string | number): void {
  const text = String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function dashedArc(radius: number, from: number, fraction: number, period: number, fill: number): string {
  if (fraction <= 0) return '';
  const segments = Math.max(1, Math.round(fraction * 2 * Math.PI * radius / period));
  const step = fraction * 2 * Math.PI / segments;
  const lead = step * (1 - fill) / 2;
  const paths: string[] = [];
  for (let k = 0; k < segments; k++) {
    const a = -Math.PI / 2 + from * 2 * Math.PI + k * step + lead;
    const b = a + step * fill;
    paths.push(`M ${radius * Math.cos(a)} ${radius * Math.sin(a)} A ${radius} ${radius} 0 ${b - a > Math.PI ? 1 : 0} 1 ${radius * Math.cos(b)} ${radius * Math.sin(b)}`);
  }
  return paths.join(' ');
}

export class OutlineOverlay {
  private readonly svg = element('svg');
  private readonly poles = element('g');
  private readonly guide: GuideOutline;
  private poleOutlines: PoleOutline[] = [];

  constructor(host: HTMLElement) {
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    Object.assign(this.svg.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '1',
    });
    this.svg.append(this.poles);

    const guideGroup = element('g');
    const outlineScale = element('g');
    const outline = element('circle');
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', hex(pixiColor.bg));
    outline.setAttribute('stroke-width', '2');
    outline.setAttribute('stroke-opacity', '0.9');
    outlineScale.append(outline);

    const pulse = element('circle');
    pulse.setAttribute('fill', 'none');
    pulse.setAttribute('stroke', hex(pixiColor.guide));
    pulse.setAttribute('stroke-width', '2');
    guideGroup.append(outlineScale, pulse);
    this.svg.append(guideGroup);
    this.guide = { group: guideGroup, outlineScale, outline, pulse };
    host.append(this.svg);
  }

  setSize(width: number, height: number): void {
    set(this.svg, 'viewBox', `0 0 ${width} ${height}`);
  }

  buildPoles(geometry: readonly PoleGeometry[]): void {
    this.poles.replaceChildren();
    this.poleOutlines = geometry.map(({ r }) => {
      const radius = r + poleLook.ringGap;
      const circumference = 2 * Math.PI * radius;
      const dashes = Math.max(8, Math.round(circumference / poleLook.dashPeriod));
      const dashLength = (circumference / dashes) * 0.55;
      const dashGap = (circumference / dashes) * 0.45;
      const group = element('g');
      const on = element('circle');
      const off = element('circle');
      const outTop = element('path');
      const outBottom = element('path');
      const unknown = element('circle');
      const parts: [SVGCircleElement, SVGCircleElement] = [element('circle'), element('circle')];
      const makeRemainder = (): PartRemainder => {
        const group = element('g');
        const unknown = element('path');
        const rest = element('path');
        for (const path of [unknown, rest]) {
          set(path, 'fill', 'none');
          set(path, 'stroke', hex(pixiColor.dimRing));
        }
        set(unknown, 'stroke-width', poleLook.unknownDotWidth);
        set(unknown, 'stroke-opacity', 0.9);
        set(rest, 'stroke-width', poleLook.ringOffWidth);
        set(group, 'opacity', 0);
        group.append(unknown, rest);
        return { group, unknown, rest, part: null };
      };
      const remainders: [PartRemainder, PartRemainder] = [makeRemainder(), makeRemainder()];
      const focus = element('circle');
      const gain = element('circle');

      for (const circle of [on, off, unknown, focus, gain, ...parts]) {
        circle.setAttribute('cx', '0');
        circle.setAttribute('cy', '0');
        circle.setAttribute('fill', 'none');
      }
      set(on, 'r', radius);
      set(on, 'stroke-width', poleLook.ringWidth);
      set(off, 'r', radius);
      set(off, 'stroke-width', poleLook.ringOffWidth);
      set(off, 'stroke-dasharray', `${dashLength} ${dashGap}`);

      const topArc = `M ${-radius} 0 A ${radius} ${radius} 0 0 1 ${radius} 0`;
      const bottomArc = `M ${-radius} 0 A ${radius} ${radius} 0 0 0 ${radius} 0`;
      set(outTop, 'd', topArc);
      set(outTop, 'fill', 'none');
      set(outTop, 'stroke', hex(pixiColor.dimRing));
      set(outTop, 'stroke-width', poleLook.ringOffWidth);
      set(outBottom, 'd', bottomArc);
      set(outBottom, 'fill', 'none');
      set(outBottom, 'stroke', hex(pixiColor.dimRing));
      set(outBottom, 'stroke-width', poleLook.ringOffWidth);
      set(outBottom, 'stroke-dasharray', `${dashLength} ${dashGap}`);

      const unknownCircumference = 2 * Math.PI * radius;
      const unknownSegments = Math.max(10, Math.round(unknownCircumference / poleLook.unknownDotPeriod));
      const unknownStep = unknownCircumference / unknownSegments;
      set(unknown, 'r', radius);
      set(unknown, 'stroke', hex(pixiColor.dimRing));
      set(unknown, 'stroke-width', poleLook.unknownDotWidth);
      set(unknown, 'stroke-linecap', 'round');
      set(unknown, 'stroke-dasharray', `0.01 ${unknownStep}`);

      for (const part of parts) {
        set(part, 'r', radius);
        set(part, 'stroke-width', poleLook.ringWidth);
        set(part, 'pathLength', 1);
        set(part, 'transform', 'rotate(-90)');
        set(part, 'stroke-opacity', 0);
      }

      set(focus, 'r', radius + 6);
      set(focus, 'stroke', hex(pixiColor.accent));
      set(focus, 'stroke-width', 2);

      set(gain, 'r', radius + gainMark.gap);
      set(gain, 'stroke-width', gainMark.width);
      set(gain, 'stroke-opacity', 0);

      group.append(off, outBottom, outTop, unknown, on, ...parts, ...remainders.map((r) => r.group), gain, focus);
      this.poles.append(group);
      return { group, on, off, outTop, outBottom, unknown, parts, remainders, radius, focus, gain };
    });
  }

  updatePart(index: number, slot: 0 | 1, part: PartRing | null, color: number, alpha: number): void {
    const outline = this.poleOutlines[index];
    if (!outline) return;
    const cyan = outline.parts[slot];
    const remainder = outline.remainders[slot];
    const reached = part?.reached ?? 0;
    set(cyan, 'stroke', hex(color));
    set(cyan, 'stroke-dasharray', `${reached} 1`);
    set(cyan, 'stroke-opacity', reached > 0 ? poleLook.ringOnAlpha * alpha : 0);
    set(remainder.group, 'opacity', poleLook.partRestAlpha * alpha);
    if (remainder.part !== part) {
      const start = reached + (part?.self ?? 0);
      set(remainder.unknown, 'd', dashedArc(outline.radius, start, part?.unknown ?? 0, poleLook.unknownDotPeriod, poleLook.unknownDotFill));
      set(remainder.rest, 'd', dashedArc(outline.radius, start + (part?.unknown ?? 0), part?.rest ?? 0, poleLook.dashPeriod, 0.55));
      remainder.part = part;
    }
  }

  updatePole(index: number, x: number, y: number, scale: number, visible: boolean, state: PoleOutlineState): void {
    const outline = this.poleOutlines[index];
    if (!outline) return;
    this.setPoleTransform(index, x, y, scale, visible);
    set(outline.on, 'stroke', hex(state.onColor));
    set(outline.on, 'stroke-opacity', state.onAlpha);
    set(outline.off, 'stroke', hex(pixiColor.dimRing));
    set(outline.off, 'stroke-opacity', state.offAlpha);
    set(outline.outTop, 'stroke-opacity', state.outOnlyAlpha);
    set(outline.outBottom, 'stroke-opacity', state.outOnlyAlpha);
    set(outline.unknown, 'stroke-opacity', state.unknownAlpha);
    set(outline.focus, 'stroke-opacity', state.focusAlpha);
    set(outline.gain, 'stroke', hex(state.gainColor));
    set(outline.gain, 'stroke-opacity', state.gainAlpha);
  }

  setPoleTransform(index: number, x: number, y: number, scale: number, visible: boolean): void {
    const outline = this.poleOutlines[index];
    if (!outline) return;
    set(outline.group, 'transform', `translate(${x} ${y}) scale(${scale})`);
    set(outline.group, 'visibility', visible ? 'visible' : 'hidden');
  }

  updateGuide(
    x: number,
    y: number,
    scale: number,
    visible: boolean,
    alpha: number,
    outlineScale: number,
    pulseRadius: number,
    pulseAlpha: number,
  ): void {
    set(this.guide.group, 'transform', `translate(${x} ${y}) scale(${scale})`);
    set(this.guide.group, 'visibility', visible ? 'visible' : 'hidden');
    set(this.guide.outlineScale, 'transform', `scale(${outlineScale})`);
    set(this.guide.outline, 'r', 12 * skyLayout.guideSocket);
    set(this.guide.outline, 'stroke-opacity', 0.9 * alpha);
    set(this.guide.pulse, 'r', pulseRadius);
    set(this.guide.pulse, 'stroke-opacity', pulseAlpha);
  }

  setOpacity(alpha: number): void {
    set(this.svg, 'opacity', alpha);
  }

  setVisible(visible: boolean): void {
    this.svg.style.visibility = visible ? 'visible' : 'hidden';
  }

  destroy(): void {
    this.svg.remove();
  }
}