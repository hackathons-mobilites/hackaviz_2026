/**
 * Astres de données : un pôle d'emploi = un disque dont l'AIRE ∝ postes salariés (INSEE).
 * Positions et rayons fixes (layout.ts). Seules la lumière, la couleur et l'opacité s'animent.
 * La couleur n'est jamais seule : contour plein (accessible) / tirets (hors budget) / moitié haute pleine et
 * moitié basse en tirets (aller possible, retour hors budget) / pointillé fin (sans donnée).
 *
 * Table OD (D-019) : un astre s'éclaire EN PARTIE. Le disque garde son aire (postes du pôle) en
 * gris-bleu ; un cœur cyan concentrique a l'aire des postes atteints (rayon r x racine de la part) ;
 * le contour suit la part (arc plein sur la fraction atteinte depuis midi, creux pour la commune
 * d'origine, points pour le non calculé, tirets pour le reste). Quand la part change, l'ancien cœur
 * s'efface pendant que le nouveau apparaît (fondu enchaîné) : jamais une croissance ni un déplacement.
 */
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { PartRing } from '../../data/od/sky';
import { gainMark, motion, pixiColor, poleLook } from '../../theme/tokens';
import { DISC_SIZE } from '../textures';
import { OutlineOverlay } from '../OutlineOverlay';
import type { PoleGeometry } from '../layout';

interface PoleAnim {
  /** 0 = éteint (gris-bleu), 1 = accessible (cyan) */
  light: number;
  /** 0 = sans donnée, 1 = calculé */
  known: number;
  /** apparition à l'ouverture */
  appear: number;
  /** 1 = ciel neutre */
  neutral: number;
  /** 1 = aller possible, retour hors budget (forme du contour seulement, jamais la lumière) */
  outOnly: number;
  /**
   * 1 = gain démontré (or) : accessible aller ET retour dans le scénario complémentaire et pas dans
   * le scénario de référence. Piloté UNIQUEMENT par SkyEngine.showGain / clearGain ; n'agit que sur un
   * pôle allumé (multiplié par `light`) : l'or ne peut jamais apparaître sur un pôle hors budget.
   */
  gain: number;
  /** 1 = astre lu en part (table OD) : la lumière passe au cœur d'aire proportionnelle aux postes atteints */
  od: number;
  /** Fractions du cœur et du contour (table OD), posées sans interpolation ; null hors table OD */
  part: PartRing | null;
}

/** Un cœur cyan et son contour, pour une part donnée (deux emplacements : fondu enchaîné). */
interface PartSlot {
  root: Container;
  core: Sprite;
  /** Arc plein de la fraction atteinte (teinté cyan comme l'orbite d'un pôle accessible) */
  lit: Graphics;
  /** Reste du contour : creux (commune d'origine), points (non calculé), tirets (non atteint) */
  rest: Graphics;
  part: PartRing | null;
}

interface PoleVisual {
  geo: PoleGeometry;
  root: Container;
  glow: Sprite;
  core: Sprite;
  ringOn: Graphics;
  ringOff: Graphics;
  ringOutOnly: Graphics;
  ringUnknown: Graphics;
  /** Seconde orbite fine des pôles dorés (gainMark) : « un anneau de plus = un gain », pas la seule couleur */
  ringGain: Graphics;
  specular: Sprite;
  focus: Graphics;
  anim: PoleAnim;
  highlight: number;
  selected: boolean;
  slots: [PartSlot, PartSlot];
  /** Emplacement de la part affichée (l'autre s'efface) */
  front: 0 | 1;
  /** Début du fondu enchaîné (performance.now), 0 = aucun */
  fadeStart: number;
}

export class Poles {
  readonly view = new Container();
  private visuals: PoleVisual[] = [];
  private highlighted: number | null = null;

  private discTex: Texture;
  private glowTex: Texture;
  private dotTex: Texture;
  private reduced = false;
  /** Or du gain affiché : normal ou ambre (mode daltonien, theme/palette.ts) ; seule la couleur change */
  private gainColor: number = pixiColor.gain;

  /** Palette du mode daltonien : prise en compte à l'image suivante, sans transition. */
  setGainColor(gain: number): void {
    this.gainColor = gain;
  }

  /** Mouvement réduit : fondu enchaîné du cœur en `motion.reduced`. */
  setReduced(reduced: boolean): void {
    this.reduced = reduced;
  }
  private svgOutlines = true;
  private outlines: OutlineOverlay;

