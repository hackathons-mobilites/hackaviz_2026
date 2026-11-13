import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect } from 'react';
import { useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';
import './features.css';
import { useFeaturesStore } from './featuresStore';

/** « Voir la carte » / « Revenir au ciel » (touche M, Échap pour revenir) : bascule temporaire du ciel vers la carte miroir. */
export function MirrorMapButton() {
  const open = useFeaturesStore((s) => s.mapOpen);
  const setOpen = useFeaturesStore((s) => s.setMapOpen);

  // Touche M : ouvrir / fermer la carte (hors champ de saisie). Ici et non dans MirrorMap,
  // chargé à la demande : la touche doit marcher avant la première ouverture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'm' && e.key !== 'M') || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (useSkyStore.getState().intro !== 'done') return;
      const st = useFeaturesStore.getState();
      st.setMapOpen(!st.mapOpen);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Groupe des vues de la barre du haut (L-13) : icône + libellé court, libellé masqué sous 1 440 px,
  // nom complet (contient le libellé visible) et infobulle visible au survol et au focus.
  // Retour du testeur KBS (10/11) : le bouton dit où il mène dans chaque état. Fermé : icône de carte,
  // « Voir la carte ». Ouvert : icône d'étoile (le ciel) et « Revenir au ciel », libellé toujours écrit
  // (classe `is-back`), même sous 1 440 px : c'est la sortie de la carte, elle ne se devine pas.
  return (
    <button
      type="button"
      className={`btn btn-ghost feature-btn view-btn map-toggle${open ? ' is-back' : ''}`}
      aria-keyshortcuts={open ? 'M Escape' : 'M'}
      aria-label={open ? 'Revenir au ciel' : 'Voir la carte'}
      data-tip={open ? 'Revenir au ciel (touche M ou Échap)' : 'Voir la carte : situer les pôles sur la carte des communes (touche M)'}
      onClick={() => setOpen(!open)}
    >
      {open ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 L13.8 10.2 L21 12 L13.8 13.8 L12 21 L10.2 13.8 L3 12 L10.2 10.2 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 6.5l5-2 7 2.5 5-2v13l-5 2-7-2.5-5 2z M8.5 4.5v13 M15.5 7v13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
      <span className="view-label">{open ? 'Revenir au ciel' : 'Voir la carte'}</span>
    </button>
  );
}

/** Message bref (affiche enregistrée, carte indisponible…), annoncé poliment. */
export function FeaturesToast() {
  const toast = useFeaturesStore((s) => s.toast);
  return (
    <div aria-live="polite" className="sr-live-wrap">
      <AnimatePresence>
        {toast && (
          <m.p
            key={toast}
            className="features-toast"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
          >
            {toast}
          </m.p>
        )}
      </AnimatePresence>
    </div>
  );
}
