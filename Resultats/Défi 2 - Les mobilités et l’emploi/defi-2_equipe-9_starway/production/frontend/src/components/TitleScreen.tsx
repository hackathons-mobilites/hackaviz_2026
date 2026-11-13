import { motion as m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { buildLogoTimeline } from '../data/logoRevealTimeline';
import { playReveal, skipReveal, titleIsReturning, titleStartDelay } from '../state/reveal';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { logoReveal, motion, reveal } from '../theme/tokens';
import { isRecordMode } from '../tour/recordSignal';
import { ColorVisionToggle } from './ColorVisionToggle';
import { Logo } from './Logo';
import { LogoReveal, type LogoRevealHandle } from './LogoReveal';
import { ReducedMotionToggle } from './ReducedMotionToggle';
import { SoundToggle } from './SoundToggle';
import { TourButton } from './TourButton';

const LINES = [
  ['Le', 'même', 'ciel.'],
  ['Pas', 'les', 'mêmes', 'étoiles.'],
];

/**
 * Écran titre (Acte 0, D-021) : au repos, seulement la nébuleuse et les étoiles de fond derrière
 * (aucun astre, aucune étoile-guide sous le texte). Le titre apparaît mot par mot (80 ms/mot).
 * « Explorer le ciel » lance la révélation : le bloc titre se retire d'un seul tenant (400 ms,
 * `y` -16 px, flou 6 px), le voile radial s'efface avec lui. Mouvement réduit : fondus de 150 ms.
 * Le logo se verrouille d'abord, point par point, en grand au-dessus des boutons (`LogoReveal`), puis se range à sa
 * place ; le titre arrive pendant ce recul. Les boutons sont là dès le début : rien de cliquable n'est invisible.
 */
export function TitleScreen() {
  const isDemo = useSkyStore((s) => s.dataset?.origin === 'demo');
  const reduced = useSkyStore(selectReducedMotion);
  const exploreRef = useRef<HTMLButtonElement>(null);
  const logoRef = useRef<LogoRevealHandle>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  /** Échap : tout en un seul fondu de 150 ms (posé avant la sortie, d'où flushSync) */
  const [quick, setQuick] = useState(false);
  // Lu au montage : ouverture (moitié du fondu de la nébuleuse) ou retour au titre (400 ms)
  const [startDelay] = useState(() => titleStartDelay());
  // Retour au titre et visite enregistrée : logo déjà formé. Ouverture : le titre attend que le logo se range
  const [formed, setFormed] = useState(() => titleIsReturning() || isRecordMode() || reduced);
  // Animations rétablies sur cet écran : le logo reste formé (la scène ne repart pas sur un titre déjà là)
  if (reduced && !formed) setFormed(true);
  const logoDelay = reduced || formed ? 0 : buildLogoTimeline().titleAt / 1000;
  const word = motion.titleWordStagger / 1000;
  const words = LINES.flat().length;
  const fast = reduced || quick;
  const outDuration = (fast ? motion.reduced : reveal.titleOut) / 1000;

  useEffect(() => {
    const t = window.setTimeout(() => exploreRef.current?.focus({ preventScroll: true }), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      flushSync(() => setQuick(true));
      skipReveal();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Mouvement réduit : mots en fondu de 150 ms tous ensemble, sans décalage, sans flou ni déplacement
  const wordFrom = reduced ? { opacity: 0 } : { opacity: 0, y: 14, filter: 'blur(6px)' };
  const wordTo = reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' };
  const wordDelay = (i: number) => (reduced ? startDelay : startDelay + logoDelay + i * word);
  const wordDuration = (reduced ? motion.reduced : motion.light) / 1000;
  const bodyDelay = reduced ? startDelay + 0.1 : startDelay + logoDelay + words * word + 0.3;
  const actionsDelay = reduced || formed ? bodyDelay : startDelay + logoReveal.actionsAt / 1000;

  // La comète file sur le M, puis le ciel s'ouvre (Échap entre-temps : la révélation est déjà passée, rien à relancer)
  const explore = () => {
    const logo = logoRef.current;
    if (reduced || !logo) {
      void playReveal();
      return;
    }
    void logo.sprint().then(() => {
      // Écran titre quitté puis revenu entre-temps (autre logo) : cette révélation-là n'a plus lieu d'être
      if (logoRef.current === logo && useSkyStore.getState().phase === 'title') void playReveal();
    });
  };

  let k = 0;
  return (
    <m.section
      className="title-screen"
      aria-labelledby="title-heading"
      initial={{ opacity: 1 }}
      // le voile radial s'efface sur la même durée que le bloc
      exit={{ opacity: 0, transition: { duration: outDuration, ease: motion.cssEasing.eclipse } }}
    >
      <div className="title-tools">
        <SoundToggle className="icon-btn icon-btn-top tip-end" />
        <ColorVisionToggle className="icon-btn icon-btn-top tip-end" />
        <ReducedMotionToggle className="icon-btn icon-btn-top tip-end" />
      </div>
      <m.div
        className="title-block"
        exit={
          fast
            ? { opacity: 0, transition: { duration: outDuration } }
            : {
                opacity: 0,
                y: -reveal.titleOutY,
                filter: `blur(${reveal.titleOutBlur}px)`,
                transition: { duration: outDuration, ease: motion.cssEasing.eclipse },
              }
        }
      >
        <m.div
          className="title-logo"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ delay: reduced ? startDelay : startDelay * 0.6, duration: wordDuration }}
        >
          {reduced ? <Logo /> : <LogoReveal ref={logoRef} instant={formed} delay={startDelay * 1000} floorRef={actionsRef} />}
        </m.div>
        <h2 id="title-heading" className="title">
          {LINES.map((line, li) => (
            <span key={li} className="title-line">
              {line.map((w) => {
                const i = k++;
                return (
                  <m.span
                    key={`${li}-${w}`}
                    className="title-word"
                    initial={wordFrom}
                    animate={wordTo}
                    transition={{ delay: wordDelay(i), duration: wordDuration, ease: motion.cssEasing.light }}
                  >
                    {w}
                  </m.span>
                );
              })}
            </span>
          ))}
        </h2>
        <div className="title-body">
          <div className="title-lede-fade">
            <m.p
              className="title-lede"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: bodyDelay, duration: wordDuration }}
            >
              Chaque astre est un pôle d'emploi d'Île-de-France ; sa taille, ce sont ses postes salariés recensés par l'INSEE. Choisissez
              une commune, une journée-type et un temps de trajet par sens : les pôles accessibles{' '}
              <strong>à l'aller et au retour</strong> s'allument.
            </m.p>
          </div>
          <m.div
            ref={actionsRef}
            className="title-actions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: actionsDelay, duration: wordDuration }}
          >
            <button ref={exploreRef} type="button" className="btn btn-primary" onClick={explore}>
              Explorer le ciel
            </button>
            <TourButton variant="title" />
          </m.div>
          {isDemo && (
            <m.p
              className="title-demo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: bodyDelay, duration: wordDuration }}
            >
              Version de démonstration : chiffres fictifs.
            </m.p>
          )}
        </div>
      </m.div>
    </m.section>
  );
}
