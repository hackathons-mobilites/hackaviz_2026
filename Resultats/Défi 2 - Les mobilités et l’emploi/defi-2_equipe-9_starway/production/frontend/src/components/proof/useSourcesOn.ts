import { useProvenanceStore } from '../../store/provenanceStore';

/**
 * Mode sources actif ? Pour les textes construits par une fonction (règle d'affichage finale du 11/11, D-064) : la phrase est écrite en
 * clair en mode sources, sinon rangée dans un « i » existant. Les autres précisions passent par `SourceTip`.
 */
export function useSourcesOn(): boolean {
  return useProvenanceStore((s) => s.on);
}
