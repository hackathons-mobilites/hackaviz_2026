import { describe, expect, it } from 'vitest';
import { GUIDE_CATEGORIES, GUIDE_ENTRIES } from './guide.manifest';
import { filterGuide, normalizeSearch } from './guideSearch';

describe("recherche de l'aide", () => {
  it('ignore les accents, les tirets et la casse', () => {
    expect(normalizeSearch('Vélo-Transports')).toBe('velo transports');
    expect(normalizeSearch("  L'Écran  ")).toBe('l ecran');
  });

  it("vide : toutes les entrées, dans l'ordre du manifeste", () => {
    const all = filterGuide(GUIDE_CATEGORIES, GUIDE_ENTRIES, '').flatMap((s) => s.entries);
    expect(all.map((e) => e.id).sort()).toEqual(GUIDE_ENTRIES.map((e) => e.id).sort());
  });

  it('trouve une entrée par son titre, sans accent', () => {
    const ids = filterGuide(GUIDE_CATEGORIES, GUIDE_ENTRIES, 'daltonisme').flatMap((s) => s.entries.map((e) => e.id));
    expect(ids).toContain('daltonisme');
  });

  it('exige tous les mots, et ne garde que les catégories qui ont un résultat', () => {
    const sections = filterGuide(GUIDE_CATEGORIES, GUIDE_ENTRIES, 'poste nuit');
    expect(sections.flatMap((s) => s.entries.map((e) => e.id))).toContain('poste-nuit');
    expect(filterGuide(GUIDE_CATEGORIES, GUIDE_ENTRIES, 'xyzzy')).toEqual([]);
  });
});
