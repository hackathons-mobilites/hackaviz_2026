import { describe, expect, it } from 'vitest';
import type { FamilyRow } from './bmo';
import { recruitChartRows } from './recruitChart';

const fam = (code: string, n: number | null, masked = 0, bar = 0): FamilyRow => ({ code, label: `Famille ${code}`, cell: n == null ? null : { n, masked }, bar });

describe('recruitChartRows (projets de recrutement par famille)', () => {
  const rows = [fam('a', 100, 0, 100 / 900), fam('b', 900, 3, 1), fam('c', null), fam('d', 400, 0, 400 / 900), fam('e', 400, 0, 400 / 900)];
  const m = recruitChartRows(rows, 'd');

  it('trie de la plus grande à la plus petite ; égalité dans l’ordre du fichier ; non diffusé en dernier', () => {
    expect(m.map((r) => r.code)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });

  it('le bout est estompé seulement pour « au moins » (cases « * » non comptées)', () => {
    expect(m.find((r) => r.code === 'b')!.atLeast).toBe(true);
    expect(m.find((r) => r.code === 'a')!.atLeast).toBe(false);
    expect(m.find((r) => r.code === 'b')!.phrase).toBe('au moins 900');
  });

  it('une famille non diffusée n’a pas de barre : la ligne l’écrit, jamais 0', () => {
    const c = m.find((r) => r.code === 'c')!;
    expect(c).toMatchObject({ n: null, bar: 0, phrase: 'non diffusé', atLeast: false });
    expect(c.sentence).toBe('Famille c : non diffusé.');
  });

  it('la famille choisie dans le sélecteur est repérée ; la phrase reprend le texte de la liste', () => {
    expect(m.filter((r) => r.selected).map((r) => r.code)).toEqual(['d']);
    expect(m[0]!.sentence).toBe('Famille b : au moins 900 projets de recrutement.');
    for (const r of m) expect(r.sentence).not.toMatch(/[\u2013\u2014]/);
  });
});
