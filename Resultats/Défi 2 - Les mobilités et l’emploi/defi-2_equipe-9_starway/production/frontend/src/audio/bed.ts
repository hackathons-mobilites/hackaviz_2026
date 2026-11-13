/**
 * Fond « nébuleuse » : deux paires de sinus graves désaccordées (D2, A2) et un souffle de bruit filtré,
 * derrière un passe-bas qui respire très lentement (LFO 0,04 Hz). Il se tait avec le silence, s'abaisse
 * pendant la visite et se « ferme » (oculaire) sur l'écran titre. Aucune information n'y est portée.
 */
import { sound, silence as silenceMotion } from '../theme/tokens';
import { centsToRatio, dbToGain } from './cues';
import { ramp, type AudioEngine } from './engine';

export class Bed {
  private engine: AudioEngine;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private level!: GainNode;
  private silenceGain!: GainNode;
  private tourGain!: GainNode;
  private focus!: BiquadFilterNode;
  private lfoDepth!: GainNode;
  private stopTimer: number | undefined;
  private playing = false;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Démarre le fond (fondu d'entrée 2,4 s). `open` : oculaire ouvert (explorateur) ou fermé (titre). */
  start(opts: { reduced: boolean; open: boolean; tour: boolean }): void {
    const ctx = this.engine.ctx;
    if (!ctx || this.playing) return;
    window.clearTimeout(this.stopTimer);
    this.teardown();
    this.playing = true;
    const b = sound.bed;
    const t = ctx.currentTime;

    const mix = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = b.lowpass;
    lowpass.Q.value = 0.4;
    // LFO : le passe-bas respire de ± lfoDepth Hz (aucun en mouvement réduit)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = b.lfoHz;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = opts.reduced ? 0 : b.lfoDepth;
    lfo.connect(this.lfoDepth).connect(lowpass.frequency);

    this.level = ctx.createGain();
    this.level.gain.setValueAtTime(0, t);
    this.level.gain.linearRampToValueAtTime(dbToGain(b.level), t + b.fadeIn / 1000);
    this.silenceGain = ctx.createGain();
    this.tourGain = ctx.createGain();
    this.tourGain.gain.value = opts.tour ? sound.tourDuck.gain : 1;
    this.focus = ctx.createBiquadFilter();
    this.focus.type = 'lowpass';
    this.focus.Q.value = 0.5;
    this.focus.frequency.value = opts.open ? b.focusOpen : b.focusClosed;

    mix.connect(lowpass).connect(this.level).connect(this.silenceGain).connect(this.tourGain).connect(this.focus);
    this.focus.connect(this.engine.bedOut);
    const send = ctx.createGain();
    send.gain.value = b.send;
    this.focus.connect(send).connect(this.engine.bedSend);

    // deux paires de sinus désaccordées de ± detuneCents : battements lents, aucun rythme
    const sines: OscillatorNode[] = [];
    for (const f of [b.root, b.fifth]) {
      for (const sign of [-1, 1]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * centsToRatio(sign * b.detuneCents);
        const g = ctx.createGain();
        g.gain.value = 0.25;
        o.connect(g).connect(mix);
        sines.push(o);
        this.nodes.push(g);
      }
    }
    // souffle : bruit (6 s, en boucle) → passe-bas 1 kHz → passe-bande 700 Hz
    const nbuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * b.noiseSeconds), ctx.sampleRate);
    const data = nbuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = nbuf;
    src.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = b.noiseLowpass;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = b.noiseBand;
    nbp.Q.value = b.noiseQ;
    const ng = ctx.createGain();
    ng.gain.value = dbToGain(b.noiseLevel);
    src.connect(nlp).connect(nbp).connect(ng).connect(mix);

    this.sources = [...sines, src, lfo];
    this.sources.forEach((s) => s.start(t));
    this.nodes.push(mix, lowpass, this.lfoDepth, this.level, this.silenceGain, this.tourGain, this.focus, send, nlp, nbp, ng);
  }

  /** Fondu de sortie (800 ms), puis arrêt des sources. */
  stop(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.playing) return;
    this.playing = false;
    ramp(this.level.gain, 0, ctx.currentTime, sound.bed.fadeOut);
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => this.teardown(), sound.bed.fadeOut + 50);
  }

  private teardown(): void {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* déjà arrêtée */
      }
    });
    this.sources.forEach((s) => s.disconnect());
    this.nodes.forEach((n) => n.disconnect());
    this.sources = [];
    this.nodes = [];
  }

  /** Visite : fond × 0,25 (attaque 300 ms) ; remontée en 1 200 ms quand elle rend la main. */
  duck(tour: boolean): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.playing) return;
    const d = sound.tourDuck;
    ramp(this.tourGain.gain, tour ? d.gain : 1, ctx.currentTime, tour ? d.attack : d.release);
  }

  /** Le silence : le fond se fige avec l'image (300 ms), reste bas (600 ms), reprend (600 ms). */
  silence(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.playing) return;
    const g = this.silenceGain.gain;
    const t = ctx.currentTime;
    const s = silenceMotion;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(sound.silenceDuck, t + s.freezeIn / 1000);
    g.setValueAtTime(sound.silenceDuck, t + (s.freezeIn + s.hold) / 1000);
    g.linearRampToValueAtTime(1, t + (s.freezeIn + s.hold + s.release) / 1000);
  }

  /** Oculaire : ouvert (explorateur) ou fermé (écran titre), en `ms`, après `delayMs`. */
  setFocus(open: boolean, ms: number, delayMs = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.playing) return;
    const f = this.focus.frequency;
    const t = ctx.currentTime + delayMs / 1000;
    f.cancelScheduledValues(ctx.currentTime);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(open ? sound.bed.focusOpen : sound.bed.focusClosed, t + Math.max(1, ms) / 1000);
  }

  /** Mouvement réduit : plus de respiration lente du filtre. */
  setReduced(reduced: boolean): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.playing) return;
    ramp(this.lfoDepth.gain, reduced ? 0 : sound.bed.lfoDepth, ctx.currentTime, 500);
  }
}
