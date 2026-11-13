import { describe, expect, it } from 'vitest';
import { extent, rankAmong, rankSentence, stripJitter, valueOf } from './incomeRank';

const nb = (s: string | null) => s?.replace(/\u00a0/g, ' ') ?? null;
const entries: [string, number][] = [
  ['A', 20000],
  ['B', 30000],
  ['C', 40000],
  ['D', 50000],
  ['E', 40000],
];

describe('halo, niveau de vie : la commune parmi les autres (retour du 03/11)', () => {
  it('rang parmi les AUTRES communes, égalités ni au-dessus ni au-dessous', () => {
    expect(rankAmong(entries, 'C', 40000)).toEqual({ others: 4, below: 2, above: 1 });
    expect(rankAmong(entries, 'Z', 40000)).toEqual({ others: 5, below: 2, above: 1 });
  });
  it('phrase du côté le plus nombreux, part arrondie à l’entier inférieur', () => {
    expect(nb(rankSentence('median', rankAmong(entries, 'C', 40000)))).toBe(
      "Niveau de vie médian plus élevé que 50 % des 4 autres communes et arrondissements d'Île-de-France dont le niveau de vie médian est publié.",
    );
    expect(nb(rankSentence('poverty', rankAmong(entries, 'B', 30000)))).toBe(
      "Taux de pauvreté plus bas que 75 % des 4 autres communes et arrondissements d'Île-de-France où le taux de pauvreté est publié.",
    );
  });
  it('extrêmes : « le plus élevé » / « le plus bas », jamais « 100 % »', () => {
    expect(nb(rankSentence('median', rankAmong(entries, 'D', 50000)))).toBe(
      "Niveau de vie médian le plus élevé des 5 communes et arrondissements d'Île-de-France dont le niveau de vie médian est publié.",
    );
    expect(nb(rankSentence('poverty', rankAmong(entries, 'A', 20000)))).toMatch(/^Taux de pauvreté le plus bas des 5 /);
    const many: [string, number][] = Array.from({ length: 300 }, (_, i) => [`c${i}`, i < 299 ? 1 : 2]);
    expect(nb(rankSentence('median', rankAmong(many, 'x', 1.5)))).toContain('plus élevé que 99 %');
  });
  it('aucune autre commune : pas de phrase', () => {
    expect(rankSentence('median', rankAmong([['A', 1]], 'A', 1))).toBeNull();
  });
  it('valeur absente (secret statistique) : null, jamais zéro', () => {
    expect(valueOf(entries, 'B')).toBe(30000);
    expect(valueOf(entries, 'Q')).toBeNull();
  });
  it('bornes de l’axe et hauteur des points sans donnée, dans [0, 1)', () => {
    expect(extent(entries)).toEqual([20000, 50000]);
    expect(extent([])).toBeNull();
    for (let i = 0; i < 2000; i++) {
      const j = stripJitter(i);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(1);
    }
  });
});
