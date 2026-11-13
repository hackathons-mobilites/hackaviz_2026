import { create } from 'zustand';
import { DataError, demoRequested, loadAccess, loadContext, loadDataset } from '../data/loaders';
import type { AccessFile, ContextFile, Dataset } from '../data/types';
import { DEFAULT_SCENARIO, openingScenario, sanitizeScenario, type Scenario } from '../state/scenario';
import { IDENTITY, type Camera } from '../state/camera';
import type { IntroStep } from '../state/displayMask';
import { hasScenarioParams, parseScenario, writeScenarioToUrl } from '../state/url';
import type { TimedCue } from '../tour/vtt';
import { prepareOd } from './odSync';
import { useOdStore } from './useOdStore';

export type ScenarioSource = 'user' | 'url' | 'tour' | 'insight' | 'init';

export interface TourUiState {
  status: 'idle' | 'playing' | 'paused' | 'ended';
  stepIndex: number;
  stepCount: number;
  subtitle: string;
  act: string;
  /** Identifiant de la visite jouée (`lea` ou `lea-video`) : nom accessible du bloc de la visite */
  scriptId?: string;
  /** Générique de fin affiché (fin naturelle en mode enregistrement) */
  credits?: boolean;
  /** Durée de narration de l'étape (ms, sans la pause) : rythme des sous-titres */
  stepMs?: number;
  /** Changement de journée sans aucune bascule : carte « silence » pendant l'étape */
  silence?: boolean;
  /** Sous-titres WebVTT alignés sur l'audio de l'étape (tools/tour-tts) ; null = texte découpé */
  cues?: TimedCue[] | null;
  /** La visite a une narration enregistrée : contrôle « Voix » affiché */
  voiceAvailable?: boolean;
  /**
   * La narration de l'étape courante a commencé (texte résolu à l'écran) : repères visuels permis (`TourMarks`). Faux pendant
   * la pose de l'étape suivante, pour qu'un repère de l'étape précédente ne reste pas sur un écran qui change.
   */
  narrating?: boolean;
  /** Prénom fictif du personnage de la visite (`TourScript.persona`), affiché sous l'étoile-guide pendant la visite */
  persona?: string | null;
}

/** Bilan du « gain démontré » montré en or (SkyEngine.showGain), pour la légende et la visite. */
export interface GainSummary {
  /** Scénario comparé : origine|journée|budget|mode */
  key: string;
  shown: boolean;
  reason: string | null;
  gained: string[];
  lost: string[];
  legend: { label: string; detail: string; color: string } | null;
}

export function gainKey(s: { origin: string | null; day: string; budget: number; mode: string }): string {
  return `${s.origin}|${s.day}|${s.budget}|${s.mode}`;
}

