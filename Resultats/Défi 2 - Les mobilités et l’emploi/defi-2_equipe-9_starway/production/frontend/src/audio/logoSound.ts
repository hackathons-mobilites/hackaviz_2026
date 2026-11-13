/**
 * Sons de l'animation du logo. Chaque scène passe par son propre bus : la couper (Échap, sprint, son coupé, sortie du
 * titre) éteint d'un coup tout ce qui est programmé, sans suivre chaque note. Aucun contexte audio n'est créé ici :
 * tant que l'utilisateur n'a fait aucun geste, le moteur n'a pas de contexte et tout reste muet, sans erreur.
 *
 * La scène d'ouverture démarre souvent sans geste : on la retient, et le premier geste accroche les sons qui restent à
 * venir (`join`). Rien n'est rattrapé : ce qui aurait déjà dû sonner ne sonne jamais.
 */
import { LOGO_STARS } from '../data/logoGeometry';
import type { LogoTimeline } from '../data/logoRevealTimeline';
import { logoReveal, reveal, sound } from '../theme/tokens';
import { throttleOk } from './cues';
import type { AudioEngine, VoiceContext } from './engine';
import { planLogoScene, starPan, type LogoCue } from './logoCues';
import { noise, pad, swell, tone } from './voices';

const L = sound.logo;
const XS = LOGO_STARS.map((s) => s.x);
const SINE = [{ type: 'sine', ratio: 1, db: 0 }] as const;
const BELL = [
  { type: 'sine', ratio: 1, db: 0 },
  { type: 'sine', ratio: 2, db: -12 },
  { type: 'triangle', ratio: 3, db: -24 },
] as const;
const GLASS = [
  { type: 'triangle', ratio: 1, db: 0 },
  { type: 'sine', ratio: 2, db: -9 },
] as const;

interface Bus {
  ctx: AudioContext;
  dry: GainNode;
  wet: GainNode;
}

export class LogoSound {
  /** Scène en cours côté image : son départ (ms, `performance.now`) */
  private scene: { tl: LogoTimeline; startedAt: number; replay: boolean } | null = null;
  private scheduled = false;
  private bus: Bus | null = null;
  /** Invalide ce qui attendait le réveil du contexte */
  private token = 0;
  private lastHover: number | null = null;

  private readonly engine: AudioEngine;
  private readonly allowed: () => boolean;

  constructor(engine: AudioEngine, allowed: () => boolean) {
    this.engine = engine;
    this.allowed = allowed;
  }

  /** Une scène commence à l'image. Sans contexte audio, elle est seulement retenue pour le premier geste. */
  scenePlay(tl: LogoTimeline, startedAt: number, replay = false): void {
    this.cutBus();
    this.scene = { tl, startedAt, replay };
    this.scheduled = false;
    this.join();
  }

  /** Geste, son remis, onglet revenu : accroche les sons à venir de la scène, une seule fois. */
  join(): void {
    const scene = this.scene;
    if (!scene || this.scheduled || !this.allowed() || !this.engine.ctx) return;
    if (performance.now() - scene.startedAt > scene.tl.end) {
      this.scene = null;
      return;
    }
    this.scheduled = true;
    this.whenRunning((vc) => {
      // le réveil du contexte a pu prendre du temps : on recalcule ce qui reste à venir
      const now = performance.now() - scene.startedAt;
      const base = this.engine.at();
      if (scene.replay && now < logoReveal.cameraIn / 2) this.rewind(vc, base);
      // un seul instant de référence : les écarts entre les sons sont exactement ceux de l'image
      for (const cue of planLogoScene(scene.tl, XS, now)) this.play(vc, cue, base + (cue.at - now) / 1000);
    });
  }

  /** Clic sur « Explorer le ciel » : remplace ce qui reste de la scène ; le souffle de la révélation prend la suite. */
  sprint(): void {
    this.cutBus();
    this.scene = null;
    this.scheduled = false;
    if (!this.allowed() || !this.engine.ctx) return;
    this.whenRunning((vc) => {
      const c = L.sprint;
      const when = this.engine.at();
      const pan = { from: c.panFrom, to: c.panTo, ms: logoReveal.sprint };
      swell(vc, when, { fromHz: c.fromHz, toHz: c.toHz, level: c.level, duration: logoReveal.sprint, release: L.comet.riseRelease, pan });
      noise(vc, when, {
        level: c.noiseLevel,
        filter: 'bandpass',
        q: c.q,
        fromHz: c.noiseFromHz,
        toHz: c.noiseToHz,
        freqEase: 'linear',
        duration: logoReveal.sprint,
        shape: 'rise',
        fade: L.comet.riseRelease,
        pan,
      });
      this.lock(vc, L.lock.notes[L.lock.notes.length - 1] as number, c.panTo, when + logoReveal.sprint / 1000);
    });
  }

  /** Survol d'une étoile : très discret, limité, jamais pendant une scène ni avant un geste. */
  hover(star: number, now: number): void {
    if (this.scene && performance.now() - this.scene.startedAt > this.scene.tl.end) this.scene = null;
    if (!this.allowed() || !this.engine.running || this.scene) return;
    if (!throttleOk(this.lastHover, now, L.hover.minGapMs)) return;
    const vc = this.engine.voice();
    const freq = L.hover.notes[star];
    if (!vc || freq === undefined) return;
    this.lastHover = now;
    const when = this.engine.at();
    tone(vc, when, { freq, partials: SINE, level: L.hover.level, attack: L.hover.attack, decay: L.hover.decay, pan: starPan(XS[star] ?? 0, XS) });
  }

