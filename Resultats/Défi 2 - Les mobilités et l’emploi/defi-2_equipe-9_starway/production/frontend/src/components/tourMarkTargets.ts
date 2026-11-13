/**
 * Où sont, à l'écran, les cibles nommées des repères de la visite (`tour/marks.ts`). SEUL endroit où une cible devient un
 * sélecteur : les scripts de visite n'en contiennent aucun. Lecture du DOM seulement (aucune écriture, aucun focus).
 */
import { markShape, type MarkTarget } from '../tour/marks';
import { tourMark } from '../theme/tokens';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Ring {
  x: number;
  y: number;
  r: number;
  /** Anneau fin (plusieurs astres à la fois) */
  thin: boolean;
}
export interface MarkGeometry {
  rings: Ring[];
  frames: Box[];
  /** Parties de l'interface à voiler (sans les cibles) */
  panels: Box[];
  /** Sous-titres de la visite : rien n'est dessiné dessus */
  safe: Box | null;
  /** Éléments d'interface encadrés (marqués `data-tour-mark` : jamais atténués par le mode épuré) */
  marked: Element[];
}

/** Ciel A : première couche des astres (le ciel B du diptyque vient après) */
const SKY_A = 'ul.pole-layer';

/** Cibles d'interface : sélecteur (tous les éléments trouvés forment un seul cadre) */
const FRAME_SELECTORS: Record<string, string> = {
  counter: '.bar-counter',
  budget: '.bar-budget',
  dayType: '.bar-day .day-field',
  mode: '.bar-mode',
  search: '.bar-origin',
  proof: '.proof-panel',
  'proof:flows': '.pf-flows',
  'proof:recruit': '.pf-recruit',
  // Bloc « Trajet » (D-066) : le trajet est un seul bloc en haut de la fiche ; le carbone est sa tuile (il n'est plus dans un pli)
  'proof:trajet': '.pf-trip-block',
  // Le bouton « Retour · N min » du bloc « Trajet » : la voix dit le retour, le repère entoure sa durée (12/11), sans rien changer à l'écran
  'proof:trajet-retour': '.pf-trip-block .alt-dir-btn:nth-child(2)',
  'proof:carbone': '.pf-trip-block .pf-carbon',
  'proof:share': '.pf-od',
  'sky:B': '.sky-host-B',
  'diptych:A': '.pane-head-A',
  'diptych:B': '.pane-head-B',
  'diptych:delta': '.split-delta',
  halo: '.halo-panel',
};

/** Interface voilée pendant un repère (jamais le ciel ni ses astres) */
const UI_REGIONS = [
  '.scenario-bar',
  '.top-bar',
  '.proof-panel',
  '.halo-panel',
  '.legend',
  '.pane-head',
  '.split-delta',
  '.zoom-controls',
  '.sky-credit',
  '.insight-chip',
  '.contrast-card',
];

function frameSelector(target: MarkTarget): string | null {
  if (FRAME_SELECTORS[target]) return FRAME_SELECTORS[target]!;
  if (target.startsWith('proof:')) return `.pf-group[data-group="${CSS.escape(target.slice(6))}"]`;
  if (target.startsWith('row:')) return `.pf-cc-svg g[data-insee="${CSS.escape(target.slice(4))}"]`;
  return null;
}

/**
 * Section ou ligne du panneau de preuve annoncée par la voix mais hors de l'écran (panneau défilant, écran de 720 px de haut) :
 * le panneau défile jusqu'à elle, sinon le repère ne s'allume pas et la voix parle d'un élément invisible (contrôle de synchro
 * du 11/11 : « Pour arriver avant » et « Les solutions complémentaires » de la visite complète). Une seule fois par repère.
 */
