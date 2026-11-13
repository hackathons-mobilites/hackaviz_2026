/**
 * Étoile filante : métaphore du trajet sélectionné (PAS un tracé géographique, ni un itinéraire).
 * Deux arcs qui dessinent une lentille (critique v0.4, spec f.2) :
 * - l'aller part de l'étoile-guide vers le pôle, arc AU-DESSUS de la corde ;
 * - après une pause sur le pôle, le retour revient sur l'arc miroir, AU-DESSOUS.
 * Un sens réussi laisse une trace fixe de 1 px tant que le pôle reste sélectionné ; un sens échoué
 * s'arrête (retour à 50 %, aller à 60 %) et sa queue se dissipe. La partie non parcourue n'est
 * jamais tracée.
 * Mouvement réduit : les arcs apparaissent en fondu (150 ms), trait plein pour un sens réussi,
 * pointillé 1-4 jusqu'au point d'arrêt pour un sens échoué.
 */
import { animate, type JSAnimation } from 'animejs';
import { Container, Graphics, MeshRope, Point, Sprite, type Texture } from 'pixi.js';
import { motion } from '../../theme/tokens';
import { arcControl, bezier, fx, shootingLegs, type Pt, type ShootingKind, type ShootingLeg } from '../transitions';

export type { ShootingKind } from '../transitions';

/** Échelle de la caméra au moment du tir : `k` (monde → écran) et `glyph` (taille des glyphes). */
export interface ShootingScale {
  k: number;
  glyph: number;
}

interface Live {
  anim: JSAnimation;
  resolve: (done: boolean) => void;
}

const S = fx.shooting;

export class ShootingStar {
  readonly view = new Container();
  /** Traces fixes (sens réussis) et arcs du mode réduit */
  private traces = new Graphics();
  /** Queue en MeshRope (WebGL / WebGPU) ; repli en Graphics pour le rendu Canvas 2D (pas de maillage) */
  private rope: MeshRope | null = null;
  private tailGfx: Graphics | null = null;
  private ropePts: Point[];
  private head: Sprite;
  private headIsImage: boolean;
  private token = 0;
  private live = new Set<Live>();
  private k = 1;

  constructor(headTex: Texture, headIsImage: boolean, tailTex: Texture | null) {
    this.headIsImage = headIsImage;
    this.head = new Sprite(headTex);
    this.head.anchor.set(0.5);
    this.head.blendMode = 'add';
    this.head.tint = headIsImage ? 0xffffff : S.color;
    this.head.visible = false;
    this.ropePts = Array.from({ length: S.tailPoints }, () => new Point());
    let tail: Container;
    if (tailTex) {
      this.rope = new MeshRope({ texture: tailTex, points: this.ropePts });
      tail = this.rope;
    } else {
      this.tailGfx = new Graphics();
      tail = this.tailGfx;
    }
    tail.tint = S.color;
    tail.blendMode = 'add';
    tail.visible = false;
    this.view.addChild(this.traces, tail, this.head);
  }

  /** Efface tout (changement de pôle, de commune, recadrage). Les animations en cours sont annulées. */
  clear(): void {
    this.token++;
    this.cancelAll();
    this.traces.clear();
    this.traces.alpha = 1;
    this.setTailVisible(false);
    this.head.visible = false;
  }

  private setTailVisible(v: boolean): void {
    if (this.rope) this.rope.visible = v;
    if (this.tailGfx) this.tailGfx.visible = v;
  }

  destroy(): void {
    this.clear();
    this.view.destroy({ children: true });
  }

