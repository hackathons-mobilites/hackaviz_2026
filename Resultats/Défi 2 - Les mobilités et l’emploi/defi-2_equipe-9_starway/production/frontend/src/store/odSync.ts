/**
 * Branchement D-019 du scénario : choisit la base de calcul du ciel affiché (table OD ou `access/`),
 * charge l'index du dossier du réglage de marche et les fichiers des origines, et ajuste le scénario
 * (horaire libre gardé seulement s'il est calculable). Appelé par `useSkyStore.applyScenario`.
 */
import { odFolderFor, type OdFolder } from '../data/od/folders';
import { isValidShift, shiftFromDayType, type Shift, type ShiftBounds } from '../data/od/shift';
import type { Dataset, ModeId } from '../data/types';
import { odModeReady } from '../data/od/compute';
import type { Scenario } from '../state/scenario';
import { loadOdFolder, loadOdSide, type OdFolderEntry, type OdOffReason, type OdShown } from './useOdStore';

/**
 * Base de calcul (fonction PURE). Ordre : dossier lisible, mode servi (`odModeReady` : section dans
 * les fichiers ET `coverage[mode].complete`), puis verrou de la visite / des découvertes.
 */
export function odBasis(entry: Pick<OdFolderEntry, 'status' | 'index'> | null, mode: ModeId, lock: boolean): OdOffReason | null {
  if (!entry) return 'no_folder';
  if (entry.status === 'absent') return 'folder_absent';
  if (entry.status !== 'ready' || !entry.index) return 'folder_error';
  if (!odModeReady(entry.index, mode)) return 'mode';
  if (lock) return 'lock';
  return null;
}

/** Horaire effectif du ciel OD : l'horaire libre s'il est calculable, sinon celui de la journée-type. */
export function effectiveShift(bounds: ShiftBounds, scenario: Pick<Scenario, 'shift' | 'day'>, dataset: Pick<Dataset, 'meta'>): Shift | null {
  if (scenario.shift && isValidShift(bounds, scenario.shift)) return scenario.shift;
  const day = dataset.meta.day_types.find((d) => d.id === scenario.day);
  return day ? shiftFromDayType(bounds, day) : null;
}

export interface OdPrepared {
  scenario: Scenario;
  shown: OdShown | null;
  off: OdOffReason | null;
  current: OdFolderEntry | null;
  /** Ciel TC commune par commune, référence de l'or (D-056) ; vélo + TC seulement, null sinon */
  transitRef: OdShown | null;
}

/**
 * Table OD des TC pour le scénario `next` en vélo + TC, sous le même réglage de marche et à la journée-type : référence
 * de l'or (D-056), indépendante du verrou de la visite et des découvertes (le vélo + TC n'a pas d'horaire libre).
 */
async function transitReference(dataset: Dataset, next: Scenario, folder: OdFolder | null, entry: OdFolderEntry | null, signal?: AbortSignal): Promise<OdShown | null> {
  if (next.mode !== 'bike_transit' || !next.origin || !folder || !entry || odBasis(entry, 'transit', false)) return null;
  const { bounds, repo, index } = entry;
  const shift = bounds ? effectiveShift(bounds, { shift: null, day: next.day }, dataset) : null;
  if (!bounds || !repo || !index || !shift) return null;
  const a = await loadOdSide(repo, next.origin, signal);
  return { folder: folder.path, index, bounds, shift, budget: next.budget, mode: 'transit', a, b: null, congestion: dataset.meta.car_congestion ?? null };
}

/**
 * Prépare la table OD du scénario `next`. Hors table OD, un horaire libre est retiré (le ciel est
 * alors celui de la journée-type, et c'est elle que montre la barre) : jamais un horaire affiché qui
 * ne serait pas celui du calcul. Rejette avec une AbortError si `signal` est annulé.
 */
export async function prepareOd(dataset: Dataset, next: Scenario, lock: boolean, signal?: AbortSignal): Promise<OdPrepared> {
  const folder = odFolderFor(dataset.meta, next.walk);
  const entry = folder ? await loadOdFolder(folder, dataset.poles) : null;
  signal?.throwIfAborted();
  const off = odBasis(entry, next.mode, lock);
  const transitRef = await transitReference(dataset, next, folder, entry, signal);
  signal?.throwIfAborted();
  const bounds = entry?.bounds ?? null;
  const shift = !off && bounds ? effectiveShift(bounds, next, dataset) : null;
  if (off || !entry?.repo || !entry.index || !bounds || !shift || !next.origin) {
    const keepShift = !off && !!next.shift && !!bounds && isValidShift(bounds, next.shift);
    return { scenario: { ...next, shift: keepShift ? next.shift : null }, shown: null, off: off ?? null, current: entry, transitRef };
  }
  const repo = entry.repo;
  const [a, b] = await Promise.all([loadOdSide(repo, next.origin, signal), next.compare ? loadOdSide(repo, next.compare, signal) : Promise.resolve(null)]);
  signal?.throwIfAborted();
  const keep = !!next.shift && isValidShift(bounds, next.shift);
  return {
    scenario: { ...next, shift: keep ? next.shift : null },
    shown: { folder: folder!.path, index: entry.index, bounds, shift, budget: next.budget, mode: next.mode, a, b, congestion: dataset.meta.car_congestion ?? null },
    off: null,
    current: entry,
    transitRef,
  };
}
