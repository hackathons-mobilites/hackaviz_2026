/**
 * Résolution d'une visite HORS navigateur (npm run tour:resolve) : rejoue les états des étapes
 * exactement comme le lecteur (même fusion, même assainissement, halo et révélation propres à
 * l'étape) et résout la narration avec les mêmes fonctions pures. Module PUR.
 */
import { computePoleStates } from '../data/accessibility';
import { goldDelta } from '../data/gain';
import type { BmoMetiersFile } from '../data/bmoMetiers';
import type { BmoFile } from '../data/bmo';
import type { ItinerariesFile } from '../data/itineraries';
import type { AccessFile, ContextFile, Dataset } from '../data/types';
import { DEFAULT_SCENARIO, sanitizeScenario, type Scenario } from '../state/scenario';
import { buildSkyView, transitCommuneStates, type SkyView } from '../state/skyView';
import type { OdShown } from '../store/useOdStore';
import { offlineOdShown, type OdOfflineSource } from './odOffline';
import type { TourScript } from './types';
import { checkVariables, resolveNarration, type NarrationContext } from './variables';

export interface ResolvedStep {
  id: string;
  act: string;
  text: string;
  minDurationMs?: number;
  /** Durée de l'audio (ms), écrite par tools/tour-tts ; conservée si le texte n'a pas changé */
  durationMs?: number;
  /** Pôle suivi (étoile filante), vérifié dans poles.json */
  focusPole?: string;
}

export interface ResolvedTour {
  id: string;
  title: string;
  voice?: string;
  processing_version: string;
  /** Identité du jeu de données (meta.dataset_id) : stable pendant un calcul, contrôlée par le mode record */
  dataset_id?: string | null;
  generated_at: string;
  steps: ResolvedStep[];
}

export interface ResolveSources {
  dataset: Dataset;
  /** access/{insee}.json (null si absent) */
  access: (insee: string) => AccessFile | null;
  /** context/{insee}.json (null si absent) */
  context: (insee: string) => ContextFile | null;
  /** itineraries/{insee}.json (D-028, null si absent) ; facultatif : sans lui, les variables d'itinéraire sont nulles */
  itineraries?: (insee: string) => ItinerariesFile | null;
  /** bmo_metiers.json (D-035, étape « recrutement ») ; facultatif : sans lui, les variables `bmo.*` sont nulles */
  bmoMetiers?: BmoMetiersFile | null;
  /** bmo.json (D-035, fichier du panneau de preuve : chiffre de la famille de métiers) ; facultatif : sans lui, les variables `bmo.family*` sont nulles */
  bmo?: BmoFile | null;
  /** Postes salariés (INSEE) d'une commune (index de la table OD) ; sans lui, les totaux de postes sont nuls (point 4.1) */
  communeJobs?: ((insee: string) => number | null) | null;
  /**
   * Table commune x commune (D-019) du ciel par défaut : la MÊME base que le site affiche (compteur, astres allumés,
   * temps du pôle) pour les modes qu'elle sert (transports en commun, voiture). Sans elle, la résolution n'a que
   * `access/`, base que le site n'affiche plus pour ces modes : les chiffres de la visite seraient ceux d'un autre ciel.
   */
  od?: OdOfflineSource | null;
}

export interface ResolveResult {
  tour: ResolvedTour;
  missing: { step: string; variables: string[] }[];
}

/**
 * Bilan de l'or hors navigateur : même règle que SkyEngine.showGain (`goldDelta`, D-056) : pôles accessibles aller
 * ET retour avec le mode complémentaire et pas en TC seuls, même journée, même budget, part TC commune par commune nulle.
 * null pour le mode TC, sans données, ou sans table commune x commune (jamais l'or d'un autre calcul).
 */
function offlineGain(view: SkyView, file: AccessFile | null | undefined, od: OdOfflineSource | null | undefined): NarrationContext['gain'] {
  const sc = view.scenario;
  // Comme SkyCanvas : l'or n'est calculé que pour le vélo + TC (jamais pour la voiture ou un autre mode)
  if (sc.mode !== 'bike_transit' || view.neutral || !file) return null;
  const ref = computePoleStates(view.dataset.poles, file, 'transit', sc.day, sc.budget);
  const hasData = (st: readonly { status: string }[]) => st.some((x) => x.status !== 'unknown');
  if (!hasData(ref) || !hasData(view.states)) return null;
  const communeTransit = transitCommuneStates(view.dataset, sc, offlineOdShown(view.dataset, { ...sc, mode: 'transit' }, od ?? null));
  if (!communeTransit) return null;
  const d = goldDelta(view.dataset.poles, ref, view.states, communeTransit);
  return { shown: d.gained.length > 0, gained: d.gained, lost: d.lost };
}

