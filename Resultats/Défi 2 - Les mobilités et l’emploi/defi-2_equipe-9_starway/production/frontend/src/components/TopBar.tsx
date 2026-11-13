import { motion as m } from 'motion/react';
import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { backToTitle } from '../state/reveal';
import { useReservedRect } from '../store/overlayRects';
import { useSkyStore } from '../store/useSkyStore';
import { motion, reveal } from '../theme/tokens';
import { ColorVisionToggle } from './ColorVisionToggle';
import { tourControls } from '../tour/controller';
import { GuideButton } from './guide/GuideButton';
import { Insights } from './Insights';
import { Logo } from './Logo';
import { MirrorMapButton } from './MirrorMapButton';
import { PosterButton } from './PosterButton';
import { ProvenanceToggle } from './provenance/ProvenanceToggle';
import { ReducedMotionToggle } from './ReducedMotionToggle';
import { SoundToggle } from './SoundToggle';
import { SubscriptionsButton } from './subscriptions/SubscriptionsButton';
import { TourButton } from './TourButton';

const SkyList = lazy(() => import('./SkyList').then((m) => ({ default: m.SkyList })));

/**
 * Barre du haut hiérarchisée (L-13, critique v0.6 § 9) : logo monochrome (aucun cyan ni or hors des
 * données) ; « Découvertes » en bouton texte et « Lancer la visite », seul bouton plein ; les autres
 * lectures du ciel (liste, carte, affiche) en un groupe d'icônes libellées (libellé masqué sous
 * 1 440 px, infobulle au survol et au focus) ; « Sources & limites » en lien ; son et mouvement réduit
 * en icônes avec infobulle. Mobile (≤ 430 px) : tout sauf la visite et les découvertes dans le menu.
 */
export function TopBar() {
  const setSourcesOpen = useSkyStore((s) => s.setSourcesOpen);
  /** Mobile (≤ 430 px) : actions secondaires dans un menu */
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // référence stable : la liste se referme d'elle-même (carte, visite) sans relancer ses effets
  const closeList = useCallback(() => setListOpen(false), []);
  // Zone réservée du ciel (arbitrage de Nicolas du 05/11, mobile 390 px) : aucun nom de pôle sous la barre
  const barRef = useRef<HTMLElement>(null);
  useReservedRect('topbar', barRef, true);

  return (
    <m.header
      ref={barRef}
      className="top-bar"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: motion.ui / 1000, ease: motion.cssEasing.ui } }}
      exit={{ opacity: 0, transition: { duration: reveal.backUi / 1000, ease: motion.cssEasing.ui } }}
    >
      <button
        type="button"
        className="brand"
        onClick={() => {
          // Retour au titre : la visite s'arrête, le scénario est gardé (store et URL)
          if (useSkyStore.getState().tour.status !== 'idle') tourControls.stop();
          backToTitle();
        }}
        aria-label="STARWAY - revenir à l'écran-titre"
      >
        <Logo small mono />
        <span className="brand-tagline">Le même ciel, mais pas les mêmes étoiles</span>
      </button>
      <nav className="top-actions" aria-label="Actions">
        <Insights />
        <TourButton />
        <button
          type="button"
          className="icon-btn top-menu-btn"
          aria-expanded={menuOpen}
          aria-controls="top-more"
          aria-label="Menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <div id="top-more" className={`top-more ${menuOpen ? 'is-open' : ''}`}>
        <div className="view-group" role="group" aria-label="Autres lectures du ciel">
          <button
            type="button"
            className="btn btn-ghost feature-btn view-btn"
            aria-expanded={listOpen}
            aria-label="Lire le ciel en liste"
            data-tip="Lire le ciel en liste (tableau accessible)"
            onClick={() => setListOpen(!listOpen)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 7h11M9 12h11M9 17h11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="5" cy="7" r="1.3" fill="currentColor" />
              <circle cx="5" cy="12" r="1.3" fill="currentColor" />
              <circle cx="5" cy="17" r="1.3" fill="currentColor" />
            </svg>
            <span className="view-label">Liste</span>
          </button>
          <MirrorMapButton />
          <PosterButton />
        </div>
        <button type="button" className="link-btn top-sources" onClick={() => setSourcesOpen(true)}>
          Sources &amp; limites
        </button>
        <GuideButton />
        <SubscriptionsButton />
        <SoundToggle />
        <ColorVisionToggle />
        <ProvenanceToggle />
        <ReducedMotionToggle />
        </div>
      </nav>
      {listOpen && (
        <Suspense fallback={null}>
          <SkyList open={listOpen} onClose={closeList} />
        </Suspense>
      )}
    </m.header>
  );
}
