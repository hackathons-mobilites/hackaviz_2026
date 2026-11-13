/**
 * Nébuleuse - DÉCOR (images IA si présentes, sinon dégradés procéduraux).
 * Dérive très lente et parallaxe ≤ 2 px, désactivées en mouvement réduit.
 *
 * Le décor reste en retrait des données (critique v0.4, P0-04) : volutes discrètes, clairière large
 * derrière les pôles et vignette de bord. Les images v3 (IMG-15, IMG-16, IMG-18) n'ont plus de
 * bleu-vert : elles s'affichent sans teinte. Le repli v1 ou procédural garde la teinte qui tire le
 * bleu-vert vers l'ardoise lavande (le cyan est réservé à « accessible »). Sur un ciel neutre, aucun
 * pixel du décor ne doit être plus clair que le disque neutre le plus sombre.
 */
import { Container, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { ambient, pixiColor } from '../../theme/tokens';

/** Réglages du décor (tokens.ts `ambient`, critique v0.4 P0-04) ; la vignette est locale. */
export const decorLook = {
  clearingAlpha: ambient.clearingAlpha,
  clearingRadius: ambient.clearingRadius,
  /** Vignette étirée sur l'écran × 1,15, centrée (critique v0.4, P0-04) */
  vignetteScale: 1.15,
} as const;

/** Teinte et opacité du fond : neutres pour la v3, teinte anti bleu-vert pour le repli. */
export function deepLook(v3: boolean): { tint: number; alpha: number } {
  return v3
    ? { tint: ambient.deepTint, alpha: ambient.deepAlpha }
    : { tint: ambient.deepTintLegacy, alpha: ambient.deepAlphaLegacy };
}

/** Teinte des volutes : neutre pour la v3, teinte anti cyan pour le repli (même alpha). */
export function wispsTint(v3: boolean): number {
  return v3 ? ambient.wispsTint : ambient.wispsTintLegacy;
}

export interface NebulaTextures {
  deep: Texture;
  wisps: Texture;
  dust: Texture;
  /** true si la texture est une image v3 (sans bleu-vert : pas de teinte) */
  deepIsV3: boolean;
  wispsIsV3: boolean;
  /** Dégradé radial (assombrissement derrière les pôles) */
  clearing: Texture;
  /** Vignette de bord (assombrit les coins du décor) */
  vignette: Texture;
}

export class Nebula {
  readonly view = new Container();
  private deep: Sprite;
  private wisps: Sprite;
  private dust: TilingSprite;
  private clearing: Sprite;
  private vignette: Sprite;
  private width = 0;
  private height = 0;

  constructor(tex: NebulaTextures) {
    this.deep = new Sprite(tex.deep);
    this.applyDeepLook(tex.deepIsV3);
    this.wisps = new Sprite(tex.wisps);
    this.wisps.blendMode = 'add';
    this.wisps.alpha = ambient.wispsAlpha;
    this.wisps.tint = wispsTint(tex.wispsIsV3);
    this.dust = new TilingSprite({ texture: tex.dust, width: 16, height: 16 });
    this.dust.blendMode = 'add';
    this.dust.alpha = ambient.dustAlpha;
    this.dust.visible = ambient.dustAlpha > 0;
    this.clearing = new Sprite(tex.clearing);
    this.clearing.anchor.set(0.5);
    this.clearing.tint = pixiColor.bg;
    this.clearing.alpha = decorLook.clearingAlpha;
    this.vignette = new Sprite(tex.vignette);
    this.vignette.anchor.set(0.5);
    // ordre : fond, volutes, poussière, clairière, puis vignette (après la clairière)
    this.view.addChild(this.deep, this.wisps, this.dust, this.clearing, this.vignette);
    this.view.alpha = 0;
  }

  /**
   * Remplace l'image du fond (changement d'orientation ou écran plus grand) : seule la texture du
   * décor change ; aucune donnée n'est touchée. La couverture est recalculée pour l'écran courant.
   */
  setDeep(texture: Texture, v3: boolean): void {
    this.deep.texture = texture;
    this.applyDeepLook(v3);
    if (this.width) this.resize(this.width, this.height);
  }

  /** Remplace l'image des volutes (écran plus grand). */
  setWisps(texture: Texture, v3: boolean): void {
    this.wisps.texture = texture;
    this.wisps.tint = wispsTint(v3);
    if (this.width) this.resize(this.width, this.height);
  }

  private applyDeepLook(v3: boolean): void {
    const look = deepLook(v3);
    this.deep.tint = look.tint;
    this.deep.alpha = look.alpha;
  }

  /**
   * Clairière centrée sur l'emprise des pôles (px écran). `side` = plus petit côté du cadre du ciel :
   * le rayon vaut `side × clearingRadius`.
   */
  setClearing(cx: number, cy: number, side: number): void {
    this.clearing.position.set(cx, cy);
    this.clearing.width = this.clearing.height = side * decorLook.clearingRadius * 2;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const margin = ambient.parallax.nebula * 2 + 40;
    cover(this.deep, width + margin, height + margin);
    cover(this.wisps, width + margin, height + margin);
    this.dust.width = width;
    this.dust.height = height;
    this.vignette.position.set(width / 2, height / 2);
    this.vignette.width = width * decorLook.vignetteScale;
    this.vignette.height = height * decorLook.vignetteScale;
  }

  /**
   * `clock` = horloge d'ambiance (ms) : elle avance moins vite, puis s'arrête, pendant un silence ;
   * la dérive se fige donc sans saut de position.
   */
  update(clock: number, parallaxX: number, parallaxY: number, ambientOn: boolean): void {
    const t = clock / 1000;
    const driftX = ambientOn ? Math.sin(t * 0.021) * ambient.nebulaDrift * 8 : 0;
    const driftY = ambientOn ? Math.cos(t * 0.017) * ambient.nebulaDrift * 5 : 0;
    const px = ambientOn ? -parallaxX * ambient.parallax.nebula : 0;
    const py = ambientOn ? -parallaxY * ambient.parallax.nebula : 0;
    this.deep.x = (this.width - this.deep.width) / 2 + px + driftX * 0.5;
    this.deep.y = (this.height - this.deep.height) / 2 + py + driftY * 0.5;
    this.wisps.x = (this.width - this.wisps.width) / 2 + px * 1.5 - driftX;
    this.wisps.y = (this.height - this.wisps.height) / 2 + py * 1.5 - driftY;
    if (ambientOn && this.dust.visible) {
      this.dust.tilePosition.x = t * 1.2;
      this.dust.tilePosition.y = t * 0.6;
    }
  }
}

function cover(sprite: Sprite, w: number, h: number): void {
  const tw = sprite.texture.width;
  const th = sprite.texture.height;
  const s = Math.max(w / tw, h / th);
  sprite.scale.set(s);
}
