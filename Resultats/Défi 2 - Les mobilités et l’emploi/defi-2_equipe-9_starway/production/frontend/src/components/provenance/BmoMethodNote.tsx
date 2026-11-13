import type { BmoMasked } from '../../data/bmo';
import { methodText } from '../../data/bmo';
import { useProvenanceStore } from '../../store/provenanceStore';
import './provenance.css';

/**
 * Mode sources (D-033), ligne de MÉTHODE du bloc des projets de recrutement BMO : somme des cases publiées, « * » non
 * comptée, « non diffusé » jamais 0. Elle accompagne la source (EMP03, GEO04). Ce n'est pas une source de donnée
 * (aucune fiche) : un texte de méthode, donc hors de `ProofNotes.tsx` (qui ne rend que des `ProvenanceNote`), sur le
 * modèle de `MethodNote.tsx`. Rendue seulement mode actif.
 */
export function BmoMethodNote({ masked, className = '' }: { masked: BmoMasked; className?: string }) {
  const on = useProvenanceStore((s) => s.on);
  return on ? <BmoMethodLine masked={masked} className={className} /> : null;
}

/** La ligne seule (rendue pure : testée sans le store, le rendu serveur lit toujours l'état initial du store). */
export function BmoMethodLine({ masked, className = '' }: { masked: BmoMasked; className?: string }) {
  return <p className={`prov-note ${className}`}>{methodText(masked)}</p>;
}
