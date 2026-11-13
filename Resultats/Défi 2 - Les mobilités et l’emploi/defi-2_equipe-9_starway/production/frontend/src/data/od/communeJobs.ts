/**
 * Postes salariés recensés par l'INSEE (EMP01, Flores) d'une commune, lus dans l'index de la table OD : `jobs` est aligné sur
 * `communes`. Fonction PURE, partagée par la visite navigateur et par `npm run tour:resolve`. Aucune valeur écrite ici :
 * commune absente de l'index ou nombre illisible = null.
 */
import type { OdIndex } from './types';

export function communeJobsOf(index: Pick<OdIndex, 'communes' | 'jobs'> | null | undefined, insee: string): number | null {
  if (!index) return null;
  const i = index.communes.indexOf(insee);
  const jobs = i >= 0 ? index.jobs[i] : undefined;
  return typeof jobs === 'number' && Number.isFinite(jobs) && jobs >= 0 ? jobs : null;
}
