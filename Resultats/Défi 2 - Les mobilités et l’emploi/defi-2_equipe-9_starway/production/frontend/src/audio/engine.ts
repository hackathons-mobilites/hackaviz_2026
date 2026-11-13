/**
 * Moteur audio (Web Audio, aucune dépendance, aucun fichier) : contexte créé au premier geste,
 * réverbération par convolution d'une réponse GÉNÉRÉE, bus maître à volume bas, compresseur doux.
 *
 *   bruitages → sfx (coupé pendant la narration) ┐
 *   fond ────────────────────────────────────────┼→ maître (0,35) → compresseur → sortie
 *   envois → sfxSend / bedSend → réverbération ──┘
 */
import { sound } from '../theme/tokens';

/** Ce qu'une recette sonore reçoit pour se brancher. */
export interface VoiceContext {
  ctx: AudioContext;
  /** Sortie sèche des bruitages */
  dry: AudioNode;
  /** Entrée de la réverbération (envoi) */
  wet: AudioNode;
  /** Bruit blanc mono de 2 s (partagé) */
  noise: AudioBuffer;
}

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Réponse impulsionnelle stéréo : bruit blanc × décroissance (1 - t)^p, après un pré-délai. */
function impulseResponse(ctx: AudioContext): AudioBuffer {
  const { seconds, preDelay, decayPower } = sound.reverb;
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * (seconds + preDelay)));
  const start = Math.floor(rate * preDelay);
  const buf = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = start; i < length; i++) {
      const t = (i - start) / (length - start);
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decayPower);
    }
  }
  return buf;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private sfxSend!: GainNode;
  /** Entrée du fond (sec) et de son envoi vers la réverbération */
  bedOut!: GainNode;
  bedSend!: GainNode;
  private noise!: AudioBuffer;
  private suspendTimer: number | undefined;

  /** Le Web Audio est-il disponible dans ce navigateur ? */
  static supported(): boolean {
    return audioContextCtor() != null;
  }

  /** Crée le contexte (à appeler dans un geste de l'utilisateur). Renvoie false si impossible. */
  ensure(): boolean {
    if (this.ctx) return true;
    const C = audioContextCtor();
    if (!C) return false;
    try {
      const ctx = new C();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      const c = sound.compressor;
      comp.threshold.value = c.threshold;
      comp.knee.value = c.knee;
      comp.ratio.value = c.ratio;
      comp.attack.value = c.attack;
      comp.release.value = c.release;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(comp);

      const reverb = ctx.createConvolver();
      reverb.buffer = impulseResponse(ctx);
      reverb.connect(this.master);

      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.sfxSend = ctx.createGain();
      this.sfxSend.connect(reverb);
      this.bedOut = ctx.createGain();
      this.bedOut.connect(this.master);
      this.bedSend = ctx.createGain();
      this.bedSend.connect(reverb);

      this.noise = noiseBuffer(ctx, 2);
      return true;
    } catch (err) {
      console.warn('Son indisponible', err);
      this.ctx = null;
      return false;
    }
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Instant audio (s) pour un départ dans `ms` millisecondes. */
  at(ms = 0): number {
    return (this.ctx?.currentTime ?? 0) + (sound.lookahead + Math.max(0, ms)) / 1000;
  }

  voice(): VoiceContext | null {
    if (!this.ctx) return null;
    return { ctx: this.ctx, dry: this.sfx, wet: this.sfxSend, noise: this.noise };
  }

  /** Bus maître : volume (0 = coupé) en `rampMs`. */
  setMaster(on: boolean, rampMs: number): void {
    if (!this.ctx) return;
    ramp(this.master.gain, on ? sound.master : 0, this.ctx.currentTime, rampMs);
  }

  /** Bruitages : coupés pendant la narration de la visite. */
  setSfx(on: boolean, rampMs: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    ramp(this.sfx.gain, on ? 1 : 0, t, rampMs);
    ramp(this.sfxSend.gain, on ? 1 : 0, t, rampMs);
  }

  resume(): void {
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  /** Suspend le contexte (après `afterMs`, le temps d'un fondu) : plus aucun calcul audio. */
  suspend(afterMs = 0): void {
    if (!this.ctx) return;
    window.clearTimeout(this.suspendTimer);
    const go = () => {
      this.suspendTimer = undefined;
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
    };
    if (afterMs > 0) this.suspendTimer = window.setTimeout(go, afterMs);
    else go();
  }
}

/** Rampe linéaire sans saut depuis la valeur courante. */
export function ramp(param: AudioParam, to: number, from: number, ms: number): void {
  param.cancelScheduledValues(from);
  param.setValueAtTime(param.value, from);
  param.linearRampToValueAtTime(to, from + Math.max(1, ms) / 1000);
}
