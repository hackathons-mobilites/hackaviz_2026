/** Branche le TourPlayer sur le store (même API applyScenario que l'interface). */
import { useFeaturesStore, type MirrorPhase } from '../components/featuresStore';
import type { ItinerariesFile } from '../data/itineraries';
import { loadGeo } from '../data/geo';
import { loadBmo, loadBmoMetiers, loadContext, loadItineraries } from '../data/loaders';
import { odFolderFor } from '../data/od/folders';
import { communeJobsOf } from '../data/od/communeJobs';
import { loadOdFolder, useOdStore } from '../store/useOdStore';
import type { BmoMetiersFile } from '../data/bmoMetiers';
import type { BmoFile } from '../data/bmo';
import { budgetScale } from '../state/budget';
import { buildSkyView, type SkyView } from '../store/selectors';
import { skyEffects, waitForSky } from '../store/skyBridge';
import { stepEffects, stepUndone } from './effects';
import { focusFolds } from './foldFocus';
import { gainKey, selectReducedMotion, useSkyStore } from '../store/useSkyStore';
import { motion } from '../theme/tokens';

/** Attente maximale du bilan du gain (ms) : au-delà, la variable reste nulle et la visite s'arrête */
const GAIN_WAIT_MS = 4000;
/**
 * Attente maximale de la chorégraphie de la carte miroir (ms) : au-delà, la visite s'arrête. 10 s (6 s avant le 06/11) :
 * le vol vers la carte dépasse 6 s sur un poste sans GPU (Chromium logiciel, mesuré au rejeu de la vidéo du 06/11), ce qui
 * coupait l'enregistrement sans que rien ne soit faux ; une vraie carte absente se referme d'elle-même et arrête plus tôt.
 */
const MAP_WAIT_MS = 10000;
/** Attente maximale de tour.resolved.json et des .vtt (ms) : au-delà, la visite part sans narration enregistrée */
const VOICE_ASSETS_WAIT_MS = 3000;

function waitUntil(ok: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => (ok() || performance.now() - t0 > timeoutMs ? resolve() : window.setTimeout(tick, 50));
    tick();
  });
}
import { endRevealForTour } from '../state/reveal';
import { isRecordMode, recordSignal } from './recordSignal';
import type { ResolvedTour } from './resolve';
import { TourPlayer } from './TourPlayer';
import { loadResolvedTour, TourAudioAssets, tourBase, voice } from './voice';
import { lea } from './tours/lea.tour';
import type { TourScript, TourStep } from './types';
import { checkVariables, resolveNarration } from './variables';

let player: TourPlayer | null = null;

/**
 * Onglet masqué : la visite se met en pause (voix comprise) et reprend au retour, si c'est le masquage
 * qui l'avait arrêtée. Une pause voulue par l'utilisateur reste une pause. Pas en mode enregistrement
 * (la vidéo suit son horloge).
 */
let hiddenPause = false;
let visibilityBound = false;
/** Visite en cours (un chargement de fichiers d'une visite précédente ne s'applique pas à la suivante) */
let session = 0;
function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (!player || isRecordMode()) return;
    if (document.visibilityState === 'hidden') {
      if (player.isPlaying) {
        player.pause();
        hiddenPause = true;
      }
    } else if (hiddenPause) {
      hiddenPause = false;
      player.resume();
    }
  });
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, Math.max(0, ms)));
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Vue d'un ciel de la visite : la MÊME que celle du site (`useSkyView` / `useCompareView`), sur la table commune x commune
 * quand le site l'affiche pour ce scénario (source `tour` : jamais verrouillée, `nextOdLock`). Le compteur, les astres
 * allumés et les temps lus par la narration sont donc ceux de l'écran.
 */
function skyViewOf(side: 'A' | 'B', budget?: number): SkyView | null {
  const s = useSkyStore.getState();
  if (!s.dataset) return null;
  if (side === 'B' && !s.scenario.compare) return null;
  const base = budget != null ? { ...s.scenario, budget } : s.scenario;
  const scenario = side === 'B' ? { ...base, origin: base.compare } : base;
  const od = useOdStore.getState().shown;
  return buildSkyView(s.dataset, scenario, s.access, s.revealed, od ? { shown: od, side } : null);
}

function currentView(budget?: number): SkyView | null {
  return skyViewOf('A', budget);
}

