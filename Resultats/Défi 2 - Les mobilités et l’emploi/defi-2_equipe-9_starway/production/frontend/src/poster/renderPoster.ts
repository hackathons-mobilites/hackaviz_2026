/**
 * Affiche 1920×1080 (ou 3840×2160) : Canvas 2D, grille calquée sur design/slides/src/build_slide.py.
 * Le ciel est l'image extraite du moteur PixiJS (renderer.extract, caméra neutre), mise à l'échelle
 * de façon UNIFORME dans son cadre : mêmes positions et mêmes tailles relatives que dans l'app.
 * Le fond (nébuleuse IA v3, IMG-15, sans bleu-vert ; v1 en repli) est un décor sans donnée,
 * fortement voilé comme sur la slide.
 */
import { poleShortName, type PlacedLabel } from '../data/labels';
import { placeMapLabels } from '../data/mapLabels';
import type { PoleStatus } from '../data/accessibility';
import type { Pole } from '../data/types';
import type { SkySnapshot } from '../sky/featureBridge';
import { assetUrls, posterBackgroundCandidates } from '../theme/assets';
import { color } from '../theme/tokens';
import type { PosterText } from './posterText';

export const POSTER = { W: 1920, H: 1080, L: 112, R: 1808 } as const;
const SKY = { x: 1090, y: 150, w: 718, h: 672, rx: 22 };
const FONT = "'Jost Variable', 'Jost', system-ui, sans-serif";

export interface PosterSky {
  snapshot: SkySnapshot;
  poles: readonly Pole[];
  statuses: readonly PoleStatus[];
  neutral: boolean;
  originName: string | null;
  /** Diptyque : ciel B (même taille de volet que A, donc mêmes positions des astres) */
  compare?: { snapshot: SkySnapshot; statuses: readonly PoleStatus[]; originName: string | null };
}

interface SkyPart {
  snapshot: SkySnapshot;
  statuses: readonly PoleStatus[];
  originName: string | null;
  tag: 'A' | 'B' | null;
}

type Region = SkySnapshot['region'];

