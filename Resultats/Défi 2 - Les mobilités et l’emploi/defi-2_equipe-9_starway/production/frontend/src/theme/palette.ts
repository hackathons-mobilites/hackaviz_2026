/**
 * Palette affichée selon le réglage « couleurs adaptées au daltonisme » (motion-spec, « Mode
 * daltonien »). Fonction pure : le mode ne change que l'or du gain, les arcs de modes du halo et la
 * carte miroir ; jamais un état, une forme, une position, une taille ni un total.
 */
import { color, colorCv, haloPalette, haloPaletteCv, mirrorCv, mirrorFill, mirrorCasingNormal, mirrorCasingCv, pixiColor, pixiColorCv } from './tokens';

export interface Palette {
  color: { readonly [K in keyof typeof color]: string };
  pixiColor: { readonly [K in keyof typeof pixiColor]: number };
  haloPalette: {
    readonly [K in keyof typeof haloPalette]: (typeof haloPalette)[K] extends readonly string[] ? readonly string[] : string;
  };
  mirror: { accessibleFillOpacity: number; accessibleStrokeOpacity: number };
  mirrorCasing: { casingColor: string; casingAlpha: number; casingWidth: number };
}

const NORMAL: Palette = { color, pixiColor, haloPalette, mirror: mirrorFill, mirrorCasing: mirrorCasingNormal };
const CV: Palette = {
  color: { ...color, ...colorCv },
  pixiColor: { ...pixiColor, ...pixiColorCv },
  haloPalette: { ...haloPalette, ...haloPaletteCv },
  mirror: mirrorCv,
  mirrorCasing: mirrorCasingCv,
};

export function palette(cv: boolean): Palette {
  return cv ? CV : NORMAL;
}