export interface SkyState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  dataset: Dataset | null;
  scenario: Scenario;
  /** Fichiers access/{insee}.json chargés (null = absent pour cette commune) */
  access: Record<string, AccessFile | null>;
  /** Communes dont les temps affichés sont FICTIFS (bandeau obligatoire) */
  accessDemo: Record<string, boolean>;
  /** Fichiers context/{insee}.json chargés (null = absent) */
  contexts: Record<string, ContextFile | null>;
  loadingOrigin: string | null;
  phase: 'title' | 'explore';
  /**
   * Acte 0 (D-021) : étape de la révélation du ciel, distincte de `phase`. Le scénario d'ouverture est
   * appliqué dès le départ (il précharge les temps de trajet) ; c'est l'AFFICHAGE qui est masqué
   * (state/displayMask.ts). Pilotée par state/reveal.ts.
   */
  intro: IntroStep;
  /** Révélation finie depuis `reveal.quietAfter` : cartes secondaires permises */
  introQuiet: boolean;
  /** Instant (performance.now) de la dernière interruption de la révélation ; 0 = aucune */
  introSkipAt: number;
  /** Visite lancée depuis le titre : les sous-titres réservent leur hauteur avant la pose */
  tourPending: boolean;
  /** Le lien ouvert contenait un scénario : on saute l'écran-titre */
  sharedLink: boolean;
  /** Toujours vrai depuis le retrait du ciel à 15 pôles (D-054) : drapeau conservé pour les composants qui le lisent encore */
  astres44: boolean;
  /** Le chargement de la table OD du scénario a échoué (erreur réseau ou fichier), à ne pas confondre avec « en cours de calcul » */
  odFailed: boolean;
  reducedMotionSystem: boolean;
  /** null = suivre le système */
  reducedMotionUser: boolean | null;
  sourcesOpen: boolean;
  /** Paragraphe de « Sources & limites » à montrer à l'ouverture (id d'ancre), ex. « marche-reglage » */
  sourcesAnchor: string | null;
  /** Incrémenté à chaque interaction manuelle (la visite se met en pause) */
  userInteraction: number;
  tour: TourUiState;
  /** Or du gain démontré (vélo + TC face aux TC) ; null si rien n'est comparé */
  gainReport: GainSummary | null;
  setGainReport: (g: GainSummary | null) => void;
  /** false = ciel non révélé (prologue de la visite) : astres neutres, aucune lumière d'accessibilité */
  revealed: boolean;
  /** Caméra du ciel (zoom / déplacement) */
  camera: Camera;
  /** Hauteur de la barre de scénario (px), pour cadrer le ciel au-dessus */
  barHeight: number;
  /** La barre (montée invisible dès le titre) a été mesurée au moins une fois */
  barMeasured: boolean;
  /** Hauteur des sous-titres de la visite (0 hors visite) : le ciel se cadre au-dessus */
  overlayHeight: number;
  /**
   * Glisser en cours sur la jauge du budget : le ciel se met à jour en fondu court, sans silence,
   * et l'URL n'est écrite qu'au relâchement (transition complète).
   */
  budgetScrub: boolean;
  /**
   * D-019 : la visite et les découvertes sont calculées sur `access/` aux journées-types ; tant que
   * l'une d'elles a posé le scénario, le ciel reste sur cette base (leurs chiffres restent vrais).
   * Levé dès que l'utilisateur change un réglage du scénario (commune, horaire, temps, mode, marche,
   * comparaison) ; le ciel passe alors sur la table commune x commune si le mode y est servi.
   */
  odLock: boolean;

  init: (search: string) => Promise<void>;
  applyScenario: (partial: Partial<Scenario>, source?: ScenarioSource) => Promise<void>;
  setPhase: (phase: SkyState['phase']) => void;
  setIntro: (intro: IntroStep) => void;
  setIntroQuiet: (quiet: boolean) => void;
  markIntroSkip: () => void;
  setTourPending: (pending: boolean) => void;
  /** Ouvre ou ferme « Sources & limites » ; `anchor` : paragraphe à faire défiler jusqu'à l'écran */
  setSourcesOpen: (open: boolean, anchor?: string | null) => void;
  setReducedMotionUser: (value: boolean | null) => void;
  setReducedMotionSystem: (value: boolean) => void;
  setTour: (partial: Partial<TourUiState>) => void;
  setCamera: (camera: Camera) => void;
  setRevealed: (revealed: boolean) => void;
  setBarHeight: (h: number) => void;
  setOverlayHeight: (h: number) => void;
  setBudgetScrub: (on: boolean) => void;
}

let applyToken = 0;
let odController: AbortController | null = null;

/** Réglages dont le changement par l'utilisateur lève le verrou D-019 (le pôle et le halo ne le lèvent pas). */
const SETTING_KEYS = ['origin', 'day', 'budget', 'mode', 'walk', 'compare'] as const;

function settingsChanged(a: Scenario, b: Scenario): boolean {
  if (SETTING_KEYS.some((k) => (a[k] ?? null) !== (b[k] ?? null))) return true;
  return (a.shift?.start ?? null) !== (b.shift?.start ?? null) || (a.shift?.end ?? null) !== (b.shift?.end ?? null);
}

/**
 * Verrou D-019 après un appel (fonction PURE) : posé par les découvertes (calculées sur `access/` aux journées-types),
 * levé par un lien ouvert ou par un changement de réglage de l'utilisateur ; ouvrir un pôle ou le halo le garde.
 * La VISITE ne le pose plus (décision de Nicolas du 06/11) : elle montre le ciel que le site affiche pour le même
 * scénario (table commune x commune), donc le compteur, les astres allumés et les temps que le jury retrouve en ouvrant
 * le site. Elle garde l'horaire de la journée-type et le réglage de marche par défaut (`applyScenario`).
 */
