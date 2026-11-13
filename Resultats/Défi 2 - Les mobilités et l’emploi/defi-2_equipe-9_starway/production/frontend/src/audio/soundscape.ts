/**
 * Chef d'orchestre du son (D-026) : reçoit ce que l'image vient de jouer (événements du ciel, étapes de
 * la révélation, carte, halo, preuve, comparaison, jauge) et le double d'un son. Il ne décide rien :
 * pas d'effet visuel, pas de son. Règles :
 * - rien ne joue avant un geste (le contexte audio naît dans un geste, ou avec `?record=1&sound=1`) ;
 * - pendant la narration de la visite, aucun bruitage et le fond s'abaisse ;
 * - mouvement réduit : bruitages de 150 ms, sans balayage ni arpège, pas de filante ni de vol ;
 * - onglet masqué : contexte suspendu ; un seul tic de jauge toutes les `motion.scrubThrottle` ms.
 */
import type { SkyEvent } from '../store/skyBridge';
import { mirror as mirrorMotion, motion, reveal, silence as silenceMotion, sound } from '../theme/tokens';
import { Bed } from './bed';
import {
  eclipsePan,
  haloHold,
  panOf,
  planGainCues,
  planLightingCues,
  shootingSegments,
  shortEnvelope,
  throttleOk,
  tickFrequency,
} from './cues';
import { AudioEngine } from './engine';
import { LogoSound } from './logoSound';
import { noise, pad, tone } from './voices';

export type TourStatus = 'idle' | 'playing' | 'paused' | 'ended';

export class Soundscape {
  private engine = new AudioEngine();
  private bed = new Bed(this.engine);
  /** Sons de l'animation du logo (écran titre) : leur plan et leur propre bus. Mouvement réduit : aucun. */
  readonly logo = new LogoSound(this.engine, () => this.wanted && !this.hidden && !this.reduced && !this.tourDucked());
  private wanted = false;
  private reduced = false;
  private tour: TourStatus = 'idle';
  private hidden = false;
  private atTitle = true;
  private lastTick: number | null = null;

  /** État initial, sans rien jouer. */
  configure(o: { on: boolean; reduced: boolean; tour: TourStatus; atTitle: boolean; hidden: boolean }): void {
    this.wanted = o.on;
    this.reduced = o.reduced;
    this.tour = o.tour;
    this.atTitle = o.atTitle;
    this.hidden = o.hidden;
  }

  /** Geste de l'utilisateur (ou démarrage permis) : crée ou réveille le contexte, lance le fond. */
  gesture(): void {
    if (!this.wanted || this.hidden) return;
    const first = !this.engine.ctx;
    if (first && !this.engine.ensure()) return;
    // un contexte créé sur un appui tactile reste suspendu : le geste suivant le réveille
    if (!this.engine.running) this.engine.resume();
    this.logo.join(); // la scène du logo déjà en cours : seuls les sons à venir partent, sans rattrapage
    if (!first && this.bed.isPlaying) return; // déjà en route : chaque clic ne refait rien
    this.engine.setMaster(true, sound.toggleRamp);
    this.engine.setSfx(!this.tourDucked(), 1);
    this.bed.start({ reduced: this.reduced, open: !this.atTitle, tour: this.tourDucked() });
  }

