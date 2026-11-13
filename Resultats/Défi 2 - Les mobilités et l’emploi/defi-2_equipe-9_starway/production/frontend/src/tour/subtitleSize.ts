/**
 * Taille des sous-titres de la visite : fonctions PURES alimentées par le jeton `tourSubtitle` (theme/tokens.ts, réglable
 * par Maia). Le CSS (`styles.css`) lit les mêmes valeurs par les variables `--tour-sub-*` publiées par `TourOverlay`
 * (`subtitleCssVars`) : une seule source, aucune taille écrite deux fois.
 */
import { tourSubtitle as T } from '../theme/tokens';

export type TourSubtitleTokens = typeof T;

/** Variables CSS publiées sur la boîte de la visite (valeurs de repli identiques dans styles.css). */
export function subtitleCssVars(t: TourSubtitleTokens = T): Record<`--tour-sub-${string}`, string> {
  return {
    '--tour-sub-font': `clamp(${t.fontMinPx}px, ${t.fontVw}vw, ${t.fontMaxPx}px)`,
    '--tour-sub-font-mobile': `${t.mobilePx}px`,
    '--tour-sub-font-record': `clamp(${t.recordMinPx}px, ${t.recordVw}vw, ${t.recordMaxPx}px)`,
    '--tour-sub-lines': String(t.maxLines),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Taille calculée (px) pour une largeur d'écran : celle que le CSS donne avec les variables ci-dessus. */
export function subtitleFontPx(viewportWidth: number, record = false, t: TourSubtitleTokens = T): number {
  if (record) return clamp((t.recordVw / 100) * viewportWidth, t.recordMinPx, t.recordMaxPx);
  if (viewportWidth <= t.mobileMaxWidth) return t.mobilePx;
  return clamp((t.fontVw / 100) * viewportWidth, t.fontMinPx, t.fontMaxPx);
}

/**
 * Largeur utile du texte (px) : celle de la boîte de la visite (`.tour-overlay` : min(880px, 100vw - 40px), 100vw - 24px
 * sous 430 px) moins ses marges intérieures (22 px de chaque côté).
 */
export function subtitleTextWidth(viewportWidth: number, t: TourSubtitleTokens = T): number {
  const box = viewportWidth <= t.mobileMaxWidth ? viewportWidth - 24 : Math.min(880, viewportWidth - 40);
  return Math.max(0, box - 44);
}

/** Caractères par ligne estimés (largeur moyenne mesurée en em), jamais moins de 1. */
export function subtitleCharsPerLine(viewportWidth: number, record = false, t: TourSubtitleTokens = T): number {
  return Math.max(1, Math.floor(subtitleTextWidth(viewportWidth, t) / (subtitleFontPx(viewportWidth, record, t) * t.avgCharEm)));
}
