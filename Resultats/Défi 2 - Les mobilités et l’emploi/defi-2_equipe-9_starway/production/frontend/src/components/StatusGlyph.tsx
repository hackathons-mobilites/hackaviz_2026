import type { PoleStatus } from '../data/accessibility';
import { usePalette } from '../store/colorVisionStore';
import { color, gainMark, poleLook } from '../theme/tokens';

export type GlyphKind = PoleStatus | 'neutral' | 'part' | 'gain';

/** Arc SVG de centre (10, 10), rayon r, de la fraction a à b du tour (depuis midi, sens horaire). */
function arcPath(r: number, a: number, b: number): string {
  const p = (t: number) => {
    const ang = -Math.PI / 2 + t * 2 * Math.PI;
    return `${(10 + r * Math.cos(ang)).toFixed(2)} ${(10 + r * Math.sin(ang)).toFixed(2)}`;
  };
  return `M${p(a)} A${r} ${r} 0 ${b - a > 0.5 ? 1 : 0} 1 ${p(b)}`;
}

/**
 * Glyphe d'état d'un pôle, mêmes formes que les astres (Poles.ts) : la couleur n'est jamais seule.
 * - accessible : disque cyan plein, contour plein (le seul cyan) ;
 * - out_only : disque éteint, contour plein en haut (l'aller) et en tirets en bas (le retour) ;
 * - none : disque éteint, contour en tirets ;
 * - unknown : contour en points, disque presque vide ;
 * - neutral : perle, sans contour (aucun résultat affiché) ;
 * - part (table OD, D-019) : disque éteint, cœur cyan d'aire ∝ `share`, arc plein sur la part atteinte
 *   depuis midi et tirets sur le reste ;
 * - gain : or du gain démontré, disque plein, orbite pleine et seconde orbite fine (gainMark), comme
 *   l'astre doré ; couleur de la palette affichée (or, ou ambre en mode daltonien).
 * Toujours décoratif (aria-hidden) : le texte voisin porte l'état.
 */
export function StatusGlyph({ kind, size = 20, className, share = 0.5 }: { kind: GlyphKind; size?: number; className?: string; share?: number }) {
  const f = Math.min(1, Math.max(0, share));
  const gain = usePalette().color.gain;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {kind === 'accessible' && (
        <>
          <circle cx="10" cy="10" r="5" fill={color.accessible} />
          <circle cx="10" cy="10" r="7.5" fill="none" stroke={color.accessible} strokeWidth="1.3" />
        </>
      )}
      {kind === 'out_only' && (
        <>
          <circle cx="10" cy="10" r="5" fill={color.dim} opacity={poleLook.coreAlphaOff} />
          <path d="M2.5 10 A7.5 7.5 0 0 1 17.5 10" fill="none" stroke={color.dimRing} strokeWidth="1.5" />
          <path d="M17.5 10 A7.5 7.5 0 0 1 2.5 10" fill="none" stroke={color.dimRing} strokeWidth="1.5" strokeDasharray="2.6 2.1" />
        </>
      )}
      {kind === 'none' && (
        <>
          <circle cx="10" cy="10" r="5" fill={color.dim} opacity={poleLook.coreAlphaOff} />
          <circle cx="10" cy="10" r="7.5" fill="none" stroke={color.dimRing} strokeWidth="1.5" strokeDasharray="2.6 2.1" />
        </>
      )}
      {kind === 'unknown' && (
        <>
          <circle cx="10" cy="10" r="5" fill={color.dim} opacity={poleLook.coreAlphaUnknown} />
          <circle cx="10" cy="10" r="7.5" fill="none" stroke={color.dimRing} strokeWidth="1.25" strokeDasharray="1.9 2.8" />
        </>
      )}
      {kind === 'gain' && (
        <>
          <circle cx="10" cy="10" r="5" fill={gain} />
          <circle cx="10" cy="10" r="7.5" fill="none" stroke={gain} strokeWidth="1.3" />
          {/* r 9,3 : seconde orbite de la légende (motion-spec, renfort permanent 1) */}
          <circle cx="10" cy="10" r="9.3" fill="none" stroke={gain} strokeWidth={gainMark.width} opacity={gainMark.alpha} />
        </>
      )}
      {kind === 'neutral' && <circle cx="10" cy="10" r="5.5" fill={color.neutral} opacity={poleLook.coreAlphaNeutral} />}
      {kind === 'part' && (
        <>
          <circle cx="10" cy="10" r="5" fill={color.dim} opacity={poleLook.coreAlphaOff} />
          {f > 0 && <circle cx="10" cy="10" r={5 * Math.sqrt(f)} fill={color.accessible} />}
          {f >= 1 ? (
            <circle cx="10" cy="10" r="7.5" fill="none" stroke={color.accessible} strokeWidth="1.3" />
          ) : (
            <>
              {f > 0 && <path d={arcPath(7.5, 0, f)} fill="none" stroke={color.accessible} strokeWidth="1.3" />}
              <path d={arcPath(7.5, f, 1)} fill="none" stroke={color.dimRing} strokeWidth="1.5" strokeDasharray="2.6 2.1" />
            </>
          )}
        </>
      )}
    </svg>
  );
}
