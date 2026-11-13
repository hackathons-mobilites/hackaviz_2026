import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSwod, fixtureIndex } from '../data/od/testkit';
import type { OdIndex } from '../data/od/types';
import type { Dataset, Meta } from '../data/types';
import { DEFAULT_SCENARIO, type Scenario } from '../state/scenario';
import { odBasis, prepareOd } from './odSync';
import { configureOd, loadOdFolder, odReadyModes, odResultOf, resetOdStore, useOdStore } from './useOdStore';
import { nextOdLock } from './useSkyStore';

/*
 * Valeurs de TEST (arbitraires, jamais affichées) : 3 communes, 1 pôle, deux réglages de marche.
 * Réglage « a » → dossier data/od_walk4000/, réglage « b » → data/od_walk500/ (dérivé de leg_limit_m).
 */
const N = 229;
const meta = {
  day_types: [
    { id: 'd06', label: '6h-14h', start: '06:00', end: '14:00' },
    { id: 'd09', label: '9h-17h', start: '09:00', end: '17:00' },
    { id: 'd14', label: '14h-22h', start: '14:00', end: '22:00' },
  ],
  walk_settings: {
    nature: 'test',
    default: 'a',
    mode: 'transit',
    settings: [
      { id: 'a', label: 'a', leg_limit_m: 4000, max_time_walking_min: 60, key: null },
      { id: 'b', label: 'b', leg_limit_m: 500, max_time_walking_min: 8, key: 'bk' },
    ],
  },
} as unknown as Meta;
const poles = [{ id: 'P0', jobs: 3 }];
const dataset = { meta, poles } as unknown as Dataset;

const indexFor = (setting: string, over: Partial<OdIndex> = {}) =>
  fixtureIndex({
    communes: ['A', 'B', 'C'],
    jobs: [1, 2, 3],
    pole_of: [0, 0, null],
    poles,
    files: ['A', 'B'],
    // publié le 03/11 : TC complet, les autres modes annoncés mais non exportés
    modes: [{ id: 'transit', code: 0, kind: 'series' }],
    coverage: {
      transit: { origins: 2, complete: true },
      walk: { origins: 0, complete: false, computed: [], status: 'not_computed' },
    },
    complete: false,
    walk_setting: { id: setting },
    ...over,
  });

const fileFor = (origin: number, minutes: number) =>
  gzipSync(
    Buffer.from(
      buildSwod({
        origin,
        step: 5,
        first: 180,
        nSlots: N,
        maxTrip: 120,
        sections: [{ mode: 0, kind: 'series', records: [{ dest: origin === 0 ? 1 : 0, out: Array(N).fill(minutes), ret: Array(N).fill(minutes) }] }],
      }),
    ),
  );

/** Serveur simulé : index par dossier, fichiers d'origine A (vers B, 20 min) et B (vers A, 50 min). */
function server(indexes: Record<string, OdIndex | null>) {
  const calls: string[] = [];
  const fetcher = async (url: RequestInfo | URL): Promise<Response> => {
    const u = String(url);
    calls.push(u);
    const folder = /(data\/od_walk\d+\/)/.exec(u)?.[1] ?? '';
    if (u.endsWith('index.json')) {
      const idx = indexes[folder];
      return idx ? Response.json(idx) : new Response('absent', { status: 404 });
    }
    const insee = /o\/(\w+)\.bin$/.exec(u)![1]!;
    return new Response(new Uint8Array(fileFor(insee === 'A' ? 0 : 1, insee === 'A' ? 20 : 50)), { headers: { 'content-type': 'application/octet-stream' } });
  };
  configureOd({ fetcher, root: '/' });
  return calls;
}

const scenario = (over: Partial<Scenario>): Scenario => ({ ...DEFAULT_SCENARIO, origin: 'A', day: 'd09', budget: 45, mode: 'transit', ...over });

afterEach(() => resetOdStore());

describe('dossier OD par réglage de marche (D-024)', () => {
  it('index chargé une fois, réglage revérifié dans index.walk_setting', async () => {
    const calls = server({ 'data/od_walk4000/': indexFor('a') });
    const e1 = await loadOdFolder({ path: 'data/od_walk4000/', settingId: 'a' }, poles);
    const e2 = await loadOdFolder({ path: 'data/od_walk4000/', settingId: 'a' }, poles);
    expect(e1.status).toBe('ready');
    expect(e2).toBe(e1);
    expect(calls.filter((c) => c.endsWith('index.json'))).toHaveLength(1);
  });

  it('réglage différent de celui demandé : dossier écarté (jamais de repli silencieux)', async () => {
    server({ 'data/od_walk4000/': indexFor('b') });
    const e = await loadOdFolder({ path: 'data/od_walk4000/', settingId: 'a' }, poles);
    expect(e.status).toBe('error');
    expect(e.error).toMatch(/réglage b au lieu de a/);
  });

  it('dossier absent : « absent », pas une erreur', async () => {
    server({});
    expect((await loadOdFolder({ path: 'data/od_walk500/', settingId: 'b' }, poles)).status).toBe('absent');
  });
});

