import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PoleState } from './accessibility';
import { crosscheckNote, insightMetricLines, insightModePhrase, insightModeText, insightPlan, lateReturnFocus, pickContrast } from './insights';
import type { Insight, Meta, Pole } from './types';

const ins = (id: string, kind: Insight['kind'], rank: number, robust: boolean, vs: string | null = '77222'): Insight => ({
  id,
  kind,
  rank,
  robust,
  scenario: { o: '93048', d: 'd09', b: 60, m: 'transit', vs },
  metric: { jobs_delta: null, poles_delta: null },
});

describe('le contraste du jour', () => {
  it('une seule découverte territoriale robuste, la mieux classée', () => {
    expect(pickContrast([ins('a', 'eclipse', 1, true), ins('b', 'territorial_gap', 3, true), ins('c', 'territorial_gap', 2, true)])?.id).toBe('c');
  });
  it('recoupement Navitia publié : seule une découverte confirmée est mise en avant', () => {
    const a = { ...ins('a', 'territorial_gap', 1, true), crosscheck: 'within_one_minute' as const };
    const b = { ...ins('b', 'territorial_gap', 2, true), crosscheck: 'confirmed' as const };
    const c = { ...ins('c', 'territorial_gap', 3, true), crosscheck: 'not_checked' as const };
    expect(pickContrast([a, b, c])?.id).toBe('b');
    expect(pickContrast([a, c])).toBeNull();
    expect(crosscheckNote(a)).toBe('verdict à une minute près selon le calculateur d’IDFM');
    expect(crosscheckNote(b)).toBeNull();
  });
  it('jeu publié : seule une découverte confirmée par Navitia est mise en avant, sinon aucune', () => {
    const published = JSON.parse(readFileSync(new URL('../../public/data/insights.json', import.meta.url), 'utf-8')) as Insight[];
    const picked = pickContrast(published);
    const confirmedGaps = published.filter((i) => i.kind === 'territorial_gap' && i.robust && i.scenario.vs && i.crosscheck === 'confirmed');
    if (!confirmedGaps.length) expect(picked).toBeNull();
    else expect(picked?.crosscheck).toBe('confirmed');
    const better = published.filter((i) => i.kind === 'territorial_gap' && i.robust && i.scenario.vs && i.rank < (picked?.rank ?? 0));
    expect(better.every((i) => i.crosscheck !== 'confirmed')).toBe(true);
  });
  it('rien si aucune ne convient', () => {
    expect(pickContrast([ins('a', 'territorial_gap', 1, false), ins('b', 'territorial_gap', 1, true, null)])).toBeNull();
    expect(pickContrast([])).toBeNull();
  });
});

const nb = (s: string) => s.replace(/ /g, '\u00a0');

describe('métrique « retour hors budget » en clair', () => {
  // Scénario fictif de test (pas un id de insights.json : les rangs changent à chaque export, revérifier
  // tout id cité contre le fichier publié)
  const lr = (metric: Insight['metric']): Pick<Insight, 'kind' | 'metric' | 'scenario'> => ({
    kind: 'late_return',
    scenario: { o: '91477', d: 'd14', b: 60, m: 'transit', vs: null },
    metric,
  });
  it('pôles atteints à l’aller, perdus au retour, et ce qui reste aller et retour', () => {
    expect(insightMetricLines(lr({ jobs_delta: -2844425, poles_delta: -7, jobs: 0, jobs_ref: 2844425 }))).toEqual([
      "7 pôles atteints à l'aller, mais pas au retour en 60 min ou moins",
      `${nb('2 844 425')} postes salariés (INSEE) perdus au retour ; aller et retour : aucun poste`,
    ]);
    expect(insightMetricLines(lr({ jobs_delta: -2670509, poles_delta: -1, jobs: 129036, jobs_ref: 2799545 }))).toEqual([
      "1 pôle atteint à l'aller, mais pas au retour en 60 min ou moins",
      `${nb('2 670 509')} postes salariés (INSEE) perdus au retour ; aller et retour : ${nb('129 036')} postes`,
    ]);
  });
  it('champs absents : rien d’inventé', () => {
    expect(insightMetricLines(lr({ jobs_delta: null, poles_delta: null }))).toEqual([]);
    expect(insightMetricLines(lr({ jobs_delta: -10, poles_delta: null }))).toEqual(['10 postes salariés (INSEE) perdus au retour']);
  });
  it('les autres types gardent l’écart signé', () => {
    expect(insightMetricLines({ ...lr({ jobs_delta: -42000, poles_delta: -3 }), kind: 'eclipse' })).toEqual([`-3 pôles · -${nb('42 000')} postes`]);
  });
});

describe('pôle ouvert après une découverte « retour hors budget »', () => {
  const pole = (id: string, jobs: number | null): Pole => ({
    id,
    name: id,
    communes: [],
    jobs,
    jobs_year: 2023,
    jobs_source: 'EMP01',
    point: { lon: 0, lat: 0, method: 't' },
    sky: { x: 0, y: 0 },
  });
  const st = (index: number, status: PoleState['status']): PoleState => ({ index, id: `P${index}`, status, out: null, ret: null, reason: null });
  it('le pôle « aller seulement » qui compte le plus de postes', () => {
    const poles = [pole('A', 900), pole('B', 500), pole('C', 800)];
    expect(lateReturnFocus(poles, [st(0, 'accessible'), st(1, 'out_only'), st(2, 'out_only')])).toBe('C');
  });
  it('aucun pôle « aller seulement » : rien', () => {
    expect(lateReturnFocus([pole('A', 1)], [st(0, 'none')])).toBeNull();
  });
});

