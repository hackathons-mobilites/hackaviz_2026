/**
 * Ombre des immeubles sur les axes du département 75.
 * Hauteurs IGN BD TOPO uniquement : une emprise sans hauteur ne projette rien.
 * Pas d’arbres, pas de hauteur par défaut.
 *
 * Entrées : data/raw/paris/bat/*.json, data/raw/paris/rue/*.json,
 * data/raw/paris/departement.json (produits par scripts/fetch-paris.mjs).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { degrees, sunPosition } from "../src/sun.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(root, "data", "raw", "paris");
const outDir = path.join(root, "public", "data");
mkdirSync(outDir, { recursive: true });

const SOUTH = 48.81556224;
const NORTH = 48.90214759;
const WEST = 2.22421717;
const EAST = 2.46985107;
const LAT0 = (SOUTH + NORTH) / 2;
const M_LAT = 111132.92 - 559.82 * Math.cos((2 * LAT0 * Math.PI) / 180);
const M_LON = 111412.84 * Math.cos((LAT0 * Math.PI) / 180);
const RES = 2;
const MARGIN = 200;
const COARSE = 8;
const MAX_SHADOW = 180;
const MIN_ALT = (0.5 * Math.PI) / 180;
const SUN_LAT = 48.8566;
const SUN_LON = 2.3522;
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const STEP = 6;
const CHUNK = 80;

const WIDTH_M = (EAST - WEST) * M_LON;
const HEIGHT_M = (NORTH - SOUTH) * M_LAT;
const GW = Math.ceil((WIDTH_M + 2 * MARGIN) / RES);
const GH = Math.ceil((HEIGHT_M + 2 * MARGIN) / RES);
const CW = Math.ceil((WIDTH_M + 2 * MARGIN) / COARSE);
const CH = Math.ceil((HEIGHT_M + 2 * MARGIN) / COARSE);

function marchOn(grid, width, height, ix, iy, sinAz, cosAz, tan10) {
  for (let d = RES; d <= MAX_SHADOW; d += RES) {
    const px = ix + (d * sinAz) / RES;
    const py = iy + (d * cosAz) / RES;
    if (px < 0 || py < 0 || px >= width || py >= height) return false;
    const dm = grid[(py | 0) * width + (px | 0)];
    if (dm >= 20 && dm >= d * tan10) return true;
  }
  return false;
}

function selfTest() {
  const w = 80;
  const h = 80;
  const grid = new Uint16Array(w * h);
  grid[40 * w + 40] = 200;
  const tan10 = Math.tan(Math.PI / 4) * 10;
  const north = marchOn(grid, w, h, 40, 50, 0, -1, tan10);
  const south = marchOn(grid, w, h, 40, 30, 0, -1, tan10);
  if (!north || south) throw new Error(`test d’ombre raté : nord=${north} sud=${south}`);
  const noon = sunPosition(new Date(Date.UTC(2026, 5, 25, 12, 0, 0)), SUN_LAT, SUN_LON);
  if (degrees(noon.altitude) < 50) throw new Error("hauteur de soleil inattendue");
  console.log("test d’ombre ok");
}

function pages(name) {
  const dir = path.join(rawDir, name);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(dir, file));
}

function toCell(lon, lat) {
  return [((lon - WEST) * M_LON + MARGIN) / COARSE, ((lat - SOUTH) * M_LAT + MARGIN) / COARSE];
}

function fillValue(grid, width, height, rings, value, merge) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const yA = Math.max(0, Math.ceil(minY - 0.5));
  const yB = Math.min(height - 1, Math.floor(maxY - 0.5));
  for (let y = yA; y <= yB; y++) {
    const py = y + 0.5;
    const xs = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        let x0 = ring[i][0];
        let y0 = ring[i][1];
        const n = ring[(i + 1) % ring.length];
        let x1 = n[0];
        let y1 = n[1];
        if (y0 === y1) continue;
        if (y0 > y1) {
          const tx = x0;
          const ty = y0;
          x0 = x1;
          y0 = y1;
          x1 = tx;
          y1 = ty;
        }
        if (py < y0 || py >= y1) continue;
        xs.push(x0 + ((x1 - x0) * (py - y0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    const row = y * width;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xL = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xR = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xL; x <= xR; x++) {
        const id = row + x;
        if (merge) merge(id, value);
        else grid[id] = value;
      }
    }
  }
}

function dilate(source) {
  const R = Math.ceil(MAX_SHADOW / COARSE);
  const horiz = new Uint8Array(CW * CH);
  for (let y = 0; y < CH; y++) {
    const row = y * CW;
    let last = -1e9;
    for (let x = 0; x < CW; x++) {
      if (source[row + x] === 2) last = x;
      if (x - last <= R) horiz[row + x] = source[row + x] === 2 ? 2 : 1;
    }
    last = 1e9;
    for (let x = CW - 1; x >= 0; x--) {
      if (source[row + x] === 2) last = x;
      if (last - x <= R && horiz[row + x] === 0) horiz[row + x] = 1;
      if (source[row + x] === 2) horiz[row + x] = 2;
    }
  }
  const out = new Uint8Array(CW * CH);
  for (let x = 0; x < CW; x++) {
    let last = -1e9;
    for (let y = 0; y < CH; y++) {
      const i = y * CW + x;
      if (horiz[i] > 0) last = y;
      if (y - last <= R) out[i] = horiz[i] === 2 ? 2 : 1;
    }
    last = 1e9;
    for (let y = CH - 1; y >= 0; y--) {
      const i = y * CW + x;
      if (horiz[i] > 0) last = y;
      if (last - y <= R && out[i] === 0) out[i] = 1;
      if (horiz[i] === 2) out[i] = 2;
    }
  }
  return out;
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function zoneOf(cover, lon, lat) {
  const [x, y] = toCell(lon, lat);
  const cx = x | 0;
  const cy = y | 0;
  if (cx < 0 || cy < 0 || cx >= CW || cy >= CH) return 0;
  return cover[cy * CW + cx];
}

function footprintZone(cover, rings) {
  let zone = 0;
  for (const ring of rings) {
    const step = Math.max(1, Math.floor(ring.length / 8));
    for (let i = 0; i < ring.length; i += step) zone = Math.max(zone, zoneOf(cover, ring[i][0], ring[i][1]));
  }
  return zone;
}

function simplifyRing(ring) {
  const out = [];
  let last = null;
  const closed =
    ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const stop = closed ? ring.length - 1 : ring.length;
  for (let i = 0; i < stop; i++) {
    const c = ring[i];
    if (last) {
      const dx = (c[0] - last[0]) * M_LON;
      const dy = (c[1] - last[1]) * M_LAT;
      if (dx * dx + dy * dy < 1.4) continue;
    }
    out.push(c);
    last = c;
  }
  if (out.length > 80) {
    const slim = [];
    const stride = Math.ceil(out.length / 80);
    for (let i = 0; i < out.length; i += stride) slim.push(out[i]);
    return slim;
  }
  return out;
}

function growBuffer(buf, offset, extra) {
  if (offset + extra <= buf.length) return buf;
  const next = Buffer.alloc(Math.max(buf.length * 2, offset + extra));
  buf.copy(next, 0, 0, offset);
  return next;
}

selfTest();

console.log(
  `grille ${GW}×${GH} px (${((GW * GH * 2) / 1e6).toFixed(0)} Mo), emprise ${WIDTH_M.toFixed(0)}×${HEIGHT_M.toFixed(0)} m`,
);

const departement = JSON.parse(readFileSync(path.join(rawDir, "departement.json"), "utf8"));
const ring = departement.features[0].geometry.coordinates[0][0];
const cover0 = new Uint8Array(CW * CH);
fillValue(cover0, CW, CH, [ring.map((c) => toCell(c[0], c[1]))], 2);
const cover = dilate(cover0);
let insideCells = 0;
for (let i = 0; i < cover.length; i++) if (cover[i] === 2) insideCells++;
console.log(`cellules Paris ${(insideCells * COARSE * COARSE / 1e6).toFixed(1)} km²`);
if (insideCells < 1_000_000 || insideCells > 2_200_000) {
  throw new Error(`masque du département inattendu : ${insideCells} cellules`);
}
if (zoneOf(cover, 2.3499, 48.853) !== 2) throw new Error("Notre-Dame hors du masque");
if (zoneOf(cover, 2.1, 48.85) !== 0) throw new Error("un point hors 75 est dans le masque");

const height = new Uint16Array(GW * GH);
const heightCache = path.join(rawDir, "height.u16");
const coverCache = path.join(rawDir, "cover.u8");
const streetsOnly = process.env.STREETS_ONLY === "1" && existsSync(heightCache) && existsSync(coverCache);
if (streetsOnly) {
  const hb = readFileSync(heightCache);
  height.set(new Uint16Array(hb.buffer, hb.byteOffset, GW * GH));
  const cb = readFileSync(coverCache);
  cover.set(new Uint8Array(cb.buffer, cb.byteOffset, CW * CH));
  console.log("grilles rechargées, bâtiments sautés");
}
const batFiles = pages("bat");
if (!batFiles.length) throw new Error("aucun bâtiment téléchargé");
let fetched = 0;
let withHeight = 0;
let unknown = 0;
let drawnKnown = 0;
let drawnUnknown = 0;
let painted = 0;
const batChunks = [];
let batBytes = 0;

function writeBat(parts, dm) {
  let bytes = 3;
  for (const part of parts) {
    bytes += 1;
    for (const r of part) bytes += 2 + r.length * 8;
  }
  let buf = Buffer.alloc(bytes);
  let o = 0;
  buf.writeUInt16LE(dm, o);
  o += 2;
  buf[o++] = parts.length;
  for (const part of parts) {
    buf[o++] = part.length;
    for (const r of part) {
      buf.writeUInt16LE(r.length, o);
      o += 2;
      for (const c of r) {
        buf.writeInt32LE(Math.round(c[0] * 1e6), o);
        buf.writeInt32LE(Math.round(c[1] * 1e6), o + 4);
        o += 8;
      }
    }
  }
  batChunks.push(buf);
  batBytes += buf.length;
}

console.log("bâtiments…");
if (!streetsOnly) for (const file of batFiles) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  for (const feature of json.features) {
    fetched++;
    const polys = polygonsOf(feature.geometry);
    if (!polys.length) continue;
    const zone = footprintZone(
      cover,
      polys.map((poly) => poly[0]),
    );
    if (!zone) continue;
    const h = feature.properties.hauteur;
    const known = Number.isFinite(h) && h >= 2;
    if (known) withHeight++;
    else unknown++;
    if (known && zone >= 1) {
      painted++;
      const dm = Math.min(65535, Math.round(h * 10));
      for (const poly of polys) {
        const rings = poly
          .map((r) => r.map((c) => {
            const x = ((c[0] - WEST) * M_LON + MARGIN) / RES;
            const y = ((c[1] - SOUTH) * M_LAT + MARGIN) / RES;
            return [x, y];
          }))
          .filter((r) => r.length >= 3);
        if (rings.length) {
          fillValue(height, GW, GH, rings, dm, (id, value) => {
            if (value >= 20) {
              if (value > height[id]) height[id] = value;
            } else if (height[id] === 0) height[id] = 1;
          });
        }
      }
    } else if (!known && zone === 2) {
      for (const poly of polys) {
        const rings = poly
          .map((r) => r.map((c) => {
            const x = ((c[0] - WEST) * M_LON + MARGIN) / RES;
            const y = ((c[1] - SOUTH) * M_LAT + MARGIN) / RES;
            return [x, y];
          }))
          .filter((r) => r.length >= 3);
        if (rings.length) {
          fillValue(height, GW, GH, rings, 1, (id) => {
            if (height[id] === 0) height[id] = 1;
          });
        }
      }
    }
    if (zone === 2) {
      const parts = [];
      for (const poly of polys) {
        const rings = poly.map(simplifyRing).filter((r) => r.length >= 3);
        if (rings.length) parts.push(rings);
      }
      if (!parts.length) continue;
      if (known) drawnKnown++;
      else drawnUnknown++;
      writeBat(parts, known ? Math.min(65535, Math.round(h * 10)) : 0);
    }
  }
  if (fetched % 20000 === 0) console.log(`  ${fetched} emprises lues, ${painted} projettent`);
}
console.log(
  `bâtiments lus ${fetched}, hauteur ${withHeight}, sans hauteur ${unknown}, dessinés ${drawnKnown}+${drawnUnknown}, qui projettent ${painted}`,
);
const batStatsPath = path.join(rawDir, "bat-stats.json");
if (!streetsOnly) {
  writeFileSync(heightCache, Buffer.from(height.buffer));
  writeFileSync(coverCache, Buffer.from(cover.buffer));
  const batFile = Buffer.alloc(8 + batBytes);
  batFile.write("BAT1", 0);
  batFile.writeUInt32LE(drawnKnown + drawnUnknown, 4);
  let batOffset = 8;
  for (const chunk of batChunks) {
    chunk.copy(batFile, batOffset);
    batOffset += chunk.length;
  }
  writeFileSync(path.join(outDir, "batis.bin"), batFile);
  const batStats = { fetched, withHeight, unknown, drawnKnown, drawnUnknown, painted };
  writeFileSync(batStatsPath, JSON.stringify(batStats));
  console.log(`batis.bin ${(batFile.length / 1e6).toFixed(1)} Mo`);
} else {
  const batStats = JSON.parse(readFileSync(batStatsPath, "utf8"));
  fetched = batStats.fetched;
  withHeight = batStats.withHeight;
  unknown = batStats.unknown;
  drawnKnown = batStats.drawnKnown;
  drawnUnknown = batStats.drawnUnknown;
  painted = batStats.painted;
}

function ray(date) {
  const sun = sunPosition(date, SUN_LAT, SUN_LON);
  const up = sun.altitude > MIN_ALT;
  return {
    up,
    altitude: degrees(sun.altitude),
    azimuth: degrees(sun.azimuth),
    sinAz: Math.sin(sun.azimuth),
    cosAz: Math.cos(sun.azimuth),
    tan10: Math.tan(sun.altitude) * 10,
  };
}

const summerRays = HOURS.map((hour) => ray(new Date(Date.UTC(2026, 5, 25, hour - 2, 0, 0))));
const winterRays = HOURS.map((hour) => ray(new Date(Date.UTC(2026, 11, 21, hour - 1, 0, 0))));

function blocked(ix, iy) {
  const i = iy * GW + ix;
  if (height[i] === 0) return false;
  if (ix <= 0 || iy <= 0 || ix >= GW - 1 || iy >= GH - 1) return true;
  return height[i - 1] > 0 && height[i + 1] > 0 && height[i - GW] > 0 && height[i + GW] > 0;
}

function pix(lon, lat) {
  const x = ((lon - WEST) * M_LON + MARGIN) / RES;
  const y = ((lat - SOUTH) * M_LAT + MARGIN) / RES;
  return [x, y];
}

let cap = 1 << 18;
let nEdges = 0;
let ax = new Float32Array(cap);
let ay = new Float32Array(cap);
let bx = new Float32Array(cap);
let by = new Float32Array(cap);
let lenA = new Float32Array(cap);
let shade = new Uint8Array(cap * 15);
let winter = new Uint8Array(cap * 15);
let bridgeA = new Uint8Array(cap);
let chunkStartFlag = new Uint8Array(cap);

function grow() {
  const next = cap * 2;
  const growF = (src) => {
    const n = new Float32Array(next);
    n.set(src);
    return n;
  };
  ax = growF(ax);
  ay = growF(ay);
  bx = growF(bx);
  by = growF(by);
  lenA = growF(lenA);
  const growU = (src, mult) => {
    const n = new Uint8Array(next * mult);
    n.set(src);
    return n;
  };
  shade = growU(shade, 15);
  winter = growU(winter, 15);
  bridgeA = growU(bridgeA, 1);
  chunkStartFlag = growU(chunkStartFlag, 1);
  cap = next;
}

const sumShade = new Float64Array(15);
const sumWinter = new Float64Array(15);
let sumLen = 0;
const arrond = new Map();

function scoreSegment(a, b) {
  const probes = [];
  for (const t of [0.2, 0.5, 0.8]) {
    const lon = a[0] + (b[0] - a[0]) * t;
    const lat = a[1] + (b[1] - a[1]) * t;
    if (zoneOf(cover, lon, lat) !== 2) continue;
    const [x, y] = pix(lon, lat);
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 1 || iy < 1 || ix >= GW - 1 || iy >= GH - 1) continue;
    if (blocked(ix, iy)) continue;
    probes.push([ix, iy]);
  }
  if (!probes.length) return null;
  const ete = new Uint8Array(15);
  const hiv = new Uint8Array(15);
  for (let h = 0; h < 15; h++) {
    const sRay = summerRays[h];
    if (!sRay.up) ete[h] = 255;
    else {
      let hit = 0;
      for (const [ix, iy] of probes) {
        if (marchOn(height, GW, GH, ix, iy, sRay.sinAz, sRay.cosAz, sRay.tan10)) hit++;
      }
      ete[h] = Math.round((100 * hit) / probes.length);
    }
    const wRay = winterRays[h];
    if (!wRay.up) hiv[h] = 255;
    else {
      let hit = 0;
      for (const [ix, iy] of probes) {
        if (marchOn(height, GW, GH, ix, iy, wRay.sinAz, wRay.cosAz, wRay.tan10)) hit++;
      }
      hiv[h] = Math.round((100 * hit) / probes.length);
    }
  }
  return { ete, hiv };
}

function meters(a, b) {
  const dx = (b[0] - a[0]) * M_LON;
  const dy = (b[1] - a[1]) * M_LAT;
  return Math.hypot(dx, dy);
}

function emitLine(coords, isBridge, insee) {
  if (coords.length < 2) return;
  const pts = [coords[0]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = meters(a, b);
    if (seg < 0.4) continue;
    let dist = STEP - carry;
    while (dist <= seg) {
      const t = dist / seg;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      dist += STEP;
    }
    carry = seg - (dist - STEP);
  }
  const end = coords[coords.length - 1];
  if (meters(pts[pts.length - 1], end) > 0.8) pts.push(end);
  let chunkLen = 0;
  let open = false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const length = meters(a, b);
    if (length < 0.8) continue;
    const scored = scoreSegment(a, b);
    if (!scored) {
      open = false;
      chunkLen = 0;
      continue;
    }
    if (nEdges === cap) grow();
    const id = nEdges++;
    const starts = !open || chunkLen >= CHUNK;
    if (starts) {
      chunkLen = 0;
      open = true;
    }
    ax[id] = a[0];
    ay[id] = a[1];
    bx[id] = b[0];
    by[id] = b[1];
    lenA[id] = length;
    bridgeA[id] = isBridge ? 1 : 0;
    chunkStartFlag[id] = starts ? 1 : 0;
    shade.set(scored.ete, id * 15);
    winter.set(scored.hiv, id * 15);
    chunkLen += length;
    sumLen += length;
    for (let h = 0; h < 15; h++) {
      if (scored.ete[h] !== 255) sumShade[h] += (scored.ete[h] / 100) * length;
      if (scored.hiv[h] !== 255) sumWinter[h] += (scored.hiv[h] / 100) * length;
    }
    if (insee) arrond.set(insee, (arrond.get(insee) || 0) + length);
  }
}

function parisCode(code) {
  return typeof code === "string" && (/^751\d{2}$/.test(code) || code === "75056");
}

console.log("axes…");
const rueFiles = pages("rue");
if (!rueFiles.length) throw new Error("aucun axe téléchargé");
let ruesLues = 0;
let ruesGardées = 0;
for (const file of rueFiles) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  for (const feature of json.features) {
    ruesLues++;
    const p = feature.properties;
    if (p.fictif === true || p.prive === true) continue;
    if (typeof p.nature === "string" && /bac/i.test(p.nature)) continue;
    const pos = Number(p.position_par_rapport_au_sol);
    if (Number.isFinite(pos) && pos < 0) continue;
    const code = parisCode(p.insee_commune_gauche)
      ? p.insee_commune_gauche
      : parisCode(p.insee_commune_droite)
        ? p.insee_commune_droite
        : "";
    const lines = linesOf(feature.geometry);
    if (!lines.length) continue;
    let touches = Boolean(code);
    if (!touches) {
      for (const line of lines) {
        if (line.some((c) => zoneOf(cover, c[0], c[1]) === 2)) {
          touches = true;
          break;
        }
      }
    }
    if (!touches) continue;
    const isBridge = pos > 0;
    let kept = false;
    for (const line of lines) {
      let length = 0;
      for (let i = 1; i < line.length; i++) length += meters(line[i - 1], line[i]);
      if (length < 8) continue;
      emitLine(line, isBridge, code);
      kept = true;
    }
    if (kept) ruesGardées++;
  }
  if (ruesLues % 5000 < 1000 && ruesLues % 1000 === 0) {
    console.log(`  ${ruesLues} tronçons, ${nEdges} segments`);
  }
}
console.log(`tronçons ${ruesLues}, gardés ${ruesGardées}, segments ${nEdges}, ${(sumLen / 1000).toFixed(0)} km`);

const missing = [];
for (let i = 1; i <= 20; i++) {
  const code = `751${String(i).padStart(2, "0")}`;
  if (!arrond.has(code)) missing.push(code);
}
if (missing.length) console.log(`arrondissements sans axe : ${missing.join(", ")}`);
else console.log("les 20 arrondissements ont des axes");

function nearShare(lon, lat, hourIndex, season) {
  let best = Infinity;
  let value = null;
  for (let i = 0; i < nEdges; i++) {
    const mx = (ax[i] + bx[i]) / 2;
    const my = (ay[i] + by[i]) / 2;
    const d = Math.hypot((mx - lon) * M_LON, (my - lat) * M_LAT);
    if (d < best) {
      best = d;
      const table = season === "hiver" ? winter : shade;
      value = table[i * 15 + hourIndex];
    }
  }
  return { best, value };
}

const huchette = nearShare(2.34514, 48.85311, HOURS.indexOf(16), "ete");
const quai = nearShare(2.3518, 48.8554, HOURS.indexOf(16), "ete");
console.log(
  `contrôle 16 h : Huchette ${huchette.value}% à ${huchette.best.toFixed(0)} m, quai Hôtel de Ville ${quai.value}% à ${quai.best.toFixed(0)} m`,
);
const june16 = sumShade[HOURS.indexOf(16)] / sumLen;
console.log(`part moyenne 25 juin 16 h ${(june16 * 100).toFixed(1)} %`);
if (!(june16 > 0.04 && june16 < 0.85)) throw new Error(`part d’ombre de juin invraisemblable : ${june16}`);
if (huchette.best > 25 || huchette.value == null || huchette.value < 25) {
  throw new Error(`Huchette n’est pas à l’ombre à 16 h (${huchette.value} à ${huchette.best.toFixed(0)} m)`);
}

console.log("raccord des carrefours…");
const parent = new Int32Array(nEdges * 2);
for (let i = 0; i < parent.length; i++) parent[i] = i;
function find(i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}
function union(i, j) {
  const a = find(i);
  const b = find(j);
  if (a !== b) parent[b] = a;
}
const cell = 8;
const buckets = new Map();
function endXY(index) {
  const edge = index >> 1;
  const second = index & 1;
  const lon = second ? bx[edge] : ax[edge];
  const lat = second ? by[edge] : ay[edge];
  return [(lon - SUN_LON) * M_LON, (lat - SUN_LAT) * M_LAT];
}
function keyOf(x, y) {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
}
for (let i = 0; i < nEdges * 2; i++) {
  const [x, y] = endXY(i);
  const key = keyOf(x, y);
  let list = buckets.get(key);
  if (!list) {
    list = [];
    buckets.set(key, list);
  }
  list.push(i);
}
for (let i = 0; i < nEdges * 2; i++) {
  const [x, y] = endXY(i);
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const list = buckets.get(`${cx + dx},${cy + dy}`);
      if (!list) continue;
      for (const j of list) {
        if (j <= i) continue;
        if ((i >> 1) === (j >> 1)) continue;
        const [xj, yj] = endXY(j);
        const gap = Math.hypot(x - xj, y - yj);
        const same = bridgeA[i >> 1] === bridgeA[j >> 1];
        if (same ? gap <= 4 : gap <= 12) union(i, j);
      }
    }
  }
  if (i > 0 && i % 200000 === 0) console.log(`  bouts ${i}`);
}

const rootToNode = new Map();
const from = new Int32Array(nEdges);
const to = new Int32Array(nEdges);
let nNodes = 0;
for (let e = 0; e < nEdges; e++) {
  const ra = find(e * 2);
  const rb = find(e * 2 + 1);
  if (!rootToNode.has(ra)) rootToNode.set(ra, nNodes++);
  if (!rootToNode.has(rb)) rootToNode.set(rb, nNodes++);
  from[e] = rootToNode.get(ra);
  to[e] = rootToNode.get(rb);
}
console.log(`nœuds ${nNodes}`);

const chunkStart = [];
const chunkCount = [];
for (let e = 0; e < nEdges; e++) {
  if (chunkStartFlag[e] || !chunkCount.length) {
    chunkStart.push(e);
    chunkCount.push(1);
  } else chunkCount[chunkCount.length - 1]++;
}
const nChunks = chunkStart.length;
console.log(`bouts de rue ${nChunks}`);

const shadeBytes = nEdges * 15;
const winterBytes = nEdges * 15;
const bridgeBytes = nEdges;
const pad = (64 + nEdges * 4 * 7 + shadeBytes + winterBytes + bridgeBytes) % 4;
const header = 64;
const bytes =
  header +
  nEdges * 4 * 7 +
  shadeBytes +
  winterBytes +
  bridgeBytes +
  (pad ? 4 - pad : 0) +
  nChunks * 4 +
  nChunks * 2;
const out = Buffer.alloc(bytes);
out.write("OMB2", 0);
out.writeUInt32LE(2, 4);
out.writeDoubleLE(WEST, 8);
out.writeDoubleLE(SOUTH, 16);
out.writeDoubleLE(EAST, 24);
out.writeDoubleLE(NORTH, 32);
out.writeUInt32LE(nEdges, 40);
out.writeUInt32LE(nNodes, 44);
out.writeUInt32LE(nChunks, 48);
let o = 64;
Buffer.from(from.buffer, from.byteOffset, nEdges * 4).copy(out, o);
o += nEdges * 4;
Buffer.from(to.buffer, to.byteOffset, nEdges * 4).copy(out, o);
o += nEdges * 4;
Buffer.from(ax.buffer, ax.byteOffset, nEdges * 4).copy(out, o);
o += nEdges * 4;
Buffer.from(ay.buffer, ay.byteOffset, nEdges * 4).copy(out, o);
o += nEdges * 4;
Buffer.from(bx.buffer, bx.byteOffset, nEdges * 4).copy(out, o);
o += nEdges * 4;
Buffer.from(by.buffer, by.byteOffset, nEdges * 4).copy(out, o);
o += nEdges * 4;
Buffer.from(lenA.buffer, lenA.byteOffset, nEdges * 4).copy(out, o);
o += nEdges * 4;
out.set(shade.subarray(0, shadeBytes), o);
o += shadeBytes;
out.set(winter.subarray(0, winterBytes), o);
o += winterBytes;
out.set(bridgeA.subarray(0, nEdges), o);
o += nEdges;
while (o % 4) o++;
for (let i = 0; i < nChunks; i++) {
  out.writeUInt32LE(chunkStart[i], o);
  o += 4;
}
for (let i = 0; i < nChunks; i++) {
  out.writeUInt16LE(chunkCount[i], o);
  o += 2;
}
writeFileSync(path.join(outDir, "axes.bin"), out);
console.log(`axes.bin ${(out.length / 1e6).toFixed(1)} Mo, écrit ${o} octets`);

function parseMeteo() {
  const file = path.join(root, "data", "raw", "H_75_latest.csv.gz");
  const text = gunzipSync(readFileSync(file)).toString("utf8");
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(";");
  const iPoste = head.indexOf("NUM_POSTE");
  const iNom = head.indexOf("NOM_USUEL");
  const iDate = head.indexOf("AAAAMMJJHH");
  const iT = head.indexOf("T");
  const stations = {
    75106001: { id: "75106001", name: "PARIS-LUXEMBOURG", hours: {} },
    75114001: { id: "75114001", name: "PARIS-MONTSOURIS", hours: {} },
  };
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split(";");
    const poste = c[iPoste];
    if (!stations[poste] || !c[iDate].startsWith("20260625")) continue;
    const local = Number(c[iDate].slice(8, 10)) + 2;
    const t = c[iT]?.trim() ? Number(c[iT]) : NaN;
    stations[poste].name = c[iNom] || stations[poste].name;
    if (Number.isFinite(t)) stations[poste].hours[local] = t;
  }
  return stations;
}

const meteo = parseMeteo();
const mean = {};
for (const hour of [10, 13, 16, 19]) {
  const index = HOURS.indexOf(hour);
  mean[`juin${hour}`] = Math.round((sumShade[index] / sumLen) * 1000) / 1000;
  mean[`decembre${hour}`] = Math.round((sumWinter[index] / sumLen) * 1000) / 1000;
}

const scene = {
  place: "Paris",
  department: "75",
  date: "2026-06-25",
  dateLabel: "jeudi 25 juin 2026",
  winterDate: "2026-12-21",
  winterLabel: "lundi 21 décembre 2026",
  hours: HOURS,
  bounds: [
    [WEST, SOUTH],
    [EAST, NORTH],
  ],
  ring: ring.map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]),
  maxShadowMeters: MAX_SHADOW,
  sampleMeters: STEP,
  chunkMeters: CHUNK,
  sun: summerRays.map((item, i) => ({
    hour: HOURS[i],
    altitude: Math.round(item.altitude * 10) / 10,
    azimuth: Math.round(item.azimuth * 10) / 10,
    up: item.up,
  })),
  winterSun: winterRays.map((item, i) => ({
    hour: HOURS[i],
    altitude: Math.round(item.altitude * 10) / 10,
    azimuth: Math.round(item.azimuth * 10) / 10,
    up: item.up,
  })),
  temperature: {
    station: meteo[75106001].name,
    id: "75106001",
    byHour: meteo[75106001].hours,
    source: "Météo-France, données horaires, département 75.",
  },
  montsouris: { byHour: meteo[75114001].hours, name: meteo[75114001].name },
  stats: {
    buildingsFetched: fetched,
    buildingsWithHeight: withHeight,
    buildingsUnknown: unknown,
    buildingsDrawn: drawnKnown,
    buildingsUnknownDrawn: drawnUnknown,
    casters: painted,
    streets: ruesGardées,
    segments: nEdges,
    chunks: nChunks,
    kilometers: Math.round(sumLen / 1000),
    nodes: nNodes,
    mean,
    missingArrondissements: missing,
    altimetricPrecisionMeters: 1.5,
    planimetricPrecisionMeters: 2.5,
  },
};
writeFileSync(path.join(outDir, "scene.json"), JSON.stringify(scene));
console.log("scene.json écrite", JSON.stringify(mean));
