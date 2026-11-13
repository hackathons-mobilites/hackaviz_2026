import type { ProofBadge } from '../../data/proof';
import { StatusGlyph, type GlyphKind } from '../StatusGlyph';

/** Glyphe du badge : même forme que l'astre (le sens unique « retour seul » attend son glyphe, motion-spec). */
const GLYPH: Record<ProofBadge['kind'], GlyphKind> = {
  accessible: 'accessible',
  out_only: 'out_only',
  in_only: 'none',
  blocked: 'none',
  unknown: 'unknown',
};

/** Badge d'état : glyphe + texte (la couleur n'est jamais seule). */
export function ProofBadgeLine({ badge }: { badge: ProofBadge }) {
  return (
    <p className={`pf-badge pf-badge-${badge.kind}`}>
      <StatusGlyph className="pf-glyph" size={16} kind={GLYPH[badge.kind]} />
      <span>{badge.text}</span>
    </p>
  );
}

/**
 * Or du gain démontré, dit en mots (audit du 03/11, point 2) : glyphe de légende prévu par motion-spec
 * (disque, orbite, seconde orbite fine), texte « Or : gain démontré » et ce qu'il veut dire.
 */
export function GainBadgeLine({ text }: { text: string }) {
  return (
    <p className="pf-badge pf-badge-gain">
      {/* glyphe de légende de l'or, couleur de la palette affichée (mode daltonien : ambre) */}
      <StatusGlyph className="pf-glyph" size={16} kind="gain" />
      <span>
        <strong>Or : gain démontré</strong> · {text}
      </span>
    </p>
  );
}