/** context/{insee}.json rangé dans le store avant la narration (flux du panneau de preuve, halo). */
async function ensureContext(insee: string | null): Promise<void> {
  const st = useSkyStore.getState();
  if (!insee || !st.dataset || insee in st.contexts) return;
  const file = await loadContext(st.dataset, insee);
  useSkyStore.setState((s) => (insee in s.contexts ? s : { contexts: { ...s.contexts, [insee]: file } }));
}

/**
 * itineraries/{insee}.json (D-028) de la commune d'origine, lu avant la narration (lignes empruntées par le
 * trajet calculé, ex. bus de remplacement). Fichier non annoncé ou absent : null, les variables d'itinéraire
 * restent nulles et une étape qui en dépend arrête la visite (jamais de trou prononcé).
 */
const tourItineraries: Record<string, ItinerariesFile | null> = {};
async function ensureItineraries(insee: string | null): Promise<void> {
  const st = useSkyStore.getState();
  if (!insee || !st.dataset || insee in tourItineraries) return;
  tourItineraries[insee] = await loadItineraries(st.dataset, insee).catch(() => null);
}

/**
 * bmo_metiers.json (D-035, métier -> famille) et bmo.json (le fichier du panneau de preuve : chiffre de la famille de
 * métiers) lus avant la narration de l'étape « recrutement » (variables `bmo.*`). Fichier absent ou invalide : null, les
 * variables restent nulles et l'étape arrête la visite (jamais de trou prononcé).
 */
let tourBmoMetiers: BmoMetiersFile | null = null;
let tourBmo: BmoFile | null = null;
let tourBmoMetiersAsked = false;
async function ensureBmoMetiers(): Promise<void> {
  const st = useSkyStore.getState();
  if (tourBmoMetiersAsked || !st.dataset) return;
  tourBmoMetiersAsked = true;
  [tourBmoMetiers, tourBmo] = await Promise.all([loadBmoMetiers(st.dataset).catch(() => null), loadBmo(st.dataset).catch(() => null)]);
}

/**
 * Postes salariés (INSEE) par commune (index de la table OD du réglage de marche en vigueur, déjà chargé par le
 * ciel : `loadOdFolder` est mémoïsé), lus avant la narration pour sortir la commune de départ des totaux de postes
 * (point 4.1 du 05/11). Index absent ou illisible : la fonction reste nulle, les variables de postes aussi, et
 * l'étape arrête la visite (jamais un total qui compterait la commune de départ).
 */
let tourCommuneJobs: ((insee: string) => number | null) | null = null;
async function ensureCommuneJobs(): Promise<void> {
  const st = useSkyStore.getState();
  if (tourCommuneJobs || !st.dataset) return;
  const folder = odFolderFor(st.dataset.meta, st.scenario.walk);
  const entry = folder ? await loadOdFolder(folder, st.dataset.poles).catch(() => null) : null;
  const index = entry?.status === 'ready' ? entry.index : null;
  if (index) tourCommuneJobs = (insee) => communeJobsOf(index, insee);
}

/** Vue de l'étape (carte miroir ou ciel) : ouvre ou ferme la carte et attend la fin de sa chorégraphie. */
async function setView(view: 'sky' | 'map'): Promise<boolean> {
  const f = useFeaturesStore.getState();
  const want: MirrorPhase = view;
  if (f.mapPhase === want && f.mapOpen === (view === 'map')) return true;
  f.setMapOpen(view === 'map');
  await waitUntil(() => {
    const g = useFeaturesStore.getState();
    // Carte indisponible (contours absents) : elle se referme d'elle-même
    return g.mapPhase === want || (view === 'map' && !g.mapOpen);
  }, MAP_WAIT_MS);
  return useFeaturesStore.getState().mapPhase === want;
}

/**
 * Glisser de la jauge joué par la visite (acte 1, D-018) : crans du plus petit au budget de l'étape,
 * mise à jour légère (budgetScrub) puis transition complète à l'arrivée. Annulable : l'annulation pose
 * toujours le budget final, pour que l'étape suivante parte du bon état.
 */
let sweep: { target: number } | null = null;
let sweepToken = 0;

/** Crans du glisser (premier = plus petit cran de la jauge, dernier = budget de l'étape) ; null sans glisser. */
function sweepBudgets(step: TourStep): number[] | null {
  const st = useSkyStore.getState();
  const target = step.state.budget;
  const scale = st.dataset ? budgetScale(st.dataset.meta) : null;
  if (!step.budgetSweep || target == null || !scale || selectReducedMotion(st)) return null;
  const out: number[] = [];
  // Par grands crans (15 min) et non par pas de 5 : chaque cran recalcule le ciel (environ 400 ms sur un portable, mesure du
  // 11/11) ; 11 crans figeaient l'écran 6 s et retardaient le sous-titre suivant de 220 à 460 ms, 4 crans tiennent en 2 s.
  const stride = scale.bigStep ?? scale.step;
  for (let b = scale.min; b < target; b += stride) out.push(b);
  return out.length ? [...out, target] : null;
}

