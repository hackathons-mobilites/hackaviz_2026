import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ItinerariesFile, ItinLeg } from '../data/itineraries';
import { computeDelta } from '../data/accessibility';
import { jobsOral } from '../data/oral';
import type { AccessFile, Commune, ContextFile, Dataset, Meta, Pole } from '../data/types';
import { DEFAULT_SCENARIO, type Scenario } from '../state/scenario';
import { buildSkyView } from '../state/skyView';
import { readItinerariesFile } from '../../scripts/nodeData';
import { VARIABLES, type NarrationContext } from './variables';

// Variables de la visite v4 « défi » sur les VRAIES données exportées, ciel à 44 astres (racine de public/data, 05/11),
// origine Maisons-Laffitte / Montesson ; astre suivi : Paris 8e.
const FOCUS = 'BE_1107_75108';
const url = (rel: string) => new URL(`../../public/data/${rel}`, import.meta.url);
const dataRoot = fileURLToPath(new URL('../../public/data', import.meta.url));
const read = <T,>(rel: string): T => JSON.parse(readFileSync(url(rel), 'utf-8')) as T;
// Itinéraires : `78358.json.gz` (gzip, 04/11) ou `78358.json` selon meta.itineraries_format
const hasItin = ['78358.json.gz', '78358.json'].some((f) => existsSync(url(`itineraries/${f}`)));
const hasData = ['meta.json', 'access/78358.json', 'access/78418.json'].every((r) => existsSync(url(r))) && hasItin;

