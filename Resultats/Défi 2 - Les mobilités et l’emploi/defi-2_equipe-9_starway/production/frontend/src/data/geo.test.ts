import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { departmentBorders, mirrorProjection, parseGeo, rewind, scaleBarPx, stopNameFromMethod, territoryKind, type CommuneProps } from './geo';

// Deux carrés contigus dans le 93 et un dans le 94, anneaux dans le sens horaire (convention d3).
const sq = (insee: string, x: number, y: number): Feature<Polygon, CommuneProps> => ({
  type: 'Feature',
  properties: { insee, name: insee },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x, y + 0.1],
        [x + 0.1, y + 0.1],
        [x + 0.1, y],
        [x, y],
      ],
    ],
  },
});

const communes = [sq('93001', 2.4, 48.9), sq('93002', 2.5, 48.9), sq('94001', 2.4, 48.8)];

describe('géographie de la carte miroir', () => {
  it('remet les anneaux dans le sens attendu par d3-geo', () => {
    const ccw: Feature<Polygon, CommuneProps> = {
      ...communes[0]!,
      geometry: { type: 'Polygon', coordinates: [[...communes[0]!.geometry.coordinates[0]!].reverse()] },
    };
    expect(rewind(ccw).geometry.coordinates[0]).toEqual(communes[0]!.geometry.coordinates[0]);
    expect(rewind(communes[0]!)).toBe(communes[0]);
  });

  it('limites de départements = arêtes non partagées dans un département', () => {
    const b = departmentBorders(communes);
    // 93 : 2 carrés accolés → 6 arêtes extérieures ; 94 : 4 arêtes
    expect(b.geometry.coordinates).toHaveLength(10);
    const shared = b.geometry.coordinates.some(
      ([a, c]) => a![0] === 2.5 && c![0] === 2.5 && Math.min(a![1]!, c![1]!) === 48.9,
    );
    expect(shared).toBe(false);
  });

  it('lit les fichiers du pipeline et tolère leur absence', () => {
    expect(parseGeo(null, null)).toBeNull();
    const fc: FeatureCollection = { type: 'FeatureCollection', features: communes as unknown as Feature[] };
    const poles: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { ...sq('x', 2.4, 48.9), properties: { kind: 'pole_area', pole_id: 'P_A', name: 'A', communes: ['93001'] } },
        { type: 'Feature', properties: { kind: 'anchor', pole_id: 'P_A', stop_name: 'Gare' }, geometry: { type: 'Point', coordinates: [2.45, 48.95] } },
      ],
    };
    const g = parseGeo(fc, poles)!;
    expect(g.communes).toHaveLength(3);
    expect(g.poleAreas.get('P_A')?.properties.name).toBe('A');
    expect(g.anchors.get('P_A')?.properties.stop_name).toBe('Gare');
    expect(parseGeo(fc, null)!.poleAreas.size).toBe(0);
  });

  it('projection cadrée sur le cadre du ciel, nord en haut', () => {
    const p = mirrorProjection({ communes }, { x: 100, y: 50, w: 800, h: 600 });
    const north = p([2.45, 48.99])!;
    const south = p([2.45, 48.81])!;
    expect(north[1]).toBeLessThan(south[1]);
    for (const c of [north, south]) {
      expect(c[0]).toBeGreaterThanOrEqual(100);
      expect(c[0]).toBeLessThanOrEqual(900);
    }
    const px = scaleBarPx(p, 2.45, 48.9, 10)!;
    expect(px).toBeGreaterThan(0);
  });

  it('mêmes états que le ciel', () => {
    expect(territoryKind('accessible', false)).toBe('accessible');
    expect(territoryKind('out_only', false)).toBe('out_only');
    expect(territoryKind('none', false)).toBe('off');
    expect(territoryKind('unknown', false)).toBe('unknown');
    expect(territoryKind('accessible', true)).toBe('neutral');
  });

  it("nom de l'arrêt de référence lu dans point.method", () => {
    expect(
      stopNameFromMethod('arrêt le plus desservi le 17/11/2026 (7262 départs) : Gare Saint-Lazare (IDFM:71370, GTFS IDFM)'),
    ).toBe('Gare Saint-Lazare');
    expect(stopNameFromMethod("arrêt le plus desservi le 17/11/2026 (1158 départs) : Noisy-le-Grand - Mont d'Est (IDFM:412697, GTFS IDFM)")).toBe(
      "Noisy-le-Grand - Mont d'Est",
    );
    expect(stopNameFromMethod('démo')).toBeNull();
  });
});
