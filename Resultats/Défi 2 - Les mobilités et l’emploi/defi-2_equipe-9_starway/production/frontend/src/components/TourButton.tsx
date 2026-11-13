import { useRef, useState } from 'react';
import { playReveal } from '../state/reveal';
import { useSkyStore } from '../store/useSkyStore';
import { defaultTour, startTour, tourAvailable } from '../tour/controller';
import { TOUR_COPY } from '../tour/microcopy';
import type { TourScript } from '../tour/types';
import { primeVoice } from '../tour/voice';
import { TourChoice } from './TourChoice';

/**
 * « Lancer la visite » : affiché si le cas est prêt (ou en démo technique), sinon masqué. Le clic ouvre le choix
 * de la version (`TourChoice`). `title` (écran titre) : toujours en contour, « Explorer le ciel » est le seul bouton
 * plein ; la visite part après les temps A et B de la révélation (le prologue fait le temps C).
 */
export function TourButton({ variant = 'ghost' }: { variant?: 'ghost' | 'secondary' | 'title' }) {
  const isDemo = useSkyStore((s) => s.dataset?.origin === 'demo');
  const available = tourAvailable(defaultTour, isDemo);
  const [choosing, setChoosing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Barre du haut, visite prête : bouton plein (l'action du jury). Titre : contour, jamais deux boutons pleins.
  const look = variant === 'title' ? 'btn-secondary' : defaultTour.ready ? 'btn-primary' : variant === 'secondary' ? 'btn-secondary' : 'btn-ghost';
  const cls = `btn ${look} btn-tour`;
  const closeChoice = () => {
    setChoosing(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const start = (script: TourScript) => {
    // Le choix de la version est le geste qui autorise la voix : l'élément audio est débloqué ici, la narration
    // démarre plus tard (après la pose du ciel), sans nouveau geste.
    primeVoice();
    closeChoice();
    if (variant === 'title') void playReveal({ thenTour: () => startTour(script) });
    else startTour(script);
  };
  const icon = (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="btn-icon">
      <path d="M8 5 L19 12 L8 19 Z" fill="currentColor" />
    </svg>
  );
  // Visite pas prête (`ready` false) : bouton masqué, plus de badge « bientôt » le jour du dépôt (D-025, L-13)
  if (!available) return null;
  const demoSuffix = isDemo && !defaultTour.ready ? ' (démo technique)' : '';
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cls}
        aria-haspopup="dialog"
        aria-label={`${TOUR_COPY.choiceTrigger}${demoSuffix}`}
        onClick={() => setChoosing(true)}
      >
        {icon}
        Lancer la visite{demoSuffix}
      </button>
      {choosing && <TourChoice onClose={closeChoice} onChoose={start} />}
    </>
  );
}
