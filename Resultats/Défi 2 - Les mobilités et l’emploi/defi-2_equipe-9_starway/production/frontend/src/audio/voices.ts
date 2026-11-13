/**
 * Recettes sonores (Web Audio) : chaque recette programme ses nœuds à l'instant `when` (s, horloge
 * audio), se branche sur les bus du moteur et se débranche seule à la fin. Paramètres en dB et en ms ;
 * les plans (quand, quelle hauteur, quel panoramique) viennent de `cues.ts`.
 */
import { archCurve, dbToGain, easeCurve, type Ease } from './cues';
import type { VoiceContext } from './engine';

const S = (ms: number) => Math.max(0, ms) / 1000;
/** Plancher des rampes exponentielles (≈ -80 dB) */
const FLOOR = 1e-4;

/** Sortie d'une voix : panoramique (fixe ou balayé), envoi vers la réverbération. */
function output(vc: VoiceContext, when: number, pan: number | { from: number; to: number; ms: number; ease?: Ease }, send: number) {
  const { ctx } = vc;
  const nodes: AudioNode[] = [];
  const panner = ctx.createStereoPanner();
  if (typeof pan === 'number') panner.pan.setValueAtTime(pan, when);
  else if (pan.from === pan.to || pan.ms <= 0) panner.pan.setValueAtTime(pan.from, when);
  else panner.pan.setValueCurveAtTime(easeCurve(pan.from, pan.to, pan.ease ?? 'linear'), when, S(pan.ms));
  panner.connect(vc.dry);
  nodes.push(panner);
  if (send > 0) {
    const s = ctx.createGain();
    s.gain.value = send;
    panner.connect(s);
    s.connect(vc.wet);
    nodes.push(s);
  }
  return { input: panner as AudioNode, nodes };
}

function cleanup(last: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  last.onended = () => nodes.forEach((n) => n.disconnect());
}

export interface ToneLayer {
  type: OscillatorType;
  /** Multiple de la fondamentale */
  ratio: number;
  /** Niveau relatif (dB) */
  db: number;
}

export interface ToneParams {
  freq: number;
  partials: readonly ToneLayer[];
  level: number;
  attack: number;
  decay: number;
  pan?: number | { from: number; to: number; ms: number; ease?: Ease };
  send?: number;
  /** Glissade de hauteur (fondamentale) vers `glideTo` en `glideMs`, easing `glideEase` */
  glideTo?: number;
  glideMs?: number;
  glideEase?: Ease;
  lowpass?: number;
}

/**
 * Son percussif (cloche, pincement, carillon, glissade) : partiels additionnés, attaque linéaire puis
 * décroissance exponentielle. Renvoie une fonction d'arrêt.
 */
export function tone(vc: VoiceContext, when: number, p: ToneParams): () => void {
  const { ctx } = vc;
  const out = output(vc, when, p.pan ?? 0, p.send ?? 0);
  const env = ctx.createGain();
  const peak = dbToGain(p.level);
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + S(p.attack));
  env.gain.exponentialRampToValueAtTime(FLOOR, when + S(p.attack + p.decay));
  const nodes: AudioNode[] = [env, ...out.nodes];
  let target: AudioNode = out.input;
  if (p.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.lowpass;
    lp.connect(out.input);
    nodes.push(lp);
    target = lp;
  }
  env.connect(target);
  const end = when + S(p.attack + p.decay) + 0.05;
  const oscs = p.partials.map((part) => {
    const o = ctx.createOscillator();
    o.type = part.type;
    // une courbe ne doit chevaucher aucun autre événement : soit la valeur, soit la courbe
    if (p.glideTo && p.glideMs) {
      o.frequency.setValueCurveAtTime(easeCurve(p.freq * part.ratio, p.glideTo * part.ratio, p.glideEase ?? 'linear'), when, S(p.glideMs));
    } else o.frequency.setValueAtTime(p.freq * part.ratio, when);
    const g = ctx.createGain();
    g.gain.value = dbToGain(part.db);
    o.connect(g).connect(env);
    nodes.push(o, g);
    o.start(when);
    o.stop(end);
    return o;
  });
  if (oscs.length) cleanup(oscs[oscs.length - 1]!, nodes);
  return () => oscs.forEach((o) => o.stop());
}

export interface PadParams {
  freqs: readonly number[];
  /** Niveau de chaque voix (dB) */
  level: number;
  attack: number;
  hold: number;
  release: number;
  pan?: number;
  send?: number;
  /** Passe-bas qui s'ouvre de `from` à `to` pendant `ms` (« mise au point ») */
  filter?: { from: number; to: number; ms: number; ease?: Ease };
  /** Écart de hauteur d'une voix jumelle (cents) : nappe « frottée » */
  detuneCents?: number;
}

