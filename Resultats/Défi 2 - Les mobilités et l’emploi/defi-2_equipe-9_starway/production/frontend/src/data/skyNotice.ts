import { formatInt } from './format';

/** Ce que sait la carte « aucun résultat » du ciel : tout est lu des données publiées, rien n'est écrit ici. */
export interface SkyNoticeFacts {
  /** Nom court de la commune de départ */
  name: string;
  poleCount: number;
  /** Communes calculées (`meta.access_communes`) */
  computedCount: number;
  communeCount: number;
  /** Le fichier de la commune n'a pas pu être chargé : ce n'est pas un calcul en cours */
  odFailed: boolean;
  /** Texte publié « Pas de station Vélib' » (`meta.velib.out_of_zone`), présent seulement si la commune n'a pas de station en mode Vélib' (D-027) */
  velibOutOfZone: string | null;
  astres44: boolean;
  accessMissing: boolean;
  walkMissing: boolean;
}

/**
 * Titre de la carte centrale du ciel quand un scénario n'a pas de résultat. L'absence de station Vélib' passe AVANT « en cours
 * de calcul » : une commune sans station n'aura jamais ce calcul, l'annoncer en cours serait faux.
 */
export function skyNoticeTitle(f: SkyNoticeFacts): string {
  if (f.odFailed) return `Le chargement des données depuis ${f.name} a échoué : rechargez la page ou réessayez dans un instant (ce n'est pas un calcul en cours).`;
  if (f.velibOutOfZone) return `${f.velibOutOfZone} (${f.name}).`;
  if (f.astres44) return `Ce mode est en cours de calcul pour les ${f.poleCount} astres (depuis ${f.name}).`;
  if (f.accessMissing) return `Le calcul depuis ${f.name} n'est pas encore publié : ${formatInt(f.computedCount)} communes sur ${formatInt(f.communeCount)} le sont à ce jour.`;
  if (f.walkMissing) return `Ce réglage de marche n'est pas encore calculé depuis ${f.name}.`;
  return `Le calcul depuis ${f.name} n'est pas encore publié pour ce scénario (journée-type ou mode).`;
}
