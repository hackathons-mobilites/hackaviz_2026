import { useEffect } from 'react';
import { useSkyStore } from '../store/useSkyStore';

/** Suit prefers-reduced-motion du système et mémorise le choix de l'utilisateur. */
export function useReducedMotionSync(): void {
  const setSystem = useSkyStore((s) => s.setReducedMotionSystem);
  const setUser = useSkyStore((s) => s.setReducedMotionUser);
  const user = useSkyStore((s) => s.reducedMotionUser);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystem(mq.matches);
    const onChange = () => setSystem(mq.matches);
    mq.addEventListener('change', onChange);
    const saved = window.localStorage.getItem('starway.reducedMotion');
    if (saved === 'true' || saved === 'false') setUser(saved === 'true');
    return () => mq.removeEventListener('change', onChange);
  }, [setSystem, setUser]);

  useEffect(() => {
    if (user === null) window.localStorage.removeItem('starway.reducedMotion');
    else window.localStorage.setItem('starway.reducedMotion', String(user));
  }, [user]);
}
