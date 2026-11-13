import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSoundStore } from '../audio/soundStore';
import { returnFocusToTourButton } from '../hooks/focusReturn';
import { cueAt, cueChunks, CUE_MAX_CHARS, sentenceChunks } from '../tour/cues';
import { cueAtTime } from '../tour/vtt';
import { TOUR_COPY } from '../tour/microcopy';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { motion, tourMark, tourSubtitle as subtitleTokens } from '../theme/tokens';
import { defaultTour, tourControls } from '../tour/controller';
import { isRecordMode } from '../tour/recordSignal';
import { subtitleCharsPerLine, subtitleCssVars } from '../tour/subtitleSize';
import { tourVersion } from '../tour/versions';
import { activeMark, markTimeline, sentenceCues } from '../tour/marks';
import { TOURS } from '../tour/registry';
import { TourMarks } from './TourMarks';

/** Taille des sous-titres : jeton `tourSubtitle` (theme/tokens.ts), réglable par Maia */
const SUBTITLE_VARS = subtitleCssVars() as CSSProperties;
/** Pas de l'horloge des sous-titres et des repères (ms) : 40 ms au plus de retard sur la voix (11/11, exigence de synchronisation à 150 ms) */
const CLOCK_TICK_MS = 40;

const ACT_LABEL: Record<string, string> = {
  prologue: 'Prologue',
  acte1: 'Acte 1 · Sous le même ciel',
  acte2: "Acte 2 · L'éclipse",
  acte3: 'Acte 3 · Deux horizons',
  halo: 'Parenthèse · Derrière notre étoile',
  acte4: 'Acte 4 · Rallumer les étoiles',
  epilogue: 'Épilogue',
};

