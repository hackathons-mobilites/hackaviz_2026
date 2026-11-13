/**
 * Textes de la visite affichés par le lecteur (hors narration). À faire relire par le narrateur
 * (docs/relecture-microcopie.md).
 */
export const TOUR_COPY = {
  /** Carte affichée quand un changement de journée-type ne fait basculer aucun pôle */
  silence: 'À cet horaire, aucun pôle ne change d’état.',
  /** Choix de la version, au clic sur « Lancer la visite » (components/TourChoice.tsx) */
  choiceTrigger: 'Lancer la visite : choisir la version courte ou la version complète',
  choiceTitle: 'Quelle visite voulez-vous lancer ?',
  choiceClose: 'Fermer sans lancer la visite',
  versionShort: 'Version courte',
  versionShortNote: 'La version présentée au jury : le défi et l’essentiel du récit.',
  versionFull: 'Version complète',
  versionFullNote: 'Pour une immersion complète : tout le récit, chaque écran expliqué.',
} as const;
