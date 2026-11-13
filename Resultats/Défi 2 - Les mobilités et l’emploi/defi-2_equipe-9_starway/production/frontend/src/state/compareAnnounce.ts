/**
 * Annonce aux lecteurs d'écran d'un changement de comparaison (retours du testeur KBS, 10/11) : entrée, commune B
 * changée, ou comparaison quittée. Fonction pure ; la barre du scénario la lit dans une zone `aria-live` polie.
 * Rien si la comparaison n'a pas changé, ni en silence (`silent` : visite en cours, dont la narration le dit déjà,
 * ou révélation pas finie, quand un lien partagé pose la comparaison).
 */
export function compareAnnouncement(
  previous: string | null,
  next: string | null,
  originName: string | null,
  nameOf: (insee: string) => string,
  silent: boolean,
): string {
  if (silent || previous === next) return '';
  if (next) return `Comparaison avec ${nameOf(next)} : deux ciels côte à côte.`;
  return originName ? `Comparaison quittée : ciel de ${originName} seul.` : 'Comparaison quittée.';
}
