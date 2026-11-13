/**
 * Store D-019 (table commune x commune, horaires libres), À CÔTÉ de useSkyStore.
 *
 * - Un index par dossier de réglage de marche (D-024 : `data/od_walk3000/`, `data/od_walk1000/`),
 *   chargé une fois et vérifié (format, réglage, pôles) ; un dépôt de fichiers d'origine par dossier
 *   (cache séparé, 16 fichiers).
 * - `shown` : la table OD du scénario AFFICHÉ, posée par `useSkyStore.applyScenario` en même temps
 *   que le scénario (null = ciel calculé sur `access/`, aux journées-types). `useOdResult()` en tire
 *   le résultat du ciel A : c'est ce que lit le panneau de preuve en mode OD.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { checkOdIndex, computeOd, odModeReady, type OdResult } from '../data/od/compute';
import { checkOdFolder, type OdFolder } from '../data/od/folders';
import { fetchOdIndex, OdRepository } from '../data/od/loader';
import { shiftBounds, type Shift, type ShiftBounds } from '../data/od/shift';
import type { SwodFile } from '../data/od/swod';
import type { OdIndex } from '../data/od/types';
import type { CarCongestionMeta, ModeId, Pole } from '../data/types';

export type OdFolderStatus = 'loading' | 'ready' | 'absent' | 'error';

export interface OdFolderEntry {
  status: OdFolderStatus;
  index: OdIndex | null;
  bounds: ShiftBounds | null;
  repo: OdRepository | null;
  error: string | null;
}

/** Pourquoi le ciel affiché n'est PAS calculé sur la table OD (null = il l'est). */
export type OdOffReason =
  /** Visite ou découverte en cours : leurs chiffres sont ceux d'access/, aux journées-types */
  | 'lock'
  /** Mode absent de la table ou incomplet (`odModeReady`) : vélo + TC, Vélib', modes pas encore exportés */
  | 'mode'
  /** Dossier du réglage de marche non publié */
  | 'folder_absent'
  /** Dossier publié mais illisible ou incohérent (erreur de publication) */
  | 'folder_error'
  /** Aucun réglage de marche publié dans meta.json : aucun dossier ne peut être choisi */
  | 'no_folder';

export interface OdShownSide {
  insee: string;
  status: 'ready' | 'not_computed' | 'error';
  file: SwodFile | null;
  error: string | null;
}

/** Table OD du scénario affiché. */
export interface OdShown {
  folder: string;
  index: OdIndex;
  bounds: ShiftBounds;
  /** Horaire effectif : horaire libre, ou celui de la journée-type */
  shift: Shift;
  budget: number;
  mode: ModeId;
  /** Ciel A (commune d'origine) */
  a: OdShownSide;
  /** Ciel B du diptyque (commune de comparaison), null hors diptyque */
  b: OdShownSide | null;
  /** Indices DiRIF (D-029) pour le mode `car_traffic` ; absent ou null : mode non servi */
  congestion?: CarCongestionMeta | null;
}

export interface OdState {
  folders: Record<string, OdFolderEntry>;
  shown: OdShown | null;
  /** Raison d'un ciel hors table OD (null quand `shown` est posé, ou avant tout scénario) */
  off: OdOffReason | null;
  /** Dossier du réglage courant (même hors table OD) : bornes du sélecteur, modes couverts */
  current: OdFolderEntry | null;
  /** Vélo + TC : table OD des TC de la même commune, référence de l'or (D-056) ; null sinon */
  transitRef: OdShown | null;
}

export interface OdLoadOptions {
  fetcher?: typeof fetch;
  /** Racine du site (BASE_URL de Vite par défaut) */
  root?: string;
}

let options: OdLoadOptions = {};
const pending = new Map<string, Promise<OdFolderEntry>>();