export function nextOdLock(source: ScenarioSource, lock: boolean, prev: Scenario, next: Scenario): boolean {
  // 13/11 (Chaville en 14h-22h, retour de Nicolas) : les découvertes sont calculées sur la table commune x commune depuis le
  // 10/11 (08e_insights_astres.py, od_walk3000) ; le verrou affichait encore `access/` : compteur 2 493 877 sous une carte qui
  // dit 1 088 397. Comme la visite, une découverte montre désormais le ciel du site pour le même scénario.
  if (source === 'insight') return false;
  if (source === 'tour') return false;
  if (source === 'url' || source === 'init') return false;
  return lock && !settingsChanged(prev, next);
}

export const useSkyStore = create<SkyState>()((set, get) => ({
  status: 'loading',
  error: null,
  dataset: null,
  scenario: DEFAULT_SCENARIO,
  access: {},
  accessDemo: {},
  contexts: {},
  loadingOrigin: null,
  phase: 'title',
  intro: 'title',
  introQuiet: false,
  introSkipAt: 0,
  tourPending: false,
  sharedLink: false,
  astres44: true,
  odFailed: false,
  reducedMotionSystem: false,
  reducedMotionUser: null,
  sourcesOpen: false,
  sourcesAnchor: null,
  userInteraction: 0,
  tour: { status: 'idle', stepIndex: 0, stepCount: 0, subtitle: '', act: '' },
  camera: IDENTITY,
  revealed: true,
  gainReport: null,
  setGainReport: (gainReport) => set({ gainReport }),
  barHeight: 120,
  barMeasured: false,
  overlayHeight: 0,
  budgetScrub: false,
  odLock: false,

  async init(search) {
    try {
      const dataset = await loadDataset({ demo: demoRequested(search) });
      const shared = hasScenarioParams(search);
      // Lien partagé : pas d'écran titre, la révélation part de la pose (App lance playReveal)
      set({ dataset, status: 'ready', sharedLink: shared, phase: shared ? 'explore' : 'title', intro: 'title' });
      await get().applyScenario(shared ? parseScenario(search) : { ...DEFAULT_SCENARIO, ...openingScenario(dataset.meta) }, 'url');
    } catch (e) {
      const message = e instanceof DataError ? e.message : 'Impossible de charger les données.';
      console.error(e);
      set({ status: 'error', error: message });
    }
  },

  async applyScenario(partial, source = 'user') {
    const { dataset } = get();
    if (!dataset) return;
    const token = ++applyToken;
    // La visite et les découvertes sont calculées sur le réglage de marche par défaut (D-024) : elles
    // y reviennent toujours, quel que soit le réglage choisi avant
    // Elles portent aussi sur les journées-types : aucun horaire libre (D-019)
    const automated = source === 'tour' || source === 'insight';
    const merged = { ...get().scenario, ...partial, ...(automated ? { walk: null, shift: null } : {}) };
    const next = sanitizeScenario(
      merged,
      dataset.meta,
      new Set(dataset.communes.map((c) => c.insee)),
      new Set(dataset.poles.map((p) => p.id)),
    );
    if (source === 'user') set((s) => ({ userInteraction: s.userInteraction + 1 }));
    const lock = nextOdLock(source, get().odLock, get().scenario, next);

    // Table OD (D-019) en parallèle des fichiers access/ (toujours chargés : visite, or, preuve, repli)
    odController?.abort();
    const controller = new AbortController();
    odController = controller;
    set({ odFailed: false });
    const odJob = prepareOd(dataset, next, lock, controller.signal).catch((e: unknown) => {
      if (controller.signal.aborted) return null;
      console.error('Table OD (D-019) :', e);
      set({ odFailed: true });
      return null;
    });

    const toLoad = [next.origin, next.compare].filter((x): x is string => !!x && !(x in get().access));
    if (toLoad.length) {
      set({ loadingOrigin: next.origin });
      const files = await Promise.all(toLoad.map((insee) => loadAccess(dataset, insee)));
      if (token !== applyToken) return;
      set((s) => {
        const access = { ...s.access };
        const accessDemo = { ...s.accessDemo };
        toLoad.forEach((insee, i) => {
          access[insee] = files[i]?.file ?? null;
          accessDemo[insee] = files[i]?.demo ?? false;
        });
        return { access, accessDemo, loadingOrigin: null };
      });
    }
    if (next.halo && next.origin && !(next.origin in get().contexts)) {
      const insee = next.origin;
      const ctx = await loadContext(dataset, insee);
      set((s) => ({ contexts: { ...s.contexts, [insee]: ctx } }));
    }
    if (token !== applyToken) return;
    // Nouvelle commune : son fichier OD peut encore être en route (la révélation attend loadingOrigin)
    if (next.origin && (next.origin !== get().scenario.origin || next.compare !== get().scenario.compare)) set({ loadingOrigin: next.origin });
    const od = await odJob;
    if (token !== applyToken) return;
    // Scénario final : horaire libre gardé seulement s'il est calculé sur la table OD (odSync)
    const final = od ? od.scenario : { ...next, shift: null };
    useOdStore.setState({ shown: od?.shown ?? null, off: od?.off ?? null, current: od?.current ?? null, transitRef: od?.transitRef ?? null });
    // Dernier appel : plus rien n'est en chargement pour le scénario affiché (un appel remplacé en
    // cours de chargement ne remet pas loadingOrigin à null ; la révélation attend cette valeur)
    set({ scenario: final, loadingOrigin: null, odLock: lock });
    // Pendant le glisser de la jauge, l'URL attend le relâchement (pas d'écriture à chaque cran)
    if (!get().budgetScrub) writeScenarioToUrl(final);
  },

  setPhase: (phase) => set({ phase }),
  setIntro: (intro) => set((s) => (s.intro === intro ? s : { intro })),
  setIntroQuiet: (introQuiet) => set({ introQuiet }),
  markIntroSkip: () => set({ introSkipAt: performance.now() }),
  setTourPending: (tourPending) => set({ tourPending }),
  setSourcesOpen: (sourcesOpen, anchor = null) => set({ sourcesOpen, sourcesAnchor: sourcesOpen ? anchor : null }),
  setReducedMotionUser: (reducedMotionUser) => set({ reducedMotionUser }),
  setReducedMotionSystem: (reducedMotionSystem) => set({ reducedMotionSystem }),
  setTour: (partial) => set((s) => ({ tour: { ...s.tour, ...partial } })),
  setCamera: (camera) => set({ camera }),
  setRevealed: (revealed) => set({ revealed }),
  setBarHeight: (barHeight) =>
    set((s) => (Math.abs(s.barHeight - barHeight) > 1 ? { barHeight, barMeasured: true } : s.barMeasured ? s : { barMeasured: true })),
  setOverlayHeight: (overlayHeight) => set((s) => (Math.abs(s.overlayHeight - overlayHeight) > 1 ? { overlayHeight } : s)),
  setBudgetScrub: (budgetScrub) => set((s) => (s.budgetScrub === budgetScrub ? s : { budgetScrub })),
}));

/** Un chiffre fictif est-il affiché ? (jeu démo, ou temps de trajet de repli pour l'origine / la comparaison) */
export function selectShowsFakeData(s: Pick<SkyState, 'dataset' | 'scenario' | 'accessDemo'>): boolean {
  if (s.dataset?.origin === 'demo') return true;
  return [s.scenario.origin, s.scenario.compare].some((insee) => !!insee && s.accessDemo[insee]);
}

/** Espace réservé sous le ciel : barre de scénario + sous-titres de la visite. */
export function selectSkyBottom(s: Pick<SkyState, 'barHeight' | 'overlayHeight'>): number {
  return s.barHeight + (s.overlayHeight > 0 ? s.overlayHeight + 16 : 0);
}

export function selectReducedMotion(s: Pick<SkyState, 'reducedMotionSystem' | 'reducedMotionUser'>): boolean {
  return s.reducedMotionUser ?? s.reducedMotionSystem;
}
