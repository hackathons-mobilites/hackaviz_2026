import { useDragControls, type PanInfo } from 'motion/react';
import { useEffect } from 'react';
import { useViewport } from '../hooks/useViewport';
import { isPhoneLayout } from '../sky/layout';
import { motion } from '../theme/tokens';

/** Seuils du glisser pour fermer : distance (px) ou vitesse (px/s) vers le bas. */
const CLOSE_OFFSET = 90;
const CLOSE_VELOCITY = 600;

let openSheets = 0;

export function useIsPhone(): boolean {
  const { width, height } = useViewport();
  return isPhoneLayout(width, height);
}

/** Décision pure : la feuille se ferme-t-elle à la fin du glisser ? */
export function shouldCloseSheet(offsetY: number, velocityY: number): boolean {
  return offsetY > CLOSE_OFFSET || (velocityY > CLOSE_VELOCITY && offsetY > 16);
}

/**
 * Feuille du bas (mise en page téléphone, `isPhoneLayout`) : poignée qui glisse pour fermer, barre de scénario masquée tant
 * qu'une feuille est ouverte (`html.sheet-open`). Le piège de focus (useFocusTrap) et Échap sont
 * gérés par chaque panneau, comme en grand écran.
 */
export function useBottomSheet(enabled: boolean, onClose: () => void) {
  const controls = useDragControls();

  useEffect(() => {
    if (!enabled) return;
    openSheets += 1;
    document.documentElement.classList.add('sheet-open');
    return () => {
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.documentElement.classList.remove('sheet-open');
    };
  }, [enabled]);

  /** Props Motion de la feuille (glisser vertical déclenché depuis la poignée uniquement). */
  const sheetProps = enabled
    ? {
        drag: 'y' as const,
        dragControls: controls,
        dragListener: false,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0, bottom: 0.7 },
        dragSnapToOrigin: true,
        onDragEnd: (_e: unknown, info: PanInfo) => {
          if (shouldCloseSheet(info.offset.y, info.velocity.y)) onClose();
        },
        initial: { y: '100%', opacity: 1 },
        animate: { y: 0, opacity: 1 },
        exit: { y: '100%', opacity: 1 },
        transition: { duration: motion.ui / 1000, ease: motion.cssEasing.ui },
      }
    : {};

  /** Props de la poignée (zone de 44 px de haut) */
  const handleProps = {
    onPointerDown: (e: React.PointerEvent) => controls.start(e),
  };

  return { sheetProps, handleProps };
}