  /**
   * Joue la filante de `from` (étoile-guide) à `to` (pôle), en coordonnées du calque « monde ».
   * Résout à la fin (ou immédiatement si une autre filante l'a remplacée).
   */
  async fire(from: Pt, to: Pt, kind: ShootingKind, reduced: boolean, scale: ShootingScale): Promise<void> {
    this.clear();
    const token = this.token;
    this.k = Math.max(1e-3, scale.k);
    const legs = shootingLegs(kind);
    const arcs = legs.map((l) => this.arcOf(l, from, to));

    if (reduced) {
      arcs.forEach(([a, c, b], i) => {
        const leg = legs[i]!;
        if (leg.ok) solid(this.traces, a, c, b, 0, leg.end, 1.25 / this.k, S.color, 0.75);
        else dotted(this.traces, a, c, b, leg.end, 1.25 / this.k, S.color, 0.75, this.k);
      });
      this.traces.alpha = 0;
      await this.run(motion.reduced, 'linear', (u) => (this.traces.alpha = u));
      return;
    }

    // Taille apparente de la tête : 14 px écran (le sprite IA porte un halo autour du cœur)
    const headScreen = S.headPx * (this.headIsImage ? 3 : 2) * scale.glyph;
    this.head.width = this.head.height = headScreen / this.k;
    this.rope?.scale.set(1 / this.k);

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;
      const [a, c, b] = arcs[i]!;
      // 1. la tête parcourt l'arc jusqu'à `end` (outQuart), la trace fixe la suit si le sens réussit
      const ok = await this.run(S.leg * Math.max(0.5, leg.end), 'outQuart', (u) => {
        const t = u * leg.end;
        this.drawTail(a, c, b, t, S.tailFraction, 1);
        if (leg.ok) {
          this.traces.clear();
          for (let j = 0; j < i; j++) {
            const [pa, pc, pb] = arcs[j]!;
            if (legs[j]!.ok) solid(this.traces, pa, pc, pb, 0, 1, 1 / this.k, S.color, S.traceAlpha);
          }
          solid(this.traces, a, c, b, 0, t, 1 / this.k, S.color, S.traceAlpha);
        }
      });
      if (!ok || token !== this.token) return;

      if (!leg.ok) {
        // 2a. sens échoué : la queue se rétracte vers la tête et se dissipe (400 ms)
        await this.run(S.failFade, 'outQuad', (u) => this.drawTail(a, c, b, leg.end, S.tailFraction * (1 - u), 1 - u));
        break;
      }
      // 2b. sens réussi : la queue se résorbe dans le pôle (ou l'étoile-guide) pendant la pause
      const last = i === legs.length - 1;
      const ok2 = await this.run(last ? motion.ui : S.pause, 'outQuad', (u) =>
        this.drawTail(a, c, b, 1, S.tailFraction * (1 - u), last ? 1 - u : 1),
      );
      if (!ok2 || token !== this.token) return;
    }
    if (token === this.token) {
      this.setTailVisible(false);
      this.head.visible = false;
    }
  }

  /** Arc d'un sens : aller au-dessus de la corde guide → pôle, retour au-dessous, pôle → guide. */
  private arcOf(leg: ShootingLeg, from: Pt, to: Pt): [Pt, Pt, Pt] {
    return leg.dir === 'out' ? [from, arcControl(from, to, 'above'), to] : [to, arcControl(from, to, 'below'), from];
  }

  /** Queue (MeshRope, coordonnées ×k pour garder une épaisseur constante à l'écran) et tête. */
  private drawTail(a: Pt, c: Pt, b: Pt, t: number, length: number, alpha: number): void {
    const t0 = Math.max(0, t - length);
    const n = this.ropePts.length;
    const k = this.k;
    for (let i = 0; i < n; i++) {
      const u = t0 + ((t - t0) * i) / (n - 1);
      const p = bezier(a, c, b, u);
      this.ropePts[i]!.set(p.x * k, p.y * k);
    }
    // corde trop courte : la géométrie du ruban dégénère, on masque la queue
    const visible = t - t0 > 1e-3 && alpha > 0.02;
    if (this.rope) {
      this.rope.visible = visible;
      this.rope.alpha = alpha;
    } else if (this.tailGfx) {
      // repli Canvas 2D : segments dont l'épaisseur décroît de la tête à la queue
      const g = this.tailGfx.clear();
      for (let i = 1; i < n && visible; i++) {
        const a0 = this.ropePts[i - 1]!;
        const a1 = this.ropePts[i]!;
        const w = (S.tailWidth * i) / (n - 1);
        g.moveTo(a0.x / k, a0.y / k).lineTo(a1.x / k, a1.y / k).stroke({ width: w / k, color: 0xffffff, alpha: (i / (n - 1)) ** 2 });
      }
      this.tailGfx.visible = visible;
      this.tailGfx.alpha = alpha;
    }
    const h = bezier(a, c, b, t);
    // tangente : la tête (sprite orienté vers la droite) suit le sens du trajet
    const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
    const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
    this.head.position.set(h.x, h.y);
    this.head.rotation = Math.atan2(dy, dx);
    this.head.alpha = alpha;
    this.head.visible = alpha > 0.02;
  }

  /** anime.js, avec une promesse qui résout aussi si l'animation est annulée (false). */
  private run(duration: number, ease: string, onUpdate: (u: number) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const p = { u: 0 };
      const entry: Live = {
        resolve,
        anim: animate(p, {
          u: 1,
          duration: Math.max(1, duration),
          ease,
          onUpdate: () => onUpdate(p.u),
          onComplete: () => {
            onUpdate(1);
            this.live.delete(entry);
            resolve(true);
          },
        }),
      };
      this.live.add(entry);
    });
  }

  private cancelAll(): void {
    for (const e of this.live) {
      e.anim.cancel();
      e.resolve(false);
    }
    this.live.clear();
  }
}

const SAMPLES = 48;

function solid(g: Graphics, a: Pt, c: Pt, b: Pt, t0: number, t1: number, width: number, color: number, alpha: number): void {
  if (t1 - t0 <= 1e-4) return;
  const n = Math.max(2, Math.ceil(SAMPLES * (t1 - t0)));
  const p0 = bezier(a, c, b, t0);
  g.moveTo(p0.x, p0.y);
  for (let i = 1; i <= n; i++) {
    const p = bezier(a, c, b, t0 + ((t1 - t0) * i) / n);
    g.lineTo(p.x, p.y);
  }
  g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
}

/** Pointillé « 1 4 » (px écran) jusqu'au point d'arrêt. */
function dotted(g: Graphics, a: Pt, c: Pt, b: Pt, t1: number, width: number, color: number, alpha: number, k: number): void {
  // longueur approchée de l'arc parcouru, en px écran
  let len = 0;
  let prev = bezier(a, c, b, 0);
  for (let i = 1; i <= SAMPLES; i++) {
    const p = bezier(a, c, b, (t1 * i) / SAMPLES);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const period = 5 / k;
  const count = Math.max(1, Math.floor(len / period));
  for (let i = 0; i <= count; i++) {
    const p = bezier(a, c, b, (t1 * i) / count);
    g.circle(p.x, p.y, width * 0.6);
  }
  g.fill({ color, alpha });
}