describe('base de calcul du ciel (odBasis, odModeReady)', () => {
  const ready = { status: 'ready' as const, index: indexFor('a') };
  it('TC complet : table OD ; vélo + TC ou marche non exportée : access/ aux journées-types', () => {
    expect(odBasis(ready, 'transit', false)).toBeNull();
    expect(odBasis(ready, 'bike_transit', false)).toBe('mode');
    expect(odBasis(ready, 'walk', false)).toBe('mode');
    expect(odReadyModes(ready.index)).toEqual(['transit']);
  });

  it('un mode exporté plus tard avec coverage[mode].complete = true s’active seul (rien en dur)', () => {
    const later = indexFor('a', {
      modes: [
        { id: 'transit', code: 0, kind: 'series' },
        { id: 'walk', code: 1, kind: 'scalar' },
      ],
      coverage: { transit: { origins: 2, complete: true }, walk: { origins: 2, complete: true } },
    });
    expect(odBasis({ status: 'ready', index: later }, 'walk', false)).toBeNull();
    // section publiée mais couverture incomplète : pas encore
    const partial = indexFor('a', { ...later, coverage: { transit: { origins: 2, complete: true }, walk: { origins: 1, complete: false, computed: ['A'] } } });
    expect(odBasis({ status: 'ready', index: partial }, 'walk', false)).toBe('mode');
  });

  it('visite ou découverte : verrou (leurs chiffres sont ceux d’access/)', () => {
    expect(odBasis(ready, 'transit', true)).toBe('lock');
  });

  it('dossier absent ou illisible', () => {
    expect(odBasis(null, 'transit', false)).toBe('no_folder');
    expect(odBasis({ status: 'absent', index: null }, 'transit', false)).toBe('folder_absent');
    expect(odBasis({ status: 'error', index: null }, 'transit', false)).toBe('folder_error');
  });
});

describe('prepareOd (branchement du scénario)', () => {
  it('journée-type en TC : table OD aux horaires de la journée-type, résultat commune par commune', async () => {
    server({ 'data/od_walk4000/': indexFor('a') });
    const r = await prepareOd(dataset, scenario({}), false);
    expect(r.off).toBeNull();
    expect(r.shown?.shift).toEqual({ start: 540, end: 1020 });
    expect(r.scenario.shift).toBeNull();
    const res = odResultOf(r.shown)!;
    expect(res.status).toBe('ok');
    expect(res.dests[1]).toMatchObject({ insee: 'B', status: 'accessible', out: { minutes: 20 } });
    // commune d'origine : trajet non mesuré (selfPairState)
    expect(res.dests[0]!.status).toBe('self');
  });

  it('horaire libre calculable : gardé ; hors bornes ou hors grille : ramené à la journée-type', async () => {
    server({ 'data/od_walk4000/': indexFor('a') });
    const ok = await prepareOd(dataset, scenario({ shift: { start: 480, end: 960 } }), false);
    expect(ok.scenario.shift).toEqual({ start: 480, end: 960 });
    expect(ok.shown?.shift).toEqual({ start: 480, end: 960 });
    const off = await prepareOd(dataset, scenario({ shift: { start: 481, end: 960 } }), false);
    expect(off.scenario.shift).toBeNull();
    expect(off.shown?.shift).toEqual({ start: 540, end: 1020 });
  });

  it('mode non servi par la table : horaire libre retiré, ciel sur access/', async () => {
    server({ 'data/od_walk4000/': indexFor('a') });
    const r = await prepareOd(dataset, scenario({ mode: 'bike_transit', shift: { start: 480, end: 960 } }), false);
    expect(r.off).toBe('mode');
    expect(r.shown).toBeNull();
    expect(r.scenario.shift).toBeNull();
  });

  it('le dossier suit le réglage de marche (w) et la comparaison charge le fichier de B', async () => {
    const calls = server({ 'data/od_walk4000/': indexFor('a'), 'data/od_walk500/': indexFor('b') });
    const r = await prepareOd(dataset, scenario({ walk: 'b', compare: 'B' }), false);
    expect(r.shown?.folder).toBe('data/od_walk500/');
    expect(calls.some((c) => c.endsWith('data/od_walk500/o/B.bin'))).toBe(true);
    expect(odResultOf(r.shown, 'B')!.dests[0]).toMatchObject({ insee: 'A', status: 'none', out: { minutes: 50 } });
  });

  it('origine sans fichier : « non calculé pour cette commune »', async () => {
    server({ 'data/od_walk4000/': indexFor('a') });
    const r = await prepareOd(dataset, scenario({ origin: 'C' }), false);
    expect(odResultOf(r.shown)!.status).toBe('origin_not_computed');
  });

  it('le store n’est posé que par l’appelant (aucun effet de bord sur le ciel affiché)', async () => {
    server({ 'data/od_walk4000/': indexFor('a') });
    await prepareOd(dataset, scenario({}), false);
    expect(useOdStore.getState().shown).toBeNull();
  });
});

describe('verrou D-019 : la visite et les découvertes montrent le ciel du site (nextOdLock, 13/11)', () => {
  const a = scenario({});
  it('ni la visite (06/11) ni les découvertes (13/11) ne le posent ; levé aussi par un lien ou un changement de réglage', () => {
    expect(nextOdLock('tour', false, a, a)).toBe(false);
    expect(nextOdLock('tour', true, a, a)).toBe(false);
    expect(nextOdLock('insight', false, a, a)).toBe(false);
    expect(nextOdLock('insight', true, a, a)).toBe(false);
    expect(nextOdLock('url', true, a, a)).toBe(false);
    expect(nextOdLock('user', true, a, { ...a, budget: 30 })).toBe(false);
    expect(nextOdLock('user', true, a, { ...a, shift: { start: 480, end: 960 } })).toBe(false);
  });
  it('ouvrir un pôle ou le halo ne le lève pas (le ciel ne change pas de base sous le clic)', () => {
    expect(nextOdLock('user', true, a, { ...a, pole: 'P0' })).toBe(true);
    expect(nextOdLock('user', true, a, { ...a, halo: 'age' })).toBe(true);
    expect(nextOdLock('user', false, a, { ...a, pole: 'P0' })).toBe(false);
  });
});