function startSweep(budgets: readonly number[]): void {
  const token = ++sweepToken;
  const target = budgets[budgets.length - 1]!;
  sweep = { target };
  void (async () => {
    for (const b of budgets.slice(1, -1)) {
      await sleep(motion.budgetSweepStep);
      if (token !== sweepToken) return;
      useSkyStore.getState().setBudgetScrub(true);
      await useSkyStore.getState().applyScenario({ budget: b }, 'tour');
    }
    await sleep(motion.budgetSweepStep);
    if (token !== sweepToken) return;
    useSkyStore.getState().setBudgetScrub(false);
    await useSkyStore.getState().applyScenario({ budget: target }, 'tour');
    if (token === sweepToken) sweep = null;
  })();
}

async function cancelSweep(): Promise<void> {
  if (!sweep) return;
  const { target } = sweep;
  sweep = null;
  sweepToken++;
  const st = useSkyStore.getState();
  st.setBudgetScrub(false);
  if (st.scenario.budget !== target) await st.applyScenario({ budget: target }, 'tour');
}

/** Section du panneau de preuve soulignée par l'étape (proofFocus) ; null retire le soulignement. */
function setProofFocus(focus: TourStep['proofFocus'] | null): void {
  document.querySelectorAll('[data-tour-focus]').forEach((el) => el.removeAttribute('data-tour-focus'));
  if (focus !== 'flows' && focus !== 'recruit') return;
  const el = document.querySelector<HTMLElement>(focus === 'flows' ? '.pf-flows' : '.pf-recruit');
  if (!el) return;
  el.setAttribute('data-tour-focus', 'true');
  el.scrollIntoView({ block: 'nearest', behavior: selectReducedMotion(useSkyStore.getState()) ? 'auto' : 'smooth' });
}

/** La visite est jouable si le cas est prêt, ou en démo technique (bandeau données fictives visible). */
export function tourAvailable(script: TourScript, isDemo: boolean): boolean {
  return script.ready || isDemo || devTourParam() === script.id;
}

/** En dev uniquement : ?tour=<id> rend la visite jouable même si ready = false (vérification). */
function devTourParam(): string | null {
  return import.meta.env.DEV ? new URLSearchParams(window.location.search).get('tour') : null;
}

/** En dev uniquement : ?tourspeed=N accélère la lecture (vérification de bout en bout). */
function devSpeed(): number {
  const v = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('tourspeed')) : 1;
  return v > 0 ? v : 1;
}

/** Durée du générique de fin en mode enregistrement (ms) - rythme vidéo, pas une donnée */
export const CREDITS_MS = 5000;

export interface StartOptions {
  /** Textes et durées audio attendus (tour.resolved.json) : obligatoires en mode enregistrement */
  resolved?: ResolvedTour;
  /** Mode enregistrement vidéo (tools/record-tour) : signaux starway:record, générique de fin */
  record?: boolean;
}