  constructor(discTex: Texture, glowTex: Texture, dotTex: Texture, outlines: OutlineOverlay) {
    this.outlines = outlines;
    this.discTex = discTex;
    this.glowTex = glowTex;
    this.dotTex = dotTex;
  }

  /** (Re)construit les astres à leurs positions fixes. Conserve l'état lumineux courant. */
  build(geometry: PoleGeometry[]): void {
    const previous = this.visuals.map((v) => v.anim);
    this.view.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.visuals = geometry.map((geo, i) => {
      const root = new Container();
      root.position.set(geo.x, geo.y);

      const glow = new Sprite(this.glowTex);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      const glowR = geo.r * poleLook.glowScale;
      glow.width = glow.height = glowR * 2;

      const core = new Sprite(this.discTex);
      core.anchor.set(0.5);
      // Le disque de la texture a un rayon DISC_SIZE/2 − 2 : on cale ce rayon sur geo.r.
      core.width = core.height = (2 * geo.r * DISC_SIZE) / (DISC_SIZE - 4);

      const R = geo.r + poleLook.ringGap;
      // trait blanc teinté au rendu : cyan (accessible) ou or (gain démontré), même forme pleine
      const ringOn = new Graphics().circle(0, 0, R).stroke({ width: poleLook.ringWidth, color: pixiColor.white, alpha: 1 });
      const circ = 2 * Math.PI * R;
      const dashes = Math.max(8, Math.round(circ / poleLook.dashPeriod));
      const ringOff = dashedCircle(R, dashes, 0.55, pixiColor.dimRing, poleLook.ringOffWidth, 1);
      // Aller possible, retour hors budget : moitié haute pleine (l'aller, au-dessus comme l'arc aller de
      // la filante), moitié basse en tirets (le retour). Même couleur et même épaisseur que « hors budget ».
      const ringOutOnly = new Graphics()
        .moveTo(-R, 0)
        .arc(0, 0, R, Math.PI, Math.PI * 2)
        .stroke({ width: poleLook.ringOffWidth, color: pixiColor.dimRing, alpha: 1 });
      dashedArc(ringOutOnly, R, 0, Math.PI, Math.max(4, Math.round(dashes / 2)), 0.55);
      ringOutOnly.stroke({ width: poleLook.ringOffWidth, color: pixiColor.dimRing, alpha: 1 });
      const ringUnknown = dashedCircle(
        R,
        Math.max(10, Math.round(circ / poleLook.unknownDotPeriod)),
        poleLook.unknownDotFill,
        pixiColor.dimRing,
        poleLook.unknownDotWidth,
        0.9,
      );
      const ringGain = new Graphics()
        .circle(0, 0, R + gainMark.gap)
        .stroke({ width: gainMark.width, color: pixiColor.white, alpha: 1 });
      ringGain.alpha = 0;
      const focus = new Graphics()
        .circle(0, 0, R + 6)
        .stroke({ width: 2, color: pixiColor.accent, alpha: 1 });
      focus.alpha = 0;

      // Reflet spéculaire identique pour tous les pôles allumés
      const specular = new Sprite(this.dotTex);
      specular.anchor.set(0.5);
      specular.blendMode = 'add';
      specular.width = specular.height = 0.9 * geo.r;
      specular.position.set(-0.3 * geo.r, -0.34 * geo.r);
      specular.alpha = 0;
      const slots: [PartSlot, PartSlot] = [this.makeSlot(), this.makeSlot()];
      root.addChild(glow, core, slots[0].root, slots[1].root, specular, ringOff, ringOutOnly, ringUnknown, ringOn, ringGain, focus);
      this.view.addChild(root);
      const anim = previous[i] ?? { light: 0, known: 0, appear: 0, neutral: 1, gain: 0, outOnly: 0, od: 0, part: null };
      const visual: PoleVisual = {
        geo,
        root,
        glow,
        core,
        specular,
        ringOn,
        ringOff,
        ringOutOnly,
        ringUnknown,
        ringGain,
        focus,
        anim,
        highlight: 0,
        selected: false,
        slots,
        front: 0,
        fadeStart: 0,
      };
      // reconstruction (redimensionnement) : la part courante est retracée sans fondu
      if (anim.part) this.drawSlot(visual, slots[0], anim.part);
      return visual;
    });
    this.outlines.buildPoles(geometry);
    this.render();
  }

  private makeSlot(): PartSlot {
    const root = new Container();
    const core = new Sprite(this.discTex);
    core.anchor.set(0.5);
    core.visible = false;
    const lit = new Graphics();
    const rest = new Graphics();
    root.addChild(core, rest, lit);
    root.alpha = 0;
    root.visible = false;
    return { root, core, lit, rest, part: null };
  }