/** Sous-titres + contrôles de la visite. Toute interaction manuelle met la visite en pause. */
export function TourOverlay() {
  const tour = useSkyStore((s) => s.tour);
  const userInteraction = useSkyStore((s) => s.userInteraction);
  const setTour = useSkyStore((s) => s.setTour);
  const lastInteraction = useRef(userInteraction);
  const setOverlayHeight = useSkyStore((s) => s.setOverlayHeight);
  const boxRef = useRef<HTMLElement | null>(null);

  const versionName = tourVersion(tour.scriptId)?.label.toLowerCase();
  const voiceOn = useSoundStore((s) => s.voice);
  const setVoice = useSoundStore((s) => s.setVoice);

  // Repère de sous-titre courant (`maxLines` lignes au plus), rythmé sur la durée de l'étape. Capacité : ce qui tient
  // dans la boîte à la largeur de l'écran (jeton `tourSubtitle`, mesuré) : un repère plus long est recoupé, jamais coupé
  // par le line-clamp (à 390 px, 84 caractères ne tiennent pas sur deux lignes).
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const capacity = Math.min(CUE_MAX_CHARS, subtitleCharsPerLine(viewportW, isRecordMode()) * subtitleTokens.maxLines);
  const cues = useMemo(() => cueChunks(tour.subtitle, capacity), [tour.subtitle, capacity]);
  // Temps écoulé dans l'étape courante (remis à zéro quand la clé d'étape change) et position dans
  // l'audio de l'étape quand une narration enregistrée joue (elle fait foi pour les cues WebVTT).
  const stepKey = `${tour.stepIndex}:${tour.subtitle}`;
  const [clock, setClock] = useState<{ key: string; ms: number; audio: number | null }>({ key: stepKey, ms: 0, audio: null });
  useEffect(() => {
    if (tour.status !== 'playing') return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const audio = tourControls.voicePosition();
      setClock((c) => (c.key === stepKey ? { key: stepKey, ms: c.ms + dt, audio } : { key: stepKey, ms: dt, audio }));
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, [tour.status, stepKey]);
  const elapsed = clock.key === stepKey ? clock.ms : 0;
  const timed = tour.cues?.length ? tour.cues : null;
  const sentences = useMemo(() => (timed ? sentenceCues(tour.subtitle, sentenceChunks(tour.subtitle, capacity), timed) : null), [timed, capacity, tour.subtitle]);
  // Instant de la narration de l'étape : position de l'audio (cues WebVTT), sinon temps écoulé. Sous-titres et repères le partagent.
  const at = timed ? (clock.key === stepKey ? (clock.audio ?? elapsed) : 0) : elapsed;
  let cue: string;
  if (timed) {
    // Une phrase par sous-titre, datée sur les cues WebVTT : jamais coupée au milieu d'une phrase courte.
    // Avant le premier mot de la voix (silence initial du MP3), rien n'est affiché : le texte n'arrive jamais avant la voix.
    const current = at < timed[0]!.startMs ? undefined : (sentences ?? timed)[cueAtTime(sentences ?? timed, at)];
    // Repère de la voix trop long pour l'écran : recoupé, chaque morceau pendant sa part de la durée de la cue
    const pieces = current ? cueChunks(current.text, capacity) : [];
    cue = current ? (pieces[cueAt(pieces, Math.max(0, at - current.startMs), Math.max(1, current.endMs - current.startMs))] ?? current.text) : '';
  } else {
    cue = cues[cueAt(cues, elapsed, tour.stepMs ?? 0)] ?? '';
  }

  // Repères visuels de l'étape (retour de Cyril du 10/11) : l'élément dont parle la voix, au fragment de texte près
  const reduced = useSkyStore(selectReducedMotion);
  const markStep = tour.scriptId ? TOURS[tour.scriptId]?.steps[tour.stepIndex] : undefined;
  const timeline = useMemo(
    () => (markStep?.marks?.length ? markTimeline(markStep.narration, tour.subtitle, markStep.marks, tour.cues, tour.stepMs ?? 0) : null),
    [markStep, tour.subtitle, tour.cues, tour.stepMs],
  );
  useEffect(() => {
    if (import.meta.env.DEV && timeline?.missing.length && tour.narrating)
      console.warn(`Visite : repère introuvable dans le texte de l'étape ${markStep?.id}`, timeline.missing);
  }, [timeline, tour.narrating, markStep]);
  const markOn = tour.narrating && (tour.status === 'playing' || tour.status === 'paused') && timeline ? activeMark(timeline.marks, at) : null;
  const markKey = markOn && markStep ? `${markStep.id}#${markOn.index}` : null;

  // Le ciel réserve la hauteur des sous-titres pendant la visite. Visite lancée depuis le titre
  // (`tourPending`) : la boîte est montée invisible dès le clic, pour que le cadre du ciel soit fixé
  // AVANT la pose des astres (Acte 0).
  const pending = useSkyStore((s) => s.tourPending);
  const active0 = tour.status !== 'idle' || pending;
  useEffect(() => {
    const el = boxRef.current;
    if (!active0 || !el) {
      setOverlayHeight(0);
      return;
    }
    const ro = new ResizeObserver(() => setOverlayHeight(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => {
      ro.disconnect();
      setOverlayHeight(0);
    };
  }, [active0, setOverlayHeight]);

  useEffect(() => {
    if (userInteraction !== lastInteraction.current) {
      lastInteraction.current = userInteraction;
      if (tour.status === 'playing') tourControls.pause();
    }
  }, [userInteraction, tour.status]);

  // Quitter ou fin de la visite : les commandes disparaissent, le focus revient sur « Lancer la visite »
  useEffect(() => {
    if (tour.status === 'ended' && !isRecordMode()) returnFocusToTourButton(boxRef.current);
  }, [tour.status]);

  useEffect(() => {
    if (tour.status !== 'ended') return;
    const t = window.setTimeout(() => setTour({ status: 'idle' }), 3500);
    return () => window.clearTimeout(t);
  }, [tour.status, setTour]);

  const active = tour.status !== 'idle' || pending;
  const reserving = pending && tour.status === 'idle';

  // Mode épuré (retour de l'équipe du 10/11) : pendant la visite, réglages et boutons inutilisés atténués ; tout revient à la fin
  const calm = tour.status === 'playing' || tour.status === 'paused';
  useEffect(() => {
    if (!calm) return;
    const root = document.documentElement;
    root.classList.add('tour-calm');
    root.style.setProperty('--tour-calm-opacity', String(tourMark.calmOpacity));
    root.style.setProperty('--tour-calm-ms', `${tourMark.inMs}ms`);
    return () => {
      root.classList.remove('tour-calm');
      root.style.removeProperty('--tour-calm-opacity');
      root.style.removeProperty('--tour-calm-ms');
    };
  }, [calm]);
  const progress = tour.stepCount ? (tour.stepIndex + 1) / tour.stepCount : 0;

  return (
    <>
    {active && <TourMarks markKey={markKey} targets={markOn?.targets ?? null} reduced={reduced} />}
    <AnimatePresence>
      {active && (
        <m.section
          key="tour"
          ref={boxRef}
          className={`tour-overlay ${reserving ? 'is-reserving' : ''}`}
          style={SUBTITLE_VARS}
          aria-label={`Visite guidée${versionName ? `, ${versionName}` : ''} : ${defaultTour.title}`}
          aria-hidden={reserving ? true : undefined}
          inert={reserving}
          initial={{ opacity: 0, y: 12 }}
          animate={reserving ? { opacity: 0, y: 12 } : { opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: motion.ui / 1000, ease: motion.cssEasing.ui }}
        >
          {tour.silence && tour.status !== 'ended' && (
            <p className="tour-silence" role="status">
              {TOUR_COPY.silence}
            </p>
          )}
          <p className="tour-act">{ACT_LABEL[tour.act] ?? defaultTour.title}</p>
          {/* Le texte complet de l'étape est annoncé aux lecteurs d'écran ; l'écran montre le repère courant. */}
          <p className="sr-only" aria-live="polite">
            {tour.subtitle}
          </p>
          <p className="tour-subtitle" aria-hidden="true">
            {cue}
          </p>
          <div className="tour-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          {tour.status !== 'ended' && (
            <div className="tour-controls">
              <button type="button" className="icon-btn" onClick={tourControls.prev} aria-label="Étape précédente">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 5v14M19 5 9 12l10 7Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              {tour.status === 'playing' ? (
                <button type="button" className="icon-btn tour-playpause" onClick={tourControls.pause} aria-label="Pause">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <button type="button" className="icon-btn tour-playpause" onClick={tourControls.resume} aria-label="Reprendre">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5 19 12 8 19Z" fill="currentColor" />
                  </svg>
                </button>
              )}
              <button type="button" className="icon-btn" onClick={tourControls.next} aria-label="Étape suivante">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 5v14M5 5l10 7-10 7Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <button type="button" className="icon-btn" onClick={tourControls.stop} aria-label="Quitter la visite">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6h12v12H6z" fill="currentColor" />
                </svg>
              </button>
              {tour.voiceAvailable && (
                // Voix de la narration : contrôle propre, indépendant du bouton son (ambiance et bruitages).
                // Libellé constant, état porté par aria-pressed ; les sous-titres restent affichés.
                <button
                  type="button"
                  className="icon-btn tip-up tour-voice"
                  aria-pressed={voiceOn}
                  aria-label="Voix"
                  onClick={() => setVoice(!voiceOn)}
                  data-tip={
                    voiceOn
                      ? 'Voix activée : la narration est lue, les sous-titres restent affichés'
                      : 'Voix coupée : sous-titres seuls. Le bouton son ne règle que l’ambiance'
                  }
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                    {voiceOn ? (
                      <path d="M8 11h.01M12 11h.01M16 11h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    ) : (
                      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    )}
                  </svg>
                </button>
              )}
              <span className="tour-step">
                {tour.stepIndex + 1} / {tour.stepCount}
                {tour.status === 'paused' ? ' · en pause' : ''}
                {tour.voiceAvailable && !voiceOn ? ' · voix coupée' : ''}
              </span>
            </div>
          )}
          <p className="tour-disclaimer">{defaultTour.disclaimer}</p>
        </m.section>
      )}
    </AnimatePresence>
    </>
  );
}
