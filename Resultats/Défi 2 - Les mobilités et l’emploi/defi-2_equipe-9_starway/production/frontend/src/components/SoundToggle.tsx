import { AudioEngine } from '../audio/engine';
import { useSoundStore } from '../audio/soundStore';

/**
 * Bouton son (barre du haut et écran titre : même composant). Libellé constant, état porté par
 * `aria-pressed` (un lecteur d'écran annonce « Son, bouton bascule, activé ») ; l'icône le redit.
 * Le son ne porte aucune information : le couper ne retire rien. Il ne coupe pas la voix de la visite
 * (contrôle « Voix » de la barre de la visite, motion-spec « Son » § Voix).
 */
export function SoundToggle({ className = 'icon-btn icon-btn-top tip-end' }: { className?: string }) {
  const on = useSoundStore((s) => s.on);
  const setOn = useSoundStore((s) => s.setOn);
  if (!AudioEngine.supported()) return null;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label="Son d'ambiance"
      onClick={() => setOn(!on)}
      data-tip={
        on
          ? 'Son activé : ambiance et bruitages, sans information de plus. La voix de la visite a son propre bouton'
          : 'Son coupé : le couper ne retire aucune information. La voix de la visite a son propre bouton'
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
        {on ? (
          <path
            d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"
            stroke="currentColor"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        ) : (
          <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
