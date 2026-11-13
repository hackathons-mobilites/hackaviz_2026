import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modeComputedFor } from '../data/coverage';
import type { AccessFile, Commune, ContextFile, Dataset, Meta, Pole } from '../data/types';
import { DEFAULT_SCENARIO, type Scenario } from '../state/scenario';
import { buildSkyView } from '../store/selectors';
import { resolveNarration } from './variables';

// Variables résolues sur les VRAIES données exportées (Montreuil / Guignes).
const read = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;
const SKY = '';
const dataset: Dataset = {
  origin: 'real',
  meta: read<Meta>(`${SKY}meta.json`),
  poles: read<Pole[]>(`${SKY}poles.json`),
  communes: read<Commune[]>('communes.json'),
  insights: [],
  sources: [],
};
// Les fichiers access du POC peuvent être retirés pendant un recalcul : ces tests sont alors sautés.
const hasPoc = ['93048', '77222'].every((i) => existsSync(new URL(`../../public/data/${SKY}access/${i}.json`, import.meta.url)));
const access: Record<string, AccessFile> = hasPoc
  ? { '93048': read<AccessFile>(`${SKY}access/93048.json`), '77222': read<AccessFile>(`${SKY}access/77222.json`) }
  : {};
const context = read<ContextFile>('context/93048.json');
const sc = (p: Partial<Scenario>): Scenario => ({ ...DEFAULT_SCENARIO, origin: '93048', day: 'd09', budget: 60, ...p });
const view = (p: Partial<Scenario>) => buildSkyView(dataset, sc(p), access);
const say = (t: string, p: Partial<Scenario>, prev?: Partial<Scenario>) =>
  resolveNarration(t, {
    view: view(p),
    previous: prev ? view(prev) : null,
    compare: p.compare ? buildSkyView(dataset, sc({ ...p, origin: p.compare }), access) : null,
    context,
    // valeur de test : ces cas ne regardent pas la commune de départ (voir defiVariables.test.ts, point 4.1)
    communeJobs: () => 0,
  });

describe.skipIf(!hasPoc)('variables de narration (données réelles)', () => {
  it('aucune variable du script de Léa ne manque sur Montreuil', () => {
    const r = say(
      '{region.populationOral} | {access.stars} | {access.jobsOral} | {day.startOral} | {halo.transitF} | {halo.transitH}',
      {},
    );
    expect(r.missing).toEqual([]);
    expect(r.text).toMatch(/^plus de \d+ millions \| \d+ étoiles \| (près|plus) de .* postes \| 9 heures \| \d+\u00a0% \| \d+\u00a0%$/);
  });
  it('gabarit de la visite : « postes salariés recensés par l’INSEE », une seule fois', () => {
    const r = say('Avec {budget} minutes : {access.stars}. Soit {access.jobsOral} salariés recensés par l’INSEE.', {});
    expect(r.missing).toEqual([]);
    expect(r.text.match(/postes salariés recensés par l’INSEE/g)).toHaveLength(1);
    expect(r.text).not.toMatch(/postes postes/);
  });
  it('éclipse : écart entre 9h-17h et 6h-14h', () => {
    const r = say('{delta.stars} {delta.sign}, {delta.jobsOral}', { day: 'd06' }, {});
    expect(r.missing).toEqual([]);
    expect(r.text).toMatch(/étoiles? de moins/);
  });
  it('comparaison : étoiles depuis Guignes', () => {
    const r = say('{compare.stars}', { compare: '77222' });
    expect(r.missing).toEqual([]);
  });
  it('mode non calculé : le delta manque (le lecteur s’arrête, on ne prononce pas un faux écart)', () => {
    // Un mode partiel (meta.mode_coverage) non calculé pour l'une des deux communes du test : depuis le flux du 06/11,
    // le vélo + TC est calculé partout, il reste par exemple Vélib' hors de sa zone (Guignes).
    const notComputed = (['93048', '77222'] as const)
      .flatMap((origin) => dataset.meta.modes.map((m) => ({ origin, mode: m.id })))
      .find((c) => !modeComputedFor(dataset.meta, c.mode, c.origin));
    expect(notComputed, 'au moins un mode partiel non calculé pour Montreuil ou Guignes').toBeTruthy();
    const r = say('{delta.stars}', { origin: notComputed!.origin, mode: notComputed!.mode }, { origin: notComputed!.origin });
    expect(r.missing).toEqual(['delta.stars']);
  });
  it('ciel non révélé : aucune étoile prononcée', () => {
    const v = buildSkyView(dataset, sc({}), access, false);
    expect(resolveNarration('{access.stars}', { view: v, previous: null }).missing).toEqual(['access.stars']);
  });
});