  /** Trace un emplacement pour une part : cœur d'aire proportionnelle aux postes atteints, contour qui suit la part. */
  private drawSlot(v: PoleVisual, slot: PartSlot, part: PartRing): void {
    slot.part = part;
    const r = v.geo.r * Math.sqrt(part.reached);
    slot.core.visible = r > 0;
    // même calage de texture que le disque principal (rayon du disque de la texture = DISC_SIZE/2 - 2)
    slot.core.width = slot.core.height = (2 * r * DISC_SIZE) / (DISC_SIZE - 4);
    const R = v.geo.r + poleLook.ringGap;
    slot.lit.clear();
    slot.rest.clear();
    const turn = Math.PI * 2;
    let a = -Math.PI / 2;
    if (part.reached > 0) {
      const b = a + part.reached * turn;
      slot.lit.moveTo(Math.cos(a) * R, Math.sin(a) * R).arc(0, 0, R, a, b);
      slot.lit.stroke({ width: poleLook.ringWidth, color: pixiColor.white, alpha: 1 });
      a = b;
    }
    // commune d'origine : creux (ni cyan ni gris), rien n'est tracé
    a += part.self * turn;
    const circ = turn * R;
    if (part.unknown > 0) {
      const b = a + part.unknown * turn;
      dashedArc(slot.rest, R, a, b, Math.max(1, Math.round((part.unknown * circ) / poleLook.unknownDotPeriod)), poleLook.unknownDotFill);
      slot.rest.stroke({ width: poleLook.unknownDotWidth, color: pixiColor.dimRing, alpha: 0.9 });
      a = b;
    }
    if (part.rest > 0) {
      const b = a + part.rest * turn;
      dashedArc(slot.rest, R, a, b, Math.max(1, Math.round((part.rest * circ) / poleLook.dashPeriod)), 0.55);
      slot.rest.stroke({ width: poleLook.ringOffWidth, color: pixiColor.dimRing, alpha: 1 });
    }
  }

  /** Nouvelle part : tracée dans l'emplacement caché, qui passe devant ; le fondu enchaîné démarre. */
  private syncPart(v: PoleVisual, now: number): void {
    const target = v.anim.part;
    const shown = v.slots[v.front].part;
    if (!target || target === shown) return;
    const back = (1 - v.front) as 0 | 1;
    this.drawSlot(v, v.slots[back], target);
    // premier tracé (aucune part montrée) : pas de fondu, la lumière (`light`, `od`) fait l'apparition
    v.fadeStart = shown ? now : 0;
    if (!shown) v.slots[v.front].part = null;
    v.front = back;
  }

  /** Caméra : positions ×k, glyphes ×glyph (même facteur pour tous). */
  setCamera(cam: { k: number; x: number; y: number }, glyph: number): void {
    for (const v of this.visuals) {
      v.root.position.set(cam.x + v.geo.x * cam.k, cam.y + v.geo.y * cam.k);
      v.root.scale.set(glyph);
    }
  }

  /** Objets animables (anime.js) - un par pôle, même ordre que poles.json. */
  animTargets(): PoleAnim[] {
    return this.visuals.map((v) => v.anim);
  }

  geometry(): PoleGeometry[] {
    return this.visuals.map((v) => v.geo);
  }

  setHighlighted(index: number | null): void {
    this.highlighted = index;
  }

  setSelected(index: number | null): void {
    this.visuals.forEach((v, i) => (v.selected = i === index));
  }

  setSvgOutlines(enabled: boolean): void {
    this.svgOutlines = enabled;
    this.render();
  }

  syncOutlineTransforms(): void {
    this.visuals.forEach((v, i) => {
      this.outlines.setPoleTransform(i, v.root.position.x, v.root.position.y, v.root.scale.x, v.root.visible);
    });
  }

  render(): void {
    const now = performance.now();
    const fadeMs = this.reduced ? motion.reduced : motion.partFade;
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i]!;
      const { light, known, appear, neutral } = v.anim;
      this.syncPart(v, now);
      // Table OD : `od` fait passer la lumière du disque entier au cœur d'aire proportionnelle aux postes atteints
      const odF = v.anim.od;
      const lightWhole = light * (1 - odF);
      let mix = 1;
      if (v.fadeStart > 0) {
        mix = Math.min(1, (now - v.fadeStart) / fadeMs);
        if (mix >= 1) v.fadeStart = 0;
        mix = mix * mix * (3 - 2 * mix);
      }
      const target = this.highlighted === i || v.selected ? 1 : 0;
      v.highlight += (target - v.highlight) * 0.25;

