/**
 * Textures procédurales (repli si les images IA sont absentes) + chargement optionnel des images.
 * Décor uniquement : aucune de ces textures n'encode une donnée.
 */
import { Assets, CanvasSource, detectAvif, Texture } from 'pixi.js';
import { assetExists, assetUrls, type AssetKey, type DecorCandidate } from '../theme/assets';
import { mulberry32 } from '../utils/rng';

/**
 * Mémoïsation : chaque texture procédurale est créée UNE fois par session et partagée par tous les
 * moteurs (remontage StrictMode, diptyque, changement de jeu de données). Le moteur détruit ses
 * objets avec `texture: false` : sans ce cache, chaque remontage laissait des textures orphelines.
 */
const cache = new Map<string, Texture>();
function memo(key: string, make: () => Texture): Texture {
  let t = cache.get(key);
  if (!t || t.destroyed) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Nombre de textures procédurales vivantes (contrôle de fuite, ?fps=1 et tests manuels). */
export function proceduralTextureCount(): number {
  return cache.size;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  return [c, ctx];
}

/** Point lumineux doux (étoiles de fond, têtes de traînée). */
export function softDotTexture(size = 32): Texture {
  return memo(`softDotTexture:${size}`, () => {
    const [c, ctx] = canvas(size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(c);
  });
}

/** Halo large (glow des astres allumés). Rayon utile = size/2. */
export function glowTexture(size = 256): Texture {
  return memo(`glowTexture:${size}`, () => {
    const [c, ctx] = canvas(size, size);
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(c);
  });
}

/**
 * Disque plein à bord net (cœur d'un astre). Le disque occupe exactement le rayon size/2 − 2 :
 * un sprite de largeur 2r·size/(size−4) a donc un disque de rayon r (aire ∝ postes).
 */
export const DISC_SIZE = 128;
export function discTexture(size = DISC_SIZE): Texture {
  return memo(`discTexture:${size}`, () => {
    const [c, ctx] = canvas(size, size);
    const r = size / 2 - 2;
    const g = ctx.createRadialGradient(size / 2 - r * 0.25, size / 2 - r * 0.25, r * 0.05, size / 2, size / 2, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(246,250,255,0.98)');
    g.addColorStop(1, 'rgba(226,236,255,0.96)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.fill();
    return Texture.from(c);
  });
}

/** Étoile-guide : éclat à quatre branches + cœur chaud. */
export function flareTexture(size = 256): Texture {
  return memo(`flareTexture:${size}`, () => {
    const [c, ctx] = canvas(size, size);
    const m = size / 2;
    ctx.globalCompositeOperation = 'lighter';
    const core = ctx.createRadialGradient(m, m, 0, m, m, m * 0.35);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.25, 'rgba(255,236,210,0.9)');
    core.addColorStop(1, 'rgba(255,200,150,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, size, size);
    const spike = (angle: number, len: number, width: number) => {
      ctx.save();
      ctx.translate(m, m);
      ctx.rotate(angle);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,245,230,0.95)');
      g.addColorStop(1, 'rgba(255,220,180,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -width);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, width);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    for (let i = 0; i < 4; i++) spike((i * Math.PI) / 2, m * 0.98, size * 0.022);
    for (let i = 0; i < 4; i++) spike(Math.PI / 4 + (i * Math.PI) / 2, m * 0.42, size * 0.012);
    return Texture.from(c);
  });
}

const NEBULA_COLORS = ['#1B2B6B', '#2A1F5E', '#3B2C7A', '#0F3B5C', '#14234F', '#4A3290'];

/** Nébuleuse procédurale : nappes de gradients radiaux superposés, très sombres. */
export function nebulaTexture(seed: number, w = 1280, h = 800, intensity = 1): Texture {
  return memo(`nebulaTexture:${seed}:${w}:${h}:${intensity}`, () => {
    const [c, ctx] = canvas(w, h);
    const rnd = mulberry32(seed);
    ctx.fillStyle = '#080E20';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // Bande diagonale type « voie lactée »
    for (let i = 0; i < 70; i++) {
      const t = rnd();
      const x = t * w;
      const y = h * (0.75 - 0.5 * t) + (rnd() - 0.5) * h * 0.35;
      const r = (0.08 + rnd() * 0.22) * w;
      const col = NEBULA_COLORS[Math.floor(rnd() * NEBULA_COLORS.length)]!;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = (0.05 + rnd() * 0.09) * intensity;
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(0.5, hexA(col, a * 0.4));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // Quelques nuages épars
    for (let i = 0; i < 18; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = (0.1 + rnd() * 0.25) * w;
      const col = NEBULA_COLORS[Math.floor(rnd() * NEBULA_COLORS.length)]!;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = (0.025 + rnd() * 0.05) * intensity;
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // Vignettage
    ctx.globalCompositeOperation = 'source-over';
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(8,14,32,0)');
    v.addColorStop(1, 'rgba(4,7,18,0.75)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    return Texture.from(c);
  });
}

/** Voile d'éclipse : bande sombre aux bords doux, liseré clair sur le front d'onde. */
export function veilTexture(w = 512, h = 16): Texture {
  return memo(`veilTexture:${w}:${h}`, () => {
    const [c, ctx] = canvas(w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(3,5,14,0)');
    g.addColorStop(0.35, 'rgba(3,5,14,0.85)');
    g.addColorStop(0.9, 'rgba(10,12,40,0.95)');
    g.addColorStop(0.97, 'rgba(179,155,255,0.55)');
    g.addColorStop(1, 'rgba(179,155,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return Texture.from(c);
  });
}

/**
 * Vignette de bord (critique v0.4, P0-04) : assombrit les coins du DÉCOR, jamais les données
 * (le calque des pôles est au-dessus). Centre légèrement remonté (246 sur 512).
 */
export function vignetteTexture(size = 512): Texture {
  return memo(`vignetteTexture:${size}`, () => {
    const [c, ctx] = canvas(size, size);
    const k = size / 512;
    const g = ctx.createRadialGradient(256 * k, 246 * k, 0, 256 * k, 246 * k, 256 * k);
    g.addColorStop(0, 'rgba(8,14,32,0)');
    g.addColorStop(0.55, 'rgba(8,14,32,0)');
    g.addColorStop(1, 'rgba(8,14,32,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(c);
  });
}

/**
 * Queue de l'étoile filante (MeshRope) : biseau blanc qui s'affine de la tête (u = 1) à la queue
 * (u = 0), alpha croissant vers la tête. Épaisseur logique `height` px (texture haute définition).
 */
export function tailTexture(height = 3, res = 4): Texture {
  return memo(`tailTexture:${height}:${res}`, () => {
    const w = 256;
    const h = Math.max(2, Math.round(height * res));
    const [c, ctx] = canvas(w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    return new Texture({ source: new CanvasSource({ resource: c, resolution: res }) });
  });
}

/** Poussière cosmique : tuile de grains très fins. */
export function dustTexture(size = 256, seed = 7): Texture {
  return memo(`dustTexture:${size}:${seed}`, () => {
    const [c, ctx] = canvas(size, size);
    const rnd = mulberry32(seed);
    for (let i = 0; i < 420; i++) {
      const a = 0.2 + rnd() * 0.8;
      ctx.fillStyle = `rgba(200,210,255,${a.toFixed(2)})`;
      ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
    }
    return Texture.from(c);
  });
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** Charge une image du manifeste si elle existe ; sinon null (le layer utilise son repli). */
export async function loadOptional(key: AssetKey): Promise<Texture | null> {
  const url = assetUrls[key];
  if (!(await assetExists(url))) return null;
  try {
    return await Assets.load<Texture>(url);
  } catch {
    return null;
  }
}

let avif: Promise<boolean> | null = null;
/** Le navigateur décode-t-il l'AVIF ? (test PixiJS sur une image de 1 px, une fois par session) */
export function avifSupported(): Promise<boolean> {
  avif ??= detectAvif.test().catch(() => false);
  return avif;
}

/**
 * Charge la première image disponible d'une liste ordonnée (v3 avif, v3 webp, puis v1) ;
 * null si aucune ne charge (le layer utilise alors son repli procédural).
 */
export async function loadFirst(candidates: DecorCandidate[]): Promise<{ texture: Texture; v3: boolean } | null> {
  for (const c of candidates) {
    if (!(await assetExists(c.url))) continue;
    try {
      return { texture: await Assets.load<Texture>(c.url), v3: c.v3 };
    } catch {
      /* fichier illisible (format non décodé) : candidat suivant */
    }
  }
  return null;
}
