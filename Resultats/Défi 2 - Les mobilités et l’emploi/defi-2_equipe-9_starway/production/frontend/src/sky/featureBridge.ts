/**
 * Pont entre l'interface (carte miroir, affiche) et un moteur du ciel, sans importer PixiJS côté React.
 * Chaque moteur s'enregistre avec l'élément hôte de son canvas (.sky-host-A, .sky-host-B).
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Positions géographiques projetées (px écran) : une par pôle (ordre de poles.json), + étoile-guide. */
export interface MirrorTargets {
  poles: (ScreenPoint | null)[];
  guide: ScreenPoint | null;
  /** Carte zoomée : l'étoile-guide est hors du cadre de la carte (elle n'est pas dessinée, sa position suit) */
  guideOut?: boolean;
}

export interface SkySnapshot {
  /** Image des astres (pôles, étoile-guide, halo) sur fond transparent, à `scale` × la taille écran */
  canvas: HTMLCanvasElement;
  /** Zone extraite, en px écran (caméra neutre) */
  region: { x: number; y: number; w: number; h: number };
  scale: number;
  /** Disques en px écran (caméra neutre), ordre de poles.json */
  poles: { x: number; y: number; r: number }[];
  guide: ScreenPoint | null;
}

export interface EngineFeatures {
  /** Ciel → carte (targets) ou carte → ciel (null). Résout à la fin de la chorégraphie du moteur. */
  setMirror(targets: MirrorTargets | null): Promise<void>;
  /**
   * Carte en diptyque : les deux ciels n'occupent chacun qu'une moitié d'écran et ne peuvent pas
   * voler vers une carte unique ; leurs astres s'effacent (280 ms) et la carte dessine les disques.
   */
  setMirrorHidden(hidden: boolean): Promise<void>;
  /** Met à jour les cibles sans animation (redimensionnement pendant que la carte est ouverte). */
  updateMirrorTargets(targets: MirrorTargets): void;
  /** Image du ciel pour l'affiche (caméra neutre). */
  snapshot(resolution: number, pad: number): SkySnapshot | null;
}

const engines = new Map<Element, EngineFeatures>();
const listeners = new Set<() => void>();

export function registerEngineFeatures(host: Element, api: EngineFeatures): () => void {
  engines.set(host, api);
  listeners.forEach((fn) => fn());
  return () => {
    if (engines.get(host) === api) engines.delete(host);
  };
}

/** Moteur du ciel A (ou B) monté dans la page, s'il existe. */
export function engineFeatures(side: 'A' | 'B' = 'A'): EngineFeatures | null {
  const host = document.querySelector(`.sky-host-${side}`);
  return (host && engines.get(host)) ?? null;
}

/**
 * Moteur du ciel dès qu'il est enregistré (un lien partagé avec &v=map ouvre la carte avant que
 * PixiJS ait fini de démarrer). null après `timeoutMs` (WebGL indisponible : la carte s'ouvre sans vol).
 */
export function whenEngineFeatures(side: 'A' | 'B' = 'A', timeoutMs = 8000): Promise<EngineFeatures | null> {
  const now = engineFeatures(side);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const check = () => {
      const e = engineFeatures(side);
      if (!e) return;
      done(e);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    function done(e: EngineFeatures | null) {
      window.clearTimeout(timer);
      listeners.delete(check);
      resolve(e);
    }
    listeners.add(check);
  });
}
