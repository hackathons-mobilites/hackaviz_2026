/**
 * Repère visuel de la visite (retour de Cyril du 10/11) : anneau ou cadre accent autour de l'élément dont parle la voix, et
 * léger voile sur le reste de l'INTERFACE (jamais sur le ciel). Décoratif : `aria-hidden`, aucun pointeur, aucun focus ; les
 * sous-titres ne sont jamais recouverts (zone exclue du dessin). Au téléphone : le repère seul, sans voile.
 * Le QUAND vient de `tour/marks.ts` (fragment de texte → instant de la voix) ; le OÙ de `tourMarkTargets.ts`. Les positions
 * sont relues à chaque image tant qu'un repère est allumé (panneau qui glisse, ciel qui se pose) ; rien n'est relu sinon.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { MarkTarget } from '../tour/marks';
import { color, motion, tourMark } from '../theme/tokens';
import { geometryKey, measureMark, revealMarkTargets, syncMarkedAttr, type MarkGeometry } from './tourMarkTargets';
import './tourMarks.css';

const EMPTY: MarkGeometry = { rings: [], frames: [], panels: [], safe: null, marked: [] };

const VARS = {
  '--tm-color': tourMark.color,
  '--tm-in': `${tourMark.inMs}ms`,
  '--tm-in-reduced': `${motion.reduced}ms`,
  '--tm-scale': String(tourMark.inScale),
  '--tm-ease': `cubic-bezier(${motion.cssEasing.ui.join(',')})`,
} as CSSProperties;

export function TourMarks({ markKey, targets, reduced }: { markKey: string | null; targets: readonly MarkTarget[] | null; reduced: boolean }) {
  // Géométrie ET cibles qu'elle mesure : au changement de repère, la géométrie du repère précédent n'est jamais redessinée sous
  // la nouvelle clé (sinon le contour naissait une image à l'ancienne place, puis sautait : captures du 11/11)
  const [geo, setGeo] = useState<{ key: string; g: MarkGeometry }>({ key: '', g: EMPTY });
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const lastKey = useRef('');
  const id = useId().replace(/:/g, '');
  const targetsKey = targets?.join(',') ?? '';

  useEffect(() => {
    if (!targets?.length) {
      lastKey.current = '';
      syncMarkedAttr([]);
      return;
    }
    // section du panneau annoncée mais hors de l'écran : le panneau défile jusqu'à elle (une fois par repère)
    revealMarkTargets(targets);
    let raf = 0;
    const tick = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const g = measureMark(targets, w > tourMark.phoneMaxWidth);
      syncMarkedAttr(g.marked);
      const k = `${targetsKey}|${w}x${h}|${geometryKey(g)}`;
      if (k !== lastKey.current) {
        lastKey.current = k;
        setGeo({ key: targetsKey, g });
        setVp((v) => (v.w === w && v.h === h ? v : { w, h }));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      syncMarkedAttr([]);
    };
    // targetsKey suit le contenu de `targets` (nouveau tableau à chaque rendu du parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  // Sans cible : rien (la dernière géométrie mesurée n'est pas redessinée)
  const shown = targets?.length && geo.key === targetsKey ? geo.g : EMPTY;
  const on = !!markKey && (shown.rings.length > 0 || shown.frames.length > 0);
  const veilOn = on && shown.panels.length > 0;
  const { w, h } = vp;
  const sw = tourMark.strokePx;
  const anim = reduced ? 'is-reduced' : '';

  return createPortal(
    <svg className="tour-marks" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false" style={VARS} data-mark={on ? markKey! : undefined}>
      <defs>
        <mask id={`${id}-veil`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <rect x={0} y={0} width={w} height={h} fill="black" />
          {shown.panels.map((b, i) => (
            <rect key={`p${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="white" />
          ))}
          {shown.frames.map((b, i) => (
            <rect key={`f${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={tourMark.cornerPx} fill="black" />
          ))}
          {shown.safe && <rect x={shown.safe.x} y={shown.safe.y} width={shown.safe.w} height={shown.safe.h} fill="black" />}
        </mask>
        <mask id={`${id}-safe`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <rect x={0} y={0} width={w} height={h} fill="white" />
          {shown.safe && <rect x={shown.safe.x} y={shown.safe.y} width={shown.safe.w} height={shown.safe.h} fill="black" />}
        </mask>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={tourMark.glowPx / 2} />
        </filter>
      </defs>
      <rect
        className={`tm-veil ${veilOn ? 'is-on' : ''}`}
        x={0}
        y={0}
        width={w}
        height={h}
        fill={color.bg}
        style={{ '--tm-veil': String(tourMark.veilAlpha) } as CSSProperties}
        mask={`url(#${id}-veil)`}
      />
      {on && (
        <g key={markKey} className={`tm-mark ${anim}`} mask={`url(#${id}-safe)`}>
          {shown.frames.map((b, i) => (
            <g key={`f${i}`} className="tm-shape">
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={tourMark.cornerPx} className="tm-glow" strokeWidth={sw * 3} filter={`url(#${id}-glow)`} style={{ opacity: tourMark.glowAlpha }} />
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={tourMark.cornerPx} className="tm-line" strokeWidth={sw} />
            </g>
          ))}
          {shown.rings.map((r, i) => (
            <g key={`r${i}`} className="tm-shape">
              {!r.thin && <circle cx={r.x} cy={r.y} r={r.r} className="tm-glow" strokeWidth={sw * 3} filter={`url(#${id}-glow)`} style={{ opacity: tourMark.glowAlpha }} />}
              <circle cx={r.x} cy={r.y} r={r.r} className="tm-line" strokeWidth={r.thin ? tourMark.litStrokePx : sw} />
            </g>
          ))}
        </g>
      )}
    </svg>,
    document.body,
  );
}
