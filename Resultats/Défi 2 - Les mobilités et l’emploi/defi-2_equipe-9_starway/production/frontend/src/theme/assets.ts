import { ambient } from './tokens';

/**
 * Manifeste des images de décor (générées par IA, voir docs/decisions.md D-006).
 * Elles n'encodent JAMAIS une donnée. Chacune a un repli procédural (sky/textures.ts)
 * pour que le ciel reste beau si le fichier est absent.
 */
export const assetUrls = {
  /** v1 : repli si les décors v3 ne chargent pas (voir decorV3 ci-dessous) */
  nebulaDeep: '/assets/img/bg-nebula-deep.webp',
  nebulaWisps: '/assets/img/nebula-wisps.webp',
  starCyan: '/assets/img/sprite-star-cyan.webp',
  guideStar: '/assets/img/sprite-guide-star.webp',
  shootingHead: '/assets/img/sprite-shooting-head.webp',
  eclipseVeil: '/assets/img/eclipse-veil.webp',
  cosmicDust: '/assets/img/cosmic-dust-tile.webp',
  /** Symbole (Cassiopée en 5 étoiles) - le logotype « STARWAY » est en HTML/CSS */
  logoSymbol: '/assets/img/logo-symbol.webp',
  /** Logo final vectoriel (symbole + « STARWAY » vectorisé) */
  logoSvg: '/assets/img/starway-logo.svg',
  symbolSvg: '/assets/img/starway-symbol.svg',
  logoMonoSvg: '/assets/img/starway-logo-mono.svg',
  /** Symbole monochrome (mêmes tracés que logoMonoSvg) : barre du haut sur mobile (L-13) */
  symbolMonoSvg: '/assets/img/starway-symbol-mono.svg',
  icon: '/assets/img/icon-starway.webp',
  horizon: '/assets/img/horizon-silhouette.webp',
  goldenDawn: '/assets/img/act4-golden-dawn.webp',
  haloRing: '/assets/img/halo-glow-ring.webp',
} as const;

export type AssetKey = keyof typeof assetUrls;

/**
 * Tête de la poignée de la jauge « Temps de trajet par sens » (IMG-20, design/prompts/chatgpt-images-v5.md) :
 * les 6 stades d'une étoile qui vieillit, du plus court au plus long temps choisi. Décor seulement :
 * la valeur reste écrite en chiffres et annoncée au lecteur d'écran. Découpés par
 * frontend/scripts/cut-star-lifecycle.py (128 px, alpha, même échelle pour les 6).
 */
export const starAgeUrls = [1, 2, 3, 4, 5, 6].map((n) => `/assets/img/star-age-${n}.webp`);

/** Précharge (et décode) des images avant leur premier affichage : pas de clignotement au premier glisser. */
export function preloadImages(urls: readonly string[]): void {
  if (typeof Image === 'undefined') return;
  for (const url of urls) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    void img.decode?.().catch(() => undefined);
  }
}

/**
 * Décors v3 (design/prompts/chatgpt-images-v3.md, IMG-15, IMG-16, IMG-18), sans cyan ni bleu-vert.
 * Fichiers `<base>-<largeur>.avif` et `.webp`, produits par frontend/scripts/optimize-images.py.
 * IMG-17 (plaque de poussière) a été refusée : la poussière reste désactivée.
 */
export const decorV3 = {
  nebulaDeep: { base: '/assets/img/bg-nebula-deep-v3', widths: [1280, 2560], aspect: 1536 / 1024 },
  nebulaWisps: { base: '/assets/img/nebula-wisps-v3', widths: [1280, 2560], aspect: 1536 / 1024 },
  nebulaPortrait: { base: '/assets/img/bg-nebula-portrait', widths: [1024], aspect: 1024 / 1536 },
} as const;

type DecorSource = (typeof decorV3)[keyof typeof decorV3];

/** Une image à essayer ; `v3` dit si elle peut se passer de la teinte qui éteint le bleu-vert. */
export interface DecorCandidate {
  url: string;
  v3: boolean;
}

/** Variante de décor retenue pour un écran : orientation et largeur du fichier v3. */
export interface DecorVariant {
  portrait: boolean;
  width: number;
}

