import { describe, expect, it } from 'vitest';
import { hasAccessFile, loadAccess, loadItineraries } from './loaders';
import { demoDataset } from './demo/generateDemo';
import { openingScenario } from '../state/scenario';
import type { Dataset } from './types';

const real = (): Dataset => {
  const d = demoDataset('query');
  return { ...d, origin: 'real', demoReason: undefined, meta: { ...d.meta, story_communes: [], access_communes: ['93048', '77284'] } };
};

describe('access_communes', () => {
  it('ne propose l’accessibilité réelle que pour les communes calculées', () => {
    const d = real();
    expect(hasAccessFile(d, '93048')).toBe(true);
    expect(hasAccessFile(d, '93066')).toBe(false);
  });
  it('commune non calculée : null, jamais de chiffres fictifs, aucun fetch', async () => {
    let fetched = 0;
    const fetcher = (async () => {
      fetched++;
      return new Response('{}');
    }) as typeof fetch;
    const res = await loadAccess(real(), '93066', fetcher);
    expect(res).toEqual({ file: null, demo: false });
    expect(fetched).toBe(0);
  });
  it('jeu démo : temps fictifs signalés', async () => {
    const res = await loadAccess(demoDataset('query'), '93066');
    expect(res.demo).toBe(true);
    expect(res.file?.modes.transit?.d09?.out.length).toBe(15);
  });
  it('ouverture : Montreuil, 9h-17h, 60 min, TC', () => {
    expect(openingScenario(real().meta)).toEqual({ origin: '93048', day: 'd09', budget: 60, mode: 'transit' });
  });
});

describe('aucune commune exportée (access_communes vide)', () => {
  it('pas de fetch, message « en cours de calcul »', async () => {
    const d = real();
    d.meta.access_communes = [];
    let fetched = 0;
    const fetcher = (async () => {
      fetched++;
      return new Response('{}');
    }) as typeof fetch;
    expect(await loadAccess(d, '93049', fetcher)).toEqual({ file: null, demo: false });
    expect(fetched).toBe(0);
    const { missingAccessMessage } = await import('./summary');
    expect(missingAccessMessage([])).toBe('Accessibilité en cours de calcul.');
    expect(openingScenario(d.meta).origin).toBeNull();
  });
});

describe('insights.json', () => {
  it('demandé seulement si meta.insights.written vaut true', async () => {
    const urls: string[] = [];
    const mk = (written: boolean) =>
      (async (u: string | URL | Request) => {
        const url = String(u);
        urls.push(url);
        const body = url.endsWith('meta.json')
          ? { ...demoDataset('query').meta, insights: { written, kinds: {} } }
          : url.endsWith('insights.json')
            ? []
            : url.endsWith('poles.json') || url.endsWith('communes.json')
              ? []
              : [];
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
    const { loadDataset } = await import('./loaders');
    await loadDataset({ demo: false, fetcher: mk(false) });
    expect(urls.some((u) => u.endsWith('insights.json'))).toBe(false);
    urls.length = 0;
    // Découvertes publiées pour les 44 astres (08e, meta.insights.written) : lues sur le ciel unique
    await loadDataset({ demo: false, fetcher: mk(true) });
    expect(urls.some((u) => u.endsWith('insights.json'))).toBe(true);
  });
});


describe('itinéraires (D-028, proposés)', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  it('non annoncés par meta.itineraries_communes : aucun fetch, bloc masqué', async () => {
    let fetched = 0;
    const fetcher = (async () => {
      fetched++;
      return json({});
    }) as typeof fetch;
    expect(await loadItineraries(real(), '93048', fetcher)).toBeNull();
    expect(fetched).toBe(0);
  });
  it('annoncés : lus seulement s’ils suivent le contrat', async () => {
    const d = real();
    d.meta = { ...d.meta, itineraries_communes: ['93048', '77284'] };
    const ok = { insee: '93048', contract: 'itineraries-proposed-1', poles: [], days: {} };
    expect(await loadItineraries(d, '93048', (async () => json(ok)) as typeof fetch)).toEqual(ok);
    expect(await loadItineraries(d, '77284', (async () => json({ insee: '77284' })) as typeof fetch)).toBeNull();
  });
});