describe.skipIf(!hasData)('variables de la visite « défi » (données réelles)', () => {
  const dataset: Dataset = {
    origin: 'real',
    meta: read<Meta>('meta.json'),
    poles: read<Pole[]>('poles.json'),
    communes: read<Commune[]>('communes.json'),
    insights: [],
    sources: [],
  };
  const access: Record<string, AccessFile> = { '78358': read('access/78358.json'), '78418': read('access/78418.json') };
  const itineraries: Record<string, ItinerariesFile> = { '78358': readItinerariesFile(dataRoot, dataset.meta, '78358')! };
  const sc = (p: Partial<Scenario>): Scenario => ({ ...DEFAULT_SCENARIO, origin: '78358', day: 'd09', budget: 60, ...p });
  const ctx = (p: Partial<Scenario>, extra: Partial<NarrationContext> = {}): NarrationContext => ({
    view: buildSkyView(dataset, sc(p), access),
    previous: null,
    compare: p.compare ? buildSkyView(dataset, sc({ ...p, origin: p.compare }), access) : null,
    access,
    itineraries,
    ...extra,
  });
  const v = (name: string, c: NarrationContext) => VARIABLES[name]!(c);

  it('moyens de transport : climatisation déclarée (TRA03) et carbone (ENV01) lus dans le trajet du pôle suivi', () => {
    const c = ctx({ pole: FOCUS, day: 'd14' });
    expect(v('moyens.climCase', c)).toBe('declaree');
    expect(v('moyens.carbonCase', c)).toBe('publie');
    // sans fiche de pôle, ou hors transports en commun : rien n'est affirmé
    expect(v('moyens.climCase', ctx({ day: 'd14' }))).toBeNull();
    expect(v('moyens.carbonCase', ctx({ pole: FOCUS, day: 'd14', mode: 'bike_transit' }))).toBeNull();
  });
  // Flux du 06/11 (PR 81) : le retour de Paris 8e en 14h-22h passe de 76 à 46 min (31 lignes de bus rétablies et
  // réseau de nuit, D-046 ; Navitia donnait 46) : l'astre est désormais allumé aussi le soir.
  it('verdict du pôle suivi : allumé en 9h-17h et en 14h-22h', () => {
    expect(v('pole.verdictCase', ctx({ pole: FOCUS }))).toBe('allume');
    expect(v('pole.verdictCase', ctx({ pole: FOCUS, day: 'd14' }))).toBe('allume');
    expect(v('pole.verdictCase', ctx({}))).toBeNull();
  });
  it('astre suivi (ciel à 44 astres) : nom à l’oral, bassin, flux publiés', () => {
    expect(v('pole.oralName', ctx({ pole: FOCUS }))).toBe('Paris 8e');
    expect(v('pole.oralName', ctx({ pole: 'BE_1146' }))).toBe('T4 Paris Ouest La Défense');
    expect(v('pole.oralName', ctx({ pole: 'BE_1126' }))).toBe('Versailles Saclay');
    expect(v('access.poleTotal', ctx({}))).toBe(44);
    expect(v('flow.case', ctx({ pole: FOCUS }, { context: read<ContextFile>('context/78358.json') }))).toBe('ok');
    expect(v('flow.peopleOral', ctx({ pole: FOCUS }, { context: read<ContextFile>('context/78358.json') }))).toMatch(/^(près de |plus de )?[\d\u00a0]+$/);
  });

  it('bus du retour lu dans l’itinéraire (D-028), nommé comme le panneau le montre', () => {
    // Flux du 06/11 : plus de bus de remplacement au retour de 22h (la règle reste testée plus bas sur un trajet construit)
    expect(v('pole.retReplacementCase', ctx({ pole: FOCUS, day: 'd14' }))).toBe('regulier');
    expect(v('pole.retReplacementOral', ctx({ pole: FOCUS, day: 'd14' }))).toBeNull();
    expect(v('pole.retReplacementCase', ctx({ pole: FOCUS }))).toBe('regulier');
    expect(v('pole.retReplacementOral', ctx({ pole: FOCUS }))).toBeNull();
    // Sans fichier d'itinéraires, ou hors du mode TC : rien n'est affirmé
    expect(v('pole.retReplacementCase', ctx({ pole: FOCUS, day: 'd14' }, { itineraries: {} }))).toBeNull();
    expect(v('pole.retReplacementCase', ctx({ pole: FOCUS, day: 'd14', mode: 'bike_transit' }))).toBeNull();
  });

  it('règle du bus de remplacement : exploitant RER ou Transilien, mode bus', () => {
    const file = itineraries['78358']!;
    const i = file.poles.indexOf(FOCUS);
    const withLegs = (legs: ItinLeg[]): ItinerariesFile => {
      const ret = [...(file.days.d14!.ret ?? [])];
      ret[i] = { ...ret[i]!, legs };
      return { ...file, days: { ...file.days, d14: { ...file.days.d14, ret } } };
    };
    const leg = (p: Partial<ItinLeg>): ItinLeg => ({ m: 'bus', dep: '22:00', arr: '22:10', min: 10, dist_m: 1000, ...p });
    const say = (legs: ItinLeg[]) =>
      v('pole.retReplacementOral', ctx({ pole: FOCUS, day: 'd14' }, { itineraries: { '78358': withLegs(legs) } }));
    expect(say([leg({ line: 'A', agency: 'RER' })])).toBe('un bus du RER A');
    expect(say([leg({ line: 'L', agency: 'Transilien' })])).toBe('un bus de la ligne L');
    expect(say([leg({ line: '272', agency: 'La Défense - Saint Cloud' })])).toBeNull();
    expect(say([leg({ m: 'rer', line: 'A', agency: 'RER' })])).toBeNull();
  });

  it('commune de départ hors des totaux de postes (point 4.1 du 05/11) : retranchée si son astre compte, jamais sinon', () => {
    const HOME = 'BE_1125'; // Seine-Aval : astre de Maisons-Laffitte
    const SELF = 5_530;
    const jobsOfHome = dataset.poles.find((p) => p.id === HOME)!.jobs!;
    const communeJobs = (insee: string) => (insee === '78358' ? SELF : null);
    // en 9h-17h l'astre de la commune de départ est allumé : le total le compte entier moins la commune
    const c = ctx({}, { communeJobs });
    expect(c.view.states.find((s) => s.id === HOME)!.status).toBe('accessible');
    const total = c.view.totals.jobs!;
    expect(v('access.jobsOral', c)).toBe(jobsOral(total - SELF));
    expect(jobsOral(total - SELF)).not.toBe(jobsOral(total - SELF - jobsOfHome));
    // sans la fonction (index illisible) : variable nulle, la visite s'arrête (jamais un total qui compte la commune)
    expect(v('access.jobsOral', ctx({}))).toBeNull();
    expect(v('access.jobsOral', ctx({}, { communeJobs: () => null }))).toBeNull();
    // écart de postes : l'astre de la commune de départ ne bouge pas ici, l'écart est celui des astres gagnés ou perdus
    const eclipse = ctx({ day: 'd14' }, { previous: ctx({}).view, communeJobs });
    const d = computeDelta(dataset.poles, eclipse.previous!.states, eclipse.view.states);
    expect(d.lost).not.toContain(HOME);
    expect(v('delta.jobsOral', eclipse)).toBe(jobsOral(Math.abs(d.jobsDelta!)));
    // astre de la commune de départ perdu : ses postes sortent de l'écart (somme des autres astres perdus seule)
    const view = ctx({}).view;
    const lostHome = { ...eclipse, previous: view, view: { ...view, states: view.states.map((s) => (s.id === HOME ? { ...s, status: 'none' as const } : s)) } };
    const dl = computeDelta(dataset.poles, view.states, lostHome.view.states);
    expect(dl.lost).toEqual([HOME]);
    expect(v('delta.jobsOral', { ...lostHome, communeJobs })).toBe(jobsOral(jobsOfHome - SELF));
  });

  it('acte 3 : la voisine allume moins d’étoiles', () => {
    expect(v('compare.rankCase', ctx({ compare: '78418' }))).toBe('moins');
    expect(v('compare.rankCase', ctx({ origin: '78418', compare: '78358' }))).toBe('plus');
    // même commune des deux côtés : autant d'étoiles
    expect(v('compare.rankCase', ctx({ compare: '78358' }))).toBe('autant');
    expect(v('compare.rankCase', ctx({}))).toBeNull();
  });

  it('or : nombre de pôles dorés à l’oral, rien sans or', () => {
    const d14 = { mode: 'bike_transit' as const, day: 'd14' as const };
    expect(v('gain.stars', ctx(d14, { gain: { shown: true, gained: [FOCUS, 'BE_1147', 'BE_1127'], lost: [] } }))).toBe('3 étoiles');
    expect(v('gain.stars', ctx(d14, { gain: { shown: true, gained: [FOCUS], lost: [] } }))).toBe('une étoile');
    expect(v('gain.stars', ctx(d14, { gain: { shown: false, gained: [], lost: [] } }))).toBeNull();
    expect(v('gain.stars', ctx(d14, { gain: null }))).toBeNull();
  });

  it('voiture avec le trafic moyen (D-029) : plus d’étoiles que les TC seuls en 14h-22h', () => {
    const tc = ctx({ day: 'd14' }).view;
    const car = ctx({ day: 'd14', mode: 'car_traffic' }, { previous: tc });
    expect(v('delta.sign', car)).toBe('de plus');
    expect(v('access.stars', car)).toMatch(/^\d+ étoiles$/);
  });
});
