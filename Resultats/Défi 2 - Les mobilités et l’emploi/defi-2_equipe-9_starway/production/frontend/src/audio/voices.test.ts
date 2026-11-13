/**
 * Les recettes et le fond se programment sans erreur sur un faux contexte Web Audio qui applique la
 * règle des automations (une courbe ne contient aucun autre événement) et vérifie les arrêts.
 */
import { describe, expect, it } from 'vitest';
import { sound } from '../theme/tokens';
import { noise, pad, swell, tone } from './voices';
import type { VoiceContext } from './engine';

class FakeParam {
  value: number;
  events: { t: number; end?: number }[] = [];
  constructor(v = 0) {
    this.value = v;
  }
  private check(t: number, end?: number) {
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`temps invalide ${t}`);
    for (const e of this.events) {
      if (e.end != null && t > e.t && t < e.end) throw new Error(`événement à ${t} dans une courbe [${e.t}, ${e.end}]`);
      if (end != null && e.t > t && e.t < end) throw new Error(`courbe [${t}, ${end}] qui contient ${e.t}`);
    }
  }
  setValueAtTime(v: number, t: number) {
    this.check(t);
    this.events.push({ t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.setValueAtTime(v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v <= 0) throw new RangeError('rampe exponentielle vers 0');
    return this.setValueAtTime(v, t);
  }
  setValueCurveAtTime(c: Float32Array, t: number, d: number) {
    if (c.length < 2 || !(d > 0)) throw new RangeError('courbe invalide');
    this.check(t, t + d);
    this.events.push({ t, end: t + d });
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
}

class FakeNode {
  connected: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    this.connected.push(n);
    return n;
  }
  disconnect() {
    this.connected = [];
  }
}

const sources: FakeSource[] = [];

class FakeSource extends FakeNode {
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  type = 'sine';
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  constructor() {
    super();
    sources.push(this);
  }
  start(t = 0) {
    this.started = t;
  }
  stop(t = 0) {
    this.stopped = t;
  }
}

function fakeContext(): VoiceContext {
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    createGain: () => Object.assign(new FakeNode(), { gain: new FakeParam(1) }),
    createStereoPanner: () => Object.assign(new FakeNode(), { pan: new FakeParam(0) }),
    createBiquadFilter: () => Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) }),
    createOscillator: () => new FakeSource(),
    createBufferSource: () => new FakeSource(),
  };
  const dry = new FakeNode();
  return {
    ctx: ctx as unknown as AudioContext,
    dry: dry as unknown as AudioNode,
    wet: new FakeNode() as unknown as AudioNode,
    noise: { duration: 2 } as unknown as AudioBuffer,
  };
}

describe('recettes sonores', () => {
  it('cloche, pincement, glissade et carillon : sans chevauchement, chaque source s\'arrête', () => {
    const vc = fakeContext();
    sources.length = 0;
    tone(vc, 0.01, { freq: 293.66, partials: [{ type: 'sine', ratio: 1, db: 0 }, { type: 'triangle', ratio: 3, db: -24 }], level: -22, attack: 8, decay: 1400, pan: 0.3, send: 0.28 });
    tone(vc, 0.01, { freq: 440, partials: [{ type: 'sine', ratio: 1, db: 0 }], level: -30, attack: 30, decay: 600, glideTo: 293.66, glideMs: 600, glideEase: 'outExpo', lowpass: 1200 });
    tone(vc, 0.01, { freq: 293.66, partials: [{ type: 'sine', ratio: 1, db: 0 }], level: -31, attack: 20, decay: 1100, pan: { from: 0, to: 0.7, ms: 500, ease: 'outQuart' } });
    expect(sources.length).toBe(4);
    expect(sources.every((s) => s.started != null && s.stopped != null && s.stopped > s.started)).toBe(true);
  });

  it('nappes et souffles (arche, percussif, tenu puis éteint), mouvement réduit compris', () => {
    const vc = fakeContext();
    sources.length = 0;
    pad(vc, 0.01, { freqs: sound.focus.notes, level: -36, attack: 250, hold: 650, release: 600, filter: { from: 300, to: 2400, ms: 900 } });
    pad(vc, 0.01, { freqs: sound.halo.notes, level: -32, attack: 5, hold: 0, release: 145, detuneCents: 3 });
    noise(vc, 0.01, { level: -26, filter: 'bandpass', q: 1.2, fromHz: 900, toHz: 350, duration: 750, shape: 'arch', pan: { from: -0.8, to: 0.8, ms: 750 } });
    noise(vc, 0.01, { level: -36, filter: 'highpass', fromHz: 2500, duration: 90, shape: 'perc', attack: 2 });
    noise(vc, 0.01, { level: -30, filter: 'bandpass', q: 6, fromHz: 2200, toHz: 1550, duration: 375, shape: 'hold', attack: 112, fade: 400 });
    expect(sources.every((s) => s.started != null && s.stopped != null)).toBe(true);
  });

  it('montées du logo (souffle et note tenue) : sans chevauchement, chaque source s\'arrête', () => {
    const vc = fakeContext();
    sources.length = 0;
    noise(vc, 0.01, { level: -36, filter: 'bandpass', q: 3.5, fromHz: 700, toHz: 1015, duration: 640, shape: 'rise', fade: 40, pan: { from: -0.6, to: -0.2, ms: 640 } });
    swell(vc, 0.01, { fromHz: 146.83, toHz: 220, level: -38, duration: 640, release: 40, pan: { from: -0.6, to: -0.2, ms: 640 }, send: 0.2 });
    expect(sources.length).toBe(2);
    expect(sources.every((s) => s.started != null && s.stopped != null && s.stopped > s.started)).toBe(true);
  });
});
