import { describe, expect, it } from 'vitest';
import { tourSubtitle as T } from '../theme/tokens';
import { CUE_MAX_CHARS } from './cues';
import { subtitleCharsPerLine, subtitleCssVars, subtitleFontPx, subtitleTextWidth } from './subtitleSize';

/** Écrans vérifiés (demande de Nicolas du 05/11) : 1920, 1280 et 390 px de large */
const SCREENS = [1920, 1280, 390] as const;

describe('sous-titres de la visite : taille réglable par jeton (tourSubtitle)', () => {
  it('le jeton est publié en variables CSS, une seule source pour le CSS et le test', () => {
    expect(subtitleCssVars()).toEqual({
      '--tour-sub-font': `clamp(${T.fontMinPx}px, ${T.fontVw}vw, ${T.fontMaxPx}px)`,
      '--tour-sub-font-mobile': `${T.mobilePx}px`,
      '--tour-sub-font-record': `clamp(${T.recordMinPx}px, ${T.recordVw}vw, ${T.recordMaxPx}px)`,
      '--tour-sub-lines': String(T.maxLines),
    });
  });
  it('1920, 1280 et 390 px : ni trop petite ni trop grande (bornes de lisibilité du jeton)', () => {
    for (const w of SCREENS) {
      for (const record of [false, true]) {
        const px = subtitleFontPx(w, record);
        expect(px, `${w} px, enregistrement ${record}`).toBeGreaterThanOrEqual(T.readableMinPx);
        expect(px, `${w} px, enregistrement ${record}`).toBeLessThanOrEqual(T.readableMaxPx);
      }
    }
  });
  it('la taille ne baisse jamais quand l’écran grandit, et reste la même qu’avant le jeton (valeurs d’origine)', () => {
    expect(subtitleFontPx(1920)).toBe(24);
    expect(subtitleFontPx(1280)).toBeCloseTo(20.48, 2);
    expect(subtitleFontPx(390)).toBe(17);
    expect(subtitleFontPx(1920, true)).toBe(30);
    expect(subtitleFontPx(1280, true)).toBeCloseTo(24.32, 2);
    let last = 0;
    for (let w = 431; w <= 2560; w += 50) {
      const px = subtitleFontPx(w);
      expect(px).toBeGreaterThanOrEqual(last);
      last = px;
    }
  });
  it('capacité d’un repère : 84 caractères aux écrans larges, recoupé à 390 px (jamais coupé par le line-clamp)', () => {
    // mesuré dans Chromium (scripts/measure-subtitles.mjs) : aucun repère coupé aux trois écrans, plus long = 83 caractères sur 2 lignes
    for (const w of [1920, 1280]) expect(subtitleCharsPerLine(w) * T.maxLines, `${w} px`).toBeGreaterThanOrEqual(CUE_MAX_CHARS);
    const mobile = subtitleCharsPerLine(390) * T.maxLines;
    expect(mobile).toBeLessThan(CUE_MAX_CHARS);
    // un repère recoupé reste lisible : pas de miettes de quelques mots
    expect(mobile).toBeGreaterThanOrEqual(CUE_MAX_CHARS * 0.75);
    for (const w of SCREENS) expect(subtitleCharsPerLine(w), `${w} px`).toBeGreaterThan(20);
  });
  it('largeur utile : boîte de la visite moins ses marges', () => {
    expect(subtitleTextWidth(1920)).toBe(880 - 44);
    expect(subtitleTextWidth(1280)).toBe(880 - 44);
    expect(subtitleTextWidth(390)).toBe(390 - 24 - 44);
  });
});
