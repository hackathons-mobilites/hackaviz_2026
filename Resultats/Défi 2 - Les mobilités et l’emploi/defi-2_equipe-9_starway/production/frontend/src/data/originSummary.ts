/**
 * Point de départ du calcul, résumé pour l'ensemble des communes : tout est lu dans
 * communes[].origin.method et meta.origin_methods (libellés publiés par le pipeline).
 * Une commune sans origin publié part du centre de la commune (API Géo).
 */
import type { Commune, Pole } from './types';

/** Libellé écrit quand aucun point de départ n'est publié pour une commune */
export const NO_ORIGIN_LABEL = 'centre de la commune (API Géo)';

export interface OriginGroup {
  /** Code de méthode publié, ou null pour « aucun origin publié » */
  method: string | null;
  label: string;
  count: number;
}

export function originGroups(
  communes: readonly Pick<Commune, 'origin'>[],
  originMethods: Readonly<Record<string, string>> | undefined,
): OriginGroup[] {
  const counts = new Map<string | null, number>();
  for (const c of communes) {
    const m = c.origin?.method ?? null;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([method, count]) => ({
      method,
      count,
      // libellé publié, sinon le code brut (jamais un libellé deviné)
      label: method == null ? NO_ORIGIN_LABEL : (originMethods?.[method] ?? `méthode « ${method} »`),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Le jeu démo (dev) a-t-il les vrais pôles (postes EMP01) ? Les pôles générés portent une source « DÉMO ». */
export function demoUsesRealPoles(poles: readonly Pick<Pole, 'jobs_source'>[]): boolean {
  return poles.length > 0 && poles.every((p) => !/DÉMO/i.test(p.jobs_source));
}
