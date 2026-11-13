import './skipLink.css';

/**
 * Lien d'évitement, premier arrêt de Tab, visible seulement au focus : saute la barre du haut et les astres (44 boutons) vers la barre de
 * scénario. Le focus se pose sur la barre elle-même : le Tab suivant arrive sur sa première commande, sans ouvrir la liste des communes.
 */
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#scenario-options"
      onClick={(e) => {
        e.preventDefault(); // pas de #ancre dans l'adresse : l'URL porte le scénario
        const bar = document.getElementById('scenario-options');
        if (!bar) return;
        bar.tabIndex = -1;
        bar.focus();
      }}
    >
      Aller à la barre de scénario
    </a>
  );
}
