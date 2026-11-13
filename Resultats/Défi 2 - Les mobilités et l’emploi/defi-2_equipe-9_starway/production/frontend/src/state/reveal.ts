/**
 * Acte 0 : chef d'orchestre de la révélation du ciel (motion-spec, « la mise au point », D-021).
 * Enchaîne les étapes `intro` du store : pose → origin → light → done, avec les durées de
 * `theme/tokens.ts` (`reveal`). Les moteurs du ciel suivent `intro` (SkyCanvas) ; ce module ne
 * touche ni PixiJS ni React.
 *
 * Vérité : l'étape `light` n'allume rien tant que les temps de trajet de la commune ne sont pas
 * chargés (masque d'affichage) ; ce module attend ce chargement avant de déclarer la fin.
 */
import { revealTimeline } from '../sky/transitions';
import { waitForSky, whenSkyReady } from '../store/skyBridge';
import { selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { motion, reveal } from '../theme/tokens';

/** Attente maximale du moteur du ciel avant de poser quand même (lien partagé, WebGL lent ou absent) */
const SKY_READY_MAX_MS = 2500;

let run = 0;
let stopListening: (() => void) | null = null;
/** Le titre revient (logo) : il rejoue son apparition sans attendre la nébuleuse, déjà là */
let titleReturning = false;

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, Math.max(0, ms)));
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function waitUntil(ok: () => boolean): Promise<void> {
  if (ok()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useSkyStore.subscribe(() => {
      if (ok()) {
        unsub();
        resolve();
      }
    });
  });
}

/** Le titre revient-il (logo cliqué) ? Le logo est alors déjà formé. */
export function titleIsReturning(): boolean {
  return titleReturning;
}

/** Délai d'apparition du titre (s) : ouverture normale (moitié du fondu de la nébuleuse) ou retour. */
export function titleStartDelay(): number {
  return (titleReturning ? reveal.backTitleAt : motion.nebulaFadeIn * 0.5) / 1000;
}

/** La révélation est-elle en cours (pose, origine ou allumage) ? */
export function revealRunning(): boolean {
  const intro = useSkyStore.getState().intro;
  return intro !== 'title' && intro !== 'done';
}

/** Touches qui n'interrompent pas : navigation au clavier et modificateurs */
const NEUTRAL_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

function listenForInterrupt(): void {
  stopListening?.();
  const onPointer = () => skipReveal();
  const onKey = (e: KeyboardEvent) => {
    if (!NEUTRAL_KEYS.has(e.key)) skipReveal();
  };
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('wheel', onPointer, { capture: true, passive: true });
  window.addEventListener('keydown', onKey, true);
  stopListening = () => {
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('wheel', onPointer, true);
    window.removeEventListener('keydown', onKey, true);
    stopListening = null;
  };
}

function focusMain(): void {
  // Le titre a quitté le DOM : le focus revient au titre de la page (Tab suivant = lien d'évitement), jamais au champ commune (clavier virtuel)
  const active = document.activeElement;
  if (active && active !== document.body) return;
  document.getElementById('page-start')?.focus({ preventScroll: true });
}

export interface RevealOptions {
  /** Lien partagé : pas de titre, décor en 800 ms, pose à 400 ms */
  shared?: boolean;
  /** Version courte (fondus de 150 ms) : lien `&v=map`, la carte suit avec son vol */
  quick?: boolean;
  /** Visite depuis le titre : temps A et B, puis cette fonction (le prologue fait C, l'acte 1 fait D) */
  thenTour?: () => void;
}

/**
 * « Explorer le ciel » (ou ouverture d'un lien partagé) : titre qui se retire, ciel qui se pose,
 * votre commune, allumage, calme. Environ 3 s, interruptible (clic, molette, touche).
 */
export async function playReveal(opts: RevealOptions = {}): Promise<void> {
  const st = useSkyStore.getState();
  if (!st.dataset) return;
  const my = ++run;
  const alive = () => my === run;
  titleReturning = false;
  const reduced = selectReducedMotion(st) || !!opts.quick;
  const tl = revealTimeline(st.dataset.poles.length, { shared: opts.shared, reduced });
  st.setIntroQuiet(false);
  if (opts.thenTour) st.setTourPending(true);
  st.setPhase('explore'); // A. le titre se retire (TitleScreen, sortie de 400 ms)
  if (!opts.thenTour) listenForInterrupt();

  // Lien partagé : la chronologie part quand le moteur est prêt (le décor s'ouvre avec lui)
  if (opts.shared) await Promise.race([whenSkyReady(), sleep(SKY_READY_MAX_MS)]);
  if (!alive()) return;

  await sleep(tl.poseAt);
  if (!alive()) return;
  useSkyStore.getState().setIntro('pose'); // B. le ciel se pose
  await sleep(tl.poseEnd - tl.poseAt + reveal.beat);
  if (!alive()) return;

  if (opts.thenTour) {
    useSkyStore.getState().setTourPending(false);
    opts.thenTour();
    return;
  }

  useSkyStore.getState().setIntro('origin'); // C. votre commune
  focusMain();
  await sleep(tl.lightAt - tl.originAt);
  if (!alive()) return;

  useSkyStore.getState().setIntro('light'); // D. le ciel s'allume, quand les données sont là
  await waitUntil(() => useSkyStore.getState().loadingOrigin === null);
  if (!alive()) return;
  await frames(); // le ciel a reçu les états réels (SkyCanvas), il connaît la durée de l'allumage
  await waitForSky();
  if (!alive()) return;
  await sleep(reveal.beat);
  if (!alive()) return;
  finish();
  await sleep(reduced ? 0 : reveal.quietAfter); // E. calme
  if (!alive()) return;
  useSkyStore.getState().setIntroQuiet(true);
}

function finish(): void {
  stopListening?.();
  useSkyStore.getState().setIntro('done');
}

/**
 * Interruption (clic, molette, touche, Échap sur le titre) : tout se termine en un fondu de 150 ms.
 * Sans données chargées, le ciel finit neutre (le masque d'affichage l'impose).
 */
export function skipReveal(): void {
  const st = useSkyStore.getState();
  if (st.intro === 'done' && st.phase === 'explore') return;
  run++;
  stopListening?.();
  titleReturning = false;
  st.markIntroSkip();
  st.setTourPending(false);
  st.setPhase('explore');
  st.setIntro('done');
  st.setIntroQuiet(true);
}

/** La visite démarre : pas de révélation à rejouer (elle pilote elle-même le ciel). */
export function endRevealForTour(): void {
  run++;
  stopListening?.();
  const st = useSkyStore.getState();
  st.setTourPending(false);
  st.setIntro('done');
  st.setIntroQuiet(true);
}

/**
 * Retour au titre (logo) : la visite est arrêtée par l'appelant (tourControls.stop, avant cet appel ;
 * pas d'import ici pour éviter un cycle avec tour/controller), son interface est remise au repos.
 * Le scénario est gardé (store et URL). L'interface sort,
 * les astres et l'étoile-guide s'effacent ensemble, le décor se rapproche, le titre revient.
 * « Explorer le ciel » rejoue ensuite la révélation avec le scénario courant.
 */
export function backToTitle(): void {
  run++;
  stopListening?.();
  const st = useSkyStore.getState();
  if (st.tour.status !== 'idle') st.setTour({ status: 'idle', credits: false, silence: false });
  useSkyStore.getState().setRevealed(true);
  titleReturning = true;
  st.setTourPending(false);
  st.setIntroQuiet(false);
  st.setIntro('title');
  st.setPhase('title');
}
