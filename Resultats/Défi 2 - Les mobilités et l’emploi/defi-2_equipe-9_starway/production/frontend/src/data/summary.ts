import type { SkyTotals } from './accessibility';
import { formatInt } from './format';

/** Message pendant le chargement des temps de trajet (rien n'est encore allumé ni annoncé) */
export const LOADING_MESSAGE = 'Chargement des temps de trajet…';

/**
 * Message quand access/{insee}.json n'existe pas : si aucune commune n'est encore exportée
 * (meta.access_communes vide), le calcul est en cours pour toutes ; sinon, pas encore pour celle-ci.
 */
export function missingAccessMessage(accessCommunes: readonly string[] | undefined): string {
  return Array.isArray(accessCommunes) && accessCommunes.length === 0
    ? 'Accessibilité en cours de calcul.'
    : 'Accessibilité pas encore calculée pour cette commune.';
}

export interface SummaryInput {
  originName: string | null;
  dayLabel: string;
  modeLabel: string;
  budget: number;
  totals: SkyTotals;
  accessMissing: boolean;
  accessCommunes?: readonly string[];
}

/** Résumé textuel de l'état du ciel (alternative textuelle, aria-live). */
export function skySummary(i: SummaryInput): string {
  if (!i.originName) {
    return `Le ciel compte ${i.totals.poleCount} pôles d'emploi. Choisissez une commune de départ pour voir ceux qui s'allument.`;
  }
  if (i.accessMissing) {
    return `${i.originName} : ${missingAccessMessage(i.accessCommunes)} Le ciel reste neutre.`;
  }
  if (!i.totals.hasData) {
    return `Depuis ${i.originName}, ce scénario (journée-type ${i.dayLabel}, ${i.modeLabel.toLowerCase()}) n'est pas encore calculé : le ciel reste neutre.`;
  }
  const jobs = i.totals.jobs == null ? 'un nombre de postes non disponible' : `${formatInt(i.totals.jobs)} postes salariés recensés par l'INSEE`;
  return (
    `Depuis ${i.originName}, journée-type ${i.dayLabel}, ${i.modeLabel.toLowerCase()} : ` +
    `${i.totals.accessibleCount} pôle${i.totals.accessibleCount > 1 ? 's' : ''} sur ${i.totals.poleCount} ` +
    `accessible${i.totals.accessibleCount > 1 ? 's' : ''} aller et retour en ${i.budget} minutes ou moins par sens, soit ${jobs}.`
  );
}