/** Emprise commune aux deux ciels : même échelle et même cadrage pour A et B. */
export function unionRegion(regions: readonly Region[]): Region {
  const x0 = Math.min(...regions.map((r) => r.x));
  const y0 = Math.min(...regions.map((r) => r.y));
  const x1 = Math.max(...regions.map((r) => r.x + r.w));
  const y1 = Math.max(...regions.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Un ciel dans son cadre, à l'échelle `s` commune, cadré sur l'emprise `union`. */
function drawSkyPart(
  ctx: CanvasRenderingContext2D,
  f: { x: number; y: number; w: number; h: number; rx: number },
  part: SkyPart,
  union: Region,
  s: number,
  head: number,
  sky: PosterSky,
): void {
  ctx.save();
  roundRect(ctx, f.x, f.y, f.w, f.h, f.rx);
  ctx.fillStyle = 'rgba(16,27,53,0.28)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(168,183,209,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();
  if (part.tag && part.originName) {
    font(ctx, 14, 500);
    ctx.fillStyle = color.guide;
    ctx.textAlign = 'left';
    fitText(ctx, `${part.tag} · ${part.originName}`, f.x + 18, f.y + 30, 14, 500, f.w - 36);
  }
  const { snapshot } = part;
  const ux = f.x + (f.w - union.w * s) / 2;
  const uy = f.y + head + (f.h - head - union.h * s) / 2;
  const toPoster = (p: { x: number; y: number }) => ({ x: ux + (p.x - union.x) * s, y: uy + (p.y - union.y) * s });
  const o = toPoster({ x: snapshot.region.x, y: snapshot.region.y });
  ctx.drawImage(snapshot.canvas, o.x, o.y, snapshot.region.w * s, snapshot.region.h * s);

  // étiquettes 16 px, sans chevauchement et dans le cadre (même placement que la carte miroir)
  const size = part.tag ? 14 : 16;
  const bounds = { x0: f.x + 8, y0: f.y + head + 4, x1: f.x + f.w - 8, y1: f.y + f.h - 8 };
  const discs = snapshot.poles.map((p) => ({ ...toPoster(p), r: p.r * s }));
  const reserved: PlacedLabel[] = [];
  if (snapshot.guide && part.originName && !part.tag) {
    const g = toPoster(snapshot.guide);
    font(ctx, 15, 500);
    const [gl] = placeMapLabels([{ index: -1000, cx: g.x, cy: g.y, r: 10, w: ctx.measureText(part.originName).width, h: 18 }], discs, {
      bounds,
      distances: [8, 28],
    });
    if (gl) {
      reserved.push(gl);
      ctx.fillStyle = color.guide;
      ctx.textAlign = 'left';
      ctx.fillText(part.originName, gl.x, gl.y + 14);
    }
  }
  font(ctx, size, 400);
  const order = sky.poles.map((p, i) => ({ p, i })).sort((a, b) => (b.p.jobs ?? 0) - (a.p.jobs ?? 0));
  const labels = placeMapLabels(
    order
      .filter(({ i }) => !!discs[i])
      .map(({ p, i }) => ({ index: i, cx: discs[i]!.x, cy: discs[i]!.y, r: discs[i]!.r, w: ctx.measureText(poleShortName(p)).width, h: size + 2 })),
    discs,
    { bounds, reserved, glow: 3 },
  );
  for (const l of labels) {
    const on = !sky.neutral && part.statuses[l.index] === 'accessible';
    if (l.leader) {
      ctx.strokeStyle = 'rgba(168,183,209,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l.leader.x1, l.leader.y1);
      ctx.lineTo(l.leader.x2, l.leader.y2);
      ctx.stroke();
    }
    ctx.fillStyle = on ? color.text : color.textDim;
    ctx.textAlign = 'left';
    ctx.fillText(poleShortName(sky.poles[l.index]!), l.x, l.y + size - 2);
  }
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Première image qui se charge dans la liste (avif, puis webp, puis v1). Un navigateur qui ne
 * décode pas l'AVIF déclenche `onerror` : on passe au webp.
 */
async function loadFirstImage(urls: string[]): Promise<HTMLImageElement | null> {
  for (const url of urls) {
    const img = await loadImage(url);
    if (img) return img;
  }
  return null;
}

async function fontsReady(): Promise<void> {
  try {
    await Promise.all(
      [300, 400, 500, 700].map((w) => document.fonts.load(`${w} 40px 'Jost Variable'`)),
    );
    await document.fonts.ready;
  } catch {
    /* police système en repli */
  }
}

function font(ctx: CanvasRenderingContext2D, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number, align: 'left' | 'right' = 'left'): void {
  // interlettrage des rubriques (0,16 em), comme Doc.kicker de build_slide.py
  ctx.letterSpacing = `${tracking}px`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
}

function kicker(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, align: 'left' | 'right' = 'left'): void {
  font(ctx, size, 500);
  ctx.fillStyle = fill;
  spaced(ctx, text.toUpperCase(), x, y, size * 0.16, align);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const trial = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(trial).width > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Texte sur une largeur max : réduit la taille si nécessaire (jamais coupé). */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, weight: number, maxW: number): void {
  let s = size;
  font(ctx, s, weight);
  while (ctx.measureText(text).width > maxW && s > size * 0.6) {
    s -= 2;
    font(ctx, s, weight);
  }
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y);
}

function legendGlyph(ctx: CanvasRenderingContext2D, kind: 'on' | 'out_only' | 'off' | 'guide', x: number, y: number): void {
  ctx.save();
  if (kind === 'on') {
    ctx.fillStyle = color.accessible;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color.accessible;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(x, y, 8.5, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'out_only') {
    // aller possible, retour hors de portée : moitié haute pleine (aller), moitié basse en tirets (retour), comme l'astre
    ctx.fillStyle = color.dim;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color.dimRing;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 8.5, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 2.5]);
    ctx.beginPath();
    ctx.arc(x, y, 8.5, 0, Math.PI);
    ctx.stroke();
  } else if (kind === 'off') {
    ctx.fillStyle = color.dim;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color.dimRing;
    ctx.setLineDash([3, 2.5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 8.5, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = color.guide;
    ctx.beginPath();
    const r = 8;
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + 1, y - 1, x + r * 0.86, y);
    ctx.quadraticCurveTo(x + 1, y + 1, x, y + r);
    ctx.quadraticCurveTo(x - 1, y + 1, x - r * 0.86, y);
    ctx.quadraticCurveTo(x - 1, y - 1, x, y - r);
    ctx.fill();
  }
  ctx.restore();
}

export async function renderPoster(t: PosterText, sky: PosterSky, scale = 1): Promise<HTMLCanvasElement> {
  const { W, H, L, R } = POSTER;
  await fontsReady();
  const [bg, logo] = await Promise.all([
    loadFirstImage(posterBackgroundCandidates(true).map((c) => c.url)),
    loadImage(assetUrls.logoSvg),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  // --- fond : nébuleuse voilée (décor), comme background() de build_slide.py
  ctx.fillStyle = color.bg;
  ctx.fillRect(0, 0, W, H);
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    const w = bg.width * s;
    const h = bg.height * s;
    ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
  }
  const vx = ctx.createLinearGradient(0, 0, W, 0);
  vx.addColorStop(0, 'rgba(8,14,32,0.80)');
  vx.addColorStop(0.55, 'rgba(8,14,32,0.62)');
  vx.addColorStop(1, 'rgba(8,14,32,0.45)');
  ctx.fillStyle = vx;
  ctx.fillRect(0, 0, W, H);
  const vy = ctx.createLinearGradient(0, 0, 0, H);
  vy.addColorStop(0.62, 'rgba(8,14,32,0)');
  vy.addColorStop(1, 'rgba(8,14,32,0.85)');
  ctx.fillStyle = vy;
  ctx.fillRect(0, 0, W, H);

  // --- en-tête
  if (logo) {
    const lw = 330;
    const lh = logo.naturalWidth ? (lw * logo.naturalHeight) / logo.naturalWidth : 80;
    ctx.drawImage(logo, L - 10, 52, lw, lh);
  }
  kicker(ctx, 'Hackathon Mobilités 2026 · Spécial Dataviz’ · Défi #2', R, 86, 14, color.textDim, 'right');
  font(ctx, 22, 400);
  ctx.fillStyle = color.text;
  ctx.textAlign = 'right';
  ctx.fillText('STARWAY · équipe Middleway', R, 118);

  // --- titre
  const colW = SKY.x - L - 48;
  ctx.fillStyle = color.text;
  fitText(ctx, t.title, L, 236, 62, 300, colW);
  // temps choisi en grand (L-16), blanc lunaire (la couleur du trajet), jamais cyan ni or
  ctx.fillStyle = color.text;
  fitText(ctx, t.timeHeadline, L, 318, 54, 500, colW);
  // sous-ligne : deux lignes au plus (au-delà, la police réduit), avant le filet à 438 px
  ctx.fillStyle = color.textDim;
  font(ctx, 24, 400);
  ctx.textAlign = 'left';
  const sub = wrap(ctx, t.subtitle, colW);
  if (sub.length <= 2) sub.forEach((ln, i) => ctx.fillText(ln, L, 366 + i * 32));
  else fitText(ctx, t.subtitle, L, 366, 24, 400, colW);

  // --- filet, rubrique, phrase
  ctx.fillStyle = color.accent;
  ctx.fillRect(L, 438, 56, 2);
  kicker(ctx, t.kicker, L, 478, 15, color.accent);
  font(ctx, 26, 400);
  ctx.fillStyle = color.textDim;
  ctx.textAlign = 'left';
  const lines = wrap(ctx, t.sentence, Math.min(900, colW));
  lines.forEach((ln, i) => ctx.fillText(ln, L, 518 + i * 37));
  let y = 518 + (lines.length - 1) * 37 + 76;
  font(ctx, 18, 400);
  ctx.fillStyle = color.text;
  wrap(ctx, t.skyCaption, colW).forEach((ln) => {
    ctx.fillText(ln, L, y);
    y += 26;
  });
  font(ctx, 16, 400);
  ctx.fillStyle = color.textDim;
  wrap(ctx, t.areaCaption, colW).forEach((ln) => {
    ctx.fillText(ln, L, y);
    y += 24;
  });
  if (t.modeNote) {
    // note du mode (réglage de marche, avertissement Vélib') : mention discrète, jamais en cyan ni en or
    font(ctx, 14, 400);
    wrap(ctx, t.modeNote, colW).forEach((ln) => {
      ctx.fillText(ln, L, y);
      y += 21;
    });
  }
  // légende sur une ligne (14 px)
  y += 22;
  font(ctx, 14, 400);
  ctx.fillStyle = color.text;
  let lx = L + 9;
  const guideName = sky.compare ? `${sky.originName ?? 'A'} et ${sky.compare.originName ?? 'B'}` : (sky.originName ?? 'Votre commune');
  const hasOutOnly = [sky.statuses, sky.compare?.statuses ?? []].some((st) => st.includes('out_only'));
  const items: [Parameters<typeof legendGlyph>[1], string][] = sky.neutral
    ? [['guide', guideName]]
    : [
        ['on', t.legendOn],
        ...(hasOutOnly ? ([['out_only', 'Aller possible, retour hors de portée']] as [Parameters<typeof legendGlyph>[1], string][]) : []),
        ['off', 'Hors de portée'],
        ['guide', guideName],
      ];
  for (const [kind, label] of items) {
    font(ctx, 14, 400);
    // une entrée de plus (« aller possible, retour hors de portée ») : la légende passe à la ligne plutôt que sous le ciel
    const w = 16 + ctx.measureText(label).width;
    if (lx > L + 9 && lx + w > L + colW) {
      lx = L + 9;
      y += 26;
    }
    legendGlyph(ctx, kind, lx, y - 5);
    ctx.fillStyle = color.text;
    ctx.textAlign = 'left';
    ctx.fillText(label, lx + 16, y);
    lx += w + 30;
  }

  // --- ciel (diptyque : deux demi-cadres de 347 px séparés de 24 px, même échelle, mêmes positions)
  const parts: SkyPart[] = [{ snapshot: sky.snapshot, statuses: sky.statuses, originName: sky.originName, tag: sky.compare ? 'A' : null }];
  if (sky.compare) parts.push({ ...sky.compare, tag: 'B' });
  const frames =
    parts.length === 1
      ? [SKY]
      : [
          { ...SKY, w: (SKY.w - 24) / 2 },
          { ...SKY, x: SKY.x + (SKY.w - 24) / 2 + 24, w: (SKY.w - 24) / 2 },
        ];
  const union = unionRegion(parts.map((p) => p.snapshot.region));
  const pad = parts.length === 1 ? 44 : 20;
  const head = parts.length === 1 ? 0 : 34;
  const skyScale = Math.min(...frames.map((f) => Math.min((f.w - 2 * pad) / union.w, (f.h - 2 * pad - head) / union.h)));
  parts.forEach((part, i) => drawSkyPart(ctx, frames[i]!, part, union, skyScale, head, sky));

  // --- cartes de chiffres
  const gap = 24;
  const cw = (R - L - 2 * gap) / 3;
  t.cards.forEach((c, i) => {
    const x = L + i * (cw + gap);
    roundRect(ctx, x, 846, cw, 136, 16);
    ctx.fillStyle = 'rgba(16,27,53,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168,183,209,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = c.accent ? color.accessible : color.text;
    fitText(ctx, c.value, x + 28, 846 + 70, 50, 300, cw - 56);
    ctx.fillStyle = color.textDim;
    fitText(ctx, c.caption, x + 28, 846 + 108, 17, 400, cw - 56);
  });

  // --- pied
  ctx.fillStyle = 'rgba(168,183,209,0.16)';
  ctx.fillRect(L, 1002, R - L, 1);
  kicker(ctx, 'Sources', L, 1040, 13, color.textDim);
  font(ctx, 13, 500);
  const kw = ctx.measureText('SOURCES').width + 7 * 13 * 0.16 + 18;
  font(ctx, 21, 500);
  const urlW = Math.min(ctx.measureText(t.url).width, 760);
  ctx.fillStyle = color.textDim;
  fitText(ctx, t.sources, L + kw, 1040, 17, 400, R - L - kw - urlW - 40);
  font(ctx, 21, 500);
  let us = 21;
  while (ctx.measureText(t.url).width > 760 && us > 13) font(ctx, --us, 500);
  const uw = ctx.measureText(t.url).width;
  ctx.fillStyle = color.text;
  ctx.textAlign = 'right';
  ctx.fillText(t.url, R, 1040);
  ctx.fillStyle = 'rgba(244,246,255,0.5)';
  ctx.fillRect(R - uw, 1045, uw, 1);
  font(ctx, 12, 400);
  ctx.fillStyle = color.textDim;
  ctx.textAlign = 'left';
  ctx.fillText(bg ? t.mentions : t.mentions.replace(/ · fond : .*$/, ''), L, 1066);

  // --- mode démo : bande rouge non désactivable
  if (t.demo) {
    ctx.fillStyle = color.demo;
    ctx.fillRect(0, 0, W, 48);
    font(ctx, 20, 700);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText('DONNÉES FICTIVES - démonstration', W / 2, 31);
  }
  return canvas;
}

export default renderPoster;