/** Réglage du chargement (tests : serveur simulé). */
export function configureOd(opts: OdLoadOptions): void {
  options = opts;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const rootUrl = () => options.root ?? import.meta.env.BASE_URL;

export const useOdStore = create<OdState>()(() => ({ folders: {}, shown: null, off: null, current: null, transitRef: null }));

/**
 * Index du dossier (une fois par dossier ; un échec n'est pas gardé, la demande suivante réessaie).
 * Vérifie le format SWOD v1, le réglage de marche du dossier et la cohérence avec poles.json.
 */
export function loadOdFolder(folder: OdFolder, poles: readonly Pick<Pole, 'id' | 'jobs'>[]): Promise<OdFolderEntry> {
  const known = useOdStore.getState().folders[folder.path];
  if (known && known.status !== 'loading' && known.status !== 'error') return Promise.resolve(known);
  const running = pending.get(folder.path);
  if (running) return running;
  const base = `${rootUrl()}${folder.path}`;
  const put = (entry: OdFolderEntry) => {
    useOdStore.setState((s) => ({ folders: { ...s.folders, [folder.path]: entry } }));
    return entry;
  };
  put({ status: 'loading', index: null, bounds: null, repo: null, error: null });
  const job = (async () => {
    try {
      const index = await fetchOdIndex(options.fetcher, base);
      if (!index) return put({ status: 'absent', index: null, bounds: null, repo: null, error: null });
      const problems = [...checkOdFolder(index, folder), ...checkOdIndex(index, poles)];
      const bounds = shiftBounds(index);
      if (!bounds) problems.push(`${folder.path}index.json : aucun horaire de poste calculable`);
      if (problems.length) {
        console.error('Table OD (D-019) écartée :', problems);
        return put({ status: 'error', index: null, bounds: null, repo: null, error: problems.join(' ; ') });
      }
      const repo = new OdRepository(index, { base: folder.binPath ? `${rootUrl()}${folder.binPath}` : base, ...(options.fetcher ? { fetcher: options.fetcher } : {}) });
      return put({ status: 'ready', index, bounds, repo, error: null });
    } catch (e) {
      console.error('Table OD (D-019) illisible :', e);
      return put({ status: 'error', index: null, bounds: null, repo: null, error: message(e) });
    } finally {
      pending.delete(folder.path);
    }
  })();
  pending.set(folder.path, job);
  return job;
}

/** Fichier d'une origine dans le dépôt du dossier (cache). Ne lève pas : l'erreur est dans le résultat. */
export async function loadOdSide(repo: OdRepository, insee: string, signal?: AbortSignal): Promise<OdShownSide> {
  try {
    const r = await repo.load(insee, signal);
    return r.status === 'ready' ? { insee, status: 'ready', file: r.file, error: null } : { insee, status: 'not_computed', file: null, error: null };
  } catch (e) {
    if (signal?.aborted) throw e;
    console.error('Fichier OD illisible :', e);
    return { insee, status: 'error', file: null, error: message(e) };
  }
}

/** Modes que ce dossier sert en horaires libres (ordre de l'index). */
export function odReadyModes(index: OdIndex | null | undefined): ModeId[] {
  if (!index) return [];
  return index.modes.filter((m) => odModeReady(index, m.id)).map((m) => m.id);
}

/**
 * Résultat OD d'un ciel (A : origine, B : comparaison) pour le scénario affiché. Fichier en erreur :
 * null (le ciel reste neutre, l'erreur est journalisée) ; origine sans fichier : `origin_not_computed`.
 */
export function odResultOf(shown: OdShown | null, side: 'A' | 'B' = 'A'): OdResult | null {
  const s = side === 'A' ? shown?.a : shown?.b;
  if (!shown || !s || s.status === 'error') return null;
  return computeOd(shown.index, s.status === 'ready' ? s.file : null, {
    origin: s.insee,
    start: shown.shift.start,
    end: shown.shift.end,
    budget: shown.budget,
    mode: shown.mode,
    congestion: shown.congestion ?? null,
  });
}

/** Remise à zéro (tests). */
export function resetOdStore(): void {
  pending.clear();
  options = {};
  useOdStore.setState({ folders: {}, shown: null, off: null, current: null, transitRef: null });
}

/**
 * Hook React : résultat OD du ciel A (recalculé seulement quand la table affichée change), ou null
 * si le ciel affiché n'est pas calculé sur la table OD (visite, découverte, vélo + TC, Vélib'...).
 */
export function useOdResult(side: 'A' | 'B' = 'A'): OdResult | null {
  const shown = useOdStore((s) => s.shown);
  return useMemo(() => odResultOf(shown, side), [shown, side]);
}
