/**
 * Moteur du ciel (PixiJS v8), indépendant de React.
 * Il DESSINE un état calculé ailleurs (data/accessibility.ts) : aucune logique métier ici.
 */
import { animate, type JSAnimation } from 'animejs';
import { AdvancedBloomFilter } from 'pixi-filters';
import { Application, BlurFilter, Container, RendererType, type Filter } from 'pixi.js';
import type { PoleState } from '../data/accessibility';
import type { HaloRing } from '../data/halo';
import type { Pole, SkyPosition } from '../data/types';
import { decorCamera, glyphScale, IDENTITY, type Camera } from '../state/camera';
import type { SkyEvent } from '../store/skyBridge';
import {
  decorNeedsReload,
  nebulaDeepCandidates,
  nebulaDeepVariant,
  nebulaWispsCandidates,
  nebulaWispsVariant,
  type DecorScreen,
  type DecorVariant,
} from '../theme/assets';
import { palette } from '../theme/palette';
import { ambient, motion, reveal, skyLayout } from '../theme/tokens';
import { computeFrame, poleGeometry, toScreen, detectOverlapZoom, UNIT_BOUNDS, type SkyBounds, type SkyFrame } from './layout';
import { GuideStar } from './layers/GuideStar';
import { OutlineOverlay } from './OutlineOverlay';
import { Nebula } from './layers/Nebula';
import { Poles } from './layers/Poles';
import { ShootingStar, type ShootingKind } from './layers/ShootingStar';
import { Starfield } from './layers/Starfield';
import { SilenceVeils, Veil } from './layers/Veil';
import {
  discTexture,
  dustTexture,
  avifSupported,
  flareTexture,
  glowTexture,
  loadFirst,
  loadOptional,
  nebulaTexture,
  softDotTexture,
  tailTexture,
  veilTexture,
  vignetteTexture,
} from './textures';
import {
  eclipseDirection,
  fx,
  gainLegend,
  lostPoles,
  planGain,
  planTransition,
  poseDelays,
  poseOrder,
  runTransition,
  shootingDuration,
  shootingKindOf,
  shootingLegs,
  type EclipseDirection,
  type GainLegend,
  type GainRefusal,
  type GainView,
  type TransitionCause,
} from './transitions';
import { EngineFeaturesImpl } from './engineFeatures';

export interface EngineView {
  states: PoleState[];
  origin: SkyPosition | null;
  originKey: string | null;
  /** Ciel neutre (aucune commune ou ciel pas encore révélé) */
  neutral?: boolean;
  /** Journée-type affichée (d06, d09, d14) : donne le sens du voile d'éclipse */
  day?: string;
}

/** Résultat de showGain : ce qui est réellement montré en or, et les pôles perdus (écart NET). */
export interface GainReport {
  /** true si au moins un pôle est peint en or */
  shown: boolean;
  /** Raison du refus (aucun or) ; null si la comparaison est valide */
  reason: GainRefusal | null;
  /** Pôles gagnés (or) : accessibles aller ET retour dans le complément, pas dans la référence */
  gained: string[];
  /** Pôles perdus : accessibles dans la référence, plus dans le complément (hors budget + silence, jamais cachés) */
  lost: string[];
  /** Entrée de légende à afficher tant que l'or est visible ; null sinon */
  legend: GainLegend | null;
}

/** Ce que la dernière transition a réellement montré (pour la visite et les tests manuels). */
export interface TransitionReport {
  cause: TransitionCause;
  /** Nombre de pôles dont l'état a réellement changé */
  changed: number;
  /** Identifiants des pôles perdus (accessibles avant, plus maintenant) */
  lost: string[];
  /** Voile joué (au moins un pôle a basculé à un changement de journée-type) */
  eclipse: EclipseDirection | null;
}

export class SkyEngine {
  private app: Application;
  private frame: SkyFrame;
  private starfield!: Starfield;
  private nebula!: Nebula;
  private poles!: Poles;
  private guide!: GuideStar;
  private shooting!: ShootingStar;
  private veil!: Veil;
  /** Moments « wow » (critique v0.4, spec f) : voir playEclipse, playSilence, playShootingStar */
  private silence!: SilenceVeils;
  private lastStates: PoleState[] | null = null;
  private lastNeutral = true;
  /**
   * Ciel affiché avant le début d'un glisser de la jauge du budget : au relâchement, le silence
   * porte sur les pôles perdus entre cet état et l'état final (jamais à chaque cran).
   */
  private scrubBase: { states: PoleState[] | null; neutral: boolean } | null = null;
  private lastDay: string | undefined;
  private lastReport: TransitionReport | null = null;
  /** Horloge d'ambiance : avance au rythme `ambientRate.v` (0 pendant un silence) */
  private ambientClock = 0;
  private lastTick = 0;
  private ambientRate = { v: 1 };
  private silenceAnim: { cancel(): unknown } | null = null;
  /** Gain démontré affiché : statuts du complément (l'or s'efface dès que le ciel affiché change) */
  private gainShown: string | null = null;
  private gainAnims: { cancel(): unknown }[] = [];
  private reduced: boolean;
  private busyUntil = 0;
  private originKey: string | null = null;
  private parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  private destroyed = false;
  private resizeTimer: number | undefined;
  private dataLayer!: Container;
  /** Carte miroir et affiche (engineFeatures.ts) : conteneur des données, accès isolé */
  private dataRoot!: Container;
  private features: EngineFeaturesImpl | null = null;
  private camera: Camera = IDENTITY;
  private barHeight: number | undefined;
  /** Marge haute imposée par l'hôte (diptyque empilé sur mobile) */
  private topInset: number | undefined;
  private withOpening = true;
  /** Durée du fondu du décor à l'ouverture (ms) : titre 1,2 s, lien partagé 0,8 s */
  private openingFade: number = motion.nebulaFadeIn;
  /**
   * Acte 0 (D-021) : astres cachés (`appear` = 0), en attente de la pose. Le décor est alors 4 % plus
   * proche (`dolly`) ; il recule pendant la mise au point. Seuls l'opacité des astres, le flou GLOBAL
   * du calque des données et l'échelle du DÉCOR s'animent : aucune position ni taille d'astre.
   */
  private veiled = false;
  private dolly = { d: 1 };
  private gpu = true;
  private bloom: Filter | null = null;
  private focusBlur: BlurFilter | null = null;
  private introAnims: JSAnimation[] = [];
  private bounds: SkyBounds = UNIT_BOUNDS;
  /** Variantes de décor chargées (orientation, largeur) ; null = repli procédural */
  private deepVariant: DecorVariant | null = null;
  private wispsVariant: DecorVariant | null = null;
  private avif = false;