export interface DecorScreen {
  /** Largeur de la fenêtre (px CSS) : décide de l'orientation */
  viewportWidth: number;
  /** Taille du canvas du ciel (px CSS) et résolution du rendu */
  width: number;
  height: number;
  resolution: number;
}

/** Plus petite largeur disponible qui couvre `needed` px physiques ; la plus grande sinon. */
export function pickWidth(widths: readonly number[], needed: number): number {
  const sorted = [...widths].sort((a, b) => a - b);
  return sorted.find((w) => w >= needed) ?? sorted[sorted.length - 1]!;
}

/** Largeur (px physiques) nécessaire pour couvrir l'écran avec une image de rapport `aspect` (largeur / hauteur). */
function neededWidth(src: DecorSource, s: DecorScreen): number {
  return Math.ceil(Math.max(s.width, s.height * src.aspect) * s.resolution);
}

/** Fond de nébuleuse : portrait (IMG-18) sous `ambient.portraitBelow` px de fenêtre, paysage (IMG-15) sinon. */
export function nebulaDeepVariant(s: DecorScreen): DecorVariant {
  const portrait = s.viewportWidth < ambient.portraitBelow;
  const src = portrait ? decorV3.nebulaPortrait : decorV3.nebulaDeep;
  return { portrait, width: pickWidth(src.widths, neededWidth(src, s)) };
}

/** Volutes (IMG-16) : une seule orientation. */
export function nebulaWispsVariant(s: DecorScreen): DecorVariant {
  return { portrait: false, width: pickWidth(decorV3.nebulaWisps.widths, neededWidth(decorV3.nebulaWisps, s)) };
}

/**
 * Faut-il recharger le décor ? Oui si l'orientation change, ou pour une largeur plus grande ;
 * jamais pour une plus petite (le fichier déjà chargé couvre encore l'écran).
 */
export function decorNeedsReload(current: DecorVariant | null, next: DecorVariant): boolean {
  if (!current) return true;
  return current.portrait !== next.portrait || next.width > current.width;
}

function v3Files(src: DecorSource, width: number, avif: boolean): DecorCandidate[] {
  const formats = avif ? (['avif', 'webp'] as const) : (['webp'] as const);
  return formats.map((f) => ({ url: `${src.base}-${width}.${f}`, v3: true }));
}

/**
 * Fichiers à essayer, dans l'ordre, pour le fond de nébuleuse : v3 (avif puis webp), le paysage v3
 * si le portrait manque, puis l'image v1 en repli. Après la liste : repli procédural (textures.ts).
 */
export function nebulaDeepCandidates(v: DecorVariant, avif: boolean): DecorCandidate[] {
  const landscape = v3Files(decorV3.nebulaDeep, v.portrait ? pickWidth(decorV3.nebulaDeep.widths, 0) : v.width, avif);
  const list = v.portrait ? [...v3Files(decorV3.nebulaPortrait, v.width, avif), ...landscape] : landscape;
  return [...list, { url: assetUrls.nebulaDeep, v3: false }];
}

/** Volutes : v3 (avif puis webp), puis v1 en repli. */
export function nebulaWispsCandidates(v: DecorVariant, avif: boolean): DecorCandidate[] {
  return [...v3Files(decorV3.nebulaWisps, v.width, avif), { url: assetUrls.nebulaWisps, v3: false }];
}

/** Fond de l'affiche exportable (1920×1080 ou 3840×2160) : IMG-15 en 2560 px, puis v1 en repli. */
export function posterBackgroundCandidates(avif: boolean): DecorCandidate[] {
  const w = decorV3.nebulaDeep.widths[decorV3.nebulaDeep.widths.length - 1]!;
  return [...v3Files(decorV3.nebulaDeep, w, avif), { url: assetUrls.nebulaDeep, v3: false }];
}

/**
 * Vérifie qu'une image existe vraiment. En dev, Vite renvoie index.html (200) pour un
 * fichier absent : on contrôle donc le content-type.
 */
export async function assetExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    return type.startsWith('image/');
  } catch {
    return false;
  }
}