/** Nappe tenue : attaque, tenue, relâche ; filtre optionnel. */
export function pad(vc: VoiceContext, when: number, p: PadParams): () => void {
  const { ctx } = vc;
  const out = output(vc, when, p.pan ?? 0, p.send ?? 0);
  const env = ctx.createGain();
  const peak = dbToGain(p.level);
  const holdEnd = when + S(p.attack + p.hold);
  const end = holdEnd + S(p.release);
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + S(p.attack));
  env.gain.setValueAtTime(peak, holdEnd);
  env.gain.linearRampToValueAtTime(0, end);
  const nodes: AudioNode[] = [env, ...out.nodes];
  let target: AudioNode = out.input;
  if (p.filter) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.setValueCurveAtTime(easeCurve(p.filter.from, p.filter.to, p.filter.ease ?? 'outQuart'), when, S(p.filter.ms));
    lp.connect(out.input);
    nodes.push(lp);
    target = lp;
  }
  env.connect(target);
  const oscs: OscillatorNode[] = [];
  for (const f of p.freqs) {
    for (const cents of p.detuneCents ? [-p.detuneCents, p.detuneCents] : [0]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = p.detuneCents ? 0.5 : 1;
      o.connect(g).connect(env);
      nodes.push(o, g);
      o.start(when);
      o.stop(end + 0.05);
      oscs.push(o);
    }
  }
  if (oscs.length) cleanup(oscs[oscs.length - 1]!, nodes);
  return () => oscs.forEach((o) => o.stop());
}

export interface NoiseParams {
  level: number;
  filter: BiquadFilterType;
  q?: number;
  fromHz: number;
  toHz?: number;
  freqEase?: Ease;
  /** Durée totale (ms) */
  duration: number;
  /** 'arch' : 0 → crête à mi-course → 0 ; 'perc' : attaque puis décroissance ; 'hold' : attaque, tenue, fondu ; 'rise' : montée jusqu'à la crête, puis fondu */
  shape: 'arch' | 'perc' | 'hold' | 'rise';
  attack?: number;
  /** 'hold' : fondu de fin (ms) */
  fade?: number;
  pan?: number | { from: number; to: number; ms: number; ease?: Ease };
  send?: number;
}

/** Souffle de bruit filtré (éclipse, titre, filante, effleurement, tic). */
export function noise(vc: VoiceContext, when: number, p: NoiseParams): () => void {
  const { ctx } = vc;
  const out = output(vc, when, p.pan ?? 0, p.send ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = vc.noise;
  src.loop = true;
  src.loopStart = Math.random() * (vc.noise.duration - 0.5);
  const flt = ctx.createBiquadFilter();
  flt.type = p.filter;
  flt.Q.value = p.q ?? 1;
  if (p.toHz != null && p.toHz !== p.fromHz) {
    flt.frequency.setValueCurveAtTime(easeCurve(p.fromHz, p.toHz, p.freqEase ?? 'inOutSine'), when, S(p.duration));
  } else flt.frequency.setValueAtTime(p.fromHz, when);
  const env = ctx.createGain();
  const peak = dbToGain(p.level);
  const dur = S(p.duration);
  if (p.shape === 'arch') {
    env.gain.value = 0;
    env.gain.setValueCurveAtTime(archCurve(peak), when, Math.max(0.01, dur));
  } else if (p.shape === 'perc') {
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + S(p.attack ?? 2));
    env.gain.exponentialRampToValueAtTime(FLOOR, when + dur);
  } else if (p.shape === 'rise') {
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + dur);
    env.gain.linearRampToValueAtTime(0, when + dur + Math.max(0.02, S(p.fade ?? 0)));
  } else {
    const fade = S(p.fade ?? 0);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + S(p.attack ?? 20));
    env.gain.setValueAtTime(peak, when + dur);
    env.gain.linearRampToValueAtTime(0, when + dur + Math.max(0.02, fade));
  }
  src.connect(flt).connect(env).connect(out.input);
  src.start(when, src.loopStart);
  const end = when + dur + S(p.fade ?? 0) + 0.06;
  src.stop(end);
  cleanup(src, [src, flt, env, ...out.nodes]);
  return () => src.stop();
}

export interface SwellParams {
  fromHz: number;
  toHz: number;
  level: number;
  /** Durée de la montée (ms) */
  duration: number;
  /** Fondu de fin (ms) */
  release: number;
  pan?: number | { from: number; to: number; ms: number; ease?: Ease };
  send?: number;
}

/** Note tenue qui monte en hauteur et en force, puis s'éteint d'un coup : la tension de la comète. */
export function swell(vc: VoiceContext, when: number, p: SwellParams): () => void {
  const { ctx } = vc;
  const out = output(vc, when, p.pan ?? 0, p.send ?? 0);
  const dur = S(p.duration);
  const end = when + dur + Math.max(0.01, S(p.release));
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(dbToGain(p.level), when + dur);
  env.gain.linearRampToValueAtTime(0, end);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueCurveAtTime(easeCurve(p.fromHz, p.toHz, 'linear'), when, Math.max(0.01, dur));
  osc.connect(env).connect(out.input);
  osc.start(when);
  osc.stop(end + 0.05);
  cleanup(osc, [osc, env, ...out.nodes]);
  return () => osc.stop();
}
