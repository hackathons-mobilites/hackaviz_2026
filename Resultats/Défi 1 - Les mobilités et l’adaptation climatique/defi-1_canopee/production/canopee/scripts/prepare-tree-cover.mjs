/** Approximate summer canopy coverage on each already prepared street segment. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "public", "data");
const rawDir = path.join(root, "data", "raw");
mkdirSync(rawDir, { recursive: true });
const rawFile = path.join(rawDir, "paris-arbres.csv");
const url = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/exports/csv?select=" +
  encodeURIComponent("idbase,hauteurenm,stadedeveloppement,geo_point_2d");
if (!existsSync(rawFile)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Arbres de Paris → ${response.status}`);
  writeFileSync(rawFile, await response.text());
}

const axes = readFileSync(path.join(dataDir, "axes.bin"));
if (axes.toString("ascii", 0, 4) !== "OMB2") throw new Error("axes.bin illisible");
const n = axes.readUInt32LE(40);
let o = 64 + n * 4 * 2;
const ax = new Float32Array(axes.buffer, axes.byteOffset + o, n); o += n * 4;
const ay = new Float32Array(axes.buffer, axes.byteOffset + o, n); o += n * 4;
const bx = new Float32Array(axes.buffer, axes.byteOffset + o, n); o += n * 4;
const by = new Float32Array(axes.buffer, axes.byteOffset + o, n);
const LAT_M = 111132;
const LON_M = 73400;
const CELL_M = 20;
const key = (x, y) => `${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`;
const buckets = new Map();
for (let e = 0; e < n; e++) {
  const k = key(((ax[e] + bx[e]) / 2) * LON_M, ((ay[e] + by[e]) / 2) * LAT_M);
  let list = buckets.get(k);
  if (!list) buckets.set(k, (list = []));
  list.push(e);
}

const current = new Float32Array(n);
const future = new Float32Array(n);
function coveredFraction(edge, lon, lat, radius) {
  const x = (ax[edge] - lon) * LON_M;
  const y = (ay[edge] - lat) * LAT_M;
  const dx = (bx[edge] - ax[edge]) * LON_M;
  const dy = (by[edge] - ay[edge]) * LAT_M;
  const a = dx * dx + dy * dy;
  if (a < 0.01) return 0;
  const b = 2 * (x * dx + y * dy);
  const c = x * x + y * y - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return 0;
  const root = Math.sqrt(discriminant);
  const start = Math.max(0, (-b - root) / (2 * a));
  const end = Math.min(1, (-b + root) / (2 * a));
  return Math.max(0, end - start);
}

let used = 0;
let young = 0;
const lines = readFileSync(rawFile, "utf8").trim().split(/\r?\n/);
const headers = lines.shift().replace(/^\uFEFF/, "").split(";");
const col = Object.fromEntries(headers.map((h, i) => [h, i]));
for (const line of lines) {
  const row = line.split(";");
  const height = Number(row[col.hauteurenm]);
  const coordinates = row[col.geo_point_2d]?.split(", ").map(Number);
  if (!coordinates || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) continue;
  if (!Number.isFinite(height) || height < 2 || height > 40) continue;
  const [lat, lon] = coordinates;
  const isYoung = row[col.stadedeveloppement] === "Jeune (arbre)";
  const todayRadius = Math.max(1.5, Math.min(6, height * 0.3));
  const futureRadius = isYoung ? Math.min(8, todayRadius + 2) : todayRadius;
  const cx = Math.floor((lon * LON_M) / CELL_M);
  const cy = Math.floor((lat * LAT_M) / CELL_M);
  used++;
  if (isYoung) young++;
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      const candidates = buckets.get(`${x},${y}`);
      if (!candidates) continue;
      for (const edge of candidates) {
        const t = coveredFraction(edge, lon, lat, todayRadius);
        if (t > 0) current[edge] += t;
        if (isYoung) {
          const f = coveredFraction(edge, lon, lat, futureRadius);
          if (f > 0) future[edge] += f;
        } else if (t > 0) future[edge] += t;
      }
    }
  }
}

const binary = Buffer.allocUnsafe(8 + n * 2);
binary.write("TREE", 0, 4, "ascii");
binary.writeUInt32LE(n, 4);
let changed = 0;
for (let e = 0; e < n; e++) {
  const a = Math.min(100, Math.round(current[e] * 100));
  const b = Math.min(100, Math.round(future[e] * 100));
  binary[8 + e] = a;
  binary[8 + n + e] = b;
  if (b - a >= 10) changed++;
}
writeFileSync(path.join(dataDir, "tree-cover.bin"), binary);
writeFileSync(path.join(dataDir, "tree-cover.json"), JSON.stringify({
  source: "les-arbres",
  generated: new Date().toISOString().slice(0, 10),
  treesUsed: used,
  youngTrees: young,
  changedSegments: changed,
  assumptions: { radiusFromHeight: "30 % de la hauteur, borné de 1,5 à 6 m", youngGrowthMeters: 2, maxFutureRadiusMeters: 8 },
}));
console.log(`${used} arbres valides, dont ${young} jeunes ; ${changed} tronçons gagnent au moins 10 points de couverture modélisée.`);
