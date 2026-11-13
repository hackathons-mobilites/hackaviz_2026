/**
 * Textes du ciel calculé sur la table OD (D-019) : compteur, résumé lu par les lecteurs d'écran,
 * liste du ciel. Fonctions PURES ; chaque nombre vient du résultat OD (index.jobs, Flores).
 */
import type { OdSkyTotals, PoleOdPart, SkyTotals } from '../accessibility';
import { formatInt, formatPercent } from '../format';
import { selfJobsText } from './texts';

const pct = (part: number, whole: number) => (whole > 0 ? formatPercent((part / whole) * 100) : null);

/** Part = Atteints / Postes, sans la commune de départ (trajet non mesuré, décision de Nicolas du 05/11) : 0 à 1, ou null. */
export function odShare(od: Pick<OdSkyTotals, 'reachedAll' | 'measurableJobs'>): number | null {
  return od.measurableJobs > 0 ? od.reachedAll / od.measurableJobs : null;
}

/** « Votre commune : 61 134 postes, trajet non mesuré » (majuscule initiale) ; null si la commune de départ n'a pas de poste. */
export function selfJobsLine(selfJobs: number): string | null {
  if (!(selfJobs > 0)) return null;
  const t = selfJobsText(selfJobs);
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
}

/**
 * « 1 234 567 postes salariés sont atteints aller et retour, soit 19,2 % des 6 357 711 postes d'Île-de-France
 * hors votre commune » : la commune de départ sort du total (trajet non mesuré), elle est dite à part.
 */
export function odCounterDetail(od: OdSkyTotals, budget: number, jobsYear?: number | null): string {
  const share = pct(od.reachedAll, od.measurableJobs);
  const scope = od.selfJobs > 0 ? ' hors votre commune' : '';
  const parts = [
    `${formatInt(od.reachedAll)} postes salariés sont atteints aller et retour en ${budget} min ou moins par sens` +
      (share ? `, soit ${share} des ${formatInt(od.measurableJobs)} postes d'Île-de-France${scope}${jobsYear ? ` (Flores ${jobsYear})` : ''}` : ''),
    `dans ${formatInt(od.reachedCommunes)} commune${od.reachedCommunes > 1 ? 's' : ''} sur ${formatInt(od.communes)}`,
  ];
  let text = `${parts.join(', ')}.`;
  const self = selfJobsLine(od.selfJobs);
  if (self) text += ` ${self} (ni atteints, ni non atteints, hors du total et du pourcentage).`;
  if (od.unknownJobs > 0) text += ` ${formatInt(od.unknownJobs)} postes non calculés.`;
  return text;
}

/** « La Défense : 41 % (213 000 sur 520 000) » ; null si le pôle n'a pas de part (aucun poste mesurable). */
export function poleShareLine(name: string, part: Pick<PoleOdPart, 'reached' | 'measurable' | 'share'>): string {
  const share = part.share != null ? formatPercent(part.share * 100) : null;
  return `${name} : ${share ?? '-'} (${formatInt(part.reached)} sur ${formatInt(part.measurable)})`;
}

/** Phrase de l'état d'un pôle lu en part (liste du ciel, aria-label) : jamais « accessible » pour une part. */
export function poleShareState(part: Pick<PoleOdPart, 'reached' | 'measurable' | 'share' | 'reachedCommunes' | 'communes' | 'self'>): string {
  const self = part.self > 0 ? selfJobsText(part.self) : null;
  // Pôle réduit à la commune de départ : rien n'est mesuré (ce n'est pas « aucun poste atteint »)
  if (part.measurable <= 0 && self) return self;
  const base =
    part.reached <= 0
      ? 'aucun poste atteint aller et retour'
      : `${part.share != null ? `${formatPercent(part.share * 100)} des postes` : 'des postes'} atteints aller et retour (${part.reachedCommunes} commune${part.reachedCommunes > 1 ? 's' : ''} sur ${part.communes})`;
  return self ? `${base} ; ${self}` : base;
}

export interface OdSummaryInput {
  originName: string;
  shiftLabel: string;
  modeLabel: string;
  budget: number;
  totals: SkyTotals;
}

/** Résumé textuel du ciel OD (zone annoncée) ; null si les totaux OD manquent. */
export function odSkySummary(i: OdSummaryInput): string | null {
  const od = i.totals.od;
  if (!od) return null;
  const share = pct(od.reachedAll, od.measurableJobs);
  const self = selfJobsLine(od.selfJobs);
  return (
    `Depuis ${i.originName}, horaires ${i.shiftLabel}, ${i.modeLabel.toLowerCase()}, en ${i.budget} minutes ou moins par sens : ` +
    `${formatInt(od.reachedAll)} postes salariés recensés par l'INSEE sont atteints aller et retour${share ? `, soit ${share} des postes d'Île-de-France${self ? ' hors votre commune' : ''}` : ''}, ` +
    `dans ${formatInt(od.reachedCommunes)} communes sur ${formatInt(od.communes)}. ` +
    `${self ? `${self}. ` : ''}` +
    `${i.totals.accessibleCount} pôle${i.totals.accessibleCount > 1 ? 's' : ''} sur ${i.totals.poleCount} éclairé${i.totals.accessibleCount > 1 ? 's' : ''} en partie ou en entier.`
  );
}
