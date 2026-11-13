import { AnimatePresence } from 'motion/react';
import { lazy, Suspense, useState } from 'react';
import { useSkyStore } from '../../store/useSkyStore';
import { tourControls } from '../../tour/controller';

const GuideDialog = lazy(() => import('./GuideDialog'));

/**
 * « Aide » de la barre du haut : ouvre la page d'aide complète (`GuideDialog`, chargée à la demande).
 * Le nom : « Aide » plutôt que « Guide », qui se confondrait avec l'étoile-guide et la visite guidée.
 * Une visite guidée en cours se met en pause le temps de lire.
 */
export function GuideButton() {
  const [open, setOpen] = useState(false);
  const show = () => {
    if (useSkyStore.getState().tour.status === 'playing') tourControls.pause();
    setOpen(true);
  };
  return (
    <>
      <button type="button" className="link-btn top-sources guide-btn" aria-haspopup="dialog" onClick={show}>
        Aide
      </button>
      <Suspense fallback={null}>
        <AnimatePresence>{open && <GuideDialog key="guide" onClose={() => setOpen(false)} />}</AnimatePresence>
      </Suspense>
    </>
  );
}
