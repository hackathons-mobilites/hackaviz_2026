/**
 * Plis du panneau de preuve et visite guidée (chantier C, lot 5, D-052) : décision PURE, testée sans navigateur.
 *
 * La visite souligne un élément du panneau (`data-tour-focus`, posé par `tour/controller.ts`, ex. `.pf-flows`) ou un pli entier
 * (`tour/foldFocus.ts`). Si cet élément est dans un pli fermé, le pli s'ouvre pendant l'étape et se referme ensuite, SEULEMENT s'il
 * a été ouvert par la visite (un pli que le visiteur a ouvert lui-même reste ouvert).
 */
export interface TourFoldDecision {
  /** Faut-il changer l'état du pli ? */
  change: boolean;
  /** État voulu du pli */
  open: boolean;
  /** Le pli est ouvert par la visite (à refermer à la fin de l'étape) */
  openedByTour: boolean;
}

export function tourFoldDecision(focused: boolean, isOpen: boolean, openedByTour: boolean): TourFoldDecision {
  if (focused && !isOpen) return { change: true, open: true, openedByTour: true };
  if (!focused && openedByTour) return { change: isOpen, open: false, openedByTour: false };
  return { change: false, open: isOpen, openedByTour: focused ? openedByTour : false };
}
