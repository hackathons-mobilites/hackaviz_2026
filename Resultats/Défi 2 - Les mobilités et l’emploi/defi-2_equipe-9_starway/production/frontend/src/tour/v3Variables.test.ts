import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AccessFile, Commune, ContextFile, Dataset, Meta, Pole } from '../data/types';
import { DEFAULT_SCENARIO, type Scenario } from '../state/scenario';
import { buildSkyView } from '../state/skyView';
import { VARIABLES, type NarrationContext } from './variables';

// Variables de la visite v3, sur les VRAIES données exportées (Maisons-Laffitte / Montesson, D-020).
const SKY = '';
const url = (rel: string) => new URL(`../../public/data/${rel}`, import.meta.url);
const read = <T,>(rel: string): T => JSON.parse(readFileSync(url(rel), 'utf-8')) as T;
const hasData = [`${SKY}meta.json`, `${SKY}access/78358.json`, `${SKY}access/78418.json`, 'context/78358.json'].every((r) => existsSync(url(r)));

const NBSP = '\u00a0';

describe.skipIf(!hasData)('variables v3 (données réelles)', () => {
  const dataset: Dataset = {
    origin: 'real',
    meta: read<Meta>(`${SKY}meta.json`),
    poles: read<Pole[]>(`${SKY}poles.json`),
    communes: read<Commune[]>('communes.json'),
    insights: [],
    sources: [],
  };
  const access: Record<string, AccessFile> = { '78358': read(`${SKY}access/78358.json`), '78418': read(`${SKY}access/78418.json`) };
  const context = read<ContextFile>('context/78358.json');
  const sc = (p: Partial<Scenario>): Scenario => ({ ...DEFAULT_SCENARIO, origin: '78358', day: 'd09', budget: 60, ...p });
  const ctx = (p: Partial<Scenario>, extra: Partial<NarrationContext> = {}): NarrationContext => ({
    view: buildSkyView(dataset, sc(p), access),
    previous: null,
    compare: p.compare ? buildSkyView(dataset, sc({ ...p, origin: p.compare }), access) : null,
    context,
    access,
    // valeur de test : ces cas ne regardent pas la commune de départ (voir defiVariables.test.ts, point 4.1)
    communeJobs: () => 0,
    ...extra,
  });
  const v = (name: string, c: NarrationContext) => VARIABLES[name]!(c);
  // Astres choisis dans les données publiées (aucun identifiant écrit en dur : les calculs peuvent être republiés)
  const { d09, d14 } = access['78358']!.modes.transit as { d09: { out: (number | null)[]; ret: (number | null)[] }; d14: { out: (number | null)[]; ret: (number | null)[] } };
  const lit = (s: { out: (number | null)[]; ret: (number | null)[] }, i: number) => s.out[i] != null && s.ret[i] != null && s.out[i]! <= 60 && s.ret[i]! <= 60;
  const ids = dataset.poles.map((p) => p.id);
  const litD09 = ids[dataset.poles.findIndex((_, i) => lit(d09, i))]!;
  const eclipsed = ids.filter((_, i) => lit(d09, i) && !lit(d14, i));
  const staysLit = ids.find((_, i) => lit(d09, i) && lit(d14, i))!;
  const returnOnly = ids.find((_, i) => lit(d09, i) && d14.out[i] === d09.out[i] && d14.ret[i] != null && d14.ret[i]! > 60)!;
  const flowsOk = Object.entries((context.flows_to_poles as { poles: Record<string, { flux: number | null; precision: string }> }).poles)
    .find(([id, e]) => ids.includes(id) && e.precision === 'ok' && (e.flux ?? 0) > 0)![0];

  it('noms à l’oral', () => {
    expect(v('origin.oralName', ctx({}))).toBe('Maisons-Laffitte');
    expect(v('compare.oralName', ctx({ compare: '78418' }))).toBe('Montesson');
    expect(v('compare.oralName', ctx({}))).toBeNull();
  });
  it('heure de départ de l’aller du pôle sélectionné (grille de 5 min)', () => {
    expect(v('pole.outDepartOral', ctx({ pole: litD09 }))).toMatch(/^\d+ heures( \d+)?$/);
    expect(v('pole.outDepartOral', ctx({}))).toBeNull();
    // mode indépendant de l'heure (vélo seul, série « any ») : pas d'heure de départ
    expect(v('pole.outDepartOral', ctx({ pole: litD09, mode: 'bike' }))).toBeNull();
  });
  it('sens qui sort du budget : retour en 14h-22h (aller identique à 9h-17h), allumé en 9h-17h', () => {
    expect(v('pole.legCase', ctx({ pole: returnOnly, day: 'd14' }))).toBe('retour');
    expect(v('pole.legCase', ctx({ pole: returnOnly }))).toBe('allume');
    expect(v('pole.legCase', ctx({}))).toBeNull();
  });
  it('sens qui sort du budget : règles sur des cas construits', () => {
    const file = access['78358']!;
    const cell = file.modes.transit!.d14!;
    const withCell = (out: (number | null)[], ret: (number | null)[]) => ({
      ...file,
      modes: { ...file.modes, transit: { ...file.modes.transit, d14: { ...cell, out, ret, reason: out.map(() => null) } } },
    });
    const n = cell.out.length;
    const at0 = (o: number | null, r: number | null) => {
      const out = Array<number | null>(n).fill(10);
      const ret = Array<number | null>(n).fill(10);
      out[0] = o;
      ret[0] = r;
      const acc = { ...access, '78358': withCell(out, ret) as AccessFile };
      return VARIABLES['pole.legCase']!({ ...ctx({}), view: buildSkyView(dataset, sc({ pole: ids[0]!, day: 'd14' }), acc), access: acc });
    };
    expect(at0(null, 30)).toBe('aller_absent');
    expect(at0(30, null)).toBe('retour_absent');
    expect(at0(70, 70)).toBe('les_deux');
    expect(at0(70, 30)).toBe('aller');
    expect(at0(43, 70)).toBe('retour_seul'); // aller différent de celui de 9h-17h
  });
  it('horizon de recherche à l’oral', () => {
    expect(v('trip.maxOral', ctx({}))).toMatch(/^\d+ (heures?( \d+)?|minutes?)$/);
    const noMax = { ...ctx({}), view: { ...ctx({}).view, dataset: { ...dataset, meta: { ...dataset.meta, max_trip_min: undefined } } } };
    expect(v('trip.maxOral', noMax)).toBeNull();
  });
  it('flux INSEE vers le pôle sélectionné', () => {
    expect(v('flow.case', ctx({ pole: flowsOk }))).toBe('ok');
    expect(v('flow.peopleOral', ctx({ pole: flowsOk }))).toMatch(/^(près de |plus de )?[\d\u00a0]+$/);
    expect(v('flow.peopleOral', ctx({}))).toBeNull();
  });
  it('halo niveau de vie : médiane à la centaine, taux à l’unité ; secret = pas de taux', () => {
    expect(v('halo.incomeMedianOral', ctx({}))).toMatch(new RegExp(`^\\d+${NBSP}\\d00 euros$`));
    expect(v('halo.povertyOral', ctx({}))).toMatch(new RegExp(`^\\d+${NBSP}%$`));
    expect(v('halo.incomeCase', ctx({}))).toBe('deux');
    const secret: ContextFile = { ...context, income: { ...context.income!, poverty_rate: null, poverty_rate_status: 'secret' } };
    expect(v('halo.povertyOral', ctx({}, { context: secret }))).toBeNull();
    expect(v('halo.incomeCase', ctx({}, { context: secret }))).toBe('pauvrete_secrete');
    expect(v('halo.incomeMedianOral', ctx({}, { context: null }))).toBeNull();
  });
  it('comparaison en postes (variante D-019)', () => {
    expect(v('compare.jobsOral', ctx({ compare: '78418' }))).toMatch(/postes$/);
    expect(v('compare.jobsOral', ctx({}))).toBeNull();
  });
  it('or : postes des seuls pôles gagnés, et bilan', () => {
    const gained = { shown: true, gained: [ids[1]!], lost: [] };
    expect(v('gain.jobsOral', ctx({ mode: 'bike_transit' }, { gain: gained }))).toMatch(/postes$/);
    expect(v('gain.case', ctx({}, { gain: gained }))).toBe('gain');
    expect(v('gain.case', ctx({}, { gain: { ...gained, lost: [ids[2]!] } }))).toBe('gain_et_perte');
    expect(v('gain.case', ctx({}, { gain: { shown: false, gained: [], lost: [] } }))).toBe('sans_gain');
    expect(v('gain.jobsOral', ctx({}, { gain: { shown: false, gained: [], lost: [] } }))).toBeNull();
    expect(v('gain.case', ctx({}, { gain: null }))).toBeNull();
  });
  it('or et éclipse : pôles dorés parmi ceux que l’éclipse a éteints (TC 9h-17h contre TC de la journée)', () => {
    const d14 = { mode: 'bike_transit' as const, day: 'd14' as const };
    const some = { shown: true, gained: eclipsed.slice(0, 2), lost: [] };
    expect(v('gain.eclipseCase', ctx(d14, { gain: some }))).toBe('partie');
    // Un astre qui reste allumé en 14h-22h : le dorer ne « rallume » rien
    expect(v('gain.eclipseCase', ctx(d14, { gain: { ...some, gained: [staysLit] } }))).toBe('autre');
    expect(v('gain.eclipseCase', ctx({ mode: 'bike_transit' }, { gain: some }))).toBeNull();
    expect(v('gain.eclipseCase', ctx(d14, { gain: { shown: false, gained: [], lost: [] } }))).toBeNull();
  });
  it('deux horizons : cas déduit des pôles allumés de chaque commune (Maisons-Laffitte / Montesson)', () => {
    const expected = (day: 'd09' | 'd14') => {
      const of = (insee: string) => ids.filter((_, i) => lit(access[insee]!.modes.transit![day]!, i));
      const [a, b] = [of('78358'), of('78418')];
      return a.length !== b.length ? 'ecart' : a.every((x) => b.includes(x)) ? 'meme_horizon' : 'autant_pas_les_memes';
    };
    expect(v('compare.horizonCase', ctx({ compare: '78418' }))).toBe(expected('d09'));
    expect(v('compare.horizonCase', ctx({ compare: '78418', day: 'd14' }))).toBe(expected('d14'));
    expect(v('compare.horizonCase', ctx({}))).toBeNull();
  });
});
