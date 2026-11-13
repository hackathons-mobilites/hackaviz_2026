/**
 * Voiles - DÉCOR, aucun ne porte de donnée.
 *
 * 1. `Veil` : voile d'éclipse (acte 2). Il traverse le ciel pendant un changement de journée-type,
 *    dans le sens du sélecteur (plus tardive : de gauche à droite ; plus matinale : de droite à
 *    gauche). Les astres qui changent réellement d'état basculent quand son front les croise.
 *    Il n'est joué que si au moins un pôle bascule (SkyEngine) : sinon, rien ne bouge.
 *
 * 2. `SilenceVeils` : « le silence comme effet ». Autour de chaque pôle PERDU, un dégradé radial
 *    couleur fond, posé SOUS le disque, assombrit passagèrement le décor (alpha 0 → 0,35 → 0).
 *    Le disque, lui, ne fait que sa transition d'état réelle.
 */
import { animate, type JSAnimation } from 'animejs';
import { Container, Sprite, type Texture } from 'pixi.js';
import { eclipse, motion, pixiColor } from '../../theme/tokens';
import type { PoleGeometry } from '../layout';
import { fx, type EclipseDirection } from '../transitions';

export class Veil {
  readonly view: Sprite;
  private peakAlpha: number;
  private width = 0;
  private anim: JSAnimation | null = null;
  private done: (() => void) | null = null;

  constructor(tex: Texture, isImage: boolean) {
    this.view = new Sprite(tex);
    // ancre au centre : le retournement horizontal (sens droite → gauche) garde le front devant
    this.view.anchor.set(0.5, 0);
    this.view.visible = false;
    this.peakAlpha = isImage ? eclipse.veilAlpha : eclipse.fallbackVeilAlpha;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.view.scale.set(1);
    this.view.width = width * eclipse.veilWidth;
    this.view.height = height;
  }

  /** Largeur du voile (px), utile pour synchroniser les bascules. */
  get veilWidth(): number {
    return Math.abs(this.view.width);
  }

  /**
   * Passage du voile, 750 ms `inOutSine`. `direction` 1 = de gauche à droite, -1 = de droite à gauche.
   * Le front (liseré clair de la texture) est toujours devant.
   */
  sweep(direction: EclipseDirection = 1): Promise<void> {
    this.stop();
    const v = this.view;
    const w = this.veilWidth;
    v.scale.x = Math.abs(v.scale.x) * direction;
    v.visible = true;
    v.alpha = 0;
    const startX = direction === 1 ? -w / 2 : this.width + w / 2;
    const span = (this.width + w) * direction;
    v.x = startX;
    const p = { t: 0 };
    return new Promise((resolve) => {
      const finish = () => {
        v.visible = false;
        this.anim = null;
        this.done = null;
        resolve();
      };
      this.done = finish;
      this.anim = animate(p, {
        t: 1,
        duration: motion.eclipse,
        ease: motion.easing.eclipse,
        onUpdate: () => {
          v.x = startX + span * p.t;
          // apparition / retrait du voile aux extrémités
          v.alpha = this.peakAlpha * Math.min(1, Math.sin(Math.PI * p.t) * 1.6);
        },
        onComplete: finish,
      });
    });
  }

  /** Interrompt un passage en cours (destruction, nouveau passage). */
  stop(): void {
    this.anim?.cancel();
    this.done?.();
  }

  destroy(): void {
    this.stop();
  }
}

export class SilenceVeils {
  readonly view = new Container();
  private sprites: Sprite[] = [];
  private geo: PoleGeometry[] = [];
  private anims: JSAnimation[] = [];
  private tex: Texture;

  constructor(glowTex: Texture) {
    this.tex = glowTex;
  }

  /** Un dégradé par pôle, aux positions fixes du ciel (rayon 2,2 × r). Invisible au repos. */
  build(geometry: readonly PoleGeometry[]): void {
    this.stop();
    this.view.removeChildren().forEach((c) => c.destroy());
    this.geo = [...geometry];
    this.sprites = geometry.map((g) => {
      const s = new Sprite(this.tex);
      s.anchor.set(0.5);
      s.tint = pixiColor.bg;
      s.alpha = 0;
      s.visible = false;
      // glowTexture : rayon utile = moitié du côté
      s.width = s.height = g.r * fx.silence.dimRadius * 2;
      this.view.addChild(s);
      return s;
    });
  }

  /** Même caméra que les astres : positions ×k, glyphes ×glyph. */
  setCamera(cam: { k: number; x: number; y: number }, glyph: number): void {
    this.sprites.forEach((s, i) => {
      const g = this.geo[i]!;
      s.position.set(cam.x + g.x * cam.k, cam.y + g.y * cam.k);
      s.scale.set((g.r * fx.silence.dimRadius * 2 * glyph) / this.tex.width);
    });
  }

  /**
   * Atténuation passagère autour des pôles perdus. `delays[i]` = instant (ms) où le pôle bascule
   * réellement (synchronisé avec le voile d'éclipse ou le décalage d'allumage).
   * Renvoie la durée totale (ms).
   */
  play(indices: readonly number[], delays: ReadonlyMap<number, number>): number {
    const d = fx.silence;
    let end = 0;
    for (const i of indices) {
      const s = this.sprites[i];
      if (!s) continue;
      const delay = delays.get(i) ?? 0;
      s.visible = true;
      s.alpha = 0;
      const p = { u: 0 };
      this.anims.push(
        animate(p, {
          u: 1,
          delay,
          duration: d.dimDuration,
          ease: motion.easing.eclipse,
          // 0 → 0,35 → 0 : l'atténuation ne dure que le temps de la bascule
          onUpdate: () => (s.alpha = d.dimAlpha * Math.sin(Math.PI * p.u)),
          onComplete: () => {
            s.alpha = 0;
            s.visible = false;
          },
        }),
      );
      end = Math.max(end, delay + d.dimDuration);
    }
    return end;
  }

  stop(): void {
    this.anims.forEach((a) => a.cancel());
    this.anims = [];
    this.sprites.forEach((s) => {
      s.alpha = 0;
      s.visible = false;
    });
  }

  destroy(): void {
    this.stop();
    this.view.destroy({ children: true });
  }
}
