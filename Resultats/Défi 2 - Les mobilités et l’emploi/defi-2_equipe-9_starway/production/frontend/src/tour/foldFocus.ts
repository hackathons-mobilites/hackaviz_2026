/**
 * Plis du panneau de preuve commentés par une étape de la visite (lot 5, D-052) : la visite ne fait que poser la marque
 * `data-tour-focus` sur le pli (`.pf-group[data-group]`) ; le pli lui-même s'ouvre, fait défiler et se referme
 * (`components/proof/PfGroup.tsx`). La marque est retirée par `setProofFocus(null)` du contrôleur, à chaque étape et à l'arrêt.
 */
export function focusFolds(ids: readonly string[] | undefined): void {
  for (const id of ids ?? []) {
    // `trajet` : le pli « Détail du trajet » (climatisation et ponctualité de chaque ligne), aller et retour ; les autres : un pli du panneau
    const sel = id === 'trajet' ? '.pf-transports' : `.pf-group[data-group="${id}"]`;
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => el.setAttribute('data-tour-focus', 'true'));
  }
}
