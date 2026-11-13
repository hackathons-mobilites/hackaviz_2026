/** Export the map's own overview hexagons for the lightweight narrative. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "../src/router.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "public/data");
const readJson = name => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const round = (value, precision = 4) => Number(value.toFixed(precision));

function readBinary(name) {
  let bytes;
  if (existsSync(path.join(directory, name))) {
    bytes = readFileSync(path.join(directory, name));
  } else {
    const manifest = readJson(name + ".parts.json");
    const parts = Array.from({ length: manifest.parts }, (_, index) =>
      readFileSync(path.join(directory, name + ".part" + String(index).padStart(3, "0"))),
    );
    bytes = gunzipSync(Buffer.concat(parts));
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Kept importable so the test can compare the exported frames to the live model. */
export function loadHexSource() {
  const scene = readJson("scene.json");
  function inside(longitude, latitude) {
    let result = false;
    for (let i = 0, j = scene.ring.length - 1; i < scene.ring.length; j = i++) {
      const a = scene.ring[i], b = scene.ring[j];
      if ((a[1] > latitude) !== (b[1] > latitude) &&
          longitude < (b[0] - a[0]) * (latitude - a[1]) / (b[1] - a[1]) + a[0]) {
        result = !result;
      }
    }
    return result;
  }
  const router = createRouter(readBinary("axes.bin"), inside, readBinary("tree-cover.bin"));
  return { scene, router };
}

export function hexId(ring) {
  // The exact same ring is generated at every hour; this stable position key
  // also lets missing hours remain null instead of changing cell order.
  return ring[0].map(value => value.toFixed(6)).join(",");
}

export function prepareStoryHex({ scene, router }) {
  const hours = scene.hours.filter(hour => hour >= 7 && hour <= 21);
  const cells = new Map();
  const hourly = hours.map((hour, hourIndex) => {
    const features = router.overviewCollection(scene.hours.indexOf(hour), "ete", false).features;
    let lowShade = 0;
    for (const feature of features) {
      const ring = feature.geometry.coordinates[0];
      const id = hexId(ring);
      if (!cells.has(id)) {
        cells.set(id, {
          id,
          ring: ring.map(point => point.map(value => round(value, 6))),
          shade: Array(hours.length).fill(null),
        });
      }
      const shade = feature.properties.s;
      cells.get(id).shade[hourIndex] = round(shade);
      if (shade < 0.4) lowShade++;
    }
    const known = features.length;
    return { hour, known, lowShade, lowShadePercent: known ? round(100 * lowShade / known, 1) : null };
  });
  return {
    generated: new Date().toISOString().slice(0, 10),
    date: scene.date,
    hours,
    ring: scene.ring,
    method: {
      source: "src/router.js, overviewCollection(hourIndex, ete, false)",
      dataSources: ["IGN BD TOPO", "Ville de Paris, arbres recensés"],
      radiusMeters: 260,
      minKnownSegments: 8,
      season: "ete",
      view: "today",
      shadePrecision: 4,
      meaning: "Part moyenne d’ombre des rues calculées, bâtiments et canopée, selon les mêmes regroupements que la carte.",
      cellWeighting: "Moyennes des groupes de rues pondérées par leur nombre de segments, comme overviewCollection.",
      statisticWeighting: "Chaque secteur compte une fois. Ces pourcentages ne décrivent pas les stations ni la superficie de Paris.",
      lowShadeThreshold: 0.4,
      statisticsPrecision: "Le seuil est appliqué aux valeurs du modèle avant leur arrondi à quatre décimales.",
      missing: "null indique une cellule absente du calcul pour cette heure, jamais une ombre nulle.",
      interpretation: "La couleur ne représente pas une température. Les images entre deux heures peuvent interpoler visuellement les couleurs, sans constituer de nouveaux calculs.",
    },
    cells: [...cells.values()],
    hourly,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = prepareStoryHex(loadHexSource());
  const serialized = JSON.stringify(data);
  writeFileSync(path.join(directory, "story-hex.json"), serialized);
  console.log(JSON.stringify({
    cells: data.cells.length,
    frames: data.hours.length,
    bytes: Buffer.byteLength(serialized),
    at16: data.hourly.find(frame => frame.hour === 16),
  }));
}
