/**
 * Couverture des modes partiels (meta.mode_coverage, D-014) : mode → codes INSEE calculés.
 * Un mode absent de mode_coverage est calculé pour toutes les communes présentes dans access/.
 * Le type est déclaré dans Meta (types.ts), tel que l'écrit le pipeline.
 */
import type { AccessFile, Meta, ModeId } from './types';

export function modeComputedFor(meta: Meta, mode: ModeId, insee: string | null): boolean {
  const list = meta.mode_coverage?.[mode];
  if (!list) return true;
  return !!insee && list.includes(insee);
}

/**
 * Portée d'un mode partiel en clair : « calculé pour 12 communes seulement », « pas encore calculé »,
 * ou null si le mode est publié pour toutes les communes. Le nombre vient de meta.mode_coverage.
 */
export function modeCoverageText(meta: Meta, mode: ModeId): string | null {
  const list = meta.mode_coverage?.[mode];
  if (!list) return null;
  if (!list.length) return 'pas encore calculé';
  const n = `${list.length} commune${list.length > 1 ? 's' : ''}`;
  // Vélib' (D-027) : la couverture est celle des stations, pas un calcul en cours
  return mode === 'velib' ? `${n} avec une station seulement` : `calculé pour ${n} seulement`;
}

/**
 * Le mode a-t-il des données dans le fichier access/ de la commune ? `car_traffic` (D-029) n'est jamais
 * publié : il est DÉDUIT de sa série de base (`meta.car_congestion.base_mode`, « car ») par
 * data/congestion.ts ; il est donc disponible dès que cette série et `meta.car_congestion` existent.
 */
export function modePublishedIn(meta: Pick<Meta, 'car_congestion'>, file: Pick<AccessFile, 'modes'>, mode: ModeId): boolean {
  if (mode === 'car_traffic') return !!meta.car_congestion && !!file.modes[meta.car_congestion.base_mode ?? 'car'];
  return !!file.modes[mode];
}

/**
 * Raison affichée à côté d'un mode grisé dans le menu : Vélib' hors zone → texte publié
 * `meta.velib.out_of_zone` (« pas de station Vélib' dans cette commune ») ; sinon la portée du mode
 * (modeCoverageText) ou « pas encore calculé ».
 */
export function modeUnavailableText(meta: Meta, mode: ModeId, insee: string | null): string {
  if (mode === 'velib' && insee && !modeComputedFor(meta, mode, insee) && meta.velib?.out_of_zone) {
    const t = meta.velib.out_of_zone;
    return t.charAt(0).toLowerCase() + t.slice(1);
  }
  return modeCoverageText(meta, mode) ?? 'pas encore calculé';
}

/**
 * Message quand le mode choisi n'est pas publié pour la commune (lien partagé, changement de commune) :
 * « Vélo + TC non calculé pour cette commune (calculé pour 12 communes seulement). » ; null sinon.
 * Vélib' (D-027) : le texte publié `meta.velib.out_of_zone` (« Pas de station Vélib' dans cette commune »).
 */
export function modeMissingMessage(meta: Meta, mode: ModeId, insee: string | null, label: string): string | null {
  if (!insee || modeComputedFor(meta, mode, insee)) return null;
  if (mode === 'velib' && meta.velib?.out_of_zone) return `${meta.velib.out_of_zone}.`;
  const scope = modeCoverageText(meta, mode);
  return `${label} non calculé pour cette commune${scope && scope !== 'pas encore calculé' ? ` (${scope})` : ''}.`;
}
