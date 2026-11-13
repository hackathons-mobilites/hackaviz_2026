import { NEEDS_METHOD_TEXT } from '../../data/needs';
import { useProvenanceStore } from '../../store/provenanceStore';
import './provenance.css';

/**
 * Mode sources (D-033), ligne de MÉTHODE de « Ce qu'il me faut sur mon trajet » : quand une case est remplie, quand un
 * astre est marqué. Texte de méthode, pas une source (aucune fiche) : hors de `ProofNotes.tsx`, sur le modèle de
 * `BmoMethodNote.tsx`. Rendue seulement mode actif.
 */
export function NeedsMethodNote({ className = '' }: { className?: string }) {
  const on = useProvenanceStore((s) => s.on);
  return on ? <NeedsMethodLine className={className} /> : null;
}

/** La ligne seule (testable sans le store). */
export function NeedsMethodLine({ className = '' }: { className?: string }) {
  return <p className={`prov-note ${className}`}>{NEEDS_METHOD_TEXT}</p>;
}
