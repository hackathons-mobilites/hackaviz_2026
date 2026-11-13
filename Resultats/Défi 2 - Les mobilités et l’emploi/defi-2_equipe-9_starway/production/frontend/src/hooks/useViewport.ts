import { useSyncExternalStore } from 'react';

let cached = { width: 0, height: 0 };

function read() {
  if (typeof window === 'undefined') return cached;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w !== cached.width || h !== cached.height) cached = { width: w, height: h };
  return cached;
}

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

/** Taille de la fenêtre (le canvas PixiJS suit la même : resizeTo: window). */
export function useViewport(): { width: number; height: number } {
  return useSyncExternalStore(subscribe, read, read);
}