export function startTour(script: TourScript = lea, opts: StartOptions = {}): void {
  const store = useSkyStore.getState();
  if (!store.dataset) return;
  player?.stop();
  const { resolved, record = false } = opts;
  bindVisibility();
  hiddenPause = false;
  // Contours de la carte miroir préchargés (mémoïsés par loadGeo) : l'étape « carte » arrive des dizaines de secondes plus
  // tard, et sans cela le premier chargement des contours pouvait dépasser MAP_WAIT_MS sur un poste lent (la visite
  // s'arrêtait à « carte miroir indisponible », constaté au rejeu du 05/11).
  if (script.steps.some((s) => s.view === 'map')) void loadGeo();
  // Narration enregistrée (tools/tour-tts) : manifeste = durationMs de tour.resolved.json. Fichiers
  // absents (cas par défaut) : aucune requête audio, la visite suit la durée estimée comme avant.
  // Mode enregistrement : le site ne joue pas la voix (ffmpeg la pose), mais lit les .vtt alignés.
  let assets: TourAudioAssets | null = null;
  const mySession = ++session;
  const assetsReady: Promise<void> = (resolved ? Promise.resolve(resolved) : loadResolvedTour(script.id))
    .then(async (r) => {
      const a = new TourAudioAssets(r, tourBase(script.id));
      await a.prefetchCues();
      if (mySession !== session) return;
      assets = a;
      if (!record) voice.setAssets(a);
      useSkyStore.getState().setTour({ voiceAvailable: !record && a.hasVoice });
    })
    .catch(() => undefined);
  voice.setAssets(null);
  let previous: SkyView | null = null;
  let dayBefore: string | null = null;
  // Le prologue garde le ciel neutre (reveal: false) : posé AVANT la fin de la révélation, sinon les
  // états réels du scénario courant s'afficheraient une image. La visite ne rejoue pas de révélation.
  store.setRevealed(script.steps[0]?.reveal ?? true);
  endRevealForTour();
  store.setPhase('explore');
  store.setTour({
    status: 'playing',
    scriptId: script.id,
    stepIndex: 0,
    stepCount: script.steps.length,
    subtitle: '',
    act: script.steps[0]?.act ?? '',
    cues: null,
    narrating: false,
    persona: script.persona ?? null,
    voiceAvailable: false,
  });
  let pendingSweep: number[] | null = null;
  /** Compteur d'interactions au début de la pose de l'étape, et carte refermée pendant son ouverture : voir `interrupted` */
  let interactionsAtApply = 0;
  let mapRefused = false;
  player = new TourPlayer(script, {
    apply: async (step) => {
      interactionsAtApply = useSkyStore.getState().userInteraction;
      mapRefused = false;
      // Étape précédente interrompue (suivant, précédent) : son glisser se termine au budget final
      await cancelSweep();
      useSkyStore.getState().setTour({ cues: null, narrating: false });
      if (!assets) await Promise.race([assetsReady, sleep(VOICE_ASSETS_WAIT_MS)]);
      setProofFocus(null);
      const view = step.view ?? 'sky';
      // Retour au ciel d'abord (la carte change la vue, jamais l'état), puis le nouvel état
      if (view === 'sky' && !(await setView('sky'))) {
        player?.stop(`la carte miroir ne s'est pas refermée (étape ${step.id})`);
        return;
      }
      const s = useSkyStore.getState();
      dayBefore = s.scenario.day;
      const meta = s.dataset!.meta;
      const state = step.state;
      const origin = state.origin ?? s.scenario.origin ?? meta.story_communes[0] ?? s.dataset!.communes[0]?.insee ?? null;
      pendingSweep = sweepBudgets(step);
      s.setRevealed(step.reveal ?? true);
      // Le halo est propre à l'étape : fermé sauf s'il est demandé. Glisser : on part du plus petit cran.
      await s.applyScenario({ halo: null, ...state, origin, ...(pendingSweep ? { budget: pendingSweep[0]! } : {}) }, 'tour');
      await ensureContext(origin);
      // Halo à deux communes : le niveau de vie de B est lu dans le même fichier que celui du panneau
      await ensureContext(useSkyStore.getState().scenario.compare);
      await ensureItineraries(origin);
      await ensureCommuneJobs();
      if (script.bmoMetier) await ensureBmoMetiers();
      // Deux images : le ciel (SkyCanvas) reçoit le nouvel état avant que la visite attende sa fin.
      await frames();
      if (view === 'map' && !(await setView('map'))) {
        // Carte refermée pendant son vol alors que les contours existent : c'est l'utilisateur, la visite se met en pause
        if (!useFeaturesStore.getState().mapOpen && (await loadGeo())) mapRefused = true;
        else player?.stop(`carte miroir indisponible (étape ${step.id})`);
      }
    },
    interrupted: (step) => {
      const s = useSkyStore.getState();
      return mapRefused || (s.userInteraction !== interactionsAtApply && stepUndone(step, s.scenario));
    },
    waitForSky,
    speed: record ? 1 : devSpeed(),
    audioMs: (i, text) => {
      const step = script.steps[i];
      return step ? assets?.audio(i, step.id, text)?.durationMs : undefined;
    },
    voice: record ? undefined : voice,
    afterSky: (step) => {
      // Glisser de la jauge (acte 1) : il accompagne la narration, qui est résolue au budget final
      if (pendingSweep) {
        startSweep(pendingSweep);
        pendingSweep = null;
      }
      setProofFocus(step.proofFocus ?? null);
      focusFolds(step.openFold);
      // Le ciel est posé (waitForSky compte l'immobilité après le voile) : on lit ce qu'il a montré.
      const fxApi = skyEffects();
      const fxs = stepEffects(dayBefore, useSkyStore.getState().scenario.day, fxApi?.lastTransition() ?? null, step.focusPole);
      useSkyStore.getState().setTour({ silence: fxs.silence });
      if (fxs.shootPole && fxApi) void fxApi.playShootingStar(fxs.shootPole);
      // Vélo + TC : attendre le bilan du gain démontré (or) de ce scénario avant de résoudre la narration.
      const sc = useSkyStore.getState().scenario;
      if (sc.mode === 'bike_transit') {
        const key = gainKey(sc);
        return waitUntil(() => useSkyStore.getState().gainReport?.key === key, GAIN_WAIT_MS);
      }
    },
    onStepStart: (step, index, text) => {
      if (resolved) {
        const expected = resolved.steps[index];
        if (!expected || expected.id !== step.id || expected.text !== text) {
          // L'audio prononcerait un autre texte (ou un autre chiffre) que l'écran : on arrête.
          player?.stop(`texte différent de tour.resolved.json (étape ${step.id})`);
          return;
        }
      }
      // Sous-titres alignés sur l'audio (WebVTT) quand l'étape est enregistrée ; sinon texte découpé
      // Repères visuels (marks) permis à partir d'ici : ils se datent sur ces cues
      useSkyStore.getState().setTour({ cues: assets?.stepCues(index, step.id, text) ?? null, narrating: true });
      if (import.meta.env.DEV && !record && assets) {
        const r = assets.resolved?.steps[index];
        if (r?.durationMs && (r.id !== step.id || r.text !== text))
          console.warn(`Visite : audio de l'étape ${step.id} ignoré, texte différent de tour.resolved.json (npm run tour:resolve puis tools/tour-tts)`);
      }
      recordSignal({ type: 'step', index, id: step.id });
    },
    onFinish: (kind, reason) => {
      void cancelSweep();
      setProofFocus(null);
      hiddenPause = false;
      useSkyStore.getState().setTour({ cues: null, voiceAvailable: false, narrating: false, persona: null });
      if (!record) return;
      if (kind === 'abort') {
        recordSignal({ type: 'abort', reason: reason ?? 'arrêt' });
        return;
      }
      useSkyStore.getState().setTour({ credits: true });
      window.setTimeout(() => {
        useSkyStore.getState().setTour({ credits: false });
        recordSignal({ type: 'end' });
      }, CREDITS_MS);
    },
    snapshot: () => {
      previous = currentView();
    },
    resolve: (step) => {
      // Étape à glisser : le texte est celui de l'état final, comme npm run tour:resolve
      const view = currentView(step.budgetSweep ? (sweep?.target ?? step.state.budget) : undefined);
      if (!view) return { text: '', missing: ['data'] };
      const s = useSkyStore.getState();
      const compare = skyViewOf('B');
      const context = s.scenario.origin ? (s.contexts[s.scenario.origin] ?? null) : null;
      const compareContext = s.scenario.compare ? (s.contexts[s.scenario.compare] ?? null) : null;
      const g = s.gainReport;
      const gain = g && g.key === gainKey(s.scenario) ? g : null;
      const ctx = {
        view, previous, compare, context, compareContext, gain, access: s.access, itineraries: tourItineraries,
        bmoMetiers: tourBmoMetiers,
        bmo: tourBmo,
        bmoMetier: script.bmoMetier ?? null,
        communeJobs: tourCommuneJobs,
      };
      const r = resolveNarration(step.narration, ctx);
      return { text: r.text, missing: [...r.missing, ...checkVariables(step.checks, ctx)] };
    },
    onUpdate: (ui) => {
      const s = useSkyStore.getState();
      if (ui.status === 'ended') {
        s.setRevealed(true);
        s.setTour({ silence: false });
      }
      s.setTour({ ...ui, stepCount: script.steps.length });
    },
    onMissing: (step, missing) => console.warn(`Visite : donnée manquante à l'étape ${step.id}`, missing),
  });
  player.start();
}

export const tourControls = {
  pause: () => {
    hiddenPause = false;
    player?.pause();
  },
  resume: () => {
    hiddenPause = false;
    player?.resume();
  },
  next: () => player?.next(),
  prev: () => player?.prev(),
  stop: () => player?.stop(),
  /** Position dans l'audio de l'étape (ms), pour les sous-titres ; null sans narration en cours */
  voicePosition: (): number | null => voice.positionMs(),
};

export { lea as defaultTour };
