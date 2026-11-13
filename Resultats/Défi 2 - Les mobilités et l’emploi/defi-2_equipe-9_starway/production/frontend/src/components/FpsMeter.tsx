import { useEffect, useState } from 'react';
import { readFps } from '../store/skyBridge';

/** Compteur d'images par seconde, affiché uniquement avec ?fps=1 (mesure de perf). */
export function FpsMeter() {
  const [enabled] = useState(() => new URLSearchParams(window.location.search).get('fps') === '1');
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setFps(readFps()), 500);
    return () => window.clearInterval(id);
  }, [enabled]);
  if (!enabled) return null;
  return (
    <div className="fps-meter" aria-hidden="true">
      {fps == null ? '- fps' : `${Math.round(fps)} fps`}
    </div>
  );
}
