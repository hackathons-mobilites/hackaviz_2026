/**
 * Télécharge les bâtiments et les tronçons BD TOPO du département 75.
 * Les pages déjà écrites sont reprises. Rien n’est simplifié ici.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "data", "raw", "paris");
mkdirSync(path.join(dir, "bat"), { recursive: true });
mkdirSync(path.join(dir, "rue"), { recursive: true });

const boundaryFile = path.join(dir, "departement.json");
if (!existsSync(boundaryFile)) {
  const response = await fetch("https://geo.api.gouv.fr/communes/75056?fields=contour&format=geojson&geometry=contour");
  if (!response.ok) throw new Error(`contour de Paris → ${response.status}`);
  const feature = await response.json();
  if (feature.geometry?.type === "Polygon") {
    feature.geometry = { type: "MultiPolygon", coordinates: [feature.geometry.coordinates] };
  }
  if (feature.geometry?.type !== "MultiPolygon") throw new Error("contour de Paris invalide");
  writeFileSync(boundaryFile, JSON.stringify({ type: "FeatureCollection", features: [feature] }));
}

const meteoFile = path.join(root, "data", "raw", "H_75_latest.csv.gz");
if (!existsSync(meteoFile)) {
  const response = await fetch("https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/HOR/H_75_latest-2025-2026.csv.gz");
  if (!response.ok) throw new Error(`données Météo-France → ${response.status}`);
  writeFileSync(meteoFile, Buffer.from(await response.arrayBuffer()));
}

const BBOX = "2.224217,48.815562,2.469851,48.902148,EPSG:4326";
const COUNT = 1000;
const PARALLEL = 16;

const layers = [
  {
    name: "bat",
    type: "BDTOPO_V3:batiment",
    props: "hauteur,geometrie",
  },
  {
    name: "rue",
    type: "BDTOPO_V3:troncon_de_route",
    props: "geometrie,nom_voie_ban_gauche,nom_voie_ban_droite,insee_commune_gauche,insee_commune_droite,position_par_rapport_au_sol,prive,importance,nature,fictif",
  },
];

function pageUrl(layer, start) {
  const q = [
    "SERVICE=WFS",
    "VERSION=2.0.0",
    "REQUEST=GetFeature",
    `TYPENAMES=${layer.type}`,
    `BBOX=${BBOX}`,
    "SRSNAME=EPSG:4326",
    `COUNT=${COUNT}`,
    `STARTINDEX=${start}`,
    "OUTPUTFORMAT=application/json",
    `PROPERTYNAME=${layer.props}`,
  ].join("&");
  return `https://data.geopf.fr/wfs/ows?${q}`;
}

function isCached(file) {
  if (!existsSync(file) || statSync(file).size < 200) return false;
  const head = readFileSync(file, "utf8").slice(0, 80);
  return head.includes("{") && head.includes("Feature");
}

async function pull(url, file) {
  if (isCached(file)) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    return json;
  }
  let last = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "ombre-paris/1.0 (hackathon mobilites)" } });
    if (res.status === 429 || res.status >= 500) {
      last = `${res.status}`;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const text = await res.text();
    if (!text.includes('"features"')) {
      last = text.slice(0, 180);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    writeFileSync(file, text);
    return JSON.parse(text);
  }
  throw new Error(`abandon ${file} (${last})`);
}

async function pool(jobs, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      await worker(job);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, run));
}

for (const layer of layers) {
  const first = await pull(pageUrl(layer, 0), path.join(dir, layer.name, "000000.json"));
  const matched = first.numberMatched ?? first.features.length;
  const pages = Math.ceil(matched / COUNT);
  console.log(`${layer.name} ${matched} objets, ${pages} pages`);
  let done = 1;
  const jobs = [];
  for (let i = 1; i < pages; i++) jobs.push(i);
  const t0 = Date.now();
  await pool(jobs, async (i) => {
    const start = i * COUNT;
    const file = path.join(dir, layer.name, `${String(start).padStart(6, "0")}.json`);
    const json = await pull(pageUrl(layer, start), file);
    done++;
    if (done % 10 === 0 || done === pages) {
      const min = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`${layer.name} ${done}/${pages} (${min} min)`);
    }
    if (!json.features) throw new Error(`page vide ${file}`);
  });
  console.log(`${layer.name} terminé`);
}
