import { useEffect, type RefObject } from 'react';
import { selectReducedMotion, useSkyStore } from '../../store/useSkyStore';
import { tourFoldDecision } from './tourFold';

/**
 * Pli et visite guidée (lot 5, D-052) : quand la visite pose `data-tour-focus` sur `root` ou sur un élément qu'il contient, le pli
 * `details` s'ouvre et amène l'élément en haut du panneau (les sous-titres de la visite couvrent le bas du panneau) ; il se referme
 * quand la marque est retirée, s'il a été ouvert par la visite (`tourFoldDecision`). La visite ne fait que poser la marque.
 */
export function useTourFold(root: RefObject<HTMLElement | null>, details: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const section = root.current;
    const fold = details.current;
    if (!section || !fold) return;
    let byTour = false;
    const sync = () => {
      const target = section.hasAttribute('data-tour-focus') ? section : section.querySelector<HTMLElement>('[data-tour-focus]');
      const d = tourFoldDecision(target != null, fold.open, byTour);
      byTour = d.openedByTour;
      if (d.change) fold.toggleAttribute('open', d.open);
      if (d.change && d.open && target) target.scrollIntoView({ block: 'start', behavior: selectReducedMotion(useSkyStore.getState()) ? 'auto' : 'smooth' });
    };
    const observer = new MutationObserver(sync);
    observer.observe(section, { attributes: true, attributeFilter: ['data-tour-focus'], subtree: true });
    sync();
    return () => observer.disconnect();
  }, [root, details]);
}
