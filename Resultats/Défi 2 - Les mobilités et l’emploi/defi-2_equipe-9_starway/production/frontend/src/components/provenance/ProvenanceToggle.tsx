import { useProvenanceStore } from '../../store/provenanceStore';

/**
 * Bouton « Provenance des données » de la barre du haut (même forme que le bouton son : icône 36 px,
 * `aria-pressed`, infobulle). Actif : chaque chiffre affiché montre sa source (jeu, millésime, code)
 * et le lien vers sa fiche. Il ne change ni le ciel, ni les données, ni l'URL.
 */
export function ProvenanceToggle({ className = 'icon-btn icon-btn-top tip-end' }: { className?: string }) {
  const on = useProvenanceStore((s) => s.on);
  const setOn = useProvenanceStore((s) => s.setOn);
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label="Provenance des données"
      onClick={() => setOn(!on)}
      data-tip={
        on
          ? 'Provenance affichée : sous chaque chiffre, sa source (jeu, millésime, code) et le lien vers sa fiche'
          : 'Afficher la provenance des données : la source de chaque chiffre, sans rien changer au ciel'
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 4.5h7.2l8.3 8.3-6.7 6.7-8.3-8.3z"
          fill={on ? 'currentColor' : 'none'}
          fillOpacity={on ? 0.25 : undefined}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="8.3" cy="8.8" r="1.4" fill="currentColor" />
      </svg>
    </button>
  );
}
