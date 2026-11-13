import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haloPalette, haloPaletteCv } from '../theme/tokens';
import { arcLabels, buildHalo, commuteDotRows, haloPairs, HALO_DIMENSIONS, intervalsOverlap, modeColors, pairSideText, sexShareLine, stripCensusParen, toSegments } from './halo';

describe('halo sans mode sources (D-033, lot 6)', () => {
  it('le dénominateur garde son effectif, pas le nom du recensement', () => {
    expect(stripCensusParen('population totale (RP, exploitation principale) : 23 093 habitants')).toBe('population totale : 23 093 habitants');
    expect(stripCensusParen('personnes des ménages fiscaux (définition INSEE)')).toBe('personnes des ménages fiscaux (définition INSEE)');
  });
});
import type { ContextFile } from './types';

const montreuil = JSON.parse(
  readFileSync(new URL('../../public/data/context/93048.json', import.meta.url), 'utf-8'),
) as ContextFile;

describe('halo', () => {
  it('segments proportionnels et contigus', () => {
    const s = toSegments([
      { value: 25, color: 'a' },
      { value: 75, color: 'b' },
    ]);
    expect(s).toEqual([
      { start: 0, end: 0.25, color: 'a' },
      { start: 0.25, end: 1, color: 'b' },
    ]);
  });
  it('sexe : un anneau, légende chiffrée, dénominateur explicite', () => {
    const h = buildHalo(montreuil, 'sex');
    expect(h.hidden).toBeNull();
    expect(h.rings).toHaveLength(1);
    expect(h.legend.map((l) => l.label)).toEqual(['Femmes', 'Hommes']);
    expect(h.denominator).toContain('population');
    expect(h.year).toBe(2023);
  });
  it('modes par sexe : deux anneaux', () => {
    expect(buildHalo(montreuil, 'commute').rings).toHaveLength(2);
  });
  it('bloc non « ok » : masqué avec une mention', () => {
    const ctx: ContextFile = { ...montreuil, population_sex: { ...montreuil.population_sex!, status: 'secret' } };
    const h = buildHalo(ctx, 'sex');
    expect(h.rings).toHaveLength(0);
    expect(h.hidden).toMatch(/secret statistique/);
    expect(buildHalo(null, 'income').hidden).toBeTruthy();
  });
});

describe('marges d’erreur du recensement', () => {
  it('part affichée avec sa marge', () => {
    const h = buildHalo(montreuil, 'commute');
    const tc = h.legend.find((l) => l.label === 'Transports en commun' && l.group?.startsWith('Femmes'));
    expect(tc?.margin).toMatch(/^\u00b1\u00a0\d+(,\d)?\u00a0pt$/);
    expect(tc?.imprecise).toBe(false);
  });
  it('marge inconnue ou ≥ part : part conservée, signalée imprécise, arc atténué', () => {
    const b = montreuil.commute_mode_by_sex!;
    const ctx: ContextFile = {
      ...montreuil,
      commute_mode_by_sex: { ...b, margin95: { F: { ...b.margin95!.F, bike: null }, H: { ...b.margin95!.H, walk: 99 } } },
    };
    const h = buildHalo(ctx, 'commute');
    const bike = h.legend.find((l) => l.label === 'Vélo' && l.group?.startsWith('Femmes'));
    const walk = h.legend.find((l) => l.label === 'Marche' && l.group?.startsWith('Hommes'));
    expect(bike?.imprecise).toBe(true);
    expect(bike?.value).toBeTruthy();
    expect(walk?.imprecise).toBe(true);
    expect(h.rings[0]!.segments[2]!.alpha).toBeLessThan(1);
  });
});

