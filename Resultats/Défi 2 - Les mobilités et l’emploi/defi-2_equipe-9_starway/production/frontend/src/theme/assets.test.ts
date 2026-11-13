import { describe, expect, it } from 'vitest';
import {
  assetUrls,
  decorNeedsReload,
  nebulaDeepCandidates,
  nebulaDeepVariant,
  nebulaWispsCandidates,
  nebulaWispsVariant,
  pickWidth,
  posterBackgroundCandidates,
} from './assets';
import { ambient } from './tokens';

const desktop = { viewportWidth: 1920, width: 1920, height: 1080, resolution: 1 };
const laptop = { viewportWidth: 1280, width: 1280, height: 720, resolution: 1 };
const phone = { viewportWidth: 390, width: 390, height: 844, resolution: 2 };

describe('pickWidth', () => {
  it('prend la plus petite largeur qui couvre, sinon la plus grande', () => {
    expect(pickWidth([1280, 2560], 1000)).toBe(1280);
    expect(pickWidth([1280, 2560], 1280)).toBe(1280);
    expect(pickWidth([1280, 2560], 1281)).toBe(2560);
    expect(pickWidth([2560, 1280], 9000)).toBe(2560);
  });
});

describe('variantes du fond de nébuleuse', () => {
  it('paysage au-dessus du seuil, portrait en dessous (largeur de fenêtre)', () => {
    expect(nebulaDeepVariant(desktop)).toEqual({ portrait: false, width: 2560 });
    expect(nebulaDeepVariant(laptop)).toEqual({ portrait: false, width: 1280 });
    expect(nebulaDeepVariant(phone)).toEqual({ portrait: true, width: 1024 });
    const edge = { ...laptop, viewportWidth: ambient.portraitBelow };
    expect(nebulaDeepVariant(edge).portrait).toBe(false);
    expect(nebulaDeepVariant({ ...edge, viewportWidth: ambient.portraitBelow - 1 }).portrait).toBe(true);
  });

  it("le volet d'un diptyque sur grand écran garde le paysage", () => {
    expect(nebulaDeepVariant({ ...desktop, width: 960 }).portrait).toBe(false);
  });

  it('tient compte de la résolution et du rapport de l\'écran (couverture)', () => {
    // 1280 × 720 en DPR 2 : 2560 px physiques
    expect(nebulaDeepVariant({ ...laptop, resolution: 2 }).width).toBe(2560);
    // écran haut : la hauteur × 1,5 dépasse 1280
    expect(nebulaWispsVariant({ viewportWidth: 1000, width: 1000, height: 900, resolution: 1 }).width).toBe(2560);
  });
});

describe('candidats et replis', () => {
  it('v3 avif puis webp, puis v1 en dernier', () => {
    const c = nebulaDeepCandidates({ portrait: false, width: 2560 }, true);
    expect(c.map((x) => x.url)).toEqual([
      '/assets/img/bg-nebula-deep-v3-2560.avif',
      '/assets/img/bg-nebula-deep-v3-2560.webp',
      assetUrls.nebulaDeep,
    ]);
    expect(c.map((x) => x.v3)).toEqual([true, true, false]);
  });

  it('sans AVIF : webp seulement', () => {
    const c = nebulaWispsCandidates({ portrait: false, width: 1280 }, false);
    expect(c.map((x) => x.url)).toEqual(['/assets/img/nebula-wisps-v3-1280.webp', assetUrls.nebulaWisps]);
  });

  it('portrait : IMG-18, puis le paysage v3, puis v1', () => {
    const urls = nebulaDeepCandidates({ portrait: true, width: 1024 }, true).map((x) => x.url);
    expect(urls).toEqual([
      '/assets/img/bg-nebula-portrait-1024.avif',
      '/assets/img/bg-nebula-portrait-1024.webp',
      '/assets/img/bg-nebula-deep-v3-1280.avif',
      '/assets/img/bg-nebula-deep-v3-1280.webp',
      assetUrls.nebulaDeep,
    ]);
  });

  it("l'affiche prend IMG-15 en 2560 px, v1 en repli", () => {
    expect(posterBackgroundCandidates(true).map((x) => x.url)).toEqual([
      '/assets/img/bg-nebula-deep-v3-2560.avif',
      '/assets/img/bg-nebula-deep-v3-2560.webp',
      assetUrls.nebulaDeep,
    ]);
  });
});

describe('decorNeedsReload', () => {
  it("recharge si l'orientation change ou pour plus large, jamais pour plus petit", () => {
    expect(decorNeedsReload(null, { portrait: false, width: 1280 })).toBe(true);
    expect(decorNeedsReload({ portrait: false, width: 1280 }, { portrait: false, width: 2560 })).toBe(true);
    expect(decorNeedsReload({ portrait: false, width: 2560 }, { portrait: false, width: 1280 })).toBe(false);
    expect(decorNeedsReload({ portrait: false, width: 1280 }, { portrait: true, width: 1024 })).toBe(true);
    expect(decorNeedsReload({ portrait: true, width: 1024 }, { portrait: false, width: 1280 })).toBe(true);
  });
});
