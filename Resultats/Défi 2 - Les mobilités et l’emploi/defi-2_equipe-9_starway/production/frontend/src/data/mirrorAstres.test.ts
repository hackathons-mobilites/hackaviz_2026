/**
 * Carte miroir, 44 astres (D-030) : le disque d'un astre est posé au centre de la commune qui le nomme
 * (`name_short_insee`), lu dans les fichiers publiés (`poles.json` du ciel des 44 astres, `geo/communes.geojson`).
 * Aucun chiffre écrit ici : tout vient des données.
 */
import { existsSync, readFileSync } from 'node:fs';
import { geoCentroid, geoContains, geoDistance } from 'd3-geo';
import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { computeFrame, datasetBounds, makeRadius } from '../sky/layout';
import { mirror } from '../theme/tokens';
import { mirrorProjection, parseGeo, poleDiscLonLat } from './geo';
import type { Commune, Pole } from './types';

const read = <T,>(rel: string): T | null => {
  const url = new URL(`../../public/data/${rel}`, import.meta.url);
  return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf-8')) as T) : null;
};

const poles44 = read<Pole[]>('poles.json');
const communesFc = read<FeatureCollection>('geo/communes.geojson');
const polesFc44 = read<FeatureCollection>('geo/poles.geojson');
const communes = read<Commune[]>('communes.json');
const geo = communesFc && polesFc44 ? parseGeo(communesFc, polesFc44) : null;
const EARTH_KM = 6371.0088;

describe.skipIf(!poles44 || !geo || !communes)('disque d’un astre sur la carte (D-030)', () => {
  it('name_short_insee appartient à l’astre pour les 44 astres, et sa géométrie est publiée', () => {
    expect(poles44!).toHaveLength(44);
    const known = new Set(geo!.communes.map((f) => f.properties.insee));
    for (const p of poles44!) {
      expect(p.name_short_insee, p.id).toBeTruthy();
      expect(p.communes, `${p.id} : la commune qui nomme l'astre doit en faire partie`).toContain(p.name_short_insee);
      expect(known.has(p.name_short_insee!), `${p.id} : géométrie de ${p.name_short_insee}`).toBe(true);
    }
  });

  it('le disque est au centre de la commune qui nomme l’astre ; les astres d’une seule commune restent centrés', () => {
    const byInsee = new Map(geo!.communes.map((f) => [f.properties.insee, f]));
    for (const p of poles44!) {
      const [lon, lat] = poleDiscLonLat(geo!, p, true);
      const c = geoCentroid(byInsee.get(p.name_short_insee!)!);
      expect(geoDistance([lon, lat], c) * EARTH_KM, p.id).toBeLessThan(1e-6);
      if (p.communes.length === 1) {
        const zone = geoCentroid(geo!.poleAreas.get(p.id)!);
        expect(geoDistance([lon, lat], zone) * EARTH_KM, `${p.id} : une seule commune`).toBeLessThan(0.01);
      }
    }
  });

  it('mesure : écart au centroïde de la zone, centre dans la commune, disques qui se touchent à la vue par défaut', () => {
    const byInsee = new Map(geo!.communes.map((f) => [f.properties.insee, f]));
    const far = poles44!
      .map((p) => {
        const [lon, lat] = poleDiscLonLat(geo!, p, true);
        const zone = geoCentroid(geo!.poleAreas.get(p.id)!);
        return { id: p.id, name: p.name_short, km: geoDistance([lon, lat], zone) * EARTH_KM };
      })
      .sort((a, b) => b.km - a.km);
    const outside = poles44!.filter((p) => !geoContains(byInsee.get(p.name_short_insee!)!, poleDiscLonLat(geo!, p, true))).map((p) => p.name_short);
    // vue d'ensemble 1600 x 900 : cadre de la carte approché (1180 x 700), rayons du ciel x discScale comme MirrorMap
    const proj = mirrorProjection(geo!, { x: 24, y: 120, w: 1180, h: 700 });
    const skyFrame = computeFrame(1600, 900, 128, datasetBounds({ communes: communes!, poles: poles44! }));
    const radius = makeRadius(poles44!, skyFrame);
    const pts = poles44!.map((p) => ({ xy: proj(poleDiscLonLat(geo!, p, true))!, r: radius(p.jobs) * mirror.discScale }));
    let touching = 0;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i]!.xy[0] - pts[j]!.xy[0], pts[i]!.xy[1] - pts[j]!.xy[1]) < pts[i]!.r + pts[j]!.r) touching++;
    console.info(
      `écart au centre de la zone : ${far.slice(0, 5).map((f) => `${f.name} ${f.km.toFixed(1)} km`).join(', ')} ; centre hors de sa commune : ${outside.length ? outside.join(', ') : 'aucun'} ; disques qui se touchent (1600 x 900, vue d'ensemble) : ${touching}`,
    );
    expect(pts.every((p) => Number.isFinite(p.xy[0]) && Number.isFinite(p.xy[1]))).toBe(true);
  });
});
