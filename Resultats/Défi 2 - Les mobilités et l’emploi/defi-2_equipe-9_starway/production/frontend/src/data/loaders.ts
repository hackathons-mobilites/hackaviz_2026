/**
 * Chargement des JSON produits par le pipeline (frontend/public/data/).
 * - meta.json absent → jeu démo (bandeau rouge obligatoire).
 * - access/{insee}.json chargé à la demande, mis en cache en mémoire.
 */
import { demoAccess, demoDataset } from './demo/generateDemo';
import { isBmoFile, type BmoFile } from './bmo';
import { isBmoMetiersFile, type BmoMetiersFile } from './bmoMetiers';
import { isItinerariesFile, itinerariesSource, type ItinerariesFile } from './itineraries';
import { isGzip } from './od/swod';
import { isTollsFile } from './tolls';
import { isTerritoireFile, type TerritoireFile } from './territoire';
import type { AccessFile, Commune, ContextFile, Dataset, Insight, Meta, Pole, SourceEntry, TollsFile } from './types';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

/**
 * Renvoie null si le fichier est absent. En dev, Vite répond index.html (200) pour un
 * fichier inexistant : on contrôle donc le content-type et le parse.
 */
export async function fetchJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<T | null> {
  let res: Response;
  try {
    // Pas d'en-tête personnalisé : la requête doit correspondre aux <link rel="preload"> d'index.html
    res = await fetcher(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export class DataError extends Error {}

function assertArray(value: unknown, file: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new DataError(`${file} : tableau attendu`);
}

export interface LoadOptions {
  demo: boolean;
  fetcher?: typeof fetch;
}

/**
 * Démo (dev) sur le VRAI ciel : vrais pôles (positions, postes EMP01) et vraies communes si
 * public/data/ les contient ; seules les durées sont tirées au hasard (bandeau rouge).
 * Sans données réelles : jeu démo généré.
 */
async function demoOnRealSky(fetcher: typeof fetch): Promise<Dataset> {
  const [meta, poles, communes] = await Promise.all([
    fetchJson<Meta>(`${DATA_BASE}meta.json`, fetcher),
    fetchJson<Pole[]>(`${DATA_BASE}poles.json`, fetcher),
    fetchJson<Commune[]>(`${DATA_BASE}communes.json`, fetcher),
  ]);
  const base = demoDataset('query');
  if (!meta || !Array.isArray(poles) || !Array.isArray(communes)) return base;
  // access_communes est ignoré : en démo, toutes les communes ont des durées FICTIVES.
  return { ...base, meta: { ...meta, access_communes: undefined, story_communes: base.meta.story_communes }, poles, communes };
}

export async function loadDataset({ demo, fetcher = fetch }: LoadOptions): Promise<Dataset> {
  // Données fictives : en développement uniquement (jamais dans un build de production).
  if (demo && import.meta.env.DEV) return demoOnRealSky(fetcher);

  const base = DATA_BASE;
  const meta = await fetchJson<Meta>(`${base}meta.json`, fetcher);
  if (!meta) {
    if (import.meta.env.DEV) return demoDataset('missing_meta');
    throw new DataError('Données indisponibles : meta.json est introuvable sur le serveur.');
  }

  const [poles, communes, insights, sources] = await Promise.all([
    fetchJson<Pole[]>(`${base}poles.json`, fetcher),
    fetchJson<Commune[]>(`${DATA_BASE}communes.json`, fetcher),
    // insights.json n'existe que si le pipeline l'a écrit (meta.insights.written) : pas de 404 inutile
    meta.insights?.written === true ? fetchJson<Insight[]>(`${base}insights.json`, fetcher) : Promise.resolve(null),
    fetchJson<SourceEntry[]>(`${DATA_BASE}${meta.sources || 'sources.json'}`, fetcher),
  ]);
  if (!poles) throw new DataError('poles.json est absent alors que meta.json existe.');
  if (!communes) throw new DataError('communes.json est absent alors que meta.json existe.');
  assertArray(poles, 'poles.json');
  assertArray(communes, 'communes.json');

  return {
    origin: 'real',
    base,
    meta,
    poles,
    communes,
    insights: Array.isArray(insights) ? insights : [],
    sources: Array.isArray(sources) ? sources : [],
  };
}

export interface LoadedAccess {
  file: AccessFile | null;
  /** true = temps de trajet FICTIFS (jeu démo ou repli si access/{insee}.json manque) → bandeau rouge */
  demo: boolean;
}

const accessCache = new Map<string, Promise<LoadedAccess>>();

/** true si access/{insee}.json est annoncé par meta.access_communes (absent = on tente le fichier). */
export function hasAccessFile(dataset: Dataset, insee: string): boolean {
  const list = dataset.meta.access_communes;
  return !Array.isArray(list) || list.includes(insee);
}

/**
 * access/{insee}.json. Données réelles : jamais de repli fictif (null = « pas encore calculé »).
 * Jeu démo (?demo=1 ou meta.json absent) : temps FICTIFS, `demo: true` (bandeau rouge).
 */
export function loadAccess(dataset: Dataset, insee: string, fetcher: typeof fetch = fetch): Promise<LoadedAccess> {
  const key = `${dataset.origin}:${insee}`;
  let p = accessCache.get(key);
  if (!p) {
    if (dataset.origin === 'demo') {
      p = Promise.resolve({ file: demoAccess(insee, dataset.poles, dataset.communes), demo: true });
    } else if (!hasAccessFile(dataset, insee)) {
      p = Promise.resolve({ file: null, demo: false });
    } else {
      p = fetchJson<AccessFile>(`${dataset.base ?? DATA_BASE}access/${insee}.json`, fetcher).then((file) => ({ file, demo: false }));
    }
    accessCache.set(key, p);
  }
  return p;
}

const contextCache = new Map<string, Promise<ContextFile | null>>();

/** context/{insee}.json (halo et volet « Derrière le ciel »). Rien en mode démo. */
export function loadContext(dataset: Dataset, insee: string, fetcher: typeof fetch = fetch): Promise<ContextFile | null> {
  if (dataset.origin === 'demo') return Promise.resolve(null);
  let p = contextCache.get(insee);
  if (!p) {
    p = fetchJson<ContextFile>(`${DATA_BASE}context/${insee}.json`, fetcher);
    contextCache.set(insee, p);
  }
  return p;
}

const itinCache = new Map<string, Promise<ItinerariesFile | null>>();

/**
 * JSON compressé en gzip (fichiers `.json.gz` des itinéraires, 04/11) : décompression native si les
 * premiers octets sont ceux du gzip, sinon lecture directe (serveur qui a déjà décodé). null si absent.
 */
export async function fetchGzJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<T | null> {
  let res: Response;
  try {
    res = await fetcher(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return null;
  try {
    let buf = await res.arrayBuffer();
    if (isGzip(buf)) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return JSON.parse(new TextDecoder('utf-8').decode(buf)) as T;
  } catch {
    return null;
  }
}

/**
 * {dossier}/{insee}.json.gz (D-028) : détail des trajets TC du panneau de preuve, pour le réglage de
 * marche `walkKey` (null = réglage par défaut, `itineraries/` ; sinon `meta.itineraries_variants`).
 * Tant que le pipeline ne l'annonce pas pour la commune, rien n'est demandé (null) et les blocs qui en
 * dépendent restent masqués. Un fichier d'un autre contrat est ignoré (null). Rien en mode démo.
 */
export function loadItineraries(dataset: Dataset, insee: string, fetcher: typeof fetch = fetch, walkKey: string | null = null): Promise<ItinerariesFile | null> {
  // Fichier demandé seulement s'il est annoncé : aucun 404 inutile
  const src = itinerariesSource(dataset.meta, walkKey);
  if (dataset.origin === 'demo' || !src || !src.communes.includes(insee)) return Promise.resolve(null);
  const url = `${dataset.base ?? DATA_BASE}${src.dir}/${insee}${src.suffix}`;
  let p = itinCache.get(url);
  if (!p) {
    const load = src.suffix.endsWith('.gz') ? fetchGzJson<unknown>(url, fetcher) : fetchJson<unknown>(url, fetcher);
    p = load.then((f) => (isItinerariesFile(f) ? f : null));
    itinCache.set(url, p);
  }
  return p;
}

let tollsPromise: Promise<TollsFile | null> | null = null;

/**
 * tolls.json (D-029, contrat tolls-1) : registre et grilles des péages, chargé une fois, à la demande du
 * panneau de preuve en voiture. Demandé seulement si meta.car_costs.tolls annonce le fichier (aucun 404).
 */
export function loadTolls(dataset: Dataset, fetcher: typeof fetch = fetch): Promise<TollsFile | null> {
  const t = dataset.meta.car_costs?.tolls;
  if (dataset.origin === 'demo' || t?.status !== 'ok' || !t.file) return Promise.resolve(null);
  if (!tollsPromise) tollsPromise = fetchJson<unknown>(`${dataset.base ?? DATA_BASE}${t.file}`, fetcher).then((f) => (isTollsFile(f) ? f : null));
  return tollsPromise;
}

/** bmo.json (D-035, projets de recrutement BMO par bassin d'emploi), chargé une fois à l'ouverture du bloc ; null sans fichier valide. */
let bmoPromise: Promise<BmoFile | null> | null = null;
export function loadBmo(dataset: Pick<Dataset, 'origin'>, fetcher: typeof fetch = fetch): Promise<BmoFile | null> {
  if (dataset.origin === 'demo') return Promise.resolve(null);
  if (!bmoPromise) bmoPromise = fetchJson<unknown>(`${DATA_BASE}bmo.json`, fetcher).then((f) => (isBmoFile(f) ? f : null));
  return bmoPromise;
}

/** territoire.json (D-048, repères de territoire : chômage, temps de travail, polarités), chargé une fois à la première ouverture d'un repère ; null sans fichier valide. */
let territoirePromise: Promise<TerritoireFile | null> | null = null;
export function loadTerritoire(dataset: Pick<Dataset, 'origin'>, fetcher: typeof fetch = fetch): Promise<TerritoireFile | null> {
  if (dataset.origin === 'demo') return Promise.resolve(null);
  if (!territoirePromise) territoirePromise = fetchJson<unknown>(`${DATA_BASE}territoire.json`, fetcher).then((f) => (isTerritoireFile(f) ? f : null));
  return territoirePromise;
}

/**
 * bmo_metiers.json (D-035, contrat bmo-metiers-1) : projets de recrutement par bassin ET par métier, chargé une fois,
 * POUR LA VISITE (étape « recrutement ») ; jamais par le panneau de preuve. null sans fichier valide.
 */
let bmoMetiersPromise: Promise<BmoMetiersFile | null> | null = null;
export function loadBmoMetiers(dataset: Pick<Dataset, 'origin'>, fetcher: typeof fetch = fetch): Promise<BmoMetiersFile | null> {
  if (dataset.origin === 'demo') return Promise.resolve(null);
  if (!bmoMetiersPromise) bmoMetiersPromise = fetchJson<unknown>(`${DATA_BASE}bmo_metiers.json`, fetcher).then((f) => (isBmoMetiersFile(f) ? f : null));
  return bmoMetiersPromise;
}

/** Le mode démo est demandé explicitement par ?demo=1 (pris en compte en développement seulement). */
export function demoRequested(search: string): boolean {
  return import.meta.env.DEV && new URLSearchParams(search).get('demo') === '1';
}
