import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "data");
mkdirSync(outDir, { recursive: true });
const scene = JSON.parse(readFileSync(path.join(outDir, "scene.json"), "utf8"));
const [[west, south], [east, north]] = scene.bounds;

async function records(host, id) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const url = `https://${host}/api/explore/v2.1/catalog/datasets/${id}/records?limit=100&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${id} → ${response.status}`);
    const page = await response.json();
    rows.push(...page.results);
    if (rows.length >= page.total_count) return rows;
  }
}

function inside([lon, lat]) {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

function point(row, category, source, extra = {}) {
  const geo = row.geo_point_2d;
  if (!geo || !inside([geo.lon, geo.lat])) return null;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [geo.lon, geo.lat] },
    properties: {
      category,
      name: row.nom || row.modele || category,
      address: row.adresse || row.voie || "",
      source,
      ...extra,
    },
  };
}

const fountains = await records("opendata.paris.fr", "fontaines-a-boire");
const equipment = await records("opendata.paris.fr", "ilots-de-fraicheur-equipements-activites");
const parks = await records("opendata.paris.fr", "ilots-de-fraicheur-espaces-verts-frais");
const lines = await records("data.iledefrance-mobilites.fr", "projets_lignes_idf");

const features = [
  ...fountains
    .filter((row) => row.dispo === "OUI")
    .map((row) => point(row, "water", "fontaines-a-boire", { model: row.modele || "" })),
  ...equipment.map((row) =>
    point(row, "cool", "ilots-de-fraicheur-equipements-activites", {
      kind: row.type || "",
      free: row.payant === "Non",
      opening: row.horaires_periode || "",
    }),
  ),
  ...parks
    .filter((row) => row.p_vegetation_h >= 0.25)
    .filter((row) => !/Décorations|Jardinets|privatifs|non parisiens/i.test(row.type || ""))
    .map((row) =>
      point(row, "park", "ilots-de-fraicheur-espaces-verts-frais", {
        kind: row.type || "",
        canopy: row.p_vegetation_h,
        opening: row.horaires_periode || "",
      }),
    ),
].filter(Boolean);

const projectFeatures = lines
  .filter((row) => {
    const year = Number((row.mes_estime || "").slice(0, 4));
    if (year < 2027 || year > 2036) return false;
    const geometry = row.geo_shape?.geometry;
    if (!geometry || !["LineString", "MultiLineString"].includes(geometry.type)) return false;
    const points = geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();
    return points.some(inside);
  })
  .map((row) => ({
    type: "Feature",
    geometry: row.geo_shape.geometry,
    properties: {
      name: row.operation || row.nom_projet,
      year: Number(row.mes_estime.slice(0, 4)),
      status: row.statut || "",
      source: "projets_lignes_idf",
    },
  }));

const collection = {
  type: "FeatureCollection",
  updated: new Date().toISOString().slice(0, 10),
  features,
};
writeFileSync(path.join(outDir, "amenities.json"), JSON.stringify(collection));
writeFileSync(
  path.join(outDir, "projects.json"),
  JSON.stringify({ type: "FeatureCollection", features: projectFeatures }),
);

const METERS_LAT = 111_132;
const METERS_LON = 73_400;
function distance(a, b) {
  return Math.hypot((a[0] - b[0]) * METERS_LON, (a[1] - b[1]) * METERS_LAT);
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a[1] > lat) !== (b[1] > lat)) {
      const x = ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0];
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

const water = features.filter((f) => f.properties.category === "water").map((f) => f.geometry.coordinates);
const refuge = features
  .filter((f) => f.properties.category === "park" || (f.properties.category === "cool" && f.properties.free))
  .map((f) => f.geometry.coordinates);
const gaps = [];
const stepLon = 350 / METERS_LON;
const stepLat = 350 / METERS_LAT;
for (let lat = south + stepLat / 2; lat < north; lat += stepLat) {
  for (let lon = west + stepLon / 2; lon < east; lon += stepLon) {
    if (!inRing(lon, lat, scene.ring)) continue;
    const nearestWater = Math.min(...water.map((p) => distance([lon, lat], p)));
    const nearestRefuge = Math.min(...refuge.map((p) => distance([lon, lat], p)));
    const waterGap = nearestWater > 350;
    const refugeGap = nearestRefuge > 600;
    if (!waterGap && !refugeGap) continue;
    gaps.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        waterGap,
        refugeGap,
        nearestWater: Math.round(nearestWater),
        nearestRefuge: Math.round(nearestRefuge),
        priority: Number(waterGap) + Number(refugeGap),
      },
    });
  }
}
writeFileSync(
  path.join(outDir, "gaps.json"),
  JSON.stringify({ type: "FeatureCollection", cellMeters: 350, features: gaps }),
);
console.log(
  `équipements : ${features.length}, projets transport : ${projectFeatures.length}, mailles avec manque : ${gaps.length}`,
);
