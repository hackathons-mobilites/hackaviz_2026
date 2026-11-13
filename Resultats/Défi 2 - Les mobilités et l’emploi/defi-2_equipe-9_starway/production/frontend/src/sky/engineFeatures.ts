/**
 * Fonctions du moteur pour la carte miroir et l'affiche, isolées de SkyEngine.ts (qui n'expose
 * qu'un contexte d'accès). Aucune logique métier : on déplace la VUE, jamais l'état d'un astre.
 *
 * Carte miroir (critique v0.4, spec a) : le décor se retire (280 ms outQuart), puis tous les astres et
 * l'étoile-guide glissent ensemble vers leur position géographique projetée (750 ms inOutSine),
 * rayon × mirror.discScale pour tous (l'aire reste ∝ postes). Retour : l'inverse.
 * Mouvement réduit : pas de vol, bascule immédiate (le fondu de 150 ms est porté par la carte SVG).
 */
import { animate, type JSAnimation } from 'animejs';
import { Rectangle, type Application, type Container } from 'pixi.js';
import { glyphScale, IDENTITY, type Camera } from '../state/camera';
import { mirror, motion } from '../theme/tokens';
import { registerEngineFeatures, type EngineFeatures, type MirrorTargets, type ScreenPoint, type SkySnapshot } from './featureBridge';
import type { PoleGeometry } from './layout';

export interface FeatureContext {
  app: Application;
  /** Conteneur des données (astres + étoile-guide, avec le bloom) */
  dataRoot: Container;
  /** Un conteneur par pôle, ordre de poles.json */
  poleRoots: () => readonly Container[];
  poleGeometry: () => readonly PoleGeometry[];
  guideView: Container;
  /** Position écran de l'étoile-guide sans caméra (null = aucune commune) */
  guideWorld: () => ScreenPoint | null;
  decor: Container[];
  camera: () => Camera;
  setCamera: (c: Camera) => void;
  reduced: () => boolean;
  clearShooting: () => void;
  setSnapshotMode: (enabled: boolean) => void;
}

