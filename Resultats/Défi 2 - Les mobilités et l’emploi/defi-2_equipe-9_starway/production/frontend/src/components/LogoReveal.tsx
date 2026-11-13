import { useEffect, useImperativeHandle, useMemo, useRef, type Ref, type RefObject } from 'react';
import { soundscape } from '../audio/soundscape';
import { LOGO_LETTERS, LOGO_SEGMENTS, LOGO_STARS, LOGO_SYMBOL_BOX, LOGO_VIEWBOX, LOGO_WORD_BOX, SYMBOL_OFFSET } from '../data/logoGeometry';
import { bump, buildLogoTimeline, cameraAt, clamp01, cometAt, easeInOut, easeOut, popScale, sceneZoom } from '../data/logoRevealTimeline';
import { logoReveal as T } from '../theme/tokens';
import './logoReveal.css';

export interface LogoRevealHandle {
  /** La comète file sur tout le M, puis résout : joué au clic sur « Explorer le ciel » */
  sprint: () => Promise<void>;
}

interface LogoRevealProps {
  /** Logo déjà formé (retour au titre, visite enregistrée) */
  instant?: boolean;
  /** Attente avant le début de la scène (ms) : le fondu de la nébuleuse */
  delay?: number;
  /** Haut de cet élément : limite basse de la scène, pour ne jamais passer sur les boutons */
  floorRef?: RefObject<HTMLElement | null>;
  ref?: Ref<LogoRevealHandle>;
}

interface Sprint {
  at: number;
  /** Clic pendant l'ouverture : la chronologie finit en accéléré depuis cet instant */
  warpFrom: number | null;
}

const LAST_STAR = LOGO_STARS.length - 1;
/** Réticule de l'étoile-guide du ciel (PoleLayer), ramené à une demi-largeur de 1 */
const RETICLE = 'M-0.5 -1H-1V-0.5M0.5 -1H1V-0.5M-1 0.5V1H-0.5M1 0.5V1H0.5';

const num = (v: number) => v.toFixed(2);
/** Lecture d'un tableau de longueur connue (une entrée par étoile, par trait ou par lettre) */
const g = <V,>(a: readonly V[], i: number): V => a[i] as V;
/** N'écrit sur le DOM que ce qui change : à l'arrêt, plus aucune écriture */
const put = (el: Element, attr: string, value: string) => {
  if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
};
const hide = (el: Element) => put(el, 'opacity', '0');

/**
 * Logo de l'écran titre, animé (motion-spec, « Le logo se verrouille ») : le symbole, grand et centré au-dessus des
 * boutons, attend dans le noir ; la comète part de l'étoile dorée, va de point en point du M en accélérant, le réticule
 * de l'étoile-guide se referme sur chaque étoile ; au point final, une onde part, la caméra recule jusqu'à la place
 * définitive du logo et le mot STARWAY naît pendant le recul, révélé par une lumière.
 * Survol : l'étoile réagit. Clic : l'animation repart. Géométrie et couleurs : celles du logo officiel, sans retouche.
 * La scène est une fonction du temps, écrite sur le DOM à chaque image (aucun rendu React pendant l'animation), et la
 * boucle s'arrête dès que plus rien ne bouge. Mouvement réduit : ce composant n'est pas utilisé, l'écran titre garde
 * le logo fixe.
 */
