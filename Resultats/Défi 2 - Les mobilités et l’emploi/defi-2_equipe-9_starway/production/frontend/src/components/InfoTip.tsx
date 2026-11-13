import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, type ReactNode } from 'react';
import { TIP_CLOSED, anchorStillVisible, isTipVisible, placeTip, tipNudge, tipReduce } from './infoTipState';

/** L'API « popover » met l'encadré dans la couche supérieure du navigateur : rien ne le coupe, ni le défilement du panneau, ni un flou d'arrière-plan. */
const HAS_POPOVER = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

/** Premier ancêtre qui défile (ou la fenêtre) : sa zone visible dit si le bouton « i » est encore à l'écran. */
function scrollParentRect(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p.getBoundingClientRect();
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/**
 * Explication d'un mot, à la demande, au clavier, à la souris et au doigt (remplace les `title` de survol) :
 * - un bouton « i » (Tab, puis Entrée ou Espace, ou un clic) ouvre un encadré et le fixe ; un second appui,
 *   Échap ou un clic ailleurs le referme ;
 * - au SURVOL de la souris, l'encadré s'ouvre aussi, et reste tant que la souris n'a quitté ni le bouton ni l'encadré ;
 * - WCAG 1.4.13 : Échap le ferme sans bouger la souris (il ne revient qu'après être sorti puis revenu), on peut passer la
 *   souris sur l'encadré pour le lire, il ne se ferme pas tout seul, et il n'est jamais coupé par le défilement du
 *   panneau (couche supérieure, position suivie au défilement, fermé si le bouton sort de la zone visible).
 * Le texte est lié au bouton (`aria-controls`, `aria-describedby` une fois ouvert) et reste dans la page, masqué, tant que l'encadré est fermé.
 * Aucune animation : l'encadré apparaît et disparaît d'un coup (rien à réduire en mouvement réduit).
 * Les états sont dans `infoTipState.ts` (fonctions pures testées).
 */
export function InfoTip({
  label,
  children,
  placement = 'bottom',
  className = '',
}: {
  /** Nom accessible du bouton, ex. « Que veut dire Hors budget ? » */
  label: string;
  children: ReactNode;
  /** Côté d'ouverture voulu : sous le bouton (légende du haut) ou au-dessus (barre du bas) ; retourné si l'encadré ne tient pas */
  placement?: 'bottom' | 'top';
  className?: string;
}) {
  const [state, send] = useReducer(tipReduce, TIP_CLOSED);
  const visible = isTipVisible(state);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  /** Place l'encadré (px écran) ; retourne faux si le bouton n'est plus visible dans son conteneur. */
  const position = useCallback((): boolean => {
    const b = btn.current;
    const p = pop.current;
    if (!b || !p) return true;
    const a = b.getBoundingClientRect();
    if (!anchorStillVisible(a, scrollParentRect(b))) return false;
    const { width, height } = p.getBoundingClientRect();
    const at = placeTip(a, { width, height }, { width: window.innerWidth, height: window.innerHeight }, placement);
    p.style.left = `${at.left}px`;
    p.style.top = `${at.top}px`;
    // Dernière vérification sur la position réelle : la bulle reste entièrement dans la fenêtre
    const nudge = tipNudge(p.getBoundingClientRect(), window.innerWidth);
    if (nudge) p.style.left = `${at.left + nudge}px`;
    p.dataset.side = at.side;
    return true;
  }, [placement]);

  // Ouverture et fermeture de la couche supérieure, puis placement avant la première image
  useLayoutEffect(() => {
    const p = pop.current;
    if (HAS_POPOVER && p) {
      try {
        if (visible && !p.matches(':popover-open')) p.showPopover();
        else if (!visible && p.matches(':popover-open')) p.hidePopover();
      } catch {
        /* déjà dans l'état voulu */
      }
    }
    if (visible && !position()) send('anchor-gone');
  }, [visible, position]);

  // Ouvert : Échap (même sans focus, souris immobile), clic ailleurs, défilement et redimensionnement
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Échap ferme d'abord l'encadré, pas le panneau qui le contient
      e.stopPropagation();
      e.stopImmediatePropagation();
      send('escape');
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) send('outside');
    };
    const onMove = (e: Event) => {
      if (e.target instanceof Node && pop.current?.contains(e.target)) return;
      if (!position()) send('anchor-gone');
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [visible, position]);

  return (
    <span
      ref={wrap}
      className={`info-tip info-${placement} ${className}`}
      // Survol à la souris seulement (au doigt, le clic seul ouvre) ; la bulle est dans le survol : la souris peut y passer
      onPointerEnter={(e) => e.pointerType === 'mouse' && send('enter')}
      onPointerLeave={(e) => e.pointerType === 'mouse' && send('leave')}
    >
      <button
        ref={btn}
        type="button"
        className="info-btn"
        aria-label={label}
        aria-expanded={visible}
        aria-controls={id}
        aria-describedby={visible ? id : undefined}
        onClick={() => send('click')}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 7.2 V11.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        </svg>
      </button>
      <span
        ref={pop}
        id={id}
        role="note"
        className="info-pop"
        data-side={placement === 'bottom' ? 'below' : 'above'}
        {...(HAS_POPOVER ? { popover: 'manual' } : { hidden: !visible })}
      >
        <span className="info-pop-body">{children}</span>
      </span>
    </span>
  );
}
