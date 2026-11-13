import { useEffect, useRef } from 'react';
import { computeFrame, datasetBounds, poleGeometry } from '../sky/layout';
import { fitCamera } from '../state/camera';
import { setCameraNow } from '../state/cameraControls';
import { selectSkyBottom, useSkyStore } from '../store/useSkyStore';
import { useViewport } from './useViewport';

/** Plafond du zoom initial sur mobile (critique v0.4, spec e) */
const MOBILE_MAX_ZOOM = 2;
const PHONE_WIDTH = 430;

/**
 * Mobile : zoom initial qui cadre l'emprise des pôles, LE MÊME pour toutes les communes (dérivé
 * de l'emprise des données, pas d'un scénario). Appliqué une fois, DÈS que le jeu de données est prêt
 * et que la feuille de scénario repliée (montée invisible dès le titre) a été mesurée : pendant le
 * titre, jamais pendant la révélation (sinon le décor, qui suit la caméra, sauterait à la pose).
 */
export function useMobileInitialZoom(): void {
  const viewport = useViewport();
  const dataset = useSkyStore((s) => s.dataset);
  const astres44 = useSkyStore((s) => s.astres44);
  const measured = useSkyStore((s) => s.barMeasured);
  const bottom = useSkyStore(selectSkyBottom);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !dataset || !measured || viewport.width > PHONE_WIDTH) return;
    done.current = true;
    const frame = computeFrame(viewport.width, viewport.height, bottom, datasetBounds(dataset));
    const geo = poleGeometry(dataset.poles, frame, astres44);
    if (!geo.length) return;
    const box = {
      x0: Math.min(...geo.map((g) => g.x - g.r)),
      y0: Math.min(...geo.map((g) => g.y - g.r)),
      x1: Math.max(...geo.map((g) => g.x + g.r)),
      y1: Math.max(...geo.map((g) => g.y + g.r)),
    };
    setCameraNow(fitCamera(box, frame, viewport, MOBILE_MAX_ZOOM));
  }, [dataset, astres44, measured, viewport, bottom]);
}