      // Neutre « perle » (aucun résultat affiché), sinon gris-bleu → cyan selon la lumière.
      // Or (gain démontré) seulement sur un pôle allumé : g = gain × lumière
      const g = v.anim.gain * light;
      const lit = lerpColor(pixiColor.accessible, this.gainColor, g);
      v.core.tint = lerpColor(lerpColor(pixiColor.dim, lit, lightWhole), poleLook.neutralTint, v.anim.neutral);
      const offAlpha = poleLook.coreAlphaUnknown + (poleLook.coreAlphaOff - poleLook.coreAlphaUnknown) * known;
      const stateAlpha = offAlpha + (poleLook.coreAlphaOn - offAlpha) * lightWhole;
      v.core.alpha = (stateAlpha + (poleLook.coreAlphaNeutral - stateAlpha) * neutral) * appear;
      v.glow.tint = lit;
      v.ringOn.tint = lit;
      // lueur pilotée par l'ÉTAT (allumé, même en partie), jamais par la valeur de la part
      v.glow.alpha = poleLook.glowAlphaOn * light * appear;
      const outlineScale = this.svgOutlines ? 0 : 1;
      v.ringOn.alpha = poleLook.ringOnAlpha * lightWhole * appear * outlineScale;
      // seconde orbite : naît et s'efface avec l'or (même canal `gain`), jamais hors d'un pôle allumé
      v.ringGain.tint = this.gainColor;
      const gainAlpha = gainMark.alpha * g * appear * (1 - neutral);
      v.ringGain.alpha = gainAlpha * outlineScale;
      v.specular.alpha = poleLook.specularAlpha * lightWhole * appear;
      const rings = (1 - neutral) * appear;
      const partOn = light * odF * rings;
      for (const k of [0, 1] as const) {
        const slot = v.slots[k]!;
        const w = k === v.front ? mix : 1 - mix;
        slot.root.alpha = partOn * w;
        slot.root.visible = slot.root.alpha > 1e-3 && !!slot.part;
        slot.core.tint = lit;
        slot.core.alpha = poleLook.coreAlphaOn;
        slot.lit.tint = lit;
        slot.lit.alpha = poleLook.ringOnAlpha * outlineScale;
        slot.rest.alpha = poleLook.partRestAlpha * outlineScale;
        this.outlines.updatePart(
          i, k, slot.part, lit,
          slot.root.visible ? slot.root.alpha : 0,
        );
      }
      const off = (1 - light) * known * rings;
      v.ringOff.alpha = off * (1 - v.anim.outOnly) * outlineScale;
      v.ringOutOnly.alpha = off * v.anim.outOnly * outlineScale;
      v.ringUnknown.alpha = (1 - light) * (1 - known) * rings * outlineScale;
      v.focus.alpha = v.highlight * appear * outlineScale;
      this.outlines.updatePole(i, v.root.position.x, v.root.position.y, v.root.scale.x, v.root.visible, {
        onColor: v.ringOn.tint,
        onAlpha: poleLook.ringOnAlpha * lightWhole * appear,
        offAlpha: off * (1 - v.anim.outOnly),
        outOnlyAlpha: off * v.anim.outOnly,
        unknownAlpha: (1 - light) * (1 - known) * rings,
        focusAlpha: v.highlight * appear,
        gainColor: this.gainColor,
        gainAlpha,
      });
    }
  }
}

function dashedCircle(R: number, segments: number, fill: number, color: number, width: number, alpha: number): Graphics {
  const g = new Graphics();
  dashedArc(g, R, 0, Math.PI * 2, segments, fill);
  g.stroke({ width, color, alpha });
  return g;
}

/** Tirets le long d'un arc [from, to] (radians, sens horaire à l'écran) ; le trait est posé par l'appelant. */
function dashedArc(g: Graphics, R: number, from: number, to: number, segments: number, fill: number): void {
  const step = (to - from) / segments;
  // tirets centrés dans leur pas : les deux bouts de l'arc ont le même demi-intervalle
  const lead = (step * (1 - fill)) / 2;
  for (let k = 0; k < segments; k++) {
    const a0 = from + k * step + lead;
    const a1 = a0 + step * fill;
    g.moveTo(Math.cos(a0) * R, Math.sin(a0) * R).arc(0, 0, R, a0, a1);
  }
}

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
