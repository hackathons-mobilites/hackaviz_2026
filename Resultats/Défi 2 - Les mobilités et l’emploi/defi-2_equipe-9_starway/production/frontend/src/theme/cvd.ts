/**
 * Outils de mesure des couleurs pour le mode daltonien (motion-spec, « Mode daltonien ») : simulation
 * des trois dichromasies, contraste WCAG 2 et distance CIEDE2000. Fonctions pures, utilisées par les
 * tests (`cvd.test.ts`, `palette.test.ts`) ; aucune n'est appelée par l'application.
 *
 * Simulation : Machado, Oliveira et Fernandes (2009), « A Physiologically-based Model for Simulation of
 * Color Vision Deficiency », IEEE TVCG 15(6), matrices de sévérité 1,0, appliquées en RGB linéaire.
 * Le modèle est moins sûr pour la tritanopie : ses résultats tritan sont indicatifs.
 */

export type Rgb = readonly [number, number, number];
export type Cvd = 'protan' | 'deutan' | 'tritan';
export const CVD_TYPES: readonly Cvd[] = ['protan', 'deutan', 'tritan'];

type Mat3 = readonly [Rgb, Rgb, Rgb];

/** Matrices de Machado et al. (2009), sévérité 1,0 (table publiée par les auteurs). */
const MACHADO: Record<Cvd, Mat3> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** « #9CEAFF » → [156, 234, 255] */
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
};

/** Couleur `fg` d'opacité `alpha` posée sur `bg` (composition sRGB, comme le navigateur). */
export function over(fg: string, alpha: number, bg: string): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return rgbToHex([0, 1, 2].map((i) => b[i]! + (f[i]! - b[i]!) * alpha) as unknown as Rgb);
}

/** Couleur vue par une personne atteinte de la dichromasie `type` (Machado 2009, sévérité 1). */
export function simulate(hex: string, type: Cvd): string {
  const lin = hexToRgb(hex).map(toLinear);
  const m = MACHADO[type];
  const out = m.map((row) => row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!);
  return rgbToHex(out.map(fromLinear) as unknown as Rgb);
}

/** Luminance relative WCAG 2. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Rapport de contraste WCAG 2 (1 à 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toLab(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  // sRGB D65 → XYZ, normalisé par le blanc D65
  const x = (0.4124564 * r! + 0.3575761 * g! + 0.1804375 * b!) / 0.95047;
  const y = 0.2126729 * r! + 0.7151522 * g! + 0.072175 * b!;
  const z = (0.0193339 * r! + 0.119192 * g! + 0.9503041 * b!) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Distance CIEDE2000 (Sharma, Wu et Dalal, 2005). */
export function deltaE00(a: string, b: string): number {
  const [L1, a1, b1] = toLab(a);
  const [L2, a2, b2] = toLab(b);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (x: number, y: number) => {
    if (x === 0 && y === 0) return 0;
    const h = Math.atan2(y, x) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2;
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * rad) +
    0.24 * Math.cos(2 * hpm * rad) +
    0.32 * Math.cos((3 * hpm + 6) * rad) -
    0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Minimum, sur la vision normale et les trois simulations, d'une mesure entre deux couleurs. */
export function worstCase(a: string, b: string, measure: (x: string, y: string) => number): number {
  let worst = measure(a, b);
  for (const t of CVD_TYPES) worst = Math.min(worst, measure(simulate(a, t), simulate(b, t)));
  return worst;
}
