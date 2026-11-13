import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';

/** Interrupteur « Réduire les animations » (barre du haut et écran titre : même composant). */
export function ReducedMotionToggle({ className = 'icon-btn icon-btn-top tip-end' }: { className?: string }) {
  const reduced = useSkyStore(selectReducedMotion);
  const setUser = useSkyStore((s) => s.setReducedMotionUser);
  return (
    <button
      type="button"
      className={className}
      aria-pressed={reduced}
      aria-label={reduced ? 'Animations réduites (activer les animations)' : 'Réduire les animations'}
      onClick={() => setUser(!reduced)}
      data-tip={
        reduced
          ? 'Animations réduites (cliquer pour les rétablir) : l’information reste identique'
          : 'Réduire les animations : sans parallaxe, scintillement ni traînées ; l’information reste identique'
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {reduced ? (
          <path d="M8 6v12M16 6v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <path d="M3 12c3-6 6-6 9 0s6 6 9 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