describe('écart femmes / hommes au seuil de 95 %', () => {
  it('intervalles part ± marge', () => {
    expect(intervalsOverlap(62.8, 2.3, 51.5, 1.9)).toBe(false);
    expect(intervalsOverlap(10.1, 0.6, 11.5, 0.7)).toBe(false);
    expect(intervalsOverlap(10.1, 1, 11.5, 1)).toBe(true);
    expect(intervalsOverlap(10, null, 11, 1)).toBeNull();
  });
  it('niveau de vie : taux de pauvreté en anneau, médiane en chiffre (jamais en arc)', () => {
    const h = buildHalo(montreuil, 'income');
    expect(h.hidden).toBeNull();
    expect(h.rings).toHaveLength(1);
    expect(h.rings[0]!.segments[0]!.end).toBeCloseTo(montreuil.income!.poverty_rate! / 100);
    expect(h.legend.map((l) => l.label)).toEqual(['Taux de pauvreté']);
    expect(h.stat?.value).toMatch(/€ par an$/);
    expect(h.denominator).toContain('ménages fiscaux');
    expect(h.guard).toMatch(/ni d.une cause/);
  });
  it('niveau de vie en secret statistique : piste pointillée, aucune valeur', () => {
    const ctx: ContextFile = {
      ...montreuil,
      income: { ...montreuil.income!, status: 'secret', median_status: 'secret', poverty_rate_status: 'secret' },
    };
    const h = buildHalo(ctx, 'income');
    expect(h.hidden).toMatch(/secret statistique/);
    expect(h.rings[0]!.segments).toEqual([{ start: 0, end: 1, color: expect.any(String), dotted: true }]);
    expect(h.legend).toHaveLength(0);
  });
  it("valeur au bout de l'arc du taux de pauvreté", () => {
    const h = buildHalo(montreuil, 'income');
    expect(h.rings[0]!.endLabel).toBe(h.legend[0]!.value);
  });
  it('diptyque : « A : x · B : y » par catégorie, secret signalé sans valeur', () => {
    const a = buildHalo(montreuil, 'sex');
    const secret: ContextFile = { ...montreuil, population_sex: { ...montreuil.population_sex!, status: 'secret' } };
    const pairs = haloPairs(a, buildHalo(secret, 'sex'));
    expect(pairs.map((p) => p.label)).toEqual(['Femmes', 'Hommes']);
    expect(pairs[0]!.a).toBe(a.legend[0]!.value);
    expect(pairs[0]!.b).toBe('non diffusé (secret statistique)');
    const inc = haloPairs(buildHalo(montreuil, 'income'), buildHalo(montreuil, 'income'));
    expect(inc[0]!.label).toMatch(/niveau de vie médian/);
    expect(inc[0]!.a).toBe(inc[0]!.b);
  });
  it('diptyque : marges de A et de B, et « estimation imprécise » des deux côtés (audit)', () => {
    const base = montreuil.commute_mode_by_sex!;
    const ctxA: ContextFile = {
      ...montreuil,
      commute_mode_by_sex: { ...base, F: { ...base.F, transit: 40 }, margin95: { F: { ...base.margin95?.F, transit: 2 }, H: { ...base.margin95?.H } } },
    };
    const ctxB: ContextFile = {
      ...montreuil,
      commute_mode_by_sex: { ...base, F: { ...base.F, transit: 3 }, margin95: { F: { ...base.margin95?.F, transit: 4 }, H: { ...base.margin95?.H } } },
    };
    const pairs = haloPairs(buildHalo(ctxA, 'commute'), buildHalo(ctxB, 'commute'));
    const tf = pairs.find((p) => p.label === 'Transports en commun' && /Femmes/.test(p.group ?? ''))!;
    expect(tf.aMargin).toBeDefined();
    expect(tf.aImprecise).toBeUndefined();
    expect(tf.bImprecise).toBe(true);
    const nb = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ');
    expect(nb(pairSideText(tf.a, tf.aMargin, tf.aImprecise))).toBe('40 % ± 2 pt');
    expect(nb(pairSideText(tf.b, tf.bMargin, tf.bImprecise))).toBe('3 % (estimation imprécise, ± 4 pt)');
  });
});

describe('halo v2 (L-08 à L-10)', () => {
  it('trois onglets du contexte, plus de « Population par sexe », puis le quatrième « Chômage » (D-048)', () => {
    expect(HALO_DIMENSIONS.slice(0, 3).map((d) => d.id)).toEqual(['age', 'commute', 'income']);
    expect(HALO_DIMENSIONS.map((d) => d.id)).toEqual(['age', 'commute', 'income', 'unemployment']);
    expect(HALO_DIMENSIONS[3]!.label).toBe('Chômage');
  });
  it('la répartition par sexe devient une phrase, tirée du bloc population_sex', () => {
    const b = montreuil.population_sex!;
    const line = sexShareLine(montreuil)!;
    expect(line).toContain('de femmes');
    expect(line).toContain(String(b.year));
    expect(sexShareLine({ ...montreuil, population_sex: { ...b, status: 'secret' } })).toBeNull();
  });
  it('noms autour de l’anneau, au milieu de chaque arc, jamais superposés d’un même côté', () => {
    const segs = [
      { start: 0, end: 0.5 },
      { start: 0.5, end: 0.52 },
      { start: 0.52, end: 0.54 },
      { start: 0.54, end: 1 },
    ];
    const labels = arcLabels(segs, segs.map((_, i) => ({ name: `n${i}`, value: `${i}` })), 100, 30);
    // premier arc : milieu à 3 h (droite)
    expect(labels[0]!.x).toBeCloseTo(100);
    expect(labels[0]!.anchor).toBe('start');
    const left = labels.filter((l) => l.x < 0).sort((a, b) => a.y - b.y);
    for (let i = 1; i < left.length; i++) expect(left[i]!.y - left[i - 1]!.y).toBeGreaterThanOrEqual(30);
  });
  it('constellation : une ligne par mode, femmes et hommes sur le même axe, marges conservées', () => {
    const rows = commuteDotRows(montreuil);
    expect(rows.length).toBeGreaterThan(0);
    const b = montreuil.commute_mode_by_sex!;
    const transit = rows.find((r) => r.mode === 'transit')!;
    expect(transit.f).toBe(b.F.transit ?? null);
    expect(transit.h).toBe(b.H.transit ?? null);
    expect(commuteDotRows({ ...montreuil, commute_mode_by_sex: { ...b, status: 'secret' } })).toEqual([]);
  });
});

describe('halo en mode daltonien (couleurs adaptées)', () => {
  it('seules les couleurs des modes changent : mêmes anneaux, mêmes fractions, mêmes valeurs', () => {
    const n = buildHalo(montreuil, 'commute');
    const cv = buildHalo(montreuil, 'commute', true);
    const strip = (h: typeof n) => ({
      ...h,
      rings: h.rings.map((r) => ({ ...r, segments: r.segments.map((s) => ({ ...s, color: '' })) })),
      legend: h.legend.map((l) => ({ ...l, color: '' })),
    });
    expect(strip(cv)).toEqual(strip(n));
    expect(cv.legend.find((l) => l.label === 'Vélo')?.color).toBe(haloPaletteCv.bike);
    expect(n.legend.find((l) => l.label === 'Vélo')?.color).toBe(haloPalette.bike);
    expect(modeColors(true)).toEqual(haloPaletteCv);
  });
  it('âges et revenus : aucune couleur ne change', () => {
    for (const dim of ['age', 'income'] as const) expect(buildHalo(montreuil, dim, true)).toEqual(buildHalo(montreuil, dim));
  });
});