describe('découverte « Gain vélo + transports en commun » (bike_gain) en clair', () => {
  const bg = (metric: Insight['metric']): Pick<Insight, 'kind' | 'metric' | 'scenario'> => ({
    kind: 'bike_gain',
    scenario: { o: '78551', d: 'd09', b: 60, m: 'bike_transit', vs: null },
    metric,
  });
  it('écart net signé, puis les deux totaux, modes écrits', () => {
    expect(insightMetricLines(bg({ jobs_delta: 2480082, poles_delta: 6, jobs: 3009703, jobs_ref: 529621 }))).toEqual([
      `+6 pôles · +${nb('2 480 082')} postes (écart net face aux transports en commun)`,
      `Aller et retour : ${nb('3 009 703')} postes en vélo + transports en commun, ${nb('529 621')} postes en transports en commun`,
    ]);
    expect(insightMetricLines(bg({ jobs_delta: 10, poles_delta: 1, jobs: 10, jobs_ref: 0 }))[1]).toBe('Aller et retour : 10 postes en vélo + transports en commun, aucun poste en transports en commun');
  });
  it('champs absents : rien d’inventé', () => {
    expect(insightMetricLines(bg({ jobs_delta: null, poles_delta: null }))).toEqual([]);
  });
  it('mode écrit pour chaque découverte', () => {
    expect(insightModeText(bg({ jobs_delta: null, poles_delta: null }))).toBe('Vélo + transports en commun comparé aux transports en commun');
    expect(insightModeText({ kind: 'eclipse', scenario: { o: 'x', d: 'd14', b: 60, m: 'transit', vs: null } })).toBe('Transports en commun');
    // dans une phrase (« En journée-type 9h-17h, en transports en commun, … », contraste du jour) : minuscules
    expect(insightModePhrase({ kind: 'territorial_gap', scenario: { o: 'x', d: 'd09', b: 60, m: 'transit', vs: 'y' } })).toBe('transports en commun');
    expect(insightModePhrase(bg({ jobs_delta: null, poles_delta: null }))).toBe('vélo + transports en commun comparé aux transports en commun');
  });
});

describe('découvertes publiées (public/data/insights.json, 44 astres)', () => {
  // Les id ne sont pas stables d'un export à l'autre : on vérifie la forme, jamais un id précis.
  const file = JSON.parse(readFileSync(new URL('../../public/data/insights.json', import.meta.url), 'utf-8')) as Insight[];
  const meta = JSON.parse(readFileSync(new URL('../../public/data/meta.json', import.meta.url), 'utf-8')) as Meta;
  it('bike_gain : vélo + TC, commune calculée dans ce mode, gain positif, aucune comparaison inter-communes', () => {
    const bike = file.filter((i) => i.kind === 'bike_gain');
    const covered = new Set(meta.mode_coverage?.bike_transit ?? []);
    for (const i of bike) {
      expect(i.scenario.m).toBe('bike_transit');
      expect(i.scenario.vs).toBeNull();
      if (meta.mode_coverage?.bike_transit) expect(covered.has(i.scenario.o)).toBe(true);
      expect(i.metric.jobs_delta ?? 0).toBeGreaterThan(0);
      if (i.metric.jobs != null && i.metric.jobs_ref != null) expect(i.metric.jobs - i.metric.jobs_ref).toBe(i.metric.jobs_delta);
    }
  });
});

describe('découvertes qui jouent leur moment (L-03)', () => {
  const label = (id: string) => ({ d06: '6h-14h', d09: '9h-17h', d14: '14h-22h' })[id] ?? id;
  const mk = (kind: Insight['kind'], sc: Partial<Insight['scenario']>): Pick<Insight, 'kind' | 'scenario'> => ({
    kind,
    scenario: { o: '78358', d: 'd14', b: 60, m: 'transit', vs: null, ...sc },
  });
  it('éclipse : journée de référence, puis journée de la découverte (seule la journée change)', () => {
    const p = insightPlan(mk('eclipse', { compare_day: 'd09' }), label);
    expect(p.verb).toBe('Voir l’éclipse');
    expect(p.subline).toBe('9h-17h, puis 14h-22h');
    expect(p.steps.map((s) => s.day)).toEqual(['d09', 'd14']);
    expect(p.steps[0]).toEqual({ ...p.steps[1], day: 'd09' });
  });
  it('gain : TC + marche, puis vélo + TC (seul le mode change)', () => {
    const p = insightPlan(mk('bike_gain', { m: 'bike_transit', d: 'd09' }), label);
    expect(p.verb).toBe('Voir le gain du vélo');
    expect(p.subline).toBe('Transports en commun, puis vélo + transports en commun');
    expect(p.steps.map((s) => s.mode)).toEqual(['transit', 'bike_transit']);
    expect(p.steps[0]).toEqual({ ...p.steps[1], mode: 'transit' });
  });
  it('deux horizons : le diptyque, annoncé', () => {
    const p = insightPlan(mk('territorial_gap', { vs: '78551' }), label);
    expect(p.verb).toBe('Voir les deux ciels');
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]!.compare).toBe('78551');
  });
  it('aller oui, retour non : la preuve du pôle', () => {
    const p = insightPlan(mk('late_return', {}), label);
    expect(p.verb).toBe('Voir le retour qui manque');
    expect(p.focusLateReturn).toBe(true);
  });
  it('mouvement réduit : la référence n’est pas montrée', () => {
    expect(insightPlan(mk('eclipse', { compare_day: 'd09' }), label, true).steps.map((s) => s.day)).toEqual(['d14']);
    expect(insightPlan(mk('bike_gain', { m: 'bike_transit' }), label, true).steps.map((s) => s.mode)).toEqual(['bike_transit']);
  });
  it('sans référence publiée, rien n’est inventé : une seule étape', () => {
    expect(insightPlan(mk('eclipse', {}), label).steps).toHaveLength(1);
  });
});
