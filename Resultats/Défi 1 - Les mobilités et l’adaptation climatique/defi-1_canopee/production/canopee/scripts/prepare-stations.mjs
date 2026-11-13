/** Relie les gares et stations IDFM aux rues ombragées et lieux frais de Paris. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "../src/router.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public", "data");
const scene = JSON.parse(readFileSync(path.join(dir, "scene.json"), "utf8"));
const amenities = JSON.parse(readFileSync(path.join(dir, "amenities.json"), "utf8"));
const binary = (name) => {
  const b = readFileSync(path.join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
function inParis(lon, lat) {
  const ring = scene.ring;
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
const router = createRouter(binary("axes.bin"), inParis, binary("tree-cover.bin"));
const source = "emplacement-des-gares-idf-data-generalisee";
const base = `https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/${source}/records`;
const rows = [];
for (let offset = 0; ; offset += 100) {
  const response = await fetch(`${base}?limit=100&offset=${offset}`);
  if (!response.ok) throw new Error(`Stations IDFM → ${response.status}`);
  const page = await response.json();
  rows.push(...page.results);
  if (rows.length >= page.total_count) break;
}

const water = amenities.features.filter((f) => f.properties.category === "water").map((f) => f.geometry.coordinates);
const cool = amenities.features
  .filter((f) => f.properties.category === "park" || (f.properties.category === "cool" && f.properties.free))
  .map((f) => f.geometry.coordinates);
const distance = (a, b) => Math.hypot((a[0] - b[0]) * 73400, (a[1] - b[1]) * 111132);
const nearest = (point, locations) => Math.round(Math.min(...locations.map((p) => distance(point, p))));
const seen = new Set();
const features = [];
for (const row of rows) {
  const lon = row.geo_point_2d?.lon;
  const lat = row.geo_point_2d?.lat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inParis(lon, lat)) continue;
  const id = String(row.id_ref_zdc || row.codeunique || row.nom_zdc);
  if (seen.has(id)) continue;
  seen.add(id);
  const point = [lon, lat];
  const shades = (season, future) => scene.hours.map((_, i) => {
    const value = router.shadeAround(lon, lat, 250, i, season, future);
    return value == null ? null : Math.round(value * 100);
  });
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: point },
    properties: {
      id,
      name: row.nom_zdc || row.nom_long || "Station",
      mode: row.mode || "Transport ferré",
      waterMeters: nearest(point, water),
      coolMeters: nearest(point, cool),
      shadeToday: shades("ete", false),
      shadeFuture: shades("ete", true),
      shadeWinter: shades("hiver", false),
    },
  });
}
features.sort((a, b) => a.properties.name.localeCompare(b.properties.name, "fr"));
const data = {
  type: "FeatureCollection",
  source,
  updated: new Date().toISOString().slice(0, 10),
  method: { radiusMeters: 250, waterThresholdMeters: 350, coolThresholdMeters: 300, shadeThresholdPercent: 40 },
  features,
};
writeFileSync(path.join(dir, "stations.json"), JSON.stringify(data));
const at16 = scene.hours.indexOf(16);
const exposed = features.filter((f) => f.properties.shadeToday[at16] < 40).length;
const farWater = features.filter((f) => f.properties.waterMeters > 350).length;
console.log(`${features.length} stations parisiennes ; ${exposed} sous 40 % d’ombre à 16 h ; ${farWater} à plus de 350 m d’une fontaine.`);