export function revealMarkTargets(targets: readonly MarkTarget[]): void {
  for (const t of targets) {
    if (!t.startsWith('proof:') && !t.startsWith('row:')) continue;
    const sel = frameSelector(t);
    const el = sel ? document.querySelector<HTMLElement>(sel) : null;
    if (!el || !el.closest('.proof-panel')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue; // pli fermé : useTourFold l'ouvre et le fait défiler
    if (r.top >= 0 && r.bottom <= window.innerHeight) continue;
    // défilement immédiat : un défilement animé allume le repère 150 à 250 ms après le mot (mesure du 11/11)
    el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
}

/** Cible connue de l'écran (le test des scripts refuse une cible inconnue) */
export function isKnownTarget(target: string): boolean {
  return (
    target === 'none' ||
    target === 'origin' ||
    target === 'stars:lit' ||
    target === 'stars:lit:B' ||
    (target.startsWith('pole:') && target.length > 5) ||
    (target.startsWith('proof:') && target.length > 6) ||
    (target.startsWith('row:') && target.length > 4) ||
    target in FRAME_SELECTORS
  );
}

function visibleRect(el: Element, vw: number, vh: number): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return null;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
  if (el.closest('[hidden], [inert]')) return null;
  return r;
}

/**
 * Partie de `r` réellement visible : intersection avec chaque ancêtre qui rogne son contenu (overflow autre que visible).
 * Sans elle, une section du panneau de preuve plus haute que sa zone défilante donnait un cadre qui débordait du panneau
 * jusque sur le compteur de la barre du bas (captures du 11/11 : « Transports utilisés », « Communes du pôle », « Coût et
 * carbone », « Comparer les moyens »). Null si l'élément est entièrement hors de la zone visible.
 */
function clippedByAncestors(el: Element, r: DOMRect): DOMRect | null {
  let x0 = r.left;
  let y0 = r.top;
  let x1 = r.right;
  let y1 = r.bottom;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const c = a.getBoundingClientRect();
    x0 = Math.max(x0, c.left);
    y0 = Math.max(y0, c.top);
    x1 = Math.min(x1, c.right);
    y1 = Math.min(y1, c.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  }
  return new DOMRect(x0, y0, x1 - x0, y1 - y0);
}

function union(rects: readonly DOMRect[]): Box | null {
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.left));
  const y0 = Math.min(...rects.map((r) => r.top));
  const x1 = Math.max(...rects.map((r) => r.right));
  const y1 = Math.max(...rects.map((r) => r.bottom));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clip(b: Box, to: Box): Box {
  const x0 = Math.max(b.x, to.x);
  const y0 = Math.max(b.y, to.y);
  const x1 = Math.min(b.x + b.w, to.x + to.w);
  const y1 = Math.min(b.y + b.h, to.y + to.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Anneau autour d'un bouton d'astre (`.pole-hit` : côté = max(44, 2 r + 16), centré sur l'astre) */
function poleRing(r: DOMRect, thin: boolean): Ring {
  const side = Math.min(r.width, r.height);
  const radius = side > 44 ? (side - 16) / 2 : 14;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: radius + tourMark.ringGapPx, thin };
}

/** Géométrie à l'écran des cibles du repère courant ; `veil` : voile de l'interface (pas au téléphone). */
export function measureMark(targets: readonly MarkTarget[], veil: boolean): MarkGeometry {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rings: Ring[] = [];
  const frames: Box[] = [];
  const marked: Element[] = [];
  const skyA = document.querySelector(SKY_A);
  for (const t of targets) {
    if (t === 'none') continue;
    if (markShape(t) === 'ring') {
      if (t === 'origin') {
        const el = document.querySelector('.guide-hit-marker');
        const r = el ? visibleRect(el, vw, vh) : null;
        if (r) rings.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: 16 + tourMark.ringGapPx, thin: false });
      } else if (t === 'stars:lit' || t === 'stars:lit:B') {
        // Couches des astres dans l'ordre du DOM : A, puis B en diptyque
        const layers = [...document.querySelectorAll(SKY_A)];
        (t === 'stars:lit' ? layers : layers.slice(1, 2)).forEach((layer) =>
          layer.querySelectorAll('.pole-hit[data-etat="accessible"]').forEach((el) => {
            const r = visibleRect(el, vw, vh);
            if (r) rings.push(poleRing(r, true));
          }),
        );
      } else {
        const el = skyA?.querySelector(`.pole-hit[data-pole-id="${CSS.escape(t.slice(5))}"]`);
        const r = el ? visibleRect(el, vw, vh) : null;
        if (r) rings.push(poleRing(r, false));
      }
      continue;
    }
    const sel = frameSelector(t);
    if (!sel) continue;
    const found = [...document.querySelectorAll(sel)].flatMap((el) => {
      const v = visibleRect(el, vw, vh);
      const r = v ? clippedByAncestors(el, v) : null;
      return r ? [{ el, r }] : [];
    });
    marked.push(...found.map((f) => f.el));
    const box = union(found.map((f) => f.r));
    if (box) {
      const p = tourMark.padPx;
      let f: Box = { x: box.x - p, y: box.y - p, w: box.w + 2 * p, h: box.h + 2 * p };
      // Ciel B entier : entre la barre du haut et la barre de scénario (sinon le cadre sort de l'écran)
      if (t === 'sky:B') {
        const top = document.querySelector('.top-bar')?.getBoundingClientRect().bottom ?? 0;
        const bottom = document.querySelector('.scenario-bar')?.getBoundingClientRect().top ?? vh;
        f = clip(f, { x: f.x, y: top + p, w: f.w, h: bottom - top - 2 * p });
      }
      // Toujours entier à l'écran : un bord hors champ ne se lirait pas comme un cadre
      const m = tourMark.strokePx + 2;
      frames.push(clip(f, { x: m, y: m, w: vw - 2 * m, h: vh - 2 * m }));
    }
  }
  const panels: Box[] = [];
  if (veil && (rings.length || frames.length)) {
    for (const sel of UI_REGIONS) {
      document.querySelectorAll(sel).forEach((el) => {
        const r = visibleRect(el, vw, vh);
        if (r) panels.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      });
    }
  }
  const tour = document.querySelector('.tour-overlay');
  const tr = tour ? visibleRect(tour, vw, vh) : null;
  return { rings, frames, panels, safe: tr ? { x: tr.left, y: tr.top, w: tr.width, h: tr.height } : null, marked };
}

/** Pose `data-tour-mark` sur les éléments encadrés, le retire des autres (aucune écriture si rien ne change). */
export function syncMarkedAttr(marked: readonly Element[]): void {
  const keep = new Set(marked);
  document.querySelectorAll('[data-tour-mark]').forEach((el) => {
    if (!keep.has(el)) el.removeAttribute('data-tour-mark');
  });
  for (const el of marked) if (!el.hasAttribute('data-tour-mark')) el.setAttribute('data-tour-mark', '');
}

const round = (n: number) => Math.round(n * 2) / 2;

/** Clé de comparaison (au demi-pixel) : pas de nouveau rendu si rien n'a bougé */
export function geometryKey(g: MarkGeometry): string {
  const b = (x: Box) => `${round(x.x)},${round(x.y)},${round(x.w)},${round(x.h)}`;
  return [
    g.rings.map((r) => `${round(r.x)},${round(r.y)},${round(r.r)},${r.thin ? 1 : 0}`).join(';'),
    g.frames.map(b).join(';'),
    g.panels.map(b).join(';'),
    g.safe ? b(g.safe) : '',
  ].join('|');
}
