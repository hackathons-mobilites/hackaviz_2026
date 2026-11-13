/**
 * « Mes réglages » : résumé et textes de l'entrée unique qui regroupe « Mes abonnements » et « Ce qu'il me faut sur mon
 * trajet » (retour de Nicolas du 09/11). Fonctions PURES. Ces réglages restent hors scénario : jamais dans l'URL, un lien
 * copié, la visite guidée ni `?record=1`.
 */
import type { SubscriptionsFile } from './subscriptions';

export const SETTINGS_TITLE = 'Mes réglages';
export const SETTINGS_EMPTY = 'Aucun réglage';
export const SETTINGS_HELP = "Cochez ce que vous avez et ce qu'il vous faut, puis enregistrez.";
export const SETTINGS_SAVED = 'Enregistré dans ce navigateur';
export const SETTINGS_NOT_STORED = 'Appliqué pour cette session : ce navigateur refuse de garder le choix';

/** Abonnement enregistré absent de la liste publiée (le panneau dit alors « coût affiché hors abonnement »). */
export const TRANSIT_TO_REVIEW = 'Abonnement à revoir';
export const VELIB_TO_REVIEW = "Vélib' à revoir";

/** « 2 besoins », « 1 besoin » ; null quand aucune case n'est cochée. */
export function needsCountText(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? '1 besoin' : `${n} besoins`;
}

/** Rappel du panneau et de la légende : « aucun coché », « 1 coché », « 2 cochés ». */
/**
 * Pli « Ce qu'il me faut sur mon trajet » d'un astre, quand aucun besoin n'est coché (retour de Cyril, validé par Nicolas le
 * 11/11) : à quoi sert le pli, en tête, à la place de « Mes besoins : aucun coché ». `link` est écrit comme un bouton qui ouvre
 * « Mes réglages » ; la phrase entière se lit `before + link + after`.
 */
export const NEEDS_EMPTY_HINT = {
  before: 'Indiquez dans ',
  link: 'Mes réglages',
  after: ' ce dont vous avez besoin sur un trajet : ce pli vous dira si celui-ci y répond.',
} as const;

export function needsRecallText(n: number): string {
  if (n <= 0) return 'aucun coché';
  return n === 1 ? '1 coché' : `${n} cochés`;
}

/**
 * Rappel « Ce qu'il me faut sur mon trajet : N cochés · Modifier » dans la légende du ciel (audit d'affichage du 10/11, lot 4) : un
 * réglage n'est pas une information ; sans aucune case cochée (« aucun coché »), la légende ne l'écrit pas. Le réglage reste dans
 * « Mes réglages » et dans le pli « Ce qu'il me faut sur mon trajet » d'un astre.
 */
export function legendNeedsRecallShown(p: { published: boolean; origin: boolean; pearl: boolean; checked: number }): boolean {
  return p.published && p.origin && !p.pearl && p.checked > 0;
}

/**
 * Libellé de l'abonnement TC : null sans abonnement, ou tant que le fichier n'est pas chargé (rien n'est affirmé avant de
 * pouvoir le lire) ; un identifiant inconnu du fichier publié est signalé, pas masqué.
 */
export function transitLabelOf(file: SubscriptionsFile | null, id: string | null): string | null {
  if (!file || !id) return null;
  const option = file.transit.options.find((o) => o.id === id);
  return option ? (option.label ?? option.id) : TRANSIT_TO_REVIEW;
}

/** Libellé Vélib' : le Ticket-V à la course (`kind: 'ride'`) vaut « aucun abonnement », comme dans le choix proposé. */
export function velibLabelOf(file: SubscriptionsFile | null, id: string | null): string | null {
  if (!file || !id) return null;
  const offer = file.velib.offers.find((o) => o.id === id);
  if (!offer) return VELIB_TO_REVIEW;
  return offer.kind === 'ride' ? null : `Vélib' ${offer.label ?? offer.id}`;
}

/** Abonnements seuls, pour l'onglet : « Navigo Annuel · Vélib' V-Plus », ou null. */
export function subscriptionsText(transitLabel: string | null, velibLabel: string | null): string | null {
  return [transitLabel, velibLabel].filter(Boolean).join(' · ') || null;
}

/** Résumé d'une ligne de l'entrée « Mes réglages » : « Navigo Annuel · 2 besoins », ou « Aucun réglage ». */
export function settingsSummary(input: { transitLabel: string | null; velibLabel: string | null; needsCount: number }): string {
  return [subscriptionsText(input.transitLabel, input.velibLabel), needsCountText(input.needsCount)].filter(Boolean).join(' · ') || SETTINGS_EMPTY;
}