type AnimParams = Parameters<typeof animate>[1];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class EngineFeaturesImpl implements EngineFeatures {
  private ctx: FeatureContext;
  private state = { t: 0, decor: 1, data: 1 };
  private targets: MirrorTargets | null = null;
  private running: JSAnimation | null = null;
  private token = 0;
  private active = false;
  private unregister: () => void;

  constructor(host: Element, ctx: FeatureContext) {
    this.ctx = ctx;
    this.unregister = registerEngineFeatures(host, this);
  }

  private cancel: (() => void) | null = null;

  /** Anime l'état ; résout false si une autre bascule a pris la main (jamais de promesse pendante). */
  private run(params: AnimParams, token: number): Promise<boolean> {
    this.running?.pause();
    this.cancel?.();
    return new Promise((resolve) => {
      this.cancel = () => resolve(false);
      this.running = animate(this.state, { ...params, onComplete: () => resolve(token === this.token) });
    });
  }

  private stop(): void {
    this.running?.pause();
    this.cancel?.();
    this.cancel = null;
  }

  async setMirror(targets: MirrorTargets | null): Promise<void> {
    const token = ++this.token;
    const reduced = this.ctx.reduced();
    this.active = true;
    if (targets) {
      this.targets = targets;
      this.ctx.clearShooting();
      if (reduced) {
        this.stop();
        this.state.t = 1;
        this.state.decor = mirror.skyDecorAlpha;
        return;
      }
      if (!(await this.run({ decor: mirror.skyDecorAlpha, duration: motion.ui, ease: motion.easing.ui }, token))) return;
      await this.run({ t: 1, duration: mirror.flight, ease: motion.easing.eclipse }, token);
      return;
    }
    if (reduced) {
      this.stop();
      this.state.t = 0;
      this.state.decor = 1;
    } else {
      if (!(await this.run({ t: 0, duration: mirror.flight, ease: motion.easing.eclipse }, token))) return;
      if (!(await this.run({ decor: 1, duration: mirror.territories, ease: motion.easing.ui }, token))) return;
    }
    if (token !== this.token) return;
    this.targets = null;
    this.active = false;
    this.restore();
  }

  async setMirrorHidden(hidden: boolean): Promise<void> {
    const token = ++this.token;
    this.active = true;
    this.targets = null;
    const to = { decor: hidden ? mirror.skyDecorAlpha : 1, data: hidden ? 0 : 1 };
    if (hidden) this.ctx.clearShooting();
    if (this.ctx.reduced()) {
      this.stop();
      Object.assign(this.state, to);
      this.tick();
    } else if (!(await this.run({ ...to, duration: hidden ? motion.ui : mirror.territories, ease: motion.easing.ui }, token))) return;
    if (hidden || token !== this.token) return;
    this.active = false;
    this.restore();
  }

  updateMirrorTargets(targets: MirrorTargets): void {
    if (this.targets) this.targets = targets;
  }

  /** Remet les astres à leur place du ciel (caméra courante). */
  private restore(): void {
    for (const d of this.ctx.decor) d.alpha = 1;
    this.ctx.guideView.renderable = true;
    this.state.data = 1;
    this.ctx.dataRoot.alpha = 1;
    this.ctx.setCamera(this.ctx.camera());
  }

  /** À chaque image, après le rendu des astres : position = ciel → carte selon t. */
  tick(): void {
    if (!this.active) return;
    const { t, decor, data } = this.state;
    for (const d of this.ctx.decor) d.alpha = decor;
    this.ctx.dataRoot.alpha = data;
    const tg = this.targets;
    if (!tg) return;
    const cam = this.ctx.camera();
    const g = glyphScale(cam.k);
    const scale = lerp(g, mirror.discScale, t);
    const geo = this.ctx.poleGeometry();
    this.ctx.poleRoots().forEach((root, i) => {
      const p = geo[i];
      const target = tg.poles[i];
      if (!p) return;
      const sx = cam.x + p.x * cam.k;
      const sy = cam.y + p.y * cam.k;
      root.position.set(target ? lerp(sx, target.x, t) : sx, target ? lerp(sy, target.y, t) : sy);
      root.scale.set(scale);
      // un pôle sans position géographique s'efface (jamais déplacé au hasard)
      root.visible = !!target || t < 0.5;
    });
    const w = this.ctx.guideWorld();
    if (w) {
      const sx = cam.x + w.x * cam.k;
      const sy = cam.y + w.y * cam.k;
      const target = tg.guide;
      this.ctx.guideView.position.set(target ? lerp(sx, target.x, t) : sx, target ? lerp(sy, target.y, t) : sy);
      this.ctx.guideView.scale.set(scale);
      // carte zoomée : hors du cadre, l'étoile-guide n'est pas dessinée (comme un pôle hors cadre)
      this.ctx.guideView.renderable = !(tg.guideOut && t >= 0.5);
    }
  }

  snapshot(resolution: number, pad: number): SkySnapshot | null {
    const { app, dataRoot } = this.ctx;
    const cam = this.ctx.camera();
    const wasActive = this.active;
    // Caméra neutre et vue « ciel » le temps de l'extraction (aucune image n'est affichée entre-temps)
    this.active = false;
    this.ctx.setCamera(IDENTITY);
    this.ctx.poleRoots().forEach((r) => (r.visible = true));
    try {
      const geo = this.ctx.poleGeometry();
      if (!geo.length) return null;
      const guide = this.ctx.guideWorld();
      const xs = geo.flatMap((p) => [p.x - p.r, p.x + p.r]).concat(guide ? [guide.x] : []);
      const ys = geo.flatMap((p) => [p.y - p.r, p.y + p.r]).concat(guide ? [guide.y] : []);
      const x0 = Math.floor(Math.min(...xs) - pad);
      const y0 = Math.floor(Math.min(...ys) - pad);
      const region = { x: x0, y: y0, w: Math.ceil(Math.max(...xs) + pad) - x0, h: Math.ceil(Math.max(...ys) + pad) - y0 };
      this.ctx.setSnapshotMode(true);
      const canvas = app.renderer.extract.canvas({
        target: dataRoot,
        frame: new Rectangle(region.x, region.y, region.w, region.h),
        resolution,
        clearColor: [0, 0, 0, 0],
        antialias: true,
      }) as HTMLCanvasElement;
      return { canvas, region, scale: resolution, poles: geo.map((p) => ({ x: p.x, y: p.y, r: p.r })), guide };
    } finally {
      this.ctx.setSnapshotMode(false);
      this.ctx.setCamera(cam);
      this.active = wasActive;
      this.tick();
    }
  }

  dispose(): void {
    this.stop();
    this.unregister();
  }
}
