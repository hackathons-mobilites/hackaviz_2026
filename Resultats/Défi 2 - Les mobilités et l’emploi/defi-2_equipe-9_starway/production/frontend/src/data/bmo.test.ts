import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  detailText,
  familyRows,
  isBmoFile,
  LIMITS,
  maskedPhrase,
  methodText,
  projectsPhrase,
  recruitLineText,
  recruitView,
  regionText,
  scopeCells,
  scopeText,
  seasonalText,
  starLimit,
  trendText,
  trendTipLines,
  type BmoCells,
  type BmoFile,
} from './bmo';
import { formatInt } from './format';
import { bassinPart, codePart } from './provenance';
import type { Pole, SourceEntry } from './types';

/**
 * Projets de recrutement BMO (D-035) : contrôles sur les données PUBLIÉES (frontend/public/data), pas sur des
 * fixtures. La mise en ligne est automatique à la fusion sur main : aucun chiffre faux, aucun écran cassé.
 */
const read = <T,>(rel: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${rel}`, import.meta.url), 'utf-8')) as T;
const exists = (rel: string): boolean => {
  try {
    readFileSync(new URL(`../../public/data/${rel}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

const file = read<BmoFile>('bmo.json');
const sources = read<SourceEntry[]>('sources.json');
/** Jeu d'astres publié (44 astres) */
const SKY_FILES = ['poles.json'].filter(exists);
const sky = (rel: string) => read<Pole[]>(rel);

const cell = (n: number | null, masked: number) => ({ n, masked });

describe('contrat bmo-1', () => {
  it('le fichier publié est reconnu, une autre forme est refusée', () => {
    expect(isBmoFile(file)).toBe(true);
    expect(isBmoFile(null)).toBe(false);
    expect(isBmoFile('<!doctype html>')).toBe(false);
    expect(isBmoFile({ ...file, contract: 'bmo-2' })).toBe(false);
    // ancienne publication sans le libellé de « * » : refusée (le bloc dit « non disponible »)
    const withoutMasked: Partial<BmoFile> = { ...file };
    delete withoutMasked.masked;
    expect(isBmoFile(withoutMasked)).toBe(false);
    expect(isBmoFile({ ...file, bassins: { x: { name: 'x', total: { met: cell(1, 0) }, families: {} } } })).toBe(false);
    expect(isBmoFile({ ...file, region: { ...file.region, published: { ...file.region.published, met: cell(1.5, 0) } } })).toBe(false);
  });

  it('25 bassins, 8 familles, millésime 2026, total officiel au-dessus de la somme publiée', () => {
    expect(Object.keys(file.bassins)).toHaveLength(25);
    expect(file.families).toHaveLength(8);
    expect(file.year).toBe(2026);
    expect(file.region.official.projects).toBe(388806);
    expect(file.region.published.met.n!).toBeLessThan(file.region.official.projects);
    expect(file.region.published.met.masked).toBe(645);
  });

  it("le total d'un bassin est la somme de ses familles (publiées et « * »)", () => {
    for (const b of Object.values(file.bassins)) {
      for (const m of ['met', 'xmet', 'smet'] as const) {
        const fam = Object.values(b.families).map((f) => f[m]);
        expect(b.total[m].n ?? 0).toBe(fam.reduce((s, c) => s + (c.n ?? 0), 0));
        expect(b.total[m].masked).toBe(fam.reduce((s, c) => s + c.masked, 0));
      }
    }
  });
});

describe('phrases : minimum, jamais 0', () => {
  it('au moins n tant qu\'une case « * » n\'est pas comptée, n seul sinon, non diffusé si aucune case', () => {
    expect(projectsPhrase(cell(32926, 22))).toBe('au moins 32\u00a0926');
    expect(projectsPhrase(cell(1679, 0))).toBe('1\u00a0679');
    expect(projectsPhrase(cell(null, 3))).toBe('non diffusé');
    expect(projectsPhrase(null)).toBe('non diffusé');
    expect(projectsPhrase(cell(null, 3))).not.toMatch(/^0$|\b0\b/);
    expect(maskedPhrase(cell(5, 0), file.masked)).toBeNull();
    expect(maskedPhrase(cell(5, 1), file.masked)).toBe('1 case « * » : non diffusé par France Travail (vraisemblablement moins de 5 projets)');
    expect(maskedPhrase(cell(5, 22), file.masked)).toBe('22 cases « * » : non diffusé par France Travail (vraisemblablement moins de 5 projets)');
  });

  it('exemple de Nicolas : 20 + 10 + « * » donne « au moins 30 », jamais 30 tout court', () => {
    expect(projectsPhrase(cell(30, 1))).toBe('au moins 30');
    const t4 = file.bassins['1146']!.total.met;
    expect(t4.masked).toBeGreaterThan(0);
    expect(projectsPhrase(t4)).toBe(`au moins ${formatInt(t4.n!)}`);
  });

  it('détail : difficiles et saisonniers avec les mêmes réserves, ou non diffusés', () => {
    const c = { met: cell(100, 0), xmet: cell(30, 2), smet: cell(null, 1) } as BmoCells;
    expect(detailText(c)).toBe('Dont au moins 30 jugés difficiles.');
    expect(detailText({ ...c, xmet: cell(null, 1) })).toBe('Difficiles et saisonniers : non diffusés.');
  });

  it('ligne du pli fermé (audit du 11/11, P36) : total et « dont au moins » difficiles, la réserve au « i » (en clair en mode sources)', () => {
    const t4 = file.bassins['1146']!.total;
    const line = recruitLineText(file.year, t4);
    expect(line).toBe(`Projets de recrutement ${file.year} du bassin : ${projectsPhrase(t4.met)}, dont ${projectsPhrase(t4.xmet)} jugés difficiles.`);
    expect(line).toContain('dont au moins');
    expect(line).not.toContain('ni des offres publiées');
    expect(recruitLineText(file.year, t4, true)).toBe(
      `Projets de recrutement ${file.year} du bassin : ${projectsPhrase(t4.met)}, dont ${projectsPhrase(t4.xmet)} jugés difficiles : ni des offres publiées, ni des embauches.`,
    );
    // sans « * » : pas de « au moins » ; difficiles non diffusés : pas de « dont »
    const c = { met: cell(100, 0), xmet: cell(30, 0), smet: cell(null, 1) } as BmoCells;
    expect(recruitLineText(2026, c)).toBe('Projets de recrutement 2026 du bassin : 100, dont 30 jugés difficiles.');
    expect(recruitLineText(2026, { ...c, xmet: cell(null, 2) })).toBe('Projets de recrutement 2026 du bassin : 100.');
    expect(line).not.toMatch(/[\u2013\u2014]|\bnull\b|NaN/);
  });

  it('« i » de la ligne : la tendance mot pour mot, réserve comprise (sans mode sources) ; saisonniers', () => {
    const tip = trendTipLines(2026);
    expect(tip.join(' ')).toBe(trendText(2026));
    expect(tip.join(' ')).toContain('ni des offres publiées, ni des embauches');
    // mode sources : la réserve est écrite dans la ligne, la bulle ne la redit pas
    expect(trendTipLines(2026, false).join(' ')).toBe(trendText(2026).replace(' : ni des offres publiées, ni des embauches.', '.'));
    expect(tip.join(' ')).not.toContain('dont au moins');
    const t4 = file.bassins['1146']!.total;
    expect(seasonalText(t4)).toBe(`Projets saisonniers : ${projectsPhrase(t4.smet)}.`);
    expect(seasonalText({ ...t4, smet: cell(null, 1) })).toBe('Projets saisonniers : non diffusé.');
  });

  it('« * » est une déduction : libellé validé, note, preuve sur les 53 786 lignes du fichier', () => {
    expect(file.masked.label).toBe('non diffusé par France Travail (vraisemblablement moins de 5 projets)');
    expect(file.masked.note).toMatch(/^Déduction de l'équipe/);
    expect(file.masked.note).toMatch(/ne définit pas le sens de « \* »/);
    expect(file.masked.evidence).toMatchObject({ rows: 53786, published_below_threshold: 0, threshold: 5 });
    expect(file.masked.evidence!.min_published).toEqual({ met: 5, xmet: 5, smet: 5 });
    expect(file.masked.note).toContain(formatInt(53786));
    const star = starLimit(file.masked);
    expect(star).toContain(file.masked.label);
    expect(star).toMatch(/Déduction/);
    expect(star).toMatch(/minimums/);
  });

  it("l'intérim : la limite dit que la source ne répond pas et que l'équipe n'a pas la réponse, sans rien affirmer", () => {
    const interim = LIMITS.find((t) => /intérim/.test(t))!;
    expect(interim).toMatch(/ni la page méthode/i);
    expect(interim).toMatch(/l'équipe n'a pas la réponse/);
    expect(interim).not.toMatch(/est compté\.|n'est pas compté|inclus|exclu/);
  });

  it('la méthode dit la somme, « * » non compté, « non diffusé » et jamais 0', () => {
    const m = methodText(file.masked);
    expect(m).toMatch(/^Méthode/);
    expect(m).toContain(file.masked.label);
    expect(m).toMatch(/au moins n/);
    expect(m).toMatch(/jamais 0/);
  });

  it('les textes disent « tendance », « intentions », ni offres ni embauches, sans tiret long ni « null »', () => {
    const all = [trendText(2026), scopeText(1), scopeText(20), regionText(file), methodText(file.masked), starLimit(file.masked), ...LIMITS].join('\n');
    expect(trendText(2026)).toMatch(/tendance/);
    expect(trendText(2026)).toMatch(/intentions/);
    expect(trendText(2026)).toMatch(/ni des offres publiées, ni des embauches/);
    expect(trendText(2026)).toMatch(/fin 2025/);
    expect(all).not.toMatch(/[\u2013\u2014]/);
    expect(all).not.toMatch(/\bnull\b|undefined|NaN/);
    // jamais « postes vacants » ou « emplois disponibles » ; « offres » seulement pour dire ce que ce n'est pas
    expect(all).not.toMatch(/postes vacants|emplois disponibles|offres d.emploi/i);
    expect(scopeText(1)).not.toMatch(/couvre/);
    expect(scopeText(20)).toMatch(/couvre 20 astres/);
  });
});

describe('rattachement aux astres (clé = bassin d\'emploi GEO04)', () => {
  it('chaque astre qui porte un bassin a ses données, au libellé GEO04 ; les autres : non disponible', () => {
    expect(SKY_FILES.length).toBeGreaterThan(0);
    for (const rel of SKY_FILES) {
      const poles = sky(rel);
      for (const p of poles) {
        const v = recruitView(file, p, poles);
        if (p.bassin) {
          expect(v.status, `${rel} ${p.id}`).toBe('ok');
          if (v.status === 'ok') expect(v.bassin.name).toBe(p.bassin.name);
        } else {
          expect(v.status, `${rel} ${p.id}`).toBe('no_bassin');
        }
      }
    }
  });

  it('le jeu des 44 astres : 24 bassins + les 20 arrondissements de Paris (un seul bassin, 1107)', () => {
    const rel = ['preview-d030/poles.json', 'poles.json'].find((r) => exists(r) && sky(r).length === 44);
    if (!rel) return; // jeu de 44 astres non publié sous ce nom
    const poles = sky(rel);
    const codes = poles.map((p) => p.bassin?.code);
    expect(new Set(codes).size).toBe(25);
    const paris = poles.filter((p) => p.bassin?.code === '1107');
    expect(paris).toHaveLength(20);
    const v = recruitView(file, paris[0]!, poles);
    expect(v.status === 'ok' && v.astres).toBe(20);
    expect(scopeText(20)).toMatch(/20 astres/);
    const t4 = poles.find((p) => p.bassin?.code === '1146')!;
    const vt4 = recruitView(file, t4, poles);
    expect(vt4.status === 'ok' && vt4.astres).toBe(1);
  });

  it('chiffres de la proposition (docs/etude-bmo.md) : T1 Paris et T4 Paris Ouest La Défense', () => {
    expect(file.bassins['1107']!.name).toBe('T1 Paris');
    expect(file.bassins['1107']!.total.met).toEqual(cell(118850, 6));
    expect(file.bassins['1146']!.total.met.n).toBe(32926);
    expect(file.bassins['1153']!.total.met).toEqual(cell(1679, 22));
    const rows = familyRows(file, file.bassins['1146']!);
    expect(rows).toHaveLength(8);
    expect(Math.max(...rows.map((r) => r.bar))).toBe(1);
    expect(scopeCells(file.bassins['1146']!, 'V')).not.toBeNull();
    expect(scopeCells(file.bassins['1146']!, 'Q')).toBeNull();
  });
});

describe('provenance (D-033)', () => {
  it('la source lue dans sources.json dit le jeu, le millésime et le code ; le bassin vient de GEO04', () => {
    const tag = codePart(sources, 'EMP03')!.tags[0]!;
    expect(tag.text).toBe('France Travail BMO 2026 (EMP03)');
    expect(tag.anchor).toBeTruthy();
    const withBassin = bassinPart(sources, [{ bassin: { code: '1146', name: 'T4 Paris Ouest La Défense', source: 'GEO04 - France Travail, bassins d\'emploi 2026' } }]);
    expect(withBassin?.tags.map((t) => t.code)).toContain('GEO04');
    // astre sans bassin : aucune source de bassin
    expect(bassinPart(sources, [{}])).toBeNull();
  });
});
