import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { fetchOdIndex, OdDataError, OdRepository, originFileUrl } from './loader';
import { buildSwod, fixtureIndex } from './testkit';

const N = 229;
const index = fixtureIndex({
  communes: ['A', 'B', 'C'],
  jobs: [1, 2, 3],
  pole_of: [0, 0, null],
  poles: [{ id: 'P0', jobs: 3 }],
  files: ['A', 'B'],
});
const fileFor = (origin: number) =>
  Buffer.from(
    gzipSync(
      Buffer.from(
        buildSwod({ origin, step: 5, first: 180, nSlots: N, maxTrip: 120, sections: [{ mode: 3, kind: 'scalar', records: [{ dest: 2, out: 10, ret: 11 }] }] }),
      ),
    ),
  );

const bin = (b: Buffer, status = 200) => new Response(new Uint8Array(b), { status, headers: { 'content-type': 'application/octet-stream' } });
const html = () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });

describe('fetchOdIndex', () => {
  it('absent (404 ou index.html du serveur de dev) : null, jamais de repli fictif', async () => {
    expect(await fetchOdIndex(async () => new Response('', { status: 404 }), '/x/')).toBeNull();
    expect(await fetchOdIndex(async () => html(), '/x/')).toBeNull();
    expect(await fetchOdIndex(async () => Promise.reject(new TypeError('réseau')), '/x/')).toBeNull();
  });

  it('format inconnu : erreur explicite (les versions 1 et 2 sont lues)', async () => {
    const bad = { ...index, format: { ...index.format, version: 3 } };
    await expect(fetchOdIndex(async () => Response.json(bad), '/x/')).rejects.toThrow(OdDataError);
    for (const version of [1, 2]) {
      const ok = { ...index, format: { ...index.format, version } };
      expect(await fetchOdIndex(async () => Response.json(ok), '/x/')).toEqual(ok);
    }
  });

  it('lit l’index publié', async () => {
    const fetcher = vi.fn(async () => Response.json(index));
    expect(await fetchOdIndex(fetcher, '/data/od/')).toEqual(index);
    expect(fetcher).toHaveBeenCalledWith('/data/od/index.json', undefined);
  });
});

describe('OdRepository', () => {
  it('chemin du fichier tiré de format.path', () => {
    expect(originFileUrl(index, 'A', '/data/od/')).toBe('/data/od/o/A.bin');
  });

  it('origine absente de files : non calculé, sans requête', async () => {
    const fetcher = vi.fn();
    const repo = new OdRepository(index, { fetcher, base: '/' });
    expect(await repo.load('C')).toEqual({ status: 'not_computed' });
    expect(await repo.load('Z')).toEqual({ status: 'not_computed' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('décode (gzip), contrôle l’en-tête et garde en cache', async () => {
    const fetcher = vi.fn(async () => bin(fileFor(0)));
    const repo = new OdRepository(index, { fetcher, base: '/' });
    const r = await repo.load('A');
    expect(r.status).toBe('ready');
    if (r.status === 'ready') expect([...r.file.sections.get(3)!.out!]).toEqual([10]);
    await repo.load('A');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('en-tête qui ne correspond pas à l’origine demandée : erreur, pas de cache', async () => {
    const fetcher = vi.fn(async () => bin(fileFor(0)));
    const repo = new OdRepository(index, { fetcher, base: '/' });
    await expect(repo.load('B')).rejects.toThrow(/origine A au lieu de B/);
    expect(repo.has('B')).toBe(false);
  });

  it('fichier annoncé mais absent : erreur de publication (pas « non calculé »)', async () => {
    const repo = new OdRepository(index, { fetcher: async () => html(), base: '/' });
    await expect(repo.load('A')).rejects.toThrow(/annoncé/);
  });

  it('annulation : rejet AbortError, rien en cache', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return bin(fileFor(0));
    });
    const repo = new OdRepository(index, { fetcher, base: '/' });
    await expect(repo.load('A', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(repo.has('A')).toBe(false);
  });

  it('cache borné : le moins récemment utilisé sort', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => bin(fileFor(String(url).includes('/A.') ? 0 : 1)));
    const repo = new OdRepository(index, { fetcher, base: '/', cacheSize: 1 });
    await repo.load('A');
    await repo.load('B');
    expect(repo.has('A')).toBe(false);
    expect(repo.has('B')).toBe(true);
  });
});
