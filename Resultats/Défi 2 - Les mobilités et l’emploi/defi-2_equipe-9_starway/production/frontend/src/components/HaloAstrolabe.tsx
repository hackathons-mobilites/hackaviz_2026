import { arc } from 'd3-shape';
import { animate } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { arcLabels, type HaloSegment } from '../data/halo';
import { astrolabe, color, haloPalette } from '../theme/tokens';

export interface AstrolabeRing {
  segments: HaloSegment[];
  /** Nom et valeur de chaque segment, posés autour de l'anneau (vide = segment sans nom, ex. la piste) */
  items: { name: string; value: string }[];
}

/** outQuart */
const outQuart = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Halo v2 « l'astrolabe » (L-08, motion-spec « Halo v2 ») : un seul anneau gradué dans le panneau,
 * étoile-guide au centre, arcs à bouts arrondis qui partent de midi dans le sens horaire, noms et
 * valeurs autour de l'anneau. L'anneau porte une donnée : il est dessiné en code (d3-shape, SVG).
 * Arcs qui poussent (700 ms outQuart, décalage 80 ms) ; au changement d'onglet (`animKey`), rétraction
 * 280 ms puis repousse, jamais de morphing entre deux catégories. Mouvement réduit : fondu 150 ms.
 * `compact` (comparaison A/B, 150 px) : même dessin à la même échelle relative, sans noms (les valeurs
 * sont dans « Valeurs détaillées »).
 */
