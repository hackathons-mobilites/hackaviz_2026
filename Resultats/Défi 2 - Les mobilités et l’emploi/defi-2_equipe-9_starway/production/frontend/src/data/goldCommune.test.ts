import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readOdOffline } from '../../scripts/nodeData';
import { DEFAULT_SCENARIO, type Scenario } from '../state/scenario';
import { buildSkyView, transitCommuneStates } from '../state/skyView';
import { offlineOdShown } from '../tour/odOffline';
import { computePoleStates, type PoleState } from './accessibility';
import { modeComputedFor } from './coverage';
import { goldDelta } from './gain';
import type { AccessFile, Commune, Dataset, DayTypeId, Meta, Pole } from './types';

/**
 * RÈGLE DE L'OR (D-056) sur les fichiers PUBLIÉS : un astre doré (vélo + TC, pas les TC seuls) n'est jamais éclairé, même
 * en partie, dans le ciel TC commune par commune. Pré-audit du 09/11 : 53 astres en or sur 582 l'étaient, dont Paris 20e
 * sur `?o=78358&d=d09&b=60`, entièrement atteint en TC commune par commune.
 */
const root = fileURLToPath(new URL('../../public', import.meta.url));
const url = (rel: string) => new URL(`../../public/data/${rel}`, import.meta.url);
const readJson = <T,>(rel: string): T | null => (existsSync(url(rel)) ? (JSON.parse(readFileSync(url(rel), 'utf-8')) as T) : null);
const meta = readJson<Meta>('meta.json');
const poles = readJson<Pole[]>('poles.json');
const communes = readJson<Commune[]>('communes.json');
const od = meta ? readOdOffline(root, meta) : null;
const published = !!meta && !!poles && !!communes && !!od;
const dataset: Dataset | null = published ? { origin: 'real', meta: meta!, poles: poles!, communes: communes!, insights: [], sources: [] } : null;

const PARIS_20E = 'BE_1107_75120';
const VERSAILLES = 'BE_1126';

const accessFiles = new Map<string, AccessFile>();
function accessOf(insee: string): AccessFile {
  let f = accessFiles.get(insee);
  if (!f) {
    f = readJson<AccessFile>(`access/${insee}.json`)!;
    accessFiles.set(insee, f);
  }
  return f;
}

function gold(insee: string, day: DayTypeId, budget: number) {
  const file = accessOf(insee);
  const sc: Scenario = { ...DEFAULT_SCENARIO, origin: insee, day, budget, mode: 'bike_transit', compare: null, pole: null, halo: null, walk: null, shift: null };
  const transit = computePoleStates(poles!, file, 'transit', day, budget);
  const bike = computePoleStates(poles!, file, 'bike_transit', day, budget);
  const commune = transitCommuneStates(dataset!, sc, offlineOdShown(dataset!, { ...sc, mode: 'transit' }, od));
  const shown = buildSkyView(dataset!, sc, { [insee]: file }, true, null);
  return { sc, transit, bike, commune: commune!, delta: commune ? goldDelta(poles!, transit, bike, commune) : null, shown };
}

describe.skipIf(!published)('or : jamais sur un astre déjà éclairé dans le ciel TC commune par commune (D-056)', () => {
  const state = (states: readonly PoleState[], id: string) => states[poles!.findIndex((p) => p.id === id)]!;

  it('?o=78358&d=d09&b=60 : Paris 20e (part TC non nulle) reste cyan, Versailles (réellement gagné) est doré', () => {
    const g = gold('78358', 'd09', 60);
    expect(g.shown.basis, 'le vélo + TC est affiché sur access/').toBe('access');
    // Paris 20e : accessible en vélo + TC, non accessible en access/ TC, mais déjà atteint en TC commune par commune
    expect(state(g.bike, PARIS_20E).status).toBe('accessible');
    expect(state(g.transit, PARIS_20E).status).not.toBe('accessible');
    expect(g.commune.find((s) => s.id === PARIS_20E)!.od!.reached, 'part TC non nulle pour Paris 20e').toBeGreaterThan(0);
    expect(g.delta!.gained).not.toContain(PARIS_20E);
    // Versailles : pareil en vélo + TC, et sa part TC commune par commune est bien nulle : l'or est mérité
    expect(state(g.bike, VERSAILLES).status).toBe('accessible');
    expect(g.commune.find((s) => s.id === VERSAILLES)!.od!.reached, 'part TC nulle pour Versailles').toBe(0);
    expect(g.delta!.gained).toContain(VERSAILLES);
  });

  it('sur toutes les communes publiées en vélo + TC : aucun or sur un astre à part TC non nulle', () => {
    // communes publiées en vélo + TC : la liste de meta.mode_coverage si le mode est partiel ; sinon (flux du 06/11 :
    // les 1 285) les communes du récit et un échantillon fixe (code INSEE multiple de 23, une soixantaine), sans choix à
    // la main. Les 1 285 communes ont été passées le 10/11 (13 s disque chaud, plus de 160 s après un redémarrage :
    // trop lent pour le contrôle de mise en ligne).
    const listed = meta!.mode_coverage?.bike_transit;
    const bikeCommunes =
      listed ??
      (meta!.access_communes ?? []).filter(
        (i) => modeComputedFor(meta!, 'bike_transit', i) && (meta!.story_communes.includes(i) || Number(i) % 23 === 0),
      );
    expect(bikeCommunes.length).toBeGreaterThan(0);
    for (const insee of bikeCommunes) {
      for (const day of meta!.day_types.map((d) => d.id) as DayTypeId[]) {
        for (const budget of meta!.budgets ?? [30, 45, 60]) {
          const g = gold(insee, day, budget);
          expect(g.commune, `${insee} ${day} ${budget} : table commune x commune lisible`).toBeTruthy();
          for (const id of g.delta!.gained) {
            const od1 = g.commune.find((s) => s.id === id)!.od!;
            expect(od1.reached, `${insee} ${day} ${budget} : ${id} doré à part TC non nulle`).toBe(0);
          }
        }
      }
    }
  }, 120_000);

  it('référence d’un autre scénario (autre journée, autre commune, table absente) : aucune référence, donc aucun or', () => {
    const file = readJson<AccessFile>('access/78358.json');
    expect(file?.modes?.bike_transit).toBeTruthy();
    const sc: Scenario = { ...DEFAULT_SCENARIO, origin: '78358', day: 'd09', budget: 60, mode: 'bike_transit', compare: null, pole: null, halo: null, walk: null, shift: null };
    const tc = { ...sc, mode: 'transit' as const };
    const shown = offlineOdShown(dataset!, tc, od)!;
    expect(transitCommuneStates(dataset!, sc, shown)).not.toBeNull();
    expect(transitCommuneStates(dataset!, sc, null)).toBeNull();
    expect(transitCommuneStates(dataset!, { ...sc, day: 'd14' }, shown), 'autre journée-type').toBeNull();
    expect(transitCommuneStates(dataset!, { ...sc, origin: '78418' }, shown), 'autre commune').toBeNull();
  });
});
