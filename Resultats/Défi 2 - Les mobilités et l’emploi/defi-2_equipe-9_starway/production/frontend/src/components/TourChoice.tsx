import { motion as m } from 'motion/react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import { TOUR_COPY } from '../tour/microcopy';
import type { TourScript } from '../tour/types';
import { TOUR_VERSIONS } from '../tour/versions';
import './tourChoice.css';

/**
 * Choix de la version de la visite, par-dessus le ciel. Clavier : le focus arrive sur la première version, Tab boucle,
 * les flèches passent d'une version à l'autre, Entrée lance, Échap ferme sans lancer (le focus revient au bouton, géré
 * par l'appelant). Aucune durée n'est affichée sous les versions (décision de Nicolas du 11/11, 16h50).
 */
export function TourChoice({ onClose, onChoose }: Readonly<{ onClose: () => void; onChoose: (script: TourScript) => void }>) {
  const ref = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const reduced = useSkyStore(selectReducedMotion);
  useFocusTrap(ref, true);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Tab reste au piège de focus ; le reste ne doit atteindre ni l'écran-titre (Échap passe la révélation) ni les raccourcis du ciel
      if (e.key === 'Tab') return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const options = [...(ref.current?.querySelectorAll<HTMLElement>('.tour-choice-option') ?? [])];
        const at = options.indexOf(document.activeElement as HTMLElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        options[(at + step + options.length) % options.length]?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const duration = (reduced ? motion.reduced : motion.ui) / 1000;
  return createPortal(
    <m.div
      className="tour-choice-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration, ease: motion.cssEasing.ui }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <m.div
        ref={ref}
        className="tour-choice"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration, ease: motion.cssEasing.ui }}
      >
        <header className="tour-choice-head">
          <h2 id={titleId}>{TOUR_COPY.choiceTitle}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={TOUR_COPY.choiceClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="tour-choice-options">
          {TOUR_VERSIONS.map(({ script, label, note }, i) => (
            <button
              key={script.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="tour-choice-option"
              data-tour-version={script.id}
              onClick={() => onChoose(script)}
            >
              <span className="tour-choice-name">{label}</span>
              <span className="tour-choice-note">{note}</span>
            </button>
          ))}
        </div>
      </m.div>
    </m.div>,
    document.body,
  );
}