export function HaloAstrolabe({
  ring,
  animKey,
  reduced,
  compact = false,
  title,
}: {
  ring: AstrolabeRing;
  animKey: string;
  reduced: boolean;
  compact?: boolean;
  /** Nom accessible du dessin (les valeurs sont lues dans la liste détaillée) */
  title: string;
}) {
  const [shown, setShown] = useState({ ring, key: animKey });
  const [p, setP] = useState(reduced ? 1 : 0);
  const pRef = useRef(p);
  useEffect(() => {
    pRef.current = p;
  }, [p]);

  // Changement d'onglet : rétraction, puis l'anneau suivant pousse. Même onglet : rien ne bouge.
  useEffect(() => {
    let alive = true;
    let ctl: ReturnType<typeof animate> | null = null;
    const n = Math.max(1, ring.segments.length);
    const span = astrolabe.grow + (n - 1) * astrolabe.stagger;
    const grow = () => {
      if (reduced) {
        setP(1);
        return;
      }
      ctl = animate(0, 1, { duration: span / 1000, ease: 'linear', onUpdate: (v) => alive && setP(v) });
    };
    if (shown.key === animKey) {
      if (pRef.current === 0) grow();
      return () => {
        alive = false;
        ctl?.stop();
      };
    }
    if (reduced || pRef.current === 0) {
      setShown({ ring, key: animKey });
      setP(0);
      grow();
    } else {
      const from = pRef.current;
      ctl = animate(from, 0, { duration: astrolabe.retract / 1000, ease: 'easeIn', onUpdate: (v) => alive && setP(v) });
      void Promise.resolve(ctl).then(() => {
        if (!alive) return;
        setShown({ ring, key: animKey });
        setP(0);
        grow();
      });
    }
    return () => {
      alive = false;
      ctl?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- l'animation suit l'onglet (animKey), pas chaque rendu
  }, [animKey, reduced]);

  const k = compact ? astrolabe.sizeCompare / astrolabe.size : 1;
  // Place des noms autour de l'anneau : un panneau de 300 px, noms de 60 px au plus de chaque côté
  const width = compact ? astrolabe.sizeCompare : 300;
  const height = compact ? astrolabe.sizeCompare : 272;
  const outer = compact ? astrolabe.outer * k * 0.66 : Math.min(astrolabe.outer, width / 2 - 58, height / 2 - 36);
  const inner = outer * (astrolabe.inner / astrolabe.outer);
  const segs = shown.ring.segments;
  const n = Math.max(1, segs.length);
  const span = astrolabe.grow + (n - 1) * astrolabe.stagger;
  const local = (i: number) => outQuart(Math.min(1, Math.max(0, (p * span - i * astrolabe.stagger) / astrolabe.grow)));

  const path = arc<{ startAngle: number; endAngle: number }>().innerRadius(inner).outerRadius(outer).cornerRadius(astrolabe.cornerRadius * k).padAngle(astrolabe.padAngle);
  const ticks: { a: number; major: boolean }[] = [];
  for (let t = 0; t < 1 - 1e-9; t += astrolabe.tickStep) {
    ticks.push({ a: t * Math.PI * 2, major: astrolabe.majorTicks.some((m) => Math.abs(m - t) < 1e-6) });
  }
  for (const m of astrolabe.majorTicks) if (!ticks.some((x) => Math.abs(x.a - m * Math.PI * 2) < 1e-6)) ticks.push({ a: m * Math.PI * 2, major: true });
  const labels = compact ? [] : arcLabels(segs, shown.ring.items, outer + astrolabe.labelGap);
  const star = 7 * (compact ? 0.8 : 1);

  return (
    <svg
      className={`halo-astrolabe ${compact ? 'is-compact' : ''} ${reduced ? 'is-reduced' : ''}`}
      viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={title}
    >
      {/* piste et graduations (10 %, plus longues à 25, 50, 75 %) */}
      <circle r={(inner + outer) / 2} fill="none" stroke={haloPalette.track} strokeWidth={outer - inner} />
      {ticks.map(({ a, major }) => {
        const r0 = outer + 2;
        const r1 = r0 + (major ? astrolabe.tickMajor : astrolabe.tick) * (compact ? 0.6 : 1);
        return (
          <line
            key={a}
            x1={Math.sin(a) * r0}
            y1={-Math.cos(a) * r0}
            x2={Math.sin(a) * r1}
            y2={-Math.cos(a) * r1}
            className={`astro-tick ${major ? 'is-major' : ''}`}
          />
        );
      })}
      <g className="astro-arcs">
        {segs.map((seg, i) => {
          const e = local(i);
          if (e <= 0) return null;
          const a0 = seg.start * Math.PI * 2;
          const a1 = a0 + (seg.end - seg.start) * Math.PI * 2 * e;
          if (a1 - a0 < 0.002) return null;
          if (seg.dotted) {
            // Valeur non diffusée (secret statistique) : piste en pointillé, jamais un arc plein
            const rm = (inner + outer) / 2;
            return <circle key={i} r={rm} fill="none" stroke={color.dimRing} strokeWidth={1.2} strokeDasharray="1 4" strokeLinecap="round" />;
          }
          return <path key={i} d={path({ startAngle: a0, endAngle: a1 }) ?? ''} fill={seg.color} fillOpacity={0.92 * (seg.alpha ?? 1)} />;
        })}
      </g>
      {/* étoile-guide au centre : ce panneau parle d'elle */}
      <path
        d={`M0 ${-star} Q0.9 -0.9 ${star} 0 Q0.9 0.9 0 ${star} Q-0.9 0.9 ${-star} 0 Q-0.9 -0.9 0 ${-star} Z`}
        fill={color.guide}
        className="astro-guide"
      />
      {labels.map((l) => {
        if (!l.name && !l.value) return null;
        const visible = local(l.index) >= 1;
        const dy = l.y < -4 ? -16 : l.y > 4 ? 0 : -8;
        return (
          <g key={l.index} className={`astro-label ${visible ? 'is-on' : ''}`}>
            {l.from && <line x1={l.from.x} y1={l.from.y} x2={l.x} y2={l.y + dy + 8} className="astro-leader" />}
            <text x={l.x} y={l.y + dy} textAnchor={l.anchor} className="astro-name">
              {l.name}
            </text>
            <text x={l.x} y={l.y + dy + 16} textAnchor={l.anchor} className="astro-value">
              {l.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
