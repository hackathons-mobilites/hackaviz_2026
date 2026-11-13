/**
 * Carte miroir : géographie réelle des communes et des pôles (frontend/public/data/geo/, produit par
 * pipeline/scripts/06b_export_geo.py depuis GEO01 et TRA01). Fonctions PURES sauf le chargement.
 * La carte change la VUE, jamais l'état : les territoires prennent l'état calculé du ciel.
 */
import { geoArea, geoCentroid, geoConicConformal, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import type { PoleStatus } from './accessibility';
import { fetchJson } from './loaders';
import type { Pole } from './types';

export interface CommuneProps {
  insee: string;
  name: string;
}

export interface PoleAreaProps {
  kind: 'pole_area';
  pole_id: string;
  name: string;
  communes: string[];
}

export interface AnchorProps {
  kind: 'anchor';
  pole_id: string;
  stop_id?: string;
  stop_name?: string;
  insee?: string;
  departures?: number;
  service_date?: string;
  method?: string;
}

type Area = Polygon | MultiPolygon;

export interface GeoData {
  communes: Feature<Area, CommuneProps>[];
  poleAreas: Map<string, Feature<Area, PoleAreaProps>>;
  anchors: Map<string, Feature<Point, AnchorProps>>;
  /** Limites de départements, dérivées des contours communaux (arêtes non partagées dans un département) */
  departments: Feature<MultiLineString>;
  source: string;
}

const GEO_BASE = `${import.meta.env.BASE_URL}data/geo/`;
/** Contours des astres (D-030) */
const POLES_GEO_BASE = `${import.meta.env.BASE_URL}data/geo/`;

/** d3-geo attend des anneaux extérieurs dans le sens horaire : on retourne ceux qui couvrent « tout le globe ». */
export function rewind<G extends Area, P>(f: Feature<G, P>): Feature<G, P> {
  if (geoArea(f as unknown as GeoPermissibleObjects) <= 2 * Math.PI) return f;
  const rev = (rings: Position[][]) => rings.map((r) => [...r].reverse());
  const g = f.geometry;
  const geometry = (
    g.type === 'Polygon' ? { ...g, coordinates: rev(g.coordinates) } : { ...g, coordinates: g.coordinates.map(rev) }
  ) as G;
  return { ...f, geometry };
}

function rings(g: Area): Position[][] {
  return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
}

/**
 * Limites de départements : dans chaque département (2 premiers caractères du code INSEE), une arête
 * de contour communal partagée par deux communes est intérieure ; une arête vue une seule fois est une
 * limite. Exact parce que le pipeline simplifie les frontières partagées à l'identique.
 */
export function departmentBorders(communes: readonly Feature<Area, CommuneProps>[]): Feature<MultiLineString> {
  const byDep = new Map<string, Map<string, [Position, Position]>>();
  const counts = new Map<string, number>();
  for (const c of communes) {
    const dep = c.properties.insee.slice(0, 2);
    let edges = byDep.get(dep);
    if (!edges) byDep.set(dep, (edges = new Map()));
    for (const ring of rings(c.geometry)) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[i + 1]!;
        const ka = `${a[0]},${a[1]}`;
        const kb = `${b[0]},${b[1]}`;
        if (ka === kb) continue;
        const key = `${dep}|${ka < kb ? ka : kb}|${ka < kb ? kb : ka}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        edges.set(key, [a, b]);
      }
    }
  }
  const lines: Position[][] = [];
  for (const edges of byDep.values()) {
    for (const [key, seg] of edges) if (counts.get(key) === 1) lines.push(seg);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

export function parseGeo(
  communesFc: FeatureCollection | null,
  polesFc: FeatureCollection | null,
): GeoData | null {
  if (!communesFc || !Array.isArray(communesFc.features)) return null;
  const communes: Feature<Area, CommuneProps>[] = [];
  for (const f of communesFc.features) {
    const t = f.geometry?.type;
    if ((t === 'Polygon' || t === 'MultiPolygon') && typeof f.properties?.insee === 'string') {
      communes.push(rewind(f as unknown as Feature<Area, CommuneProps>));
    }
  }
  const poleAreas = new Map<string, Feature<Area, PoleAreaProps>>();
  const anchors = new Map<string, Feature<Point, AnchorProps>>();
  for (const f of polesFc?.features ?? []) {
    const props = f.properties as { kind?: string; pole_id?: string } | null;
    if (!props?.pole_id || !f.geometry) continue;
    if (props.kind === 'pole_area' && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
      poleAreas.set(props.pole_id, rewind(f as unknown as Feature<Area, PoleAreaProps>));
    } else if (props.kind === 'anchor' && f.geometry.type === 'Point') {
      anchors.set(props.pole_id, f as unknown as Feature<Point, AnchorProps>);
    }
  }
  const source = (communesFc as FeatureCollection & { source?: string }).source ?? 'GEO01 - API Géo (contours des communes)';
  return { communes, poleAreas, anchors, departments: departmentBorders(communes), source };
}

let geoPromise: Promise<GeoData | null> | null = null;

/**
 * Position (lon, lat) du disque d'un astre sur la carte miroir.
 * 44 astres (D-030) : centre géographique (centroïde du contour) de la COMMUNE qui donne son nom à l'astre
 * (`name_short_insee`, géométrie de `geo/communes.geojson`) : on lit ainsi le nom du rond sur la commune citée.
 * Le centroïde de la zone entière l'éloignait de cette commune (Poissy 15,1 km, Cergy 13,5, Provins 12,5,
 * Fontainebleau 11,5) ; pour les 20 arrondissements (une seule commune par astre) rien ne change. Repli :
 * centroïde de la zone, puis arrêt d'affichage. Paramètre `_astres44` : encore passé par `MirrorMap.tsx`, sans effet.
 */
export function poleDiscLonLat(
  geo: Pick<GeoData, 'communes' | 'poleAreas' | 'anchors'>,
  pole: Pick<Pole, 'id' | 'name_short_insee' | 'point'>,
  _astres44: boolean,
  communeByInsee: ReadonlyMap<string, Feature<Area, CommuneProps>> = new Map(geo.communes.map((f) => [f.properties.insee, f])),
): [number, number] {
  const commune = pole.name_short_insee ? communeByInsee.get(pole.name_short_insee) : undefined;
  const centre = commune ?? geo.poleAreas.get(pole.id);
  if (centre) return geoCentroid(centre as GeoPermissibleObjects) as [number, number];
  const anchor = geo.anchors.get(pole.id);
  return anchor ? (anchor.geometry.coordinates as [number, number]) : [pole.point.lon, pole.point.lat];
}

/** Chargement tolérant (une fois) : null si les fichiers geo/ ne sont pas encore publiés. */
export function loadGeo(fetcher: typeof fetch = fetch): Promise<GeoData | null> {
  if (!geoPromise) {
    geoPromise = Promise.all([
      fetchJson<FeatureCollection>(`${GEO_BASE}communes.geojson`, fetcher),
      fetchJson<FeatureCollection>(`${POLES_GEO_BASE}poles.geojson`, fetcher),
    ]).then(([c, p]) => parseGeo(c, p));
    // un échec n'est pas mémorisé : on retentera à la prochaine ouverture
    void geoPromise.then((g) => {
      if (!g) geoPromise = null;
    });
  }
  return geoPromise;
}

/**
 * Lambert-93 (EPSG:2154, IGN) : conique conforme, parallèles 44° N et 49° N, méridien central 3° E.
 * Cadrée sur le même cadre que le ciel.
 */
export function mirrorProjection(
  geo: Pick<GeoData, 'communes'>,
  frame: { x: number; y: number; w: number; h: number },
): GeoProjection {
  const fc = { type: 'FeatureCollection', features: geo.communes } as unknown as Parameters<GeoProjection['fitExtent']>[1];
  return geoConicConformal()
    .parallels([44, 49])
    .rotate([-3, 0])
    .fitExtent(
      [
        [frame.x, frame.y],
        [frame.x + frame.w, frame.y + frame.h],
      ],
      fc,
    );
}

/**
 * Longueur écran (px) de `km` kilomètres, mesurée sur la projection autour de (lon, lat) :
 * 1° de longitude = 111,32 km × cos(latitude) (ellipsoïde ramené à la sphère, écart < 0,5 % ici).
 */
export function scaleBarPx(projection: GeoProjection, lon: number, lat: number, km: number): number | null {
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const a = projection([lon, lat]);
  const b = projection([lon + dLon, lat]);
  if (!a || !b) return null;
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * États du ciel, mêmes formes sur la carte : plein (accessible), tirets (hors budget), trait mixte
 * (aller possible, retour hors budget), points (non calculé), neutre.
 */
export type TerritoryKind = 'accessible' | 'out_only' | 'off' | 'unknown' | 'neutral';

export function territoryKind(status: PoleStatus | undefined, neutral: boolean): TerritoryKind {
  if (neutral) return 'neutral';
  if (status === 'accessible') return 'accessible';
  if (status === 'out_only') return 'out_only';
  if (status === 'none') return 'off';
  return 'unknown';
}

/** Réexporté depuis stopName.ts (module sans d3-geo, utilisé par le panneau de preuve). */
export { stopNameFromMethod } from './stopName';
