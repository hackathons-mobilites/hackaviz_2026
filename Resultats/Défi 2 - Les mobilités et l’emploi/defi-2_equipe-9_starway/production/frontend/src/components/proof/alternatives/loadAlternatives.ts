import { fetchGzJson } from '../../../data/loaders';
import type { Dataset } from '../../../data/types';
import { alternativesDir, isAlternativesFile, isCoverageFile, matchesWalkSetting, type AlternativesCoverage, type AlternativesFile } from './alternatives';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

/** Ce que le chargeur lit du jeu de données : mêmes champs que `loadItineraries`. */
type AltDataset = Pick<Dataset, 'origin' | 'base'>;

/** Caches séparés par dossier (un réglage de marche par dossier) : la clé est l'URL. */
const coverageCache = new Map<string, Promise<AlternativesCoverage | null>>();
const fileCache = new Map<string, Promise<AlternativesFile | null>>();

/**
 * `{dossier}/coverage.json` du réglage de marche `walkSetting` (null = défaut, `alternatives/` ; « comfort » : `alternatives_comfort/`,
 * phase G) : demandé une seule fois par session et par dossier, au premier pli ouvert. Absent (404, cas d'avant la publication),
 * illisible, d'un autre contrat ou, hors défaut, d'un autre réglage (`walk_setting`) : null, et le panneau garde son comportement
 * d'avant. Rien en mode démo.
 */
export function loadCoverage(dataset: AltDataset, fetcher: typeof fetch = fetch, walkSetting: string | null = null): Promise<AlternativesCoverage | null> {
  const dir = alternativesDir(walkSetting);
  if (dataset.origin === 'demo' || !dir) return Promise.resolve(null);
  const url = `${dataset.base ?? DATA_BASE}${dir}/coverage.json`;
  let p = coverageCache.get(url);
  if (!p) {
    p = fetchGzJson<unknown>(url, fetcher).then((v) => (isCoverageFile(v) && matchesWalkSetting(v, walkSetting) ? v : null));
    coverageCache.set(url, p);
  }
  return p;
}

/**
 * `{dossier}/{insee}.json.gz`, seulement pour une commune dont la couverture du même réglage annonce une case calculée. null si
 * absent, ou, hors défaut, si le fichier dit un autre réglage de marche.
 */
export function loadCommuneAlternatives(dataset: AltDataset, insee: string, fetcher: typeof fetch = fetch, walkSetting: string | null = null): Promise<AlternativesFile | null> {
  const dir = alternativesDir(walkSetting);
  if (dataset.origin === 'demo' || !dir) return Promise.resolve(null);
  const url = `${dataset.base ?? DATA_BASE}${dir}/${insee}.json.gz`;
  let p = fileCache.get(url);
  if (!p) {
    p = fetchGzJson<unknown>(url, fetcher).then((v) => (isAlternativesFile(v) && matchesWalkSetting(v, walkSetting) ? v : null));
    fileCache.set(url, p);
  }
  return p;
}

/** Pour les tests : oublie les fichiers déjà demandés. */
export function resetAlternativesCache(): void {
  coverageCache.clear();
  fileCache.clear();
}
