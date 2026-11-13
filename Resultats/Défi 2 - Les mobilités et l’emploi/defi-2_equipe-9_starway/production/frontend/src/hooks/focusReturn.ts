/** Ce qu'il faut du document pour décider d'un retour de focus (faux objets dans les tests, pas de DOM sous Vitest). */
type FocusDoc = Pick<Document, 'activeElement' | 'body'>;
type Focusable = { focus: () => void };
type Container = { contains: (node: Node | null) => boolean };

/**
 * Rend le focus à `target` s'il était dans `container` (un menu qui se ferme) ou s'il est perdu sur BODY (l'élément focalisé vient
 * d'être retiré de la page). Un focus posé ailleurs par l'utilisateur ne bouge pas. Renvoie true si le focus a été rendu.
 */
export function returnFocus(target: Focusable | null | undefined, container: Container | null | undefined, doc: FocusDoc = document): boolean {
  const active = doc.activeElement;
  const lost = !active || active === doc.body;
  if (!target || (!lost && !container?.contains(active))) return false;
  target.focus();
  return true;
}

/** Fin de la visite : le focus revient sur « Lancer la visite » de la barre du haut (les commandes de la visite ont disparu). */
export function returnFocusToTourButton(
  container: Container | null | undefined,
  doc: FocusDoc & Pick<Document, 'querySelector'> = document,
): boolean {
  return returnFocus(doc.querySelector<HTMLElement>('.top-bar .btn-tour'), container, doc);
}