/**
 * Même règle que le lecteur : origine de l'étape, sinon courante, sinon première commune du récit. Comme
 * `applyScenario` (source `tour`) : réglage de marche par défaut et journée-type, jamais d'horaire libre.
 */
function stepScenario(current: Scenario, state: Partial<Scenario>, dataset: Dataset): Scenario {
  const origin =
    state.origin ?? current.origin ?? dataset.meta.story_communes[0] ?? dataset.communes[0]?.insee ?? null;
  return sanitizeScenario(
    { ...current, halo: null, ...state, origin, walk: null, shift: null },
    dataset.meta,
    new Set(dataset.communes.map((c) => c.insee)),
    new Set(dataset.poles.map((p) => p.id)),
  );
}

/** Vue d'un ciel (A : commune du scénario, B : commune de comparaison), sur la table OD quand le site l'affiche. */
function viewOf(dataset: Dataset, scenario: Scenario, access: Record<string, AccessFile | null>, revealed: boolean, shown: OdShown | null, side: 'A' | 'B'): SkyView {
  const sc = side === 'B' ? { ...scenario, origin: scenario.compare } : scenario;
  return buildSkyView(dataset, sc, access, revealed, shown ? { shown, side } : null);
}

export function resolveTour(
  script: TourScript,
  src: ResolveSources,
  previousFile: ResolvedTour | null = null,
  now: Date = new Date(),
  /** Le MP3 de l'étape existe-t-il sous son nom actuel (`NN-id`) ? Faux : `durationMs` n'est pas conservé (le manifeste ne ment pas) */
  audioExists?: (index: number, stepId: string) => boolean,
): ResolveResult {
  const access: Record<string, AccessFile | null> = {};
  const loadAccess = (insee: string | null) => {
    if (insee && !(insee in access)) access[insee] = src.access(insee);
  };
  const itineraries: Record<string, ItinerariesFile | null> = {};
  const loadItineraries = (insee: string | null) => {
    if (insee && !(insee in itineraries)) itineraries[insee] = src.itineraries?.(insee) ?? null;
  };
  let scenario: Scenario = DEFAULT_SCENARIO;
  let revealed = true;
  // Table OD affichée au moment de l'étape précédente (pour les écarts) : celle que le site aurait posée alors
  let shown: OdShown | null = null;
  const steps: ResolvedStep[] = [];
  const missing: ResolveResult['missing'] = [];

  for (const step of script.steps) {
    const previous = scenario.origin || steps.length ? viewOf(src.dataset, scenario, access, revealed, shown, 'A') : null;
    scenario = stepScenario(scenario, step.state, src.dataset);
    revealed = step.reveal ?? true;
    loadAccess(scenario.origin);
    loadAccess(scenario.compare);
    loadItineraries(scenario.origin);
    shown = offlineOdShown(src.dataset, scenario, src.od ?? null);
    const view = viewOf(src.dataset, scenario, access, revealed, shown, 'A');
    const compare = scenario.compare ? viewOf(src.dataset, scenario, access, revealed, shown, 'B') : null;
    const context = scenario.origin ? src.context(scenario.origin) : null;
    const ctx: NarrationContext = {
      view,
      previous,
      compare,
      context,
      compareContext: scenario.compare ? src.context(scenario.compare) : null,
      access,
      itineraries,
      bmoMetiers: src.bmoMetiers ?? null,
      bmo: src.bmo ?? null,
      bmoMetier: script.bmoMetier ?? null,
      communeJobs: src.communeJobs ?? null,
      gain: offlineGain(view, scenario.origin ? access[scenario.origin] : null, src.od),
    };
    const r = resolveNarration(step.narration, ctx);
    const vars = [...r.missing, ...checkVariables(step.checks, ctx)];
    if (step.focusPole && !src.dataset.poles.some((p) => p.id === step.focusPole)) vars.push(`focusPole:${step.focusPole}`);
    if (vars.length) missing.push({ step: step.id, variables: vars });
    const old = previousFile?.steps.find((s) => s.id === step.id);
    steps.push({
      id: step.id,
      act: step.act,
      text: r.text,
      ...(step.minDurationMs != null ? { minDurationMs: step.minDurationMs } : {}),
      ...(step.focusPole ? { focusPole: step.focusPole } : {}),
      // l'audio n'est valable que pour le même texte, et seulement si son fichier existe sous le nom actuel de l'étape
      ...(old?.durationMs != null && old.text === r.text && (audioExists?.(steps.length, step.id) ?? true) ? { durationMs: old.durationMs } : {}),
    });
  }

  return {
    tour: {
      id: script.id,
      title: script.title,
      voice: script.voice,
      processing_version: src.dataset.meta.processing_version,
      dataset_id: (src.dataset.meta as { dataset_id?: string | null }).dataset_id ?? null,
      generated_at: now.toISOString(),
      steps,
    },
    missing,
  };
}