  /** Bouton son (appelé dans le geste du clic). */
  setOn(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) {
      this.gesture();
      return;
    }
    if (!this.engine.ctx) return;
    this.logo.cancel();
    this.engine.setMaster(false, sound.toggleRamp);
    this.bed.stop();
    this.engine.suspend(Math.max(sound.toggleRamp, sound.bed.fadeOut) + 50);
  }

  /** Onglet masqué : le contexte est suspendu (le fond se coupe) ; il reprend au retour. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (!this.engine.ctx) return;
    if (hidden) {
      this.logo.cancel(); // l'horloge audio s'arrête, pas l'image : plus rien ne serait à sa place au retour
      this.engine.suspend();
    } else if (this.wanted) {
      this.engine.resume();
      this.logo.join();
    }
  }

  setReduced(reduced: boolean): void {
    if (reduced === this.reduced) return;
    this.reduced = reduced;
    if (reduced) this.logo.stop();
    this.bed.setReduced(reduced);
  }

  private tourDucked(): boolean {
    return this.tour === 'playing' || this.tour === 'paused';
  }

  /** Visite : fond abaissé tant qu'elle est en cours ; bruitages coupés pendant la narration. */
  setTour(status: TourStatus): void {
    if (status === this.tour) return;
    this.tour = status;
    this.bed.duck(this.tourDucked());
    // Bruitages coupés pendant la narration ET pendant la pause de la visite (retour de Cyril du 12/11 : un son bref, puis plus rien, quand
    // il met la visite en pause ou la relance : le ciel continue de bouger pendant la pause, ses bruitages ne doivent pas se réveiller)
    const quiet = status === 'playing' || status === 'paused';
    this.engine.setSfx(!quiet, quiet ? sound.narrationMute : motion.ui);
  }

  /** Écran titre ⇄ ciel : l'oculaire du fond se ferme ou s'ouvre. */
  setAtTitle(atTitle: boolean): void {
    if (atTitle === this.atTitle) return;
    this.atTitle = atTitle;
    if (atTitle) {
      // « l'oculaire se ferme » : sur la sortie de l'interface et l'effacement des astres (motion-spec)
      this.bed.setFocus(false, this.reduced ? motion.reduced : motion.reduced + reveal.backSky);
      this.logo.back();
    } else {
      this.bed.setFocus(true, this.reduced ? motion.reduced : reveal.focusDuration);
    }
  }

  private canPlay(): boolean {
    return this.wanted && !this.hidden && this.engine.running && !this.tourDucked();
  }

  /* ---------------------------------------------------------------- révélation (Acte 0) */

  /** A. le titre se retire : un souffle qui s'élève. */
  titleOut(): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.titleOut;
    noise(vc, this.engine.at(), {
      level: c.level,
      filter: 'bandpass',
      q: c.q,
      fromHz: c.fromHz,
      toHz: this.reduced ? c.fromHz : c.toHz,
      duration: this.reduced ? motion.reduced : reveal.titleOut,
      shape: 'arch',
      send: sound.reverb.send,
    });
  }

  /** B. le ciel se pose : « mise au point », trois sinus derrière un passe-bas qui s'ouvre. */
  pose(): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.focus;
    if (this.reduced) {
      pad(vc, this.engine.at(), { freqs: c.notes, level: c.level, attack: sound.reducedAttack, hold: 0, release: motion.reduced - sound.reducedAttack, send: sound.reverb.send });
      return;
    }
    pad(vc, this.engine.at(), {
      freqs: c.notes,
      level: c.level,
      attack: c.attack,
      hold: Math.max(0, reveal.focusDuration - c.attack),
      release: c.release,
      filter: { from: c.fromHz, to: c.toHz, ms: reveal.focusDuration, ease: 'outQuart' },
      send: sound.reverb.send,
    });
  }

  /* ---------------------------------------------------------------- ciel */

  sky(e: SkyEvent): void {
    if (e.type === 'transition') this.transition(e);
    else if (e.type === 'guide') this.guide(e.x, e.reduced);
    else if (e.type === 'shooting') this.shooting(e);
    else this.gain(e.gold, e.reduced);
  }

  /** C. naissance de l'étoile-guide : cloche chaude, placée sur l'étoile. */
  private guide(x: number, reduced: boolean): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.guide;
    const env = shortEnvelope({ attack: c.attack, decay: c.decay }, reduced);
    tone(vc, this.engine.at(), {
      freq: c.freq,
      partials: [
        { type: 'sine', ratio: 1, db: 0 },
        { type: 'sine', ratio: 2, db: -12 },
        { type: 'triangle', ratio: 3, db: -24 },
      ],
      level: c.level,
      ...env,
      pan: panOf(x),
      send: sound.reverb.send,
    });
  }

  /** Allumage, silence, éclipse : un seul bruitage par transition (éclipse > perte > allumage). */
  private transition(e: Extract<SkyEvent, { type: 'transition' }>): void {
    if (e.cause === 'scrub') return; // glisser : seul le tic de la jauge parle
    // le fond se tait avec l'image (ambiance figée), même pendant la visite
    if (e.silence) this.bed.silence();
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const reduced = e.reduced;
    if (e.dayFlip) {
      const c = sound.eclipse;
      const p = eclipsePan(e.eclipse, reduced || e.eclipse == null);
      const short = reduced || e.eclipse == null;
      noise(vc, this.engine.at(), {
        level: c.level,
        filter: 'bandpass',
        q: c.q,
        fromHz: c.fromHz,
        toHz: short ? c.fromHz : c.toHz,
        duration: short ? motion.reduced : motion.eclipse,
        shape: 'arch',
        pan: short ? 0 : { from: p.from, to: p.to, ms: motion.eclipse, ease: 'inOutSine' },
        send: sound.reverb.send,
      });
      return;
    }
    if (e.lost > 0) {
      const c = sound.lost;
      const dur = reduced ? motion.reduced : silenceMotion.dimDuration;
      tone(vc, this.engine.at(reduced ? 0 : e.lostDelay), {
        freq: c.fromHz,
        partials: [{ type: 'sine', ratio: 1, db: 0 }],
        level: c.level,
        attack: reduced ? sound.reducedAttack : 30,
        decay: dur,
        glideTo: c.toHz,
        glideMs: dur,
        glideEase: 'outExpo',
        lowpass: c.lowpass,
        send: sound.reverb.send,
      });
      return;
    }
    const notes = planLightingCues(e.lit, reduced);
    const c = sound.pluck;
    const env = shortEnvelope({ attack: c.attack, decay: c.decay }, reduced);
    for (const n of notes) {
      tone(vc, this.engine.at(n.at), {
        freq: n.freq,
        partials: [
          { type: 'sine', ratio: 1, db: 0 },
          { type: 'sine', ratio: 2, db: c.octaveLevel },
        ],
        level: c.level,
        ...env,
        pan: n.pan,
        send: sound.reverb.send,
      });
    }
  }

  /** Étoile filante : un souffle sifflé par arc, de l'étoile-guide vers le pôle, puis retour. */
  private shooting(e: Extract<SkyEvent, { type: 'shooting' }>): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.shooting;
    for (const seg of shootingSegments(e.legs, e.fromX, e.toX, e.reduced)) {
      const when = this.engine.at(seg.at);
      const pan = { from: seg.fromPan, to: seg.toPan, ms: seg.duration, ease: 'outQuart' as const };
      noise(vc, when, {
        level: c.level,
        filter: 'bandpass',
        q: c.q,
        fromHz: seg.fromHz,
        toHz: seg.toHz,
        freqEase: 'outQuart',
        duration: seg.duration,
        // sens réussi : le souffle naît et s'éteint avec l'arc ; sens qui échoue : il s'éteint au point d'arrêt
        shape: seg.fade == null ? 'arch' : 'hold',
        attack: seg.duration * 0.3,
        fade: seg.fade ?? 0,
        pan,
        send: sound.reverb.send,
      });
      tone(vc, when, {
        freq: c.toneHz,
        partials: [{ type: 'sine', ratio: 1, db: 0 }],
        level: c.toneLevel,
        attack: seg.duration * 0.4,
        decay: seg.duration * 0.6 + (seg.fade ?? 0),
        pan,
      });
    }
  }

  /** Or du gain : carillon, le seul son qui ne sert qu'à l'or. */
  private gain(gold: readonly { x: number; delay: number }[], reduced: boolean): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.gain;
    const [root, fifth] = c.notes;
    const env = shortEnvelope({ attack: c.attack, decay: c.decay }, reduced);
    for (const cue of planGainCues(gold, reduced)) {
      tone(vc, this.engine.at(cue.at), {
        freq: root,
        partials: [
          { type: 'sine', ratio: 1, db: 0 },
          { type: 'sine', ratio: fifth / root, db: 0 },
          { type: 'triangle', ratio: 2, db: c.octaveLevel },
        ],
        level: c.level,
        ...env,
        pan: cue.pan,
        send: c.send,
      });
    }
  }

  /* ---------------------------------------------------------------- interface */

  /** Halo : nappe frottée tenue jusqu'à la fin des arcs. */
  halo(arcs: number): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.halo;
    const r = this.reduced;
    pad(vc, this.engine.at(), {
      freqs: c.notes,
      level: c.level,
      attack: r ? sound.reducedAttack : c.attack,
      hold: r ? 0 : Math.max(0, haloHold(arcs) - c.attack),
      release: r ? motion.reduced - sound.reducedAttack : c.release,
      detuneCents: 3,
      send: sound.reverb.send,
    });
  }

  /** Panneau de preuve : un effleurement. */
  proof(): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.proof;
    noise(vc, this.engine.at(), { level: c.level, filter: 'highpass', q: 0.7, fromHz: c.highpass, duration: c.duration, shape: 'perc', attack: 2 });
  }

  /** Comparaison : un sinus qui se dédouble, la seconde voix glisse à la quinte. */
  compare(): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const c = sound.compare;
    const level = c.level - 3; // deux voix
    const when = this.engine.at();
    if (this.reduced) {
      for (const f of [c.root, c.fifth]) {
        tone(vc, when, { freq: f, partials: [{ type: 'sine', ratio: 1, db: 0 }], level, attack: sound.reducedAttack, decay: motion.reduced - sound.reducedAttack, send: sound.reverb.send });
      }
      return;
    }
    const base = { partials: [{ type: 'sine' as const, ratio: 1, db: 0 }], level, attack: 20, decay: c.glide + c.release, send: sound.reverb.send };
    tone(vc, when, { ...base, freq: c.root, pan: { from: 0, to: -c.spread, ms: c.glide, ease: 'outQuart' } });
    tone(vc, when, { ...base, freq: c.root, glideTo: c.fifth, glideMs: c.glide, glideEase: 'outQuart', pan: { from: 0, to: c.spread, ms: c.glide, ease: 'outQuart' } });
  }

  /** Carte miroir : glissade grave vers le territoire (aller) ou vers le ciel (retour), avec le vol. */
  mirror(direction: 'down' | 'up'): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay() || this.reduced) return; // mouvement réduit : fondu enchaîné, aucun son
    const c = sound.mirror;
    const [from, to] = direction === 'down' ? [c.highHz, c.lowHz] : [c.lowHz, c.highHz];
    // le vol commence après le retrait du décor (aller) ou du territoire (retour) : motion.ui
    const when = this.engine.at(motion.ui);
    tone(vc, when, {
      freq: from,
      partials: [{ type: 'sine', ratio: 1, db: 0 }],
      level: c.level,
      attack: mirrorMotion.flight * 0.3,
      decay: mirrorMotion.flight * 0.7,
      glideTo: to,
      glideMs: mirrorMotion.flight,
      glideEase: 'inOutSine',
      send: sound.reverb.send,
    });
    noise(vc, when, { level: c.level + c.noiseLevel, filter: 'lowpass', q: 0.5, fromHz: c.noiseLowpass, duration: mirrorMotion.flight, shape: 'arch', send: sound.reverb.send });
  }

  /** Jauge : un tic par cran visible, au plus un par `motion.scrubThrottle` ; tic double et doux sur un repère. */
  tick(fraction: number, onMark: boolean): void {
    const vc = this.engine.voice();
    if (!vc || !this.canPlay()) return;
    const now = performance.now();
    if (!throttleOk(this.lastTick, now, motion.scrubThrottle)) return;
    this.lastTick = now;
    const c = sound.tick;
    const f = tickFrequency(fraction);
    const one = (at: number, level: number) => {
      const when = this.engine.at(at);
      noise(vc, when, { level, filter: 'bandpass', q: c.q, fromHz: f, duration: c.noiseMs, shape: 'perc', attack: 1 });
      tone(vc, when, { freq: f, partials: [{ type: 'sine', ratio: 1, db: 0 }], level: level + c.toneLevel, attack: 1, decay: c.toneMs - 1 });
    };
    if (onMark) {
      one(0, c.markLevel);
      one(c.markGapMs, c.markLevel);
    } else one(0, c.level);
  }
}

/** Instance unique (un seul contexte audio par page). */
export const soundscape = new Soundscape();
