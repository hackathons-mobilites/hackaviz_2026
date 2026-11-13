/**
 * Étoile-guide : la commune de résidence choisie. Repère chaud, forme d'éclat (≠ disque des pôles).
 * Naissance scale 0 → 1 (outBack) et une seule pulsation de halo. Aucune animation continue.
 */
import { animate, type JSAnimation } from 'animejs';
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { motion, pixiColor, skyLayout } from '../../theme/tokens';
import { Halo } from './Halo';
import { OutlineOverlay } from '../OutlineOverlay';

export class GuideStar {
  readonly view = new Container();
  /** Halo « Derrière notre étoile », solidaire de l'étoile-guide */
  readonly halo = new Halo();
  private flare: Sprite;
  private glow: Sprite;
  private pulse: Graphics;
  private socket: Graphics;
  /**
   * Socle couleur fond (disque plein + liseré) sous l'éclat : l'éclat est en fusion additive, il
   * disparaîtrait sur un astre allumé ; posé sur ce socle, il reste visible partout (au-dessus des astres).
   */
  private outline: Graphics;
  private state = { scale: 0, alpha: 0, pulse: 1 };
  private placeGen = 0;
  private anims: JSAnimation[] = [];
  private size = 0;
  private outlines: OutlineOverlay;
  private world = { x: 0, y: 0 };
  private cam = { k: 1, x: 0, y: 0 };
  private glyph = 1;
  private svgOutlines = true;

  constructor(flareTex: Texture, glowTex: Texture, flareIsImage: boolean, outlines: OutlineOverlay) {
    this.outlines = outlines;
    this.glow = new Sprite(glowTex);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = pixiColor.guide;
    this.flare = new Sprite(flareTex);
    this.flare.anchor.set(0.5);
    this.flare.blendMode = 'add';
    if (!flareIsImage) this.flare.tint = pixiColor.guide;
    this.pulse = new Graphics();
    // rayon 12 × guideSocket à l'échelle 1 ; mis à l'échelle de l'étoile dans render()
    const R = 12 * skyLayout.guideSocket;
    // Le socle reste sous l'éclat dans Pixi ; un disque SVG le masquerait au-dessus du canvas.
    this.socket = new Graphics()
      .circle(0, 0, R)
      .fill({ color: pixiColor.bg, alpha: skyLayout.guideSocketAlpha });
    this.outline = new Graphics()
      .circle(0, 0, R)
      .stroke({ width: 2, color: pixiColor.bg, alpha: 0.9 });
    // Ordre de dessin : halo, lueur, pulsation, socle, éclat (l'éclat est toujours au-dessus)
    this.view.addChild(this.halo.view, this.glow, this.pulse, this.socket, this.outline, this.flare);
    this.view.visible = false;
  }

  /** Taille de référence (px) selon l'écran. */
  setCamera(cam: { k: number; x: number; y: number }, glyph: number): void {
    this.cam = cam;
    this.glyph = glyph;
    this.applyPosition();
  }

  setWorldPosition(pos: { x: number; y: number }): void {
    this.world = pos;
    this.applyPosition();
  }

  private applyPosition(): void {
    this.view.position.set(this.cam.x + this.world.x * this.cam.k, this.cam.y + this.world.y * this.cam.k);
    this.view.scale.set(this.glyph);
  }

  setSize(size: number): void {
    this.size = size;
    this.halo.setGuideSize(size);
  }

  setSvgOutlines(enabled: boolean): void {
    this.svgOutlines = enabled;
    this.render();
  }

  syncOutlineTransform(): void {
    this.outlines.updateGuide(
      this.view.position.x,
      this.view.position.y,
      this.view.scale.x,
      this.view.visible && this.view.renderable,
      this.state.alpha,
      Math.max(0.01, (this.size / 12) * this.state.scale),
      this.size * (0.4 + this.state.pulse * 1.6),
      this.state.pulse < 1 ? (1 - this.state.pulse) * 0.7 * this.state.alpha : 0,
    );
  }

  /** Place l'étoile-guide ; naissance animée si `animateBirth`. */
  async place(pos: { x: number; y: number } | null, reduced: boolean): Promise<void> {
    // Changements de commune rapprochés (retour de Nicolas du 03/11, « on n'a que le nom ») : chaque
    // appel arrête les animations du précédent, et seul le dernier touche l'état après une attente.
    // Sans cela, un effacement plus ancien continuait de pousser l'opacité vers 0 après la naissance.
    const gen = ++this.placeGen;
    for (const a of this.anims) a.pause();
    this.anims = [];
    const run = (params: Parameters<typeof animate>[1]) => {
      const a = animate(this.state, params);
      this.anims.push(a);
      return a;
    };
    if (!pos) {
      await run({ alpha: 0, duration: reduced ? motion.reduced : motion.ui, ease: 'outQuad' }).then();
      if (gen === this.placeGen) this.view.visible = false;
      return;
    }
    const wasVisible = this.view.visible && this.state.alpha > 0.5;
    if (wasVisible) {
      await run({ alpha: 0, scale: 0.6, duration: reduced ? motion.reduced : motion.ui, ease: 'inQuad' }).then();
      if (gen !== this.placeGen) return;
    }
    this.setWorldPosition(pos);
    this.view.visible = true;
    if (reduced) {
      this.state.scale = 1;
      this.state.pulse = 1;
      await run({ alpha: 1, duration: motion.reduced, ease: 'linear' }).then();
      return;
    }
    this.state.scale = 0;
    this.state.alpha = 1;
    this.state.pulse = 0;
    run({ pulse: 1, duration: motion.guideBirth * 1.6, ease: 'outQuad', delay: motion.guideBirth * 0.4 });
    await run({ scale: 1, duration: motion.guideBirth, ease: motion.easing.birth }).then();
  }

  render(): void {
    const { scale, alpha, pulse } = this.state;
    const s = this.size;
    this.flare.width = this.flare.height = s * 2.2 * scale;
    this.glow.width = this.glow.height = s * 3.2 * scale;
    this.flare.alpha = alpha;
    this.socket.alpha = alpha;
    this.socket.scale.set(Math.max(0.01, (s / 12) * scale));
    this.outline.alpha = alpha * (this.svgOutlines ? 0 : 1);
    this.outline.scale.set(Math.max(0.01, (s / 12) * scale));
    this.glow.alpha = 0.55 * alpha;
    this.pulse.clear();
    if (pulse < 1) {
      this.pulse
        .circle(0, 0, s * (0.4 + pulse * 1.6))
        .stroke({ width: 2, color: pixiColor.guide, alpha: (1 - pulse) * 0.7 * alpha * (this.svgOutlines ? 0 : 1) });
    }
    this.syncOutlineTransform();
  }
}
