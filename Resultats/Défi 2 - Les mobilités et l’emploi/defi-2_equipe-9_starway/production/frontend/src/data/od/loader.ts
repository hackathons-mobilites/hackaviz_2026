/**
 * Chargement D-019 : `od/index.json` une fois, `od/o/{insee}.bin` à chaque origine (cache en mémoire,
 * annulation par AbortSignal si l'origine change). Données réelles seulement : aucun repli fictif.
 */
import { checkSwodHeader, originHasFile } from './compute';
import { decodeSwodBytes, SWOD_VERSIONS, type SwodFile } from './swod';
import type { OdIndex } from './types';

export const OD_BASE = `${import.meta.env.BASE_URL}data/od/`;

export class OdDataError extends Error {}

/** Un fichier absent : 404, ou index.html renvoyé par le serveur de dev Vite (200 en text/html). */
function looksMissing(res: Response): boolean {
  return !res.ok || (res.headers.get('content-type') ?? '').includes('text/html');
}

/** od/index.json, ou null s'il n'est pas publié (le jeu D-019 est optionnel tant que la décision n'est pas adoptée). */
export async function fetchOdIndex(fetcher: typeof fetch = fetch, base = OD_BASE, signal?: AbortSignal): Promise<OdIndex | null> {
  let res: Response;
  try {
    res = await fetcher(`${base}index.json`, signal ? { signal } : undefined);
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
  if (looksMissing(res)) return null;
  const json = (await res.json()) as OdIndex;
  if (json?.format?.name !== 'SWOD' || !SWOD_VERSIONS.includes(json.format.version)) {
    throw new OdDataError(`od/index.json : format ${json?.format?.name} v${json?.format?.version} non lu (SWOD v1 ou v2 attendu)`);
  }
  return json;
}

export function originFileUrl(index: Pick<OdIndex, 'format'>, insee: string, base = OD_BASE): string {
  return `${base}${index.format.path.replace('{insee}', insee)}`;
}

export type OdOriginLoad =
  | { status: 'ready'; file: SwodFile }
  /** Origine absente de index.files : « non calculé pour cette commune », ciel neutre */
  | { status: 'not_computed' };

export interface OdRepositoryOptions {
  fetcher?: typeof fetch;
  base?: string;
  /** Nombre de fichiers décodés gardés en mémoire (moins récemment utilisés retirés d'abord) */
  cacheSize?: number;
}

/**
 * Dépôt des fichiers d'une origine pour UN index. Un fichier réussi est gardé en cache ; un échec ou
 * une annulation ne l'est pas (la prochaine demande refait la requête).
 */
export class OdRepository {
  readonly index: OdIndex;
  private readonly fetcher: typeof fetch;
  private readonly base: string;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, SwodFile>();

  // défaut enveloppé : `fetch` appelé comme méthode du dépôt lèverait « Illegal invocation »
  constructor(index: OdIndex, { fetcher = (input, init) => globalThis.fetch(input, init), base = OD_BASE, cacheSize = 16 }: OdRepositoryOptions = {}) {
    this.index = index;
    this.fetcher = fetcher;
    this.base = base;
    this.cacheSize = Math.max(1, cacheSize);
  }

  has(insee: string): boolean {
    return this.cache.has(insee);
  }

  /** Fichier décodé de l'origine. Rejette avec une AbortError si `signal` est annulé. */
  async load(insee: string, signal?: AbortSignal): Promise<OdOriginLoad> {
    if (!this.index.communes.includes(insee) || !originHasFile(this.index, insee)) return { status: 'not_computed' };
    const hit = this.cache.get(insee);
    if (hit) {
      // plus récemment utilisé : en fin de Map
      this.cache.delete(insee);
      this.cache.set(insee, hit);
      return { status: 'ready', file: hit };
    }
    const url = originFileUrl(this.index, insee, this.base);
    // appel détaché : `fetch` lèverait « Illegal invocation » appelé comme méthode du dépôt
    const fetcher = this.fetcher;
    const res = await fetcher(url, signal ? { signal } : undefined);
    if (looksMissing(res)) {
      // annoncé par index.files mais introuvable : erreur de publication, pas « non calculé »
      throw new OdDataError(`${url} : fichier annoncé par od/index.json mais absent (HTTP ${res.status})`);
    }
    const file = await decodeSwodBytes(await res.arrayBuffer());
    signal?.throwIfAborted();
    const problems = checkSwodHeader(this.index, file, insee);
    if (problems.length) throw new OdDataError(`${url} : ${problems.join(' ; ')}`);
    this.cache.set(insee, file);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return { status: 'ready', file };
  }
}