  private poleData: Pole[];
  private astres44 = false;
  private astres44AutoZoomApplied = false;
  /** Récepteur des événements joués (ciel A seulement : design sonore, D-026) */
  private sink: ((e: SkyEvent) => void) | null = null;
  private outlines!: OutlineOverlay;

  private constructor(app: Application, poleData: Pole[], reduced: boolean, astres44?: boolean) {
    this.app = app;
    this.poleData = poleData;
    this.astres44 = astres44 ?? false;
    this.reduced = reduced;
    this.frame = computeFrame(app.screen.width, app.screen.height, this.barHeight, this.bounds, this.topInset);
  }

  static async create(
    host: HTMLElement,
    poles: Pole[],
    reduced: boolean,
    barHeight?: number,
    opts: { opening?: boolean; openingFade?: number; veiled?: boolean; bounds?: SkyBounds; astres44?: boolean } = {},
  ): Promise<SkyEngine> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: '#080E20',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    app.canvas.setAttribute('aria-hidden', 'true');
    app.canvas.classList.add('sky-canvas');
    host.appendChild(app.canvas);
    const engine = new SkyEngine(app, poles, reduced, opts.astres44);
    engine.outlines = new OutlineOverlay(host);
    engine.barHeight = barHeight;
    engine.withOpening = opts.opening ?? true;
    engine.openingFade = opts.openingFade ?? motion.nebulaFadeIn;
    engine.veiled = !!opts.veiled;
    // Décor rapproché au titre (sans recul en mouvement réduit : échelle 1 dès le départ)
    if (engine.veiled && !reduced) engine.dolly.d = reveal.decorDolly;
    engine.bounds = opts.bounds ?? UNIT_BOUNDS;
    await engine.setup();
    engine.features = engine.attachFeatures(host);
    // dev uniquement (retiré du build) : poignée de diagnostic des effets, ex. __starwaySky.lastTransition()
    if (import.meta.env.DEV) (window as unknown as { __starwaySky?: SkyEngine }).__starwaySky = engine;
    return engine;
  }

  private async setup(): Promise<void> {
    this.avif = await avifSupported();
    const screen = this.decorScreen();
    const deepVariant = nebulaDeepVariant(screen);
    const wispsVariant = nebulaWispsVariant(screen);
    const [deepImg, wispsImg, dustImg, guideImg, headImg, veilImg] = await Promise.all([
      // décors v3 (avif, puis webp), puis v1 en repli ; null = repli procédural
      loadFirst(nebulaDeepCandidates(deepVariant, this.avif)),
      loadFirst(nebulaWispsCandidates(wispsVariant, this.avif)),
      // poussière désactivée (dustAlpha 0) : pas de téléchargement inutile
      ambient.dustAlpha > 0 ? loadOptional('cosmicDust') : Promise.resolve(null),
      loadOptional('guideStar'),
      loadOptional('shootingHead'),
      loadOptional('eclipseVeil'),
    ]);
    const glow = glowTexture();
    const dot = softDotTexture();

    if (deepImg?.v3) this.deepVariant = deepVariant;
    if (wispsImg?.v3) this.wispsVariant = wispsVariant;
    this.nebula = new Nebula({
      deep: deepImg?.texture ?? nebulaTexture(1337),
      wisps: wispsImg?.texture ?? nebulaTexture(4242, 1024, 640, 0.9),
      dust: dustImg ?? dustTexture(),
      deepIsV3: !!deepImg?.v3,
      wispsIsV3: !!wispsImg?.v3,
      clearing: glow,
      vignette: vignetteTexture(),
    });
    // Repli sans GPU (WebGL et WebGPU indisponibles : rendu Canvas 2D de PixiJS) : même ciel, sans
    // bloom ni maillage, moins d'étoiles de fond. Les données (positions, tailles, états) sont identiques.
    const gpu = this.app.renderer.type !== RendererType.CANVAS;
    this.gpu = gpu;
    this.starfield = new Starfield(dot);
    if (!gpu) this.starfield.setMaxStars(CANVAS_MAX_STARS);
    this.poles = new Poles(discTexture(), glow, dot, this.outlines);
    this.poles.setReduced(this.reduced);
    this.guide = new GuideStar(guideImg ?? flareTexture(), glow, !!guideImg, this.outlines);
    this.shooting = new ShootingStar(headImg ?? glow, !!headImg, gpu ? tailTexture(fx.shooting.tailWidth) : null);
    this.veil = new Veil(veilImg ?? veilTexture(), !!veilImg);
    this.silence = new SilenceVeils(glow);

    // Couche des données : astres + étoile-guide + filante, avec un bloom doux.
    // Les astres et l'étoile-guide sont placés en coordonnées écran (zoom des glyphes atténué) ;
    // la filante vit dans un calque « monde » mis à l'échelle par la caméra.
    const dataLayer = new Container();
    this.dataLayer = new Container();
    this.dataLayer.addChild(this.shooting.view);
    // l'atténuation du silence est SOUS les disques : elle assombrit le décor, jamais une donnée
    dataLayer.addChild(this.silence.view, this.poles.view, this.dataLayer, this.guide.view);
    if (gpu) {
      this.bloom = new AdvancedBloomFilter({ threshold: 0.6, bloomScale: 0.45, brightness: 1, blur: 4, quality: 4 });
      dataLayer.filters = [this.bloom];
    }

    this.dataRoot = dataLayer;
    this.app.stage.addChild(this.nebula.view, this.starfield.view, dataLayer, this.veil.view);
    this.app.stage.eventMode = 'none';
    this.layout();

    this.app.renderer.on('resize', () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.layout(), 80);
    });
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    this.app.ticker.add(this.tick);
    this.playOpening();
  }

  /** Écran vu par le décor : fenêtre (orientation) et canvas du ciel (largeur du fichier). */
  private decorScreen(): DecorScreen {
    const { width, height } = this.app.screen;
    return { viewportWidth: window.innerWidth, width, height, resolution: this.app.renderer.resolution };
  }

  /**
   * Après un redimensionnement : recharge le fond si l'orientation change (portrait sous 760 px de
   * fenêtre) ou s'il faut un fichier plus large. Décor seulement : positions et tailles des astres
   * ne dépendent pas de cette image. Si le fichier v3 ne charge pas, l'image en place reste.
   */
  private refreshDecor(): void {
    if (!this.deepVariant && !this.wispsVariant) return; // repli v1 ou procédural : rien à changer
    const screen = this.decorScreen();
    const deepNext = nebulaDeepVariant(screen);
    if (this.deepVariant && decorNeedsReload(this.deepVariant, deepNext)) {
      this.deepVariant = deepNext;
      void loadFirst(nebulaDeepCandidates(deepNext, this.avif).filter((c) => c.v3)).then((img) => {
        if (img && !this.destroyed && this.deepVariant === deepNext) this.nebula.setDeep(img.texture, true);
      });
    }
    const wispsNext = nebulaWispsVariant(screen);
    if (this.wispsVariant && decorNeedsReload(this.wispsVariant, wispsNext)) {
      this.wispsVariant = wispsNext;
      void loadFirst(nebulaWispsCandidates(wispsNext, this.avif).filter((c) => c.v3)).then((img) => {
        if (img && !this.destroyed && this.wispsVariant === wispsNext) this.nebula.setWisps(img.texture, true);
      });
    }
  }

  private layout(): void {
    if (this.destroyed) return;
    const { width, height } = this.app.screen;
    this.frame = computeFrame(width, height, this.barHeight, this.bounds, this.topInset);
    this.outlines.setSize(width, height);
    this.nebula.resize(width, height);
    this.refreshDecor();
    this.starfield.build(width, height);
    const geo = poleGeometry(this.poleData, this.frame, this.astres44);
    this.poles.build(geo);
    this.silence.build(geo);
    if (geo.length) {
      const xs = geo.map((g) => g.x);
      const ys = geo.map((g) => g.y);
      this.nebula.setClearing(
        (Math.min(...xs) + Math.max(...xs)) / 2,
        (Math.min(...ys) + Math.max(...ys)) / 2,
        Math.min(this.frame.w, this.frame.h),
      );
      
      // D-030 (44 astres) : auto-zoom pour éviter les chevauchements initiaux
      if (this.astres44 && !this.astres44AutoZoomApplied) {
        const k = detectOverlapZoom(geo);
        if (k > 1.001) {
          this.camera = { k, x: 0, y: 0 };
          this.astres44AutoZoomApplied = true;
        }
      }
    }
    this.veil.resize(width, height);
    this.guide.setSize(Math.max(12, Math.min(this.frame.w, this.frame.h) * skyLayout.guideSize));
    if (this.originPos) {
      this.guide.setWorldPosition(toScreen(this.frame, this.originPos));
    }
    this.shooting.clear();
    this.setCamera(this.camera);
  }

  /**
   * Ouverture du DÉCOR seulement : nébuleuse (1,2 s au titre, 0,8 s pour un lien partagé), étoiles de
   * fond par vagues (1,5 s). Les astres ne sont plus posés ici (Acte 0) : moteur voilé, ils attendent
   * `pose()` ; sinon (diptyque ouvert après la révélation) ils sont là d'emblée.
   */
  private playOpening(): void {
    const now = performance.now();
    if (!this.veiled) this.poles.animTargets().forEach((a) => (a.appear = 1));
    if (this.reduced || !this.withOpening) {
      this.nebula.view.alpha = 1;
      this.starfield.startOpening(now - motion.starsWaves);
      this.busyUntil = now;
      return;
    }
    animate(this.nebula.view, { alpha: [0, 1], duration: this.openingFade, ease: 'inOutSine' });
    this.starfield.startOpening(now + this.openingFade * 0.3);
    this.busyUntil = now;
  }

  /** Les astres attendent-ils la pose (titre, ou retour au titre) ? */
  isVeiled(): boolean {
    return this.veiled;
  }

  private stopIntro(): void {
    this.introAnims.forEach((a) => a.cancel());
    this.introAnims = [];
  }

  /** Flou global du calque des données (devant le bloom) ; absent en rendu Canvas 2D. */
  private setFocusBlur(strength: number): void {
    if (!this.gpu || this.destroyed) return;
    if (strength <= 0.05) {
      if (this.focusBlur) {
        this.dataRoot.filters = this.bloom ? [this.bloom] : [];
        this.focusBlur.destroy();
        this.focusBlur = null;
      }
      return;
    }
    if (!this.focusBlur) {
      this.focusBlur = new BlurFilter({ strength, quality: 3 });
      this.dataRoot.filters = this.bloom ? [this.focusBlur, this.bloom] : [this.focusBlur];
    }
    this.focusBlur.strength = strength;
  }

  private animateDolly(to: number, duration: number, ease: string, delay = 0): void {
    if (Math.abs(this.dolly.d - to) < 1e-4) return;
    this.introAnims.push(animate(this.dolly, { d: to, duration, delay, ease, onUpdate: () => this.setCamera(this.camera) }));
  }

  /** Flou global de `from` à `to` (outQuart) ; retiré dès qu'il atteint 0. */
  private animateBlur(from: number, to: number, duration: number, ease: string, delay = 0): void {
    if (!this.gpu) return;
    const p = { v: from };
    if (delay === 0) this.setFocusBlur(from);
    this.introAnims.push(
      animate(p, {
        v: to,
        duration,
        delay,
        ease,
        onUpdate: () => this.setFocusBlur(p.v),
        onComplete: () => this.setFocusBlur(to),
      }),
    );
  }

  /**
   * Temps B de la révélation : les astres apparaissent en perles neutres, par rayon décroissant (donc
   * par postes, `poseOrder`), décalés de `poseDelays` ; le calque des données passe d'un flou de 8 à
   * net, le décor recule de 1,04 à 1. Mouvement réduit : un fondu de 150 ms, sans flou ni recul.
   * Résout quand le dernier astre est posé.
   */
  pose(): Promise<void> {
    if (this.destroyed || !this.veiled) return this.settled();
    this.veiled = false;
    this.stopIntro();
    const targets = this.poles.animTargets();
    const now = performance.now();
    if (this.reduced) {
      this.setFocusBlur(0);
      this.dolly.d = 1;
      this.setCamera(this.camera);
      targets.forEach((a) => this.introAnims.push(animate(a, { appear: 1, duration: motion.reduced, ease: 'linear' })));
      this.busyUntil = Math.max(this.busyUntil, now + motion.reduced);
      return this.settled();
    }
    const order = poseOrder(this.poles.geometry());
    const delays = poseDelays(order.length);
    order.forEach((index, rank) => {
      const a = targets[index];
      if (a) {
        this.introAnims.push(
          animate(a, { appear: 1, duration: reveal.poleAppear, delay: delays[rank] ?? 0, ease: motion.easing.light }),
        );
      }
    });
    this.animateBlur(reveal.focusBlur, 0, reveal.focusDuration, motion.easing.ui);
    this.animateDolly(1, reveal.decorDollyDuration, motion.easing.ui);
    this.busyUntil = Math.max(this.busyUntil, now + (delays.at(-1) ?? 0) + reveal.poleAppear);
    return this.settled();
  }

  /**
   * Retour au titre : les astres (et, via `update`, l'étoile-guide) s'effacent ENSEMBLE, sans ordre
   * (l'ordre n'a de sens qu'à l'entrée) ; flou 0 → 8, décor 1 → 1,04. Mouvement réduit : fondu 150 ms.
   */
  veilSky(): Promise<void> {
    if (this.destroyed || this.veiled) return this.settled();
    this.veiled = true;
    this.stopIntro();
    const now = performance.now();
    const targets = this.poles.animTargets();
    if (this.reduced) {
      targets.forEach((a) => this.introAnims.push(animate(a, { appear: 0, duration: motion.reduced, ease: 'linear' })));
      this.busyUntil = Math.max(this.busyUntil, now + motion.reduced);
      return this.settled();
    }
    // 150 ms : l'interface a commencé à sortir (motion-spec, retour au titre, étape 2)
    const delay = motion.reduced;
    targets.forEach((a) =>
      this.introAnims.push(animate(a, { appear: 0, duration: reveal.backSky, delay, ease: motion.easing.eclipse })),
    );
    // Le flou n'a plus rien à flouter une fois les astres effacés : retiré à la fin (aucun coût au titre)
    const p = { v: 0 };
    this.introAnims.push(
      animate(p, {
        v: reveal.focusBlur,
        duration: reveal.backSky,
        delay,
        ease: motion.easing.eclipse,
        onUpdate: () => this.setFocusBlur(p.v),
        onComplete: () => this.setFocusBlur(0),
      }),
    );
    // décor : 700 ms (motion-spec), de la fin de la sortie de l'interface
    this.animateDolly(reveal.decorDolly, reveal.backSky + reveal.backUi + 20, motion.easing.eclipse, delay);
    this.busyUntil = Math.max(this.busyUntil, now + delay + reveal.backSky);
    return this.settled();
  }

  /** Interruption de la révélation : valeurs finales en un fondu de 150 ms. */
  finishIntro(): void {
    if (this.destroyed) return;
    this.veiled = false;
    this.stopIntro();
    this.setFocusBlur(0);
    this.dolly.d = 1;
    this.setCamera(this.camera);
    for (const a of this.poles.animTargets()) {
      if (a.appear < 1) this.introAnims.push(animate(a, { appear: 1, duration: motion.reduced, ease: 'linear' }));
    }
    this.busyUntil = Math.max(this.busyUntil, performance.now() + motion.reduced);
  }

  private originPos: SkyPosition | null = null;

  /** Applique un nouvel état. Renvoie une promesse résolue à la fin de la transition. */
  update(view: EngineView, cause: TransitionCause, opts: { quick?: boolean } = {}): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    // quick : juste après une interruption de la révélation, tout finit en fondus de 150 ms
    const reduced = this.reduced || !!opts.quick;
    const now = performance.now();
    let end = 0;

    if (view.originKey !== this.originKey) {
      this.originKey = view.originKey;
      this.originPos = view.origin;
      this.shooting.clear();
      const pos = view.origin ? toScreen(this.frame, view.origin) : null;
      void this.guide.place(pos, reduced);
      if (pos) this.emit({ type: 'guide', x: this.screenFraction(pos.x), reduced });
      end = Math.max(end, reduced ? motion.reduced : motion.guideBirth);
    }

    // L'or ne survit jamais à un changement du ciel affiché : il ne vaut que pour la paire comparée
    if (this.gainShown != null && (view.neutral || statusKey(view.states) !== this.gainShown)) this.clearGain();
    if (view.originKey !== this.originKey && this.gainShown != null) this.clearGain();

    const direction = eclipseDirection(this.lastDay, view.day);
    const cam = this.camera;
    // positions à l'écran (caméra comprise) : le voile croise les astres là où on les voit
    const seen = this.poles.geometry().map((g) => ({ ...g, x: cam.x + g.x * cam.k }));
    const steps = planTransition(view.states, seen, cause, {
      reduced,
      screenWidth: this.app.screen.width,
      current: this.poles.animTargets(),
      neutral: view.neutral,
      direction,
    });
    // L'allumage suit la naissance de l'étoile-guide
    const offset = cause === 'origin' && !reduced ? motion.guideBirth * 0.5 : 0;
    steps.forEach((s) => (s.delay += offset));

    // Éclipse : seulement si au moins un pôle bascule réellement ; sinon pas de voile du tout.
    let eclipseDir: EclipseDirection | null = null;
    if (cause === 'day' && steps.length > 0 && !reduced) {
      eclipseDir = direction;
      end = Math.max(end, this.playEclipse(direction));
    }
    // Silence : seulement sur une perte réelle (accessible → hors budget), jamais sur un gain.
    // Glisser de la jauge : aucun silence pendant le geste ; au relâchement, la perte se mesure
    // depuis le ciel d'avant le geste.
    if (cause === 'scrub') this.scrubBase ??= { states: this.lastStates, neutral: this.lastNeutral };
    const base = cause === 'scrub' ? null : this.scrubBase ?? { states: this.lastStates, neutral: this.lastNeutral };
    if (cause !== 'scrub') this.scrubBase = null;
    const lost = base ? lostPoles(base.states, view.states, { prevNeutral: base.neutral, nextNeutral: view.neutral }) : [];
    if (lost.length) {
      const delays = new Map(steps.map((st) => [st.index, st.delay] as const));
      end = Math.max(end, this.silenceFor(lost, delays));
    }
    const sink = this.sink;
    const before = sink ? this.poles.animTargets().map((t) => t.light) : null;
    end = Math.max(end, runTransition(this.poles.animTargets(), steps));

    this.lastReport = {
      cause,
      changed: steps.length,
      lost: lost.map((i) => this.poleData[i]?.id ?? String(i)),
      eclipse: eclipseDir,
    };
    this.lastStates = view.states;
    this.lastNeutral = !!view.neutral;
    this.lastDay = view.day ?? this.lastDay;
    this.busyUntil = Math.max(this.busyUntil, now + end);
    if (sink && before) {
      const w = this.app.screen.width || 1;
      const lostSet = new Set(lost);
      const lit = steps
        .filter((st) => st.light > 0.5 && (before[st.index] ?? 0) < 0.5)
        .sort((a, b) => a.delay - b.delay)
        .map((st) => ({ x: (seen[st.index]?.x ?? 0) / w, delay: st.delay }));
      const lostDelays = steps.filter((st) => lostSet.has(st.index)).map((st) => st.delay);
      sink({
        type: 'transition',
        cause,
        reduced,
        lit,
        lost: lost.length,
        lostDelay: lostDelays.length ? Math.min(...lostDelays) : 0,
        eclipse: eclipseDir,
        dayFlip: cause === 'day' && steps.length > 0,
        silence: lost.length > 0 && !this.reduced,
      });
    }
    return this.settled();
  }

  /**
   * Gain démontré (acte 4) : peint en OR les seuls pôles accessibles aller ET retour dans le scénario
   * complémentaire (ex. vélo + TC) et pas dans le scénario de référence (TC), même journée-type et même
   * budget, et dont la part TC commune par commune est nulle (`planGain`, règle `goldDelta`, D-056). Les pôles perdus (l'écart est NET, sur `access/`) restent
   * visibles dans leur état hors budget, avec le « silence ». Le ciel affiché doit déjà être le
   * complément (appeler `update(complément)` d'abord) : sinon rien n'est peint.
   * Mouvement réduit : fondu 150 ms, sans silence. Réversible avec `clearGain()`.
   */
  showGain(reference: GainView, complement: GainView, communeTransit: readonly PoleState[] | null): Promise<GainReport> {
    const plan = planGain(this.poleData, reference, complement, communeTransit);
    const ids = (idx: readonly number[]) => idx.map((i) => this.poleData[i]?.id ?? String(i));
    let reason = plan.reason;
    if (!reason && (this.destroyed || this.lastNeutral || !this.lastStates || statusKey(this.lastStates) !== statusKey(complement.states))) {
      reason = 'not_displayed';
    }
    const report: GainReport = { shown: false, reason, gained: ids(plan.gained), lost: ids(plan.lost), legend: null };
    if (reason) {
      this.clearGain();
      return Promise.resolve(report);
    }
    this.stopGainAnims();
    const targets = this.poles.animTargets();
    const gained = new Set(plan.gained);
    let end = 0;
    const gold: { x: number; delay: number }[] = [];
    targets.forEach((t, i) => {
      const to = gained.has(i) ? 1 : 0;
      if (Math.abs(t.gain - to) < 1e-3) return;
      // allumage en or : 600 ms outExpo, décalage 60 ms (motion-spec, acte 4) ; réduit : fondu 150 ms
      const rank = plan.gained.indexOf(i);
      const delay = this.reduced || to === 0 ? 0 : Math.max(0, rank) * GAIN_STAGGER;
      const duration = this.reduced ? motion.reduced : motion.light;
      this.gainAnims.push(animate(t, { gain: to, delay, duration, ease: motion.easing.light }));
      end = Math.max(end, delay + duration);
      if (to === 1) gold.push({ x: this.poleScreenFraction(i), delay });
    });
    if (gold.length) this.emit({ type: 'gain', reduced: this.reduced, gold: gold.sort((a, b) => a.delay - b.delay) });
    // pôles perdus face à la référence : silence (s'il n'a pas déjà été joué par la dernière transition)
    const already = new Set(this.lastReport?.lost ?? []);
    const lostNow = plan.lost.filter((i) => !already.has(this.poleData[i]?.id ?? ''));
    if (lostNow.length) end = Math.max(end, this.silenceFor(lostNow, new Map()));
    this.gainShown = statusKey(complement.states);
    report.shown = plan.gained.length > 0;
    report.legend = report.shown ? gainLegend : null;
    this.busyUntil = Math.max(this.busyUntil, performance.now() + end);
    return this.settled().then(() => report);
  }

  /** Retire l'or (retour au scénario de référence, autre commune, autre budget...). */
  clearGain(): void {
    this.stopGainAnims();
    this.gainShown = null;
    if (this.destroyed) return;
    const duration = this.reduced ? motion.reduced : motion.light * 0.5;
    for (const t of this.poles.animTargets()) {
      if (t.gain > 1e-3) this.gainAnims.push(animate(t, { gain: 0, duration, ease: motion.easing.ui }));
    }
  }

  private stopGainAnims(): void {
    this.gainAnims.forEach((a) => a.cancel());
    this.gainAnims = [];
  }

  /** Événements joués (design sonore, D-026) : seul le ciel A en a un ; null pour se désabonner. */
  setEventSink(fn: ((e: SkyEvent) => void) | null): void {
    this.sink = fn;
  }

  private emit(e: SkyEvent): void {
    if (!this.destroyed) this.sink?.(e);
  }

  /** x « monde » (calque des données) → fraction de la largeur de l'écran, caméra comprise */
  private screenFraction(x: number): number {
    return (this.camera.x + x * this.camera.k) / (this.app.screen.width || 1);
  }

  private poleScreenFraction(index: number): number {
    return this.screenFraction(this.poles.geometry()[index]?.x ?? 0);
  }

  /** Bilan de la dernière transition (changements réels, pôles perdus, voile joué ou non). */
  lastTransition(): TransitionReport | null {
    return this.lastReport;
  }

  /**
   * Voile d'éclipse dans le sens du sélecteur, puis 900 ms d'immobilité (comptées dans `settled()`).
   * Appelé par `update()` quand la journée-type change ET qu'au moins un pôle bascule : ne pas
   * l'appeler sans différence réelle (un repère = une signification). Renvoie la durée (ms).
   */
  playEclipse(direction: EclipseDirection): number {
    if (this.destroyed) return 0;
    if (this.reduced) return motion.reduced;
    void this.veil.sweep(direction);
    return motion.eclipse + fx.eclipse.holdAfter;
  }

  /**
   * « Le silence comme effet » pour des pôles perdus (identifiants de poles.json) : l'ambiance se
   * fige (300 ms), reste immobile (600 ms), reprend (600 ms) ; atténuation passagère autour de
   * chaque pôle perdu. Ne garde que les pôles qui sont, dans l'état affiché, réellement hors budget
   * après avoir été accessibles. Appelé par `update()` ; exposé pour la visite. Renvoie la durée (ms).
   */
  playSilence(lostPoleIds: readonly string[]): number {
    const lost = new Set(this.lastReport?.lost ?? []);
    const idx = lostPoleIds
      .filter((id) => lost.has(id))
      .map((id) => this.poleData.findIndex((p) => p.id === id))
      .filter((i) => i >= 0);
    return idx.length ? this.silenceFor(idx, new Map()) : 0;
  }

  private silenceFor(indices: readonly number[], delays: ReadonlyMap<number, number>): number {
    if (this.destroyed || this.reduced) return 0; // mouvement réduit : ambiance déjà coupée, fondu d'état seul
    const d = fx.silence;
    this.silenceAnim?.cancel();
    const r = this.ambientRate;
    const total = d.freezeIn + d.hold + d.release;
    const p = { t: 0 };
    const start = r.v;
    this.silenceAnim = animate(p, {
      t: total,
      duration: total,
      ease: 'linear',
      onUpdate: () => {
        const t = p.t;
        if (t < d.freezeIn) r.v = start * (1 - easeOutQuad(t / d.freezeIn));
        else if (t < d.freezeIn + d.hold) r.v = 0;
        else r.v = easeInOutSine((t - d.freezeIn - d.hold) / d.release);
      },
      onComplete: () => {
        r.v = 1;
        this.silenceAnim = null;
      },
    });
    return Math.max(d.freezeIn + d.hold, this.silence.play(indices, delays));
  }

  /** Étoile filante de l'étoile-guide vers un astre. */
  shoot(index: number, kind: ShootingKind): Promise<void> {
    const geo = this.poles.geometry()[index];
    if (!geo || !this.originPos) return Promise.resolve();
    const from = toScreen(this.frame, this.originPos);
    // la filante est dans le calque « monde » (×k) : tête et queue gardent leur taille à l'écran
    const p = this.shooting.fire(from, { x: geo.x, y: geo.y }, kind, this.reduced, {
      k: this.camera.k,
      glyph: glyphScale(this.camera.k),
    });
    this.emit({
      type: 'shooting',
      reduced: this.reduced,
      fromX: this.screenFraction(from.x),
      toX: this.poleScreenFraction(index),
      legs: shootingLegs(kind),
    });
    this.busyUntil = Math.max(this.busyUntil, performance.now() + shootingDuration(kind, this.reduced));
    return p;
  }

  /**
   * Étoile filante vers un pôle (identifiant de poles.json), selon son état RÉEL dans le ciel affiché :
   * deux arcs (aller au-dessus, retour au-dessous) si accessible, retour arrêté à 50 % si le retour
   * est hors budget, aller arrêté à 60 % si l'aller est hors budget ; rien si non calculé ou ciel neutre.
   */
  playShootingStar(poleId: string): Promise<void> {
    const index = this.poleData.findIndex((p) => p.id === poleId);
    if (index < 0 || this.lastNeutral) return Promise.resolve();
    const kind = shootingKindOf(this.lastStates?.[index]?.status);
    return kind ? this.shoot(index, kind) : Promise.resolve();
  }

  /** Caméra : appliquée aux astres (zoom complet) et au décor (zoom atténué, effet de profondeur). */
  setCamera(c: Camera): void {
    this.camera = c;
    this.dataLayer.position.set(c.x, c.y);
    this.dataLayer.scale.set(c.k);
    const g = glyphScale(c.k);
    this.poles.setCamera(c, g);
    this.silence.setCamera(c, g);
    this.guide.setCamera(c, g);
    const stars = this.dollied(decorCamera(c, 0.45));
    this.starfield.view.position.set(stars.x, stars.y);
    this.starfield.view.scale.set(stars.k);
    const neb = this.dollied(decorCamera(c, 0.2));
    this.nebula.view.position.set(neb.x, neb.y);
    this.nebula.view.scale.set(neb.k);
  }

  /**
   * Recul du décor (Acte 0) : facteur d autour du centre c de l'écran, k' = d × k et
   * pos' = c × (1 - d) + d × pos. Nébuleuse et étoiles de fond seulement, jamais les données.
   */
  private dollied(cam: Camera): Camera {
    const d = this.dolly.d;
    if (Math.abs(d - 1) < 1e-5) return cam;
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    return { k: cam.k * d, x: cx * (1 - d) + d * cam.x, y: cy * (1 - d) + d * cam.y };
  }

  /** Halo autour de l'étoile-guide (null = fermé). */
  setHalo(rings: HaloRing[] | null): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const p = this.guide.halo.show(rings, this.reduced);
    this.busyUntil = Math.max(this.busyUntil, performance.now() + (this.reduced ? motion.reduced * 2 : motion.ui + 700 + 8 * 80));
    return p;
  }

  /** L'hôte a changé de taille (passage en diptyque) : on recadre. */
  resize(): void {
    if (this.destroyed) return;
    this.app.resize();
    this.layout();
  }

  /** Hauteur de la barre de scénario : le ciel se recadre au-dessus. */
  /** Marges imposées par l'hôte : bas (barre) et haut (diptyque empilé). */
  setInsets(bottom: number, top?: number): void {
    if (this.barHeight === bottom && this.topInset === top) return;
    this.barHeight = bottom;
    this.topInset = top;
    this.layout();
  }

  setBarHeight(h: number): void {
    if (this.barHeight === h) return;
    this.barHeight = h;
    this.layout();
  }

  clearShooting(): void {
    this.shooting.clear();
  }

  setSelected(index: number | null): void {
    this.poles.setSelected(index);
  }

  highlight(index: number | null): void {
    this.poles.setHighlighted(index);
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    this.poles?.setReduced(reduced);
  }

  /**
   * Mode daltonien (motion-spec, « Mode daltonien ») : seul l'or du gain change de couleur, à l'image
   * suivante, sans transition ni son. États, formes, positions et tailles inchangés.
   */
  setPalette(cv: boolean): void {
    this.poles?.setGainColor(palette(cv).pixiColor.gain);
  }

  /** Résout quand la transition en cours est terminée. */
  settled(): Promise<void> {
    const wait = this.busyUntil - performance.now();
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, wait)));
  }

  fps(): number {
    return this.app.ticker.FPS;
  }

  private onPointer = (e: PointerEvent): void => {
    const { width, height } = this.app.screen;
    this.parallax.tx = (e.clientX / width - 0.5) * 2;
    this.parallax.ty = (e.clientY / height - 0.5) * 2;
  };

  private tick = (): void => {
    const now = performance.now();
    const ambientOn = !this.reduced;
    // horloge d'ambiance : figée pendant un silence (scintillement, dérive et parallaxe se taisent)
    const rate = this.ambientRate.v;
    this.ambientClock += Math.min(100, this.lastTick ? now - this.lastTick : 0) * rate;
    this.lastTick = now;
    const p = this.parallax;
    p.x += (p.tx - p.x) * 0.04 * rate;
    p.y += (p.ty - p.y) * 0.04 * rate;
    this.nebula.update(this.ambientClock, p.x, p.y, ambientOn);
    this.starfield.update(now, this.ambientClock, p.x, p.y, ambientOn, motion.starsWaves);
    this.poles.render();
    this.guide.render();
    this.features?.tick();
    this.poles.syncOutlineTransforms();
    this.guide.syncOutlineTransform();
    this.outlines.setOpacity(this.dataRoot.alpha);
  };

  /** Accès minimal pour la carte miroir et l'affiche (aucune logique métier). */
  private attachFeatures(host: HTMLElement): EngineFeaturesImpl {
    return new EngineFeaturesImpl(host, {
      app: this.app,
      dataRoot: this.dataRoot,
      poleRoots: () => this.poles.view.children as Container[],
      poleGeometry: () => this.poles.geometry(),
      guideView: this.guide.view,
      guideWorld: () => (this.originPos ? toScreen(this.frame, this.originPos) : null),
      decor: [this.nebula.view, this.starfield.view],
      camera: () => this.camera,
      setCamera: (c) => this.setCamera(c),
      reduced: () => this.reduced,
      clearShooting: () => this.shooting.clear(),
      setSnapshotMode: (enabled) => this.setSnapshotMode(enabled),
    });
  }

  private setSnapshotMode(enabled: boolean): void {
    this.outlines.setVisible(!enabled);
    this.poles.setSvgOutlines(!enabled);
    this.guide.setSvgOutlines(!enabled);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sink = null;
    this.features?.dispose();
    window.removeEventListener('pointermove', this.onPointer);
    window.clearTimeout(this.resizeTimer);
    this.app.ticker.remove(this.tick);
    this.silenceAnim?.cancel();
    this.stopGainAnims();
    this.stopIntro();
    this.veil.destroy();
    this.outlines.destroy();
    this.shooting.clear();
    this.silence.stop();
    // texture: false - les textures chargées par Assets sont partagées (StrictMode remonte le moteur)
    this.app.destroy({ removeView: true }, { children: true, texture: false });
  }
}

/** Décalage entre deux pôles qui s'allument en or (motion-spec, acte 4) */
const GAIN_STAGGER = 60;

/** Empreinte des statuts affichés (comparaison d'états, pas de références) */
function statusKey(states: readonly PoleState[]): string {
  return states.map((s) => s.status).join('|');
}

/** Étoiles de fond en rendu Canvas 2D (sans GPU) */
const CANVAS_MAX_STARS = 900;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;
}