  /** Retour au titre : deux notes qui descendent, quand le titre revient. */
  back(): void {
    if (!this.allowed() || !this.engine.running) return;
    const vc = this.engine.voice();
    if (!vc) return;
    L.back.notes.forEach((freq, i) => {
      const when = this.engine.at(reveal.backTitleAt + i * L.back.gapMs);
      tone(vc, when, { freq, partials: BELL, level: L.back.level, attack: L.back.attack, decay: L.back.decay, send: L.back.send });
    });
  }

  /** Coupe ce qui sonne, mais retient la scène : si le son revient, les sons à venir repartent. */
  cancel(): void {
    this.cutBus();
    this.scheduled = false;
  }

  /** Sortie de l'écran titre ou mouvement réduit : plus aucune scène. */
  stop(): void {
    this.cancel();
    this.scene = null;
  }

  /** Attend que le contexte tourne (au premier geste, il démarre avec un léger retard) ; ne laisse jamais d'erreur. */
  private whenRunning(fn: (vc: VoiceContext) => void): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const token = ++this.token;
    const go = () => {
      if (token !== this.token || !this.allowed() || !this.engine.running) return;
      try {
        const vc = this.openBus();
        if (vc) fn(vc);
      } catch (err) {
        console.warn('Son du logo indisponible', err);
      }
    };
    if (ctx.state === 'running') go();
    else void ctx.resume().then(go, () => undefined);
  }

  private openBus(): VoiceContext | null {
    const base = this.engine.voice();
    if (!base) return null;
    const dry = base.ctx.createGain();
    const wet = base.ctx.createGain();
    dry.connect(base.dry);
    wet.connect(base.wet);
    this.bus = { ctx: base.ctx, dry, wet };
    return { ...base, dry, wet };
  }

  private cutBus(): void {
    this.token++;
    const bus = this.bus;
    this.bus = null;
    if (!bus) return;
    const t = bus.ctx.currentTime;
    for (const node of [bus.dry, bus.wet]) {
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(0, t + L.stopFade / 1000);
    }
    setTimeout(() => {
      bus.dry.disconnect();
      bus.wet.disconnect();
    }, L.stopFade + 50);
  }

  /** Retour en arrière au clic sur le logo, le temps que la caméra revienne au centre. */
  private rewind(vc: VoiceContext, when: number): void {
    const c = L.replay;
    tone(vc, when, {
      freq: c.fromHz,
      glideTo: c.toHz,
      glideMs: logoReveal.cameraIn,
      glideEase: 'outQuart',
      partials: SINE,
      level: c.level,
      attack: c.attack,
      decay: logoReveal.cameraIn,
      send: c.send,
    });
  }

  private lock(vc: VoiceContext, freq: number, pan: number, when: number): void {
    const c = L.lock;
    noise(vc, when, { level: c.clickLevel, filter: 'bandpass', q: c.clickQ, fromHz: c.clickHz, duration: c.clickMs, shape: 'perc', attack: 1, pan });
    tone(vc, when, { freq: c.thudHz, partials: SINE, level: c.thudLevel, attack: 1, decay: c.thudDecay, pan });
    tone(vc, when, { freq, partials: GLASS, level: c.level, attack: c.attack, decay: c.decay, pan, send: c.send });
  }

  private play(vc: VoiceContext, cue: LogoCue, when: number): void {
    switch (cue.kind) {
      case 'ignite':
        tone(vc, when, { freq: L.ignite.freq, partials: BELL, level: L.ignite.level, attack: L.ignite.attack, decay: L.ignite.decay, pan: cue.pan, send: L.ignite.send });
        break;
      case 'comet': {
        const pan = { from: cue.panFrom, to: cue.panTo, ms: cue.ms };
        noise(vc, when, {
          level: cue.level,
          filter: 'bandpass',
          q: L.comet.q,
          fromHz: cue.fromHz,
          toHz: cue.toHz,
          freqEase: 'linear',
          duration: cue.ms,
          shape: 'rise',
          fade: L.comet.riseRelease,
          pan,
          send: L.comet.send,
        });
        swell(vc, when, { fromHz: cue.riseFromHz, toHz: cue.riseToHz, level: cue.riseLevel, duration: cue.ms, release: L.comet.riseRelease, pan });
        break;
      }
      case 'lock':
        this.lock(vc, cue.freq, cue.pan, when);
        break;
      case 'impact': {
        const c = L.impact;
        tone(vc, when, { freq: c.fromHz, glideTo: c.toHz, glideMs: c.glide, glideEase: 'outQuart', partials: SINE, level: c.level, attack: c.attack, decay: c.decay, pan: cue.pan, send: c.send });
        noise(vc, when, {
          level: c.waveLevel,
          filter: 'bandpass',
          q: c.waveQ,
          fromHz: c.waveFromHz,
          toHz: c.waveToHz,
          freqEase: 'outQuart',
          duration: logoReveal.shock,
          shape: 'perc',
          attack: 8,
          pan: { from: cue.pan, to: 0, ms: logoReveal.shock },
          send: c.send,
        });
        break;
      }
      case 'word': {
        const c = L.word;
        pad(vc, when, {
          freqs: c.notes,
          level: c.level,
          attack: c.attack,
          hold: Math.max(0, cue.ms - c.attack),
          release: c.release,
          filter: { from: c.fromHz, to: c.toHz, ms: cue.ms, ease: 'outQuart' },
          send: c.send,
        });
        break;
      }
      case 'sweep': {
        const c = L.sweep;
        noise(vc, when, { level: c.level, filter: 'bandpass', q: c.q, fromHz: c.fromHz, toHz: c.toHz, duration: cue.ms, shape: 'arch', pan: { from: -c.pan, to: c.pan, ms: cue.ms } });
        break;
      }
    }
  }
}
