/**
 * L'or du gain démontré, dit en mots (audit du 03/11, point 2 ; motion-spec « Renforts permanents ») :
 * la couleur n'est jamais seule. Fonctions PURES. Le gain lui-même suit une seule règle (`goldDelta`,
 * D-056), appliquée par le moteur (`SkyEngine.showGain`, vélo + TC face aux TC seuls, même journée-type,
 * même temps de trajet) et rangée dans le store (`gainReport`) : les textes ne font que la lire.
 */
import { computeDelta, type PoleState, type ScenarioDelta } from './accessibility';
import { formatInt } from './format';
import type { Pole } from './types';

/**
 * L'astre est-il éteint dans le ciel TC calculé commune par commune (table OD, D-019) ? Part TC nulle,
 * communes du pôle toutes mesurées : un pôle non calculé, ou mesuré en partie, ne prouve rien.
 */
function transitCommuneDark(state: PoleState | undefined): boolean {
  return !!state?.od && state.status !== 'unknown' && state.od.reached === 0 && state.od.unknown === 0;
}

/**
 * RÈGLE DE L'OR (D-056), une seule fonction pour le ciel, le compteur, la légende et la visite : un astre est
 * doré si le mode complémentaire le rejoint aller et retour, si les TC seuls ne le rejoignent pas dans `access/`
 * (`transit`, même mesure que le vélo + TC) ET si sa part TC commune par commune est nulle (`communeTransit`, le
 * ciel TC que l'application affiche). `lost` reste l'écart sur `access/` : on ne mesure pas une perte entre
 * deux calculs différents.
 */
export function goldDelta(
  poles: readonly Pole[],
  transit: readonly PoleState[],
  complement: readonly PoleState[],
  communeTransit: readonly PoleState[],
): Pick<ScenarioDelta, 'gained' | 'lost'> {
  const delta = computeDelta(poles, transit, complement);
  const byId = new Map(communeTransit.map((s) => [s.id, s] as const));
  return { gained: delta.gained.filter((id) => transitCommuneDark(byId.get(id))), lost: delta.lost };
}

export interface GainLike {
  shown: boolean;
  gained: readonly string[];
}

/** Mention courte, identique partout (aria-label, résumé, panneau) */
export const GAIN_MARK = 'or : gain démontré';

/** Ce que veut dire l'or pour un pôle (motion-spec, aria-label d'un pôle doré). */
export const GAIN_POLE_TEXT = 'accessible aller et retour en vélo + transports en commun, pas en transports en commun seuls';

/** Le pôle est-il peint en or ? (jamais en diptyque : l'or n'y est pas peint) */
export function isGained(report: GainLike | null | undefined, poleId: string, split = false): boolean {
  return !split && !!report?.shown && report.gained.includes(poleId);
}

/**
 * Phrase du résumé du ciel (lecteur d'écran) : « Dont 3 pôles en or (gain démontré) : accessibles aller
 * et retour en vélo + transports en commun, pas en transports en commun seuls, soit 1 105 553 postes salariés recensés par l'INSEE. »
 * null si aucun or n'est peint. `jobs` = somme des postes des pôles dorés (null : non citée).
 */
export function gainSummaryText(report: GainLike | null | undefined, jobs: number | null, split = false): string | null {
  if (split || !report?.shown || report.gained.length === 0) return null;
  const n = report.gained.length;
  const many = n > 1;
  const tail = jobs != null ? `, soit ${formatInt(jobs)} postes salariés recensés par l'INSEE` : '';
  return `Dont ${n} pôle${many ? 's' : ''} en or (gain démontré) : accessible${many ? 's' : ''} aller et retour en vélo + transports en commun, pas en transports en commun seuls${tail}.`;
}