export function LogoReveal({ instant = false, delay = 0, floorRef, ref }: Readonly<LogoRevealProps>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tl = useMemo(() => buildLogoTimeline(), []);
  const startRef = useRef<number | null>(null);
  const replayRef = useRef(false);
  const sprintRef = useRef<Sprint | null>(null);
  const pendingRef = useRef<Promise<void> | null>(null);
  const wakeRef = useRef<() => void>(() => undefined);

  useImperativeHandle(
    ref,
    () => ({
      sprint: () => {
        if (pendingRef.current) return pendingRef.current;
        const now = performance.now();
        const t = now - (startRef.current ?? now);
        sprintRef.current = { at: now, warpFrom: t < tl.finalAt ? Math.max(0, t) : null };
        soundscape.logo.sprint();
        wakeRef.current();
        pendingRef.current = new Promise((resolve) => {
          window.setTimeout(() => {
            pendingRef.current = null;
            resolve();
          }, T.sprint);
        });
        return pendingRef.current;
      },
    }),
    [tl],
  );

  useEffect(() => {
    const svg = svgRef.current;
    const button = buttonRef.current;
    if (!svg || !button) return undefined;
    const pick = <E extends Element>(attr: string) => Array.from(svg.querySelectorAll<E>(`[data-${attr}]`));
    const one = <E extends Element>(attr: string) => svg.querySelector<E>(`[data-${attr}]`) as E;
    const stars = pick<SVGGElement>('star');
    const ripples = pick<SVGCircleElement>('ripple');
    const flashes = pick<SVGCircleElement>('flash');
    const reticles = pick<SVGGElement>('reticle');
    const lines = pick<SVGLineElement>('seg');
    const letters = pick<SVGPathElement>('letter');
    const tail = one<SVGPathElement>('tail');
    const tailPaint = one<SVGLinearGradientElement>('tailpaint');
    const head = one<SVGCircleElement>('head');
    const core = one<SVGCircleElement>('core');
    const shock = one<SVGCircleElement>('shock');
    const sweep = one<SVGRectElement>('sweep');
    const sweepGlow = one<SVGCircleElement>('sweepglow');
    const titleBlock = button.closest('.title-block');
    const hot = LOGO_STARS.map(() => 0);
    const wasNear = LOGO_STARS.map(() => false);
    const pointer = { seen: false, cx: 0, cy: 0, x: Infinity, y: Infinity, nx: 0, ny: 0 };
    const smooth = { x: 0, y: 0 };
    let raf = 0;
    let idleTimer = 0;
    let transform = '';

    const wake = () => {
      window.clearTimeout(idleTimer);
      if (!raf) raf = requestAnimationFrame(frame);
    };
    wakeRef.current = wake;

    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer.seen = true;
      pointer.cx = e.clientX;
      pointer.cy = e.clientY;
      pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ny = (e.clientY / window.innerHeight) * 2 - 1;
      wake();
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    /** Pose la caméra sur le SVG (rien du tout quand le logo est à sa place) ; renvoie la taille d'une unité à l'écran */
    const placeCamera = (c: number, push: number): number => {
      const rest = button.getBoundingClientRect();
      const restUnit = rest.width / LOGO_VIEWBOX.width;
      if (c >= 1 && push <= 1) {
        if (transform) {
          transform = '';
          svg.style.transform = '';
        }
        return restUnit;
      }
      const floor = floorRef?.current?.getBoundingClientRect().top ?? window.innerHeight * 0.8;
      const zoneHeight = Math.max(0, floor - T.sceneTop);
      const zoom = sceneZoom({ viewportWidth: window.innerWidth, zoneHeight, restUnit, symbol: LOGO_SYMBOL_BOX });
      const s = zoom ** (1 - c) * push;
      const fx = LOGO_SYMBOL_BOX.cx * restUnit;
      const fy = LOGO_SYMBOL_BOX.cy * restUnit;
      const ox = (window.innerWidth / 2 - rest.left - fx) * (1 - c);
      const oy = (T.sceneTop + zoneHeight / 2 - rest.top - fy) * (1 - c);
      const next = `translate(${num(ox + fx - s * fx)}px, ${num(oy + fy - s * fy)}px) scale(${s.toFixed(4)})`;
      if (next !== transform) {
        transform = next;
        svg.style.transform = next;
      }
      return restUnit * s;
    };

    const frame = (now: number) => {
      raf = 0;
      // Élément sans taille : retiré du document (fin de la sortie du titre, avant le nettoyage de l'effet) ou masqué
      if (button.getBoundingClientRect().width <= 0) {
        if (button.isConnected) raf = requestAnimationFrame(frame);
        return;
      }
      if (startRef.current === null) {
        startRef.current = instant ? now - tl.end - 1 : now + delay;
        if (!instant) soundscape.logo.scenePlay(tl, startRef.current);
      }
      const sp = sprintRef.current;
      const sprintU = sp ? (now - sp.at) / T.sprint : -1;
      const warped = !!sp && sp.warpFrom !== null;
      // Clic pendant l'ouverture : la chronologie court jusqu'au point final, puis reste sur le symbole
      const t =
        sp && sp.warpFrom !== null
          ? sprintU < 1
            ? sp.warpFrom + (tl.finalAt - sp.warpFrom) * sprintU
            : Math.min(tl.finalAt + (sprintU - 1) * T.sprint, tl.pullAt)
          : now - startRef.current;
      const replay = replayRef.current;
      const sprintAfter = sp ? (sprintU - 1) * T.sprint : -1;
      const running = !warped && sprintU >= 0 && sprintU <= 1;

      // Caméra : grand et centré, puis recul jusqu'à la place définitive ; sprint : le logo s'avance un peu
      const c = cameraAt(tl, t, replay);
      const pushed = !sp || warped ? 0 : sprintU <= 1 ? easeOut(sprintU) : 1 - clamp01((sprintAfter - T.sprintHold) / T.sprintBack);
      const unit = placeCamera(c, 1 + (T.sprintZoom - 1) * pushed);
      if (replay && titleBlock) titleBlock.classList.toggle('is-logo-scene', t < tl.titleAt);

      // Position de la souris dans le repère du symbole (qui se déplace avec la caméra)
      if (pointer.seen) {
        const r = svg.getBoundingClientRect();
        pointer.x = ((pointer.cx - r.left) * LOGO_VIEWBOX.width) / r.width - SYMBOL_OFFSET.x;
        pointer.y = ((pointer.cy - r.top) * LOGO_VIEWBOX.height) / r.height - SYMBOL_OFFSET.y;
      }

      // Clic sur le logo : l'ancienne image s'éteint pendant que la caméra revient
      const fading = replay ? 1 - clamp01(t / T.cameraIn) : 0;

      // Décalage à la souris, en pixels à l'écran, ramené en unités du logo
      smooth.x += (pointer.nx - smooth.x) * T.parallaxFollow;
      smooth.y += (pointer.ny - smooth.y) * T.parallaxFollow;
      const reach = (T.parallaxRest + (T.parallaxScene - T.parallaxRest) * (1 - c)) / unit;
      const pos = LOGO_STARS.map((s, i) => ({
        x: s.x + smooth.x * reach * g(T.parallaxDepth, i),
        y: s.y + smooth.y * reach * g(T.parallaxDepth, i),
      }));
      const onM = (f: number) => {
        const seg = Math.max(0, Math.min(LOGO_SEGMENTS.length - 1, Math.floor(f)));
        const p = f - seg;
        return { x: g(pos, seg).x + (g(pos, seg + 1).x - g(pos, seg).x) * p, y: g(pos, seg).y + (g(pos, seg + 1).y - g(pos, seg).y) * p };
      };

      LOGO_STARS.forEach((s, i) => {
        const lockT = g(tl.arrivals, i);
        const p = g(pos, i);
        const u = (t - lockT) / T.lockHold;
        const locked = u >= 0;
        const near = Math.hypot(pointer.x - p.x, pointer.y - p.y) < T.hoverRadius + s.r * 0.5;
        if (near && !g(wasNear, i) && t > tl.end) soundscape.logo.hover(i, now);
        wasNear[i] = near;
        hot[i] = g(hot, i) + ((near ? 1 : 0) - g(hot, i)) * T.hoverFollow;
        const h = g(hot, i);

        // Étoile : en sommeil avant son tour, puis verrouillage ; retour d'énergie après le point final
        const echoAt = tl.finalAt + (LAST_STAR - i) * T.echoStagger;
        const back = bump((t - echoAt) / T.echo);
        const passed = running ? bump((sprintU - i / LAST_STAR) * 3 + 0.5) : 0;
        const dormant = T.dormantOpacity * clamp01(t / T.lockApproach);
        const sleeping = T.dormantScale + (1 - T.dormantScale) * fading;
        const base = locked ? popScale(u) : sleeping;
        const scale = base + back * T.echoScale + h * T.hoverScale + passed * T.sprintStar;
        const star = g(stars, i);
        put(star, 'transform', `translate(${num(p.x)} ${num(p.y)}) scale(${scale.toFixed(3)}) translate(${-s.x} ${-s.y})`);
        put(star, 'opacity', (locked ? 1 : Math.max(dormant, fading)).toFixed(3));

        // Éclair et petite onde, à l'instant du verrouillage
        const flash = g(flashes, i);
        if (u < 0 || u > 1) hide(flash);
        else {
          put(flash, 'cx', num(p.x));
          put(flash, 'cy', num(p.y));
          put(flash, 'r', num(s.r * T.flashSize));
          put(flash, 'opacity', ((1 - u) ** 2).toFixed(3));
        }
        const ripple = g(ripples, i);
        if (u < 0 || u > 1) hide(ripple);
        else {
          put(ripple, 'cx', num(p.x));
          put(ripple, 'cy', num(p.y));
          put(ripple, 'r', num(s.r * (T.rippleFrom + (T.rippleTo - T.rippleFrom) * easeOut(u))));
          put(ripple, 'opacity', ((1 - u) * 0.9).toFixed(3));
        }

        // Réticule : il tourne, se referme et claque au verrouillage, reste en place, repart avec le retour d'énergie
        const pre = clamp01((t - (lockT - T.lockApproach)) / T.lockApproach);
        const out = clamp01((t - echoAt) / T.echo);
        const snap = 1 - T.reticleSnap * bump((t - lockT) / T.reticleSnapTime);
        const open = 1 + (T.reticleOut - 1) * easeOut(out);
        const closing = T.reticleFrom + (T.reticleTo - T.reticleFrom) * easeInOut(pre);
        const opening = pre > 0 && out < 1 ? pre * (1 - out) : 0;
        const opacity = Math.max(opening, h > 0.01 ? h : 0);
        const reticle = g(reticles, i);
        if (opacity <= 0) hide(reticle);
        else {
          const k = s.r * (opening > 0 ? closing * snap * open : T.reticleFrom + (T.reticleTo - T.reticleFrom) * h);
          const angle = opening > 0 ? T.reticleTurn * (1 - easeInOut(pre)) : 0;
          put(reticle, 'transform', `translate(${num(p.x)} ${num(p.y)}) rotate(${angle.toFixed(1)}) scale(${k.toFixed(2)})`);
          put(reticle, 'stroke-width', (T.reticleStroke / (unit * k)).toFixed(4));
          put(reticle, 'opacity', opacity.toFixed(3));
        }
      });

      // Traits : dessinés derrière la comète ; ils suivent les étoiles
      LOGO_SEGMENTS.forEach((q, i) => {
        const a = g(tl.arrivals, i);
        const b = g(tl.arrivals, i + 1);
        const drawn = clamp01((t - a) / (b - a)) ** T.cometEase;
        const p = drawn <= 0 && fading > 0 ? 1 : drawn;
        const fromX = q[0] + g(pos, i).x - g(LOGO_STARS, i).x;
        const fromY = q[1] + g(pos, i).y - g(LOGO_STARS, i).y;
        const toX = q[2] + g(pos, i + 1).x - g(LOGO_STARS, i + 1).x;
        const toY = q[3] + g(pos, i + 1).y - g(LOGO_STARS, i + 1).y;
        const line = g(lines, i);
        put(line, 'x1', num(fromX));
        put(line, 'y1', num(fromY));
        put(line, 'x2', num(fromX + (toX - fromX) * p));
        put(line, 'y2', num(fromY + (toY - fromY) * p));
        put(line, 'opacity', (drawn > 0 ? 0.9 : 0.9 * fading).toFixed(3));
        put(line, 'stroke-width', num(running ? 6 + T.sprintStroke * bump(sprintU) : 6));
      });

      // Comète : ouverture, sprint au clic sur « Explorer le ciel », ou passage discret de temps en temps
      const idleCycle = T.idleEvery + T.idleRun;
      const idleOffset = (time: number) => (time - tl.end - T.idleEvery) % idleCycle;
      const cometFraction = (lag: number): number | null => {
        if (running) {
          const f = (sprintU * T.sprint - lag) / T.sprint;
          return f < 0 ? null : easeInOut(f) * LOGO_SEGMENTS.length;
        }
        if (sp && !warped) return null;
        const at = t - lag;
        const seg = cometAt(tl, at);
        if (seg) return seg.seg + seg.p ** T.cometEase;
        if (at <= tl.end + T.idleEvery) return null;
        const idle = idleOffset(at);
        return idle < T.idleRun ? (idle / T.idleRun) * LOGO_SEGMENTS.length : null;
      };
      const samples: { x: number; y: number; k: number }[] = [];
      for (let k = 0; k <= T.trailSamples; k++) {
        const f = cometFraction(k * T.trailStep);
        if (f !== null) samples.push({ ...onM(f), k });
      }
      const headOn = samples[0]?.k === 0;
      if (headOn && samples[0]) {
        put(head, 'cx', num(samples[0].x));
        put(head, 'cy', num(samples[0].y));
        put(head, 'opacity', '1');
        put(core, 'cx', num(samples[0].x));
        put(core, 'cy', num(samples[0].y));
        put(core, 'opacity', '1');
      } else {
        hide(head);
        hide(core);
      }
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (first && last && samples.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) > 1) {
        const left: string[] = [];
        const right: string[] = [];
        let nx = 0;
        let ny = 0;
        samples.forEach((s, i) => {
          const o = g(samples, Math.min(i + 1, samples.length - 1));
          const q = g(samples, Math.max(i - 1, 0));
          const d = Math.hypot(o.x - q.x, o.y - q.y);
          if (d > 0.01) {
            nx = -(o.y - q.y) / d;
            ny = (o.x - q.x) / d;
          }
          const w = (T.cometWidth / 2) * (1 - s.k / T.trailSamples) ** 1.2;
          left.push(`${num(s.x + nx * w)} ${num(s.y + ny * w)}`);
          right.unshift(`${num(s.x - nx * w)} ${num(s.y - ny * w)}`);
        });
        put(tail, 'd', `M${left.join('L')}L${right.join('L')}Z`);
        put(tailPaint, 'x1', num(first.x));
        put(tailPaint, 'y1', num(first.y));
        put(tailPaint, 'x2', num(last.x));
        put(tailPaint, 'y2', num(last.y));
        put(tail, 'opacity', '1');
      } else hide(tail);

      // Onde du point final, ou de la fin du sprint
      const shockU = sprintAfter > 0 ? sprintAfter / T.shock : sp ? -1 : (t - tl.finalAt) / T.shock;
      if (shockU < 0 || shockU > 1) hide(shock);
      else {
        const end = g(pos, LAST_STAR);
        put(shock, 'cx', num(end.x));
        put(shock, 'cy', num(end.y));
        put(shock, 'r', num(T.shockFrom + T.shockRadius * easeOut(shockU)));
        put(shock, 'stroke-width', num(T.shockStroke * (1 - shockU) + 1));
        put(shock, 'opacity', ((1 - shockU) ** 2 * T.shockOpacity).toFixed(3));
      }

      // Le mot naît lettre par lettre, encore sombre ; la lumière le traverse et le pose à son éclat final
      const sweepU = running ? sprintU : (t - tl.sweepAt) / T.sweep;
      const front = T.sweepFrom + T.sweepTravel * easeInOut(sweepU);
      letters.forEach((el, i) => {
        const e = Math.max(easeOut((t - g(tl.letterAt, i)) / T.letterDuration), fading);
        const passedBy = t >= tl.sweepAt + T.sweep || fading > 0 ? 1 : clamp01((front - LOGO_WORD_BOX.x - i * T.letterPitch) / T.sweepSoftness);
        put(el, 'opacity', (e * (T.letterDim + (1 - T.letterDim) * passedBy)).toFixed(3));
        put(el, 'transform', `translate(${num(-T.letterShift * (1 - e))} 0)`);
      });
      if (sweepU <= 0 || sweepU >= 1) {
        hide(sweep);
        hide(sweepGlow);
      } else {
        put(sweep, 'x', num(front - T.sweepWidth / 2));
        put(sweep, 'opacity', '1');
        put(sweepGlow, 'cx', num(front));
        put(sweepGlow, 'opacity', (T.sweepGlowOpacity * bump(sweepU)).toFixed(3));
      }

      // Tant que quelque chose bouge, on continue ; sinon la boucle s'arrête jusqu'au prochain événement
      const idleNow = t > tl.end + T.idleEvery && idleOffset(t) < T.idleRun + T.trailSamples * T.trailStep;
      const calm = hot.every((v) => v < T.settleEpsilon) && Math.hypot(pointer.nx - smooth.x, pointer.ny - smooth.y) < T.settleEpsilon;
      // Fin du sprint sans révélation (données pas encore prêtes) : la scène reprend là où elle en était
      if (sp && sprintAfter > (warped ? T.sprintHold : Math.max(T.shock, T.sprintHold + T.sprintBack))) {
        if (warped) startRef.current = now - t;
        sprintRef.current = null;
      }
      const moving = t <= tl.end || !calm || !!sprintRef.current || idleNow;
      if (moving) raf = requestAnimationFrame(frame);
      else {
        replayRef.current = false;
        hot.fill(0);
        const untilIdle = idleCycle - ((t - tl.end - T.idleEvery + idleCycle * 2) % idleCycle);
        idleTimer = window.setTimeout(wake, Math.max(0, untilIdle));
      }
    };
    wake();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      window.removeEventListener('pointermove', onPointer);
      wakeRef.current = () => undefined;
      titleBlock?.classList.remove('is-logo-scene');
      soundscape.logo.stop();
    };
  }, [tl, instant, delay, floorRef]);

  const c = T.color;
  return (
    <button
      ref={buttonRef}
      type="button"
      className="logo-reveal"
      aria-label="STARWAY, rejouer l'animation du logo"
      onClick={() => {
        startRef.current = performance.now();
        soundscape.logo.scenePlay(tl, startRef.current, true);
        replayRef.current = true;
        sprintRef.current = null;
        wakeRef.current();
      }}
    >
      <svg ref={svgRef} viewBox={`0 0 ${LOGO_VIEWBOX.width} ${LOGO_VIEWBOX.height}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="lr-path" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="332" y2="0">
            <stop offset="0" stopColor={c.gold} />
            <stop offset="0.45" stopColor={c.lunar} />
            <stop offset="0.85" stopColor={c.cyan} />
            <stop offset="1" stopColor={c.cyan} />
          </linearGradient>
          <linearGradient id="lr-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={c.cyan} stopOpacity="0" />
            <stop offset="0.5" stopColor={c.white} stopOpacity="1" />
            <stop offset="1" stopColor={c.cyan} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lr-tail" data-tailpaint gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={c.white} stopOpacity="1" />
            <stop offset="0.3" stopColor={c.word} stopOpacity="0.8" />
            <stop offset="1" stopColor={c.cyan} stopOpacity="0" />
          </linearGradient>
          <radialGradient id="lr-halo">
            <stop offset="0" stopColor={c.white} stopOpacity="0.95" />
            <stop offset="0.28" stopColor={c.cyan} stopOpacity="0.5" />
            <stop offset="1" stopColor={c.cyan} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="lr-flash">
            <stop offset="0" stopColor={c.white} stopOpacity="0.9" />
            <stop offset="0.4" stopColor={c.white} stopOpacity="0.3" />
            <stop offset="1" stopColor={c.white} stopOpacity="0" />
          </radialGradient>
          {/* Lueur du logo officiel, posée étoile par étoile : même image, bien moins de surface à recalculer */}
          <filter id="lr-glow" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0" result="g" />
            <feMerge>
              <feMergeNode in="g" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="lr-word">
            {LOGO_LETTERS.map((d) => (
              <path key={d} d={d} />
            ))}
          </clipPath>
        </defs>
        <g transform={`translate(${SYMBOL_OFFSET.x} ${SYMBOL_OFFSET.y})`}>
          <circle data-shock className="lr-shock" stroke={c.cyan} opacity="0" />
          {LOGO_SEGMENTS.map((_, i) => (
            <line key={i} data-seg={i} stroke="url(#lr-path)" strokeWidth="6" strokeLinecap="round" opacity="0" />
          ))}
          {LOGO_STARS.map((s, i) => (
            <circle key={i} data-ripple={i} className="lr-ripple" stroke={s.fill} strokeWidth={T.rippleStroke} opacity="0" />
          ))}
          {LOGO_STARS.map((s, i) => (
            <g key={i} data-reticle={i} className="lr-reticle" stroke={s.fill} opacity="0">
              <path d={RETICLE} />
            </g>
          ))}
          {LOGO_STARS.map((s, i) => (
            <g key={i} data-star={i} filter="url(#lr-glow)" opacity="0">
              <path d={s.outer} fill={s.fill} />
              <path d={s.inner} fill={s.core} />
            </g>
          ))}
          {LOGO_STARS.map((_, i) => (
            <circle key={i} data-flash={i} fill="url(#lr-flash)" opacity="0" />
          ))}
          <path data-tail fill="url(#lr-tail)" opacity="0" />
          <circle data-head r={T.cometGlow} fill="url(#lr-halo)" opacity="0" />
          <circle data-core r={T.cometCore} fill={c.white} opacity="0" />
        </g>
        <circle data-sweepglow cy={LOGO_WORD_BOX.y + LOGO_WORD_BOX.height / 2} r={T.sweepGlowRadius} fill="url(#lr-halo)" opacity="0" />
        {LOGO_LETTERS.map((d, i) => (
          <path key={d} data-letter={i} d={d} fill={c.word} opacity="0" />
        ))}
        <g clipPath="url(#lr-word)">
          <rect data-sweep y={LOGO_WORD_BOX.y} width={T.sweepWidth} height={LOGO_WORD_BOX.height} fill="url(#lr-sweep)" opacity="0" />
        </g>
      </svg>
    </button>
  );
}
