/**
 * Zones réservées du ciel (critique v0.6 § 6, L-02) : rectangles écran des cartes et panneaux posés
 * sur le ciel (contraste du jour, halo, preuve, liste, découvertes ouvertes, puce de découverte).
 * PoleLayer les lit pour ne jamais poser un nom sous une carte ; les cartes lisent en retour la
 * position de l'étoile-guide pour s'écarter d'elle (state/panes.ts, `cardSide`).
 * Aucune donnée ici : seulement de la mise en page.
 */
import { useLayoutEffect, type RefObject } from 'react';
import { create } from 'zustand';

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Étoile-guide du ciel A à l'écran, et largeur de son nom (pour que les cartes s'en écartent). */
export interface GuideAnchor {
  x: number;
  y: number;
  labelW: number;
}

interface OverlayState {
  rects: Record<string, ScreenRect>;
  guide: GuideAnchor | null;
  setRect: (key: string, rect: ScreenRect | null) => void;
  setGuide: (g: GuideAnchor | null) => void;
}

/**
 * Zones d'interface posées sur le ciel en permanence (boutons de zoom, barre du haut, légende), distinctes des cartes
 * et panneaux ci-dessus : les noms de pôles les évitent en ne déplaçant que ceux qui tombent dessous (`data/labelZones.ts`).
 */
export const SKY_CHROME_KEYS = ['zoom', 'topbar', 'legend'] as const;
export const isSkyChromeKey = (key: string): boolean => SKY_CHROME_KEYS.some((k) => key === k || key.startsWith(`${k}:`));

const same = (a: ScreenRect | undefined, b: ScreenRect) =>
  !!a && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;

export const useOverlayRects = create<OverlayState>()((set) => ({
  rects: {},
  guide: null,
  setRect: (key, rect) =>
    set((s) => {
      if (!rect) {
        if (!(key in s.rects)) return s;
        const rects = { ...s.rects };
        delete rects[key];
        return { rects };
      }
      return same(s.rects[key], rect) ? s : { rects: { ...s.rects, [key]: rect } };
    }),
  setGuide: (guide) =>
    set((s) => {
      const g = s.guide;
      if (!guide) return g ? { guide: null } : s;
      if (g && Math.abs(g.x - guide.x) < 1 && Math.abs(g.y - guide.y) < 1 && Math.abs(g.labelW - guide.labelW) < 1) return s;
      return { guide };
    }),
}));

/**
 * Boîte de mise en page d'un élément (sans les transformations d'entrée de Motion, qui le décalent
 * pendant 280 ms) : offsetLeft / offsetTop d'un élément `position: fixed` sont relatifs à la fenêtre.
 */
function layoutRect(el: HTMLElement): ScreenRect {
  if (getComputedStyle(el).position === 'fixed') return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * Comme `useReservedRect`, mais publie un rectangle par enfant direct de `ref` (clés `key:0`, `key:1`, ...)
 * au lieu de la boîte entière : une liste en ligne dont les lignes sont plus courtes que le conteneur
 * (la légende en bandeau) ne réserve que ce qui est écrit, jamais le vide à droite des lignes courtes.
 * Les enfants masqués (largeur nulle) ne réservent rien ; ajouts et retraits d'enfants suivis.
 */
export function useReservedChildren(key: string, ref: RefObject<HTMLElement | null>, active: boolean): void {
  const setRect = useOverlayRects((s) => s.setRect);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let published: string[] = [];
    const publish = () => {
      const next: string[] = [];
      Array.from(el.children).forEach((child, i) => {
        const c = child as HTMLElement;
        const k = `${key}:${i}`;
        const r = layoutRect(c);
        if (r.w > 0 && r.h > 0) {
          setRect(k, r);
          next.push(k);
        }
      });
      published.filter((k) => !next.includes(k)).forEach((k) => setRect(k, null));
      published = next;
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => {
      ro?.disconnect();
      ro?.observe(el);
      Array.from(el.children).forEach((c) => ro?.observe(c));
      publish();
    }) : null;
    mo?.observe(el, { childList: true });
    window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', publish);
      published.forEach((k) => setRect(k, null));
    };
  }, [key, ref, active, setRect]);
}

/** Publie le rectangle de `ref` comme zone réservée tant que `active` (taille et fenêtre suivies ; `version` : à changer quand la carte change de place). */
export function useReservedRect(key: string, ref: RefObject<HTMLElement | null>, active: boolean, version: string | number = 0): void {
  const setRect = useOverlayRects((s) => s.setRect);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) {
      setRect(key, null);
      return;
    }
    const publish = () => setRect(key, layoutRect(el));
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', publish);
      setRect(key, null);
    };
  }, [key, ref, active, setRect, version]);
}
