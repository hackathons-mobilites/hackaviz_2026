import { animate, type JSAnimation } from 'animejs';
import { useEffect, useRef } from 'react';
import { formatInt, roundHundred } from '../data/format';
import { motion } from '../theme/tokens';

interface Props {
  value: number | null;
  reduced: boolean;
  /** Durée du défilement (ms) : celle de l'allumage du ciel, pour finir avec le dernier astre */
  duration?: number;
}

/**
 * Compteur « postes salariés (INSEE) accessibles » : arrondi à la centaine pendant l'animation,
 * valeur exacte à la fin. null → « - » (jamais de 0 de substitution).
 */
export function JobsCounter({ value, reduced, duration = motion.counter }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef({ v: 0 });
  const anim = useRef<JSAnimation | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    anim.current?.pause();
    if (value == null) {
      el.textContent = '-';
      return;
    }
    if (reduced) {
      current.current.v = value;
      el.textContent = formatInt(value);
      return;
    }
    anim.current = animate(current.current, {
      v: value,
      duration,
      ease: motion.easing.light,
      onUpdate: () => {
        el.textContent = formatInt(roundHundred(current.current.v));
      },
      onComplete: () => {
        el.textContent = formatInt(value);
      },
    });
    // la durée suit l'allumage courant ; elle ne relance pas le défilement à elle seule
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);

  // Zéro ou inconnu (L-18) : chiffre gris-bleu clair, jamais en cyan (le cyan dit « accessible »)
  return <span ref={ref} data-testid="compteur-postes" className={`counter-value ${value == null || value === 0 ? 'is-empty' : ''}`} />;
}
