/**
 * Halo v2 dans le ciel (D-025, L-08) : une ORBITE sans donnée autour de l'étoile-guide, cercle fin
 * lavande qui dit « le panneau parle de cette étoile ». Les arcs chiffrés ont quitté le ciel pour
 * l'astrolabe du panneau (components/HaloAstrolabe.tsx) : autour de l'étoile-guide, ils recouvraient
 * le contour d'état des pôles voisins (La Défense depuis Maisons-Laffitte) et le nom de la commune.
 * Naissance 280 ms outQuart ; mouvement réduit : fondu 150 ms. Rien ne bouge ensuite.
 */
import { animate } from 'animejs';
import { Container, Graphics } from 'pixi.js';
import type { HaloRing } from '../../data/halo';
import { guideLabel, haloOrbit, motion } from '../../theme/tokens';

export class Halo {
  readonly view = new Container();
  private g = new Graphics();
  private radius = 24;
  private open = false;
  private token = 0;

  constructor() {
    this.view.addChild(this.g);
    this.view.alpha = 0;
  }

  /** Taille de l'étoile-guide (px, espace de l'étoile) : rayon de l'orbite = guideLabel.orbitFactor × taille. */
  setGuideSize(size: number): void {
    this.radius = size * guideLabel.orbitFactor;
    this.draw();
  }

  /**
   * Ouvre (tableau, même vide : le panneau est ouvert) ou ferme (null) l'orbite. Les anneaux reçus ne
   * sont plus dessinés ici. Renvoie une promesse résolue à la fin du fondu.
   */
  async show(rings: HaloRing[] | null, reduced: boolean): Promise<void> {
    const token = ++this.token;
    const next = rings != null;
    if (next === this.open) return;
    this.open = next;
    this.draw();
    await animate(this.view, {
      alpha: next ? 1 : 0,
      duration: reduced ? motion.reduced : haloOrbit.appear,
      ease: reduced ? 'linear' : 'outQuart',
    }).then();
    if (token !== this.token) return;
  }

  private draw(): void {
    this.g.clear();
    this.g.circle(0, 0, this.radius).stroke({ width: haloOrbit.width, color: haloOrbit.color, alpha: haloOrbit.alpha });
  }
}
