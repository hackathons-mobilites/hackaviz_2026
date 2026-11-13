/**
 * Fond étoilé procédural - DÉCOR. Jamais cyan plein, toujours plus petit que le plus petit pôle,
 * aucune interaction, absent de la légende.
 */
import { Container, Particle, ParticleContainer, Texture } from 'pixi.js';
import { ambient, dust, skyLayout } from '../../theme/tokens';
import { mulberry32 } from '../../utils/rng';

const STAR_TINTS = [0xffffff, 0xffffff, 0xe6ecff, 0xcfd9ff, 0xfff1e0, 0xdcd3ff];
/** Rayon apparent du cœur du sprite softDot (32 px) */
const DOT_CORE = 5;
const MOBILE_WIDTH = 430;
const MOBILE_MAX_STARS = 1200;

interface StarData {
  particle: Particle;
  base: number;
  omega: number;
  phase: number;
  birth: number;
}

export class Starfield {
  readonly view = new Container();
  private planes: { container: ParticleContainer; depth: number; stars: StarData[] }[] = [];
  private opening = 1; // 1 = ouverture terminée
  private openingStart = 0;

  private texture: Texture;
  private maxStars: number = ambient.maxStars;

  constructor(texture: Texture) {
    this.texture = texture;
  }

  /** Plafond d'étoiles (rendu Canvas 2D sans GPU). Pris en compte au prochain `build`. */
  setMaxStars(n: number): void {
    this.maxStars = n;
  }

  build(width: number, height: number, seed = 42): void {
    this.view.removeChildren().forEach((c) => c.destroy());
    this.planes = [];
    const rnd = mulberry32(seed);
    // Mobile (critique v0.4, spec e) : 1 200 étoiles au plus sous 430 px de large
    const cap = Math.min(this.maxStars, width < MOBILE_WIDTH ? MOBILE_MAX_STARS : ambient.maxStars);
    const count = Math.min(cap, Math.round(((width * height) / 1e6) * ambient.starsPerMegapixel));
    const depths = [
      { depth: ambient.parallax.far, share: 0.62, rMax: 0.8 },
      { depth: (ambient.parallax.far + ambient.parallax.near) / 2, share: 0.3, rMax: 1.15 },
      { depth: ambient.parallax.near, share: 0.08, rMax: skyLayout.maxStarRadius },
    ];
    const pad = ambient.parallax.near * 2;
    this.buildDust(width, height, count, cap < ambient.maxStars);
    for (const d of depths) {
      const container = new ParticleContainer({
        texture: this.texture,
        dynamicProperties: { position: false, color: true, rotation: false, vertex: false, uvs: false },
      });
      container.blendMode = 'add';
      const stars: StarData[] = [];
      const n = Math.round(count * d.share);
      for (let i = 0; i < n; i++) {
        const r = 0.25 + Math.pow(rnd(), 2.2) * (d.rMax - 0.25);
        const scale = r / DOT_CORE;
        const particle = new Particle({
          texture: this.texture,
          x: -pad + rnd() * (width + pad * 2),
          y: -pad + rnd() * (height + pad * 2),
          scaleX: scale,
          scaleY: scale,
          anchorX: 0.5,
          anchorY: 0.5,
          tint: STAR_TINTS[Math.floor(rnd() * STAR_TINTS.length)]!,
          alpha: 0,
        });
        stars.push({
          particle,
          base: 0.25 + rnd() * 0.65,
          omega: ambient.twinkleOmegaMin + rnd() * (ambient.twinkleOmegaMax - ambient.twinkleOmegaMin),
          phase: rnd() * Math.PI * 2,
          birth: rnd(),
        });
        container.addParticle(particle);
      }
      this.view.addChild(container);
      this.planes.push({ container, depth: d.depth, stars });
    }
  }

  /**
   * Poussière cosmique en code (L-25, IMG-19 refusée : 1 690 points de plus de 2 x 2 px après deux
   * essais) : points de 1 px (texture blanche 1 x 1, jamais le sprite flou des étoiles), tirage à
   * graine fixe (`dust.seed` : même poussière à chaque visite pour une même fenêtre), positions
   * uniformes sans grille, fusion additive, alpha `dust.alphaMin` à `dust.alphaMax`. Statique : ni
   * scintillement ni parallaxe, donc rien à couper en mouvement réduit. Sous les étoiles, dans le budget
   * de points de fond ; absente en rendu Canvas 2D sans GPU (plafond réduit).
   */
  private buildDust(width: number, height: number, stars: number, lowPower: boolean): void {
    if (lowPower) return;
    const n = Math.max(0, Math.min(Math.round(dust.count * Math.min(1, (width * height) / dust.referenceArea)), dust.spriteBudget - stars));
    if (!n) return;
    const rnd = mulberry32(dust.seed);
    const container = new ParticleContainer({
      texture: Texture.WHITE,
      dynamicProperties: { position: false, color: false, rotation: false, vertex: false, uvs: false },
    });
    container.blendMode = 'add';
    const side = dust.radius * 2;
    const scale = side / Texture.WHITE.width;
    for (let i = 0; i < n; i++) {
      container.addParticle(
        new Particle({
          texture: Texture.WHITE,
          x: Math.floor(rnd() * width),
          y: Math.floor(rnd() * height),
          scaleX: scale,
          scaleY: scale,
          tint: dust.tint,
          alpha: dust.alphaMin + rnd() * (dust.alphaMax - dust.alphaMin),
        }),
      );
    }
    this.view.addChild(container);
  }

  /** Ouverture : les étoiles s'allument par vagues (durée totale `duration`). */
  startOpening(now: number): void {
    this.opening = 0;
    this.openingStart = now;
  }

  /**
   * `now` pilote l'ouverture ; `clock` (horloge d'ambiance, ms) pilote le scintillement : elle ralentit
   * puis s'arrête pendant un silence, donc les étoiles se figent sans saut d'intensité.
   */
  update(now: number, clock: number, parallaxX: number, parallaxY: number, ambientOn: boolean, openingDuration: number): void {
    const t = clock / 1000;
    if (this.opening < 1) this.opening = Math.min(1, (now - this.openingStart) / openingDuration);
    for (const plane of this.planes) {
      plane.container.x = ambientOn ? -parallaxX * plane.depth : 0;
      plane.container.y = ambientOn ? -parallaxY * plane.depth : 0;
      for (const s of plane.stars) {
        // Vagues : chaque étoile naît à `birth` × durée, en ~25 % de la durée
        const born = this.opening >= 1 ? 1 : clamp01((this.opening - s.birth * 0.75) / 0.25);
        const twinkle = ambientOn
          ? 1 - ambient.twinkleDepth + ambient.twinkleDepth * Math.sin(s.omega * t + s.phase)
          : 1;
        s.particle.alpha = s.base * twinkle * born;
      }
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
