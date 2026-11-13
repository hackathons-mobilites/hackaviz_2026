import { serviceWeekday } from '../../data/proof';
import { shortDate } from '../../data/provenance';
import { nightNetworkMethodText, nightReturnMethodText, calcMethodText } from '../../data/od/texts';
import type { OdTimeSegment } from '../../data/od/types';
import { useProvenanceStore } from '../../store/provenanceStore';
import { useSkyStore } from '../../store/useSkyStore';
import './provenance.css';

/**
 * Mode sources (D-033), ligne de MÉTHODE des horaires libres calculés sur un réseau de nuit (D-040) : le matin de la grille
 * est calculé sur les horaires IDFM complétés des courses de la veille codées 24:00 et plus, le soir sur ces horaires
 * complétés des courses du lendemain parties avant 3h ; les deux viennent du même mardi type. Plages, jour et date lus dans
 * `index.time_segments` et `meta.service_date`. Texte de
 * méthode (aucune fiche de source ici : la note `CodeSourceNote` de ProofOd la cite). Rien sans le mode, sans plage de nuit.
 */
export function NightNetworkMethodNote({ segments, className = '' }: { segments: readonly OdTimeSegment[] | undefined; className?: string }) {
  const on = useProvenanceStore((s) => s.on);
  const ds = useSkyStore((s) => s.dataset);
  if (!on || !ds || ds.origin !== 'real') return null;
  const day = ds.meta.service_date;
  const text = nightNetworkMethodText(segments, serviceWeekday(day), shortDate(day));
  return text ? <p className={`prov-note ${className}`}>{text}</p> : null;
}

/**
 * Mode sources (D-033), ligne de MÉTHODE d'un poste de nuit : le retour du matin est lu dans les
 * horaires du même jour type (jour et date de `meta.service_date`), pas dans ceux du lendemain. Ce
 * n'est pas une source de donnée (aucune fiche) : un texte de méthode, donc hors de `ProofNotes.tsx`
 * (qui ne rend que des `ProvenanceNote`). Rendue seulement mode actif, comme les notes de provenance.
 */
export function NightReturnMethodNote({ className = '' }: { className?: string }) {
  const on = useProvenanceStore((s) => s.on);
  const ds = useSkyStore((s) => s.dataset);
  if (!on || !ds || ds.origin !== 'real') return null;
  const day = ds.meta.service_date;
  return <p className={`prov-note ${className}`}>{nightReturnMethodText(serviceWeekday(day), shortDate(day))}</p>;
}

/**
 * Mode sources (D-033), ligne de MÉTHODE du calcul des postes atteints (aller, retour attente comprise, commune
 * comptée entière, Part = Atteints / Postes). Texte de méthode sans donnée : aucune fiche, rendu seulement mode actif.
 */
export function CalcMethodNote({ timeDependent, className = '' }: { timeDependent: boolean; className?: string }) {
  const on = useProvenanceStore((s) => s.on);
  const ds = useSkyStore((s) => s.dataset);
  if (!on || !ds || ds.origin !== 'real') return null;
  return <p className={`prov-note ${className}`}>{calcMethodText(timeDependent)}</p>;
}
