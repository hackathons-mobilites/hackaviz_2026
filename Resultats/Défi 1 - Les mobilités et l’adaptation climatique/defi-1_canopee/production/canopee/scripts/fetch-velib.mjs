import { readFile, writeFile } from "node:fs/promises";

const dataset = "velib-emplacement-des-stations";
const sourceUrl = `https://opendata.paris.fr/explore/dataset/${dataset}/`;
const response = await fetch(
  `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/${dataset}/exports/json`,
);
if (!response.ok) throw new Error(`Open Data Paris → ${response.status}`);
const rows = await response.json();
const { ring } = JSON.parse(await readFile(new URL("../public/data/scene.json", import.meta.url), "utf8"));

function inParis(lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i];
    const [px, py] = ring[j];
    if ((y > lat) !== (py > lat) && lon < x + (px - x) * (lat - y) / (py - y)) inside = !inside;
  }
  return inside;
}

const stations = new Map();
for (const { stationcode, name, capacity, coordonnees_geo } of rows) {
  const { lon, lat } = coordonnees_geo ?? {};
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inParis(lon, lat)) continue;
  if (!stationcode || !name || stations.has(stationcode)) throw new Error("Station Vélib incomplète ou en double");
  stations.set(stationcode, {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { category: "velib", name, code: stationcode, capacity },
  });
}

if (!stations.size) throw new Error("Aucune station Vélib dans le contour de Paris");
const features = [...stations.values()].sort((a, b) => a.properties.code.localeCompare(b.properties.code, "fr"));
const metadata = {
  type: "FeatureCollection",
  source: dataset,
  sourceUrl,
  producer: "Smovengo / Syndicat Autolib’ Vélib’ Métropole",
  licence: "ODbL",
  updated: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", dateStyle: "short" }).format(),
};
const geojson = `${JSON.stringify(metadata).slice(0, -1)},"features":[\n${features.map((feature) => JSON.stringify(feature)).join(",\n")}\n]}\n`;
await writeFile(new URL("../public/data/velib.json", import.meta.url), geojson);
console.log(`${features.length} stations Vélib dans le contour de Paris (${rows.length} dans l’export).`);
