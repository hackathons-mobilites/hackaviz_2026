/**
 * États de l'explication « i » (InfoTip), en fonction pure pour être testée sans navigateur.
 *
 * Trois raisons d'être ouverte, qui se combinent :
 * - `pinned` : ouverte par un clic, Entrée ou Espace (elle reste jusqu'à un nouvel appui, Échap ou un clic ailleurs) ;
 * - `hover` : la souris est sur le bouton ou sur la bulle (jamais le doigt : au doigt, le clic seul ouvre) ;
 * - `dismissed` : fermée par Échap (ou par un appui) alors que la souris est encore dessus. L'encadré reste fermé
 *   tant que la souris n'est pas sortie puis revenue.
 *
 * WCAG 1.4.13 (contenu au survol ou au focus) : écartable sans bouger la souris (Échap), survolable (la bulle reste
 * ouverte quand la souris passe du bouton à la bulle), persistant (elle ne se ferme pas seule, seulement quand la
 * souris est sortie du bouton et de la bulle, ou à une action de la personne).
 */
export interface TipState {
  pinned: boolean;
  hover: boolean;
  dismissed: boolean;
}

export type TipEvent = 'enter' | 'leave' | 'click' | 'escape' | 'outside' | 'anchor-gone';

export const TIP_CLOSED: TipState = { pinned: false, hover: false, dismissed: false };

export function isTipVisible(s: TipState): boolean {
  return (s.pinned || s.hover) && !s.dismissed;
}

export function tipReduce(s: TipState, event: TipEvent): TipState {
  switch (event) {
    case 'enter':
      return { ...s, hover: true, dismissed: false };
    case 'leave':
      return { ...s, hover: false, dismissed: false };
    case 'click':
      if (isTipVisible(s)) {
        // Ouverte par le survol : l'appui la fixe. Déjà fixée : l'appui la ferme, même si la souris est dessus.
        return s.pinned ? { pinned: false, hover: s.hover, dismissed: true } : { ...s, pinned: true };
      }
      return { ...s, pinned: true, dismissed: false };
    case 'escape':
      return isTipVisible(s) ? { pinned: false, hover: s.hover, dismissed: true } : s;
    case 'outside':
      return s.pinned ? { ...s, pinned: false } : s;
    case 'anchor-gone':
      // Le bouton est sorti de la zone visible de son conteneur défilant : plus rien à montrer
      return TIP_CLOSED;
  }
}

export interface TipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TipPlacement {
  left: number;
  top: number;
  /** Côté de l'ancre où la bulle s'ouvre (sert à placer le pont de survol) */
  side: 'below' | 'above';
}

/** Espace entre le bouton et la bulle ; le « pont » de survol (CSS) le recouvre pour que la souris ne la quitte pas. */
export const TIP_GAP = 6;
const MARGIN = 8;
const OVERHANG = 8;

/**
 * Position fixe de la bulle (px écran) : sous le bouton ou au-dessus selon `placement`, retournée de l'autre côté
 * si elle ne tient pas, puis ramenée dans la fenêtre. Alignement comme avant : à gauche du bouton (sous) ou à droite (au-dessus).
 */
export function placeTip(
  anchor: TipRect,
  pop: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: 'bottom' | 'top',
): TipPlacement {
  const below = anchor.bottom + TIP_GAP;
  const above = anchor.top - TIP_GAP - pop.height;
  const fitsBelow = below + pop.height <= viewport.height - MARGIN;
  const fitsAbove = above >= MARGIN;
  const wantBelow = placement === 'bottom';
  const useBelow = wantBelow ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
  const top = useBelow ? below : Math.max(MARGIN, above);
  const rawLeft = placement === 'bottom' ? anchor.left - OVERHANG : anchor.right + OVERHANG - pop.width;
  const left = Math.max(MARGIN, Math.min(rawLeft, viewport.width - pop.width - MARGIN));
  return { left, top, side: useBelow ? 'below' : 'above' };
}

/**
 * Correction horizontale (px) à appliquer après placement si la bulle dépasse encore de la fenêtre (mesure du rendu réel) :
 * elle doit rester entièrement visible, quel que soit le navigateur ou le conteneur qui décale la position fixe.
 */
export function tipNudge(rect: { left: number; right: number }, viewportWidth: number): number {
  if (rect.left < MARGIN) return MARGIN - rect.left;
  if (rect.right > viewportWidth - MARGIN) return viewportWidth - MARGIN - rect.right;
  return 0;
}

/** Le bouton est-il encore visible dans son conteneur défilant ? (au moins en partie) */
export function anchorStillVisible(anchor: TipRect, container: TipRect): boolean {
  return anchor.bottom > container.top && anchor.top < container.bottom && anchor.right > container.left && anchor.left < container.right;
}
