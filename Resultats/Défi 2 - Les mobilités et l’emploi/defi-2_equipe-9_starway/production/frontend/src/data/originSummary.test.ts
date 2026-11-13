import { describe, expect, it } from 'vitest';
import { demoPoles } from './demo/generateDemo';
import { demoUsesRealPoles, NO_ORIGIN_LABEL, originGroups } from './originSummary';

const methods = { gravity: 'centre de gravité de la population', nearest_inhabited: 'carreau habité le plus proche' };

describe('point de départ (communes[].origin)', () => {
  it('compte chaque méthode publiée, libellé lu dans meta.origin_methods', () => {
    const g = originGroups(
      [{ origin: { lon: 0, lat: 0, method: 'gravity' } }, { origin: { lon: 0, lat: 0, method: 'gravity' } }, { origin: { lon: 0, lat: 0, method: 'nearest_inhabited' } }],
      methods,
    );
    expect(g).toEqual([
      { method: 'gravity', label: methods.gravity, count: 2 },
      { method: 'nearest_inhabited', label: methods.nearest_inhabited, count: 1 },
    ]);
  });
  it('aucun origin publié : centre de la commune (API Géo)', () => {
    expect(originGroups([{ origin: null }, {}], methods)).toEqual([{ method: null, label: NO_ORIGIN_LABEL, count: 2 }]);
  });
  it('méthode sans libellé publié : le code brut, jamais un libellé deviné', () => {
    expect(originGroups([{ origin: { lon: 0, lat: 0, method: 'x' } }], {})[0]!.label).toBe('méthode « x »');
  });
});

describe('démo sur le vrai ciel', () => {
  it('pôles générés : postes fictifs ; pôles réels : postes réels', () => {
    expect(demoUsesRealPoles(demoPoles())).toBe(false);
    expect(demoUsesRealPoles(demoPoles().map((p) => ({ ...p, jobs_source: 'EMP01' })))).toBe(true);
  });
});
