import { AnimatePresence, MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { ContrastOfTheDay } from './components/ContrastOfTheDay';
import { InsightChip } from './components/InsightChip';
import { DemoBanner } from './components/DemoBanner';
import { FpsMeter } from './components/FpsMeter';
import { HaloPanel } from './components/HaloPanel';
import { Legend } from './components/Legend';
import { useFeaturesStore } from './components/featuresStore';
import { FeaturesToast } from './components/MirrorMapButton';
import { PoleLayer } from './components/PoleLayer';
import { ProofPanel } from './components/ProofPanel';
import { ScenarioBar } from './components/ScenarioBar';
import { SkyCanvas } from './components/SkyCanvas';
import { RecordDirector } from './components/RecordDirector';
import { TourResume } from './components/TourResume';
import { SkyNotice } from './components/SkyNotice';
import { SkyCredit } from './components/SkyCredit';
import { SkySummary } from './components/SkySummary';
import { MySettings } from './components/settings/MySettings';
import { SourcesDrawer } from './components/SourcesDrawer';
import { TitleScreen } from './components/TitleScreen';
import { SkipLink } from './components/SkipLink';
import { TopBar } from './components/TopBar';
import { TourOverlay } from './components/TourOverlay';
import { ZoomControls } from './components/ZoomControls';
import { useMobileInitialZoom } from './hooks/useMobileInitialZoom';
import { useSoundscape } from './audio/useSoundscape';
import { preloadImages, starAgeUrls } from './theme/assets';
import { useReducedMotionSync } from './hooks/useReducedMotionSync';
import { playReveal } from './state/reveal';
import { parseView } from './state/url';
import { useReveal } from './store/selectors';
import { selectReducedMotion, selectShowsFakeData, useSkyStore } from './store/useSkyStore';

// Chargés à la demande (bundle initial plus léger) : carte miroir (d3-geo + géométries) et diptyque.
const MirrorMap = lazy(() => import('./components/MirrorMap').then((m) => ({ default: m.MirrorMap })));
const Diptych = lazy(() => import('./components/Diptych').then((m) => ({ default: m.Diptych })));

export function App() {
  useReducedMotionSync();
  useMobileInitialZoom();
  // Design sonore (D-026) : un seul branchement, rien ne joue avant un geste
  useSoundscape();
  const status = useSkyStore((s) => s.status);
  const error = useSkyStore((s) => s.error);
  const phase = useSkyStore((s) => s.phase);
  const split = useSkyStore((s) => !!s.scenario.compare);
  const mapWanted = useFeaturesStore((s) => s.mapOpen || s.mapPhase !== 'sky');
  const isDemo = useSkyStore(selectShowsFakeData);
  const reduced = useSkyStore(selectReducedMotion);
  const init = useSkyStore((s) => s.init);
  const sharedLink = useSkyStore((s) => s.sharedLink);
  const { mask, quiet } = useReveal();

  useEffect(() => {
    void init(window.location.search);
    // Tête de la jauge (IMG-20) : chargée et décodée pendant l'écran titre, aucun clignotement au premier glisser
    preloadImages(starAgeUrls);
  }, [init]);

  // Lien partagé : pas de titre, la révélation part de la pose (décor 800 ms, pose à 400 ms).
  // `&v=map` : version courte (fondus de 150 ms), puis le vol de la carte miroir.
  // Mode enregistrement : RecordDirector garde l'écran titre et lance la visite lui-même.
  useEffect(() => {
    if (status !== 'ready' || !sharedLink) return;
    if (new URLSearchParams(window.location.search).get('record') === '1') return;
    void playReveal({ shared: true, quick: parseView(window.location.search) === 'map' });
  }, [status, sharedLink]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reduced);
  }, [reduced]);

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <div className={`app ${isDemo ? 'has-demo-banner' : ''}`}>
        {isDemo && <DemoBanner />}
        {status === 'ready' && <SkyCanvas side="A" />}
        {status === 'ready' && split && <SkyCanvas key="B" side="B" />}
        {status === 'loading' && <div className="sky-fallback" aria-hidden="true" />}
        {status === 'error' && (
          <main className="fatal" role="alert">
            <h1>Le ciel n'a pas pu se charger</h1>
            <p>{error}</p>
          </main>
        )}
        {status === 'ready' && (
          <>
            {/* Clavier : le titre (point de départ du focus après la révélation), le lien d'évitement, la barre du haut, puis les commandes de la visite */}
            <h1 id="page-start" className="sr-only" tabIndex={-1}>
              STARWAY - les pôles d'emploi accessibles aller et retour
            </h1>
            {phase === 'explore' && mask.origin && <SkipLink />}
            {/* Acte 0 (D-021) : pendant le titre, aucune interface ne transparaît sous le titre ;
                la barre du haut entre au temps C, avec l'étoile-guide */}
            <AnimatePresence>{mask.origin && <TopBar key="top" />}</AnimatePresence>
            {/* Montée dès le clic sur la visite, avant les astres dans l'ordre de Tab (z-index 31 : devant les feuilles du bas) */}
            <TourOverlay />
            <main id="main" className="explorer" aria-label="Explorateur de scénarios" tabIndex={-1}>
              <PoleLayer side="A" />
              {split && <PoleLayer side="B" />}
              {split && mask.origin && (
                <Suspense fallback={null}>
                  <Diptych />
                </Suspense>
              )}
              <SkySummary />
              {quiet && <SkyNotice />}
            </main>
            <Legend />
            {quiet && <ContrastOfTheDay />}
            {quiet && <InsightChip />}
            {!split && mask.origin && <ZoomControls />}
            {/* Attribution OSM toujours visible sur le ciel (audit du 03/11, point 3 ; motion-spec « Bande de provenance ») */}
            {mask.origin && <SkyCredit />}
            {/* Montée dès le titre, invisible et inert : sa hauteur fixe le cadre du ciel avant la pose */}
            <ScenarioBar />
            {mapWanted && (
              <Suspense fallback={null}>
                <MirrorMap />
              </Suspense>
            )}
            {/* Pôle sélectionné (&p=) et halo (&h=) : après la révélation */}
            {mask.done && <ProofPanel />}
            {mask.done && <HaloPanel />}
            <SourcesDrawer />
            <MySettings />
            <FeaturesToast />
            <AnimatePresence>{phase === 'title' && <TitleScreen key="title" />}</AnimatePresence>
            <RecordDirector />
            <TourResume />
            <FpsMeter />
          </>
        )}
      </div>
    </MotionConfig>
  );
}
