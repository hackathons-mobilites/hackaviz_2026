/**
 * Heure creuse du panneau de preuve (D-028, bloc `offpeak` de itineraries/{insee}.json.gz, 06h) :
 * temps TC porte à porte pour un départ fixe à 11h00, commune vers pôle (aller) et pôle vers commune
 * (retour). Le départ est un CHOIX DE L'ÉQUIPE, pas une donnée, et ce n'est pas la règle de l'aller du
 * ciel (arrivée avant le début du poste) : le texte le dit toujours. Fonctions PURES.
 */
import type { ItinerariesFile } from './itineraries';
import { optionalSeriesFit, seriesFit } from './seriesGuard';

export interface OffpeakFact {
  /** « 11h00 » */
  clock: string;
  out: number | null;
  ret: number | null;
  /** « en partant à 11h00 : aller 38 min, retour 41 min » */
  text: string;
  /** Phrase de garde (choix de l'équipe) */
  note: string;
}

/** "11:00" → « 11h00 » (minutes toujours écrites, comme le libellé du contrat). */
export function offpeakClock(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${h}h${String(min).padStart(2, '0')}`;
}

function legText(name: string, v: number | null, reason: string | null | undefined, maxTripMin: number | null | undefined): string {
  if (v != null) return `${name} ${v}\u00a0min`;
  const lim = typeof maxTripMin === 'number' && maxTripMin > 0 ? (maxTripMin % 60 === 0 ? `${maxTripMin / 60}\u00a0h` : `${maxTripMin}\u00a0min`) : null;
  if (reason === 'no_trip_within_120' || reason == null) return `${name} : aucun trajet${lim ? ` de ${lim} ou moins` : ''}`;
  return `${name} : non calculé`;
}

/**
 * Temps à l'heure creuse pour un pôle, seulement si le fichier publie le bloc `offpeak` et au moins un
 * sens. null sinon (rien n'est affiché).
 */
export function offpeakFact(file: ItinerariesFile | null | undefined, poleId: string, maxTripMin?: number | null): OffpeakFact | null {
  const op = file?.offpeak;
  if (!op || !Array.isArray(op.out) || !Array.isArray(op.ret)) return null;
  // Garde de longueur (arbitrage du 05/11) : les séries du bloc se lisent par position de `file.poles`, de même longueur
  const n = file.poles.length;
  if (!seriesFit(n, op.out) || !seriesFit(n, op.ret) || !optionalSeriesFit(n, op.reason)) return null;
  const i = file.poles.indexOf(poleId);
  const clock = offpeakClock(op.dep ?? '');
  if (i < 0 || !clock) return null;
  const out = typeof op.out[i] === 'number' ? op.out[i]! : null;
  const ret = typeof op.ret[i] === 'number' ? op.ret[i]! : null;
  if (out == null && ret == null && op.reason?.[i] !== 'no_trip_within_120') return null;
  const reason = op.reason?.[i] ?? null;
  return {
    clock,
    out,
    ret,
    text: `En partant à ${clock} : ${legText('aller', out, reason, maxTripMin)}, ${legText('retour', ret, reason, maxTripMin)}`,
    note: `Heure creuse : départ à ${clock} choisi par l’équipe (pas une donnée), dans les deux sens. Le verdict du ciel reste celui des horaires de la journée-type.`,
  };
}
