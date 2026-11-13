import { useRef } from 'react';
import { resetCamera, zoomBy } from '../state/cameraControls';
import { ZOOM_MAX, ZOOM_MIN } from '../state/camera';
import { useReservedRect } from '../store/overlayRects';
import { useSkyStore } from '../store/useSkyStore';

/**
 * Boutons + / − / recentrer (la molette, le pincement et le glisser font la même chose).
 * Zone réservée du ciel (arbitrage de Nicolas du 05/11, mobile 390 px) : aucun nom de pôle n'est posé dessous.
 */
export function ZoomControls() {
  const k = useSkyStore((s) => s.camera.k);
  const ref = useRef<HTMLDivElement>(null);
  useReservedRect('zoom', ref, true);
  return (
    <div ref={ref} className="zoom-controls" role="group" aria-label="Zoom du ciel">
      <button type="button" className="icon-btn" onClick={() => zoomBy(1.6)} disabled={k >= ZOOM_MAX - 1e-3} aria-label="Zoomer">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.6)} disabled={k <= ZOOM_MIN + 1e-3} aria-label="Dézoomer">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="icon-btn" onClick={resetCamera} disabled={k <= ZOOM_MIN + 1e-3} aria-label="Recentrer le ciel">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {Math.abs(k - 1) > 0.01 && (
        <span className="zoom-level mono" aria-live="polite">
          {k.toFixed(1).replace('.', ',')}×
        </span>
      )}
    </div>
  );
}
