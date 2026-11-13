/**
 * Construit l’ombre horaire d’un cadre autour de Saint-Michel.
 *
 * Données :
 * - IGN BD TOPO via WFS Géoplateforme (bâtiments.hauteur, tronçons de route)
 * - Météo-France, fichier horaire département 75 (station Luxembourg)
 * - Ville de Paris : fontaines à boire, îlots de fraîcheur
 *
 * Les fichiers bruts sont mis en cache dans data/raw/. Rien n’est inventé :
 * un bâtiment sans hauteur ne projette pas d’ombre.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { degrees, shadowOffset, sunPosition } from "../src/sun.js";

if (process.env.SAINT_MICHEL !== "1") {
  console.error("Ce script ne couvre que Saint-Michel et écraserait le département 75. Lancez scripts/prepare-paris.mjs.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = path.join(root, "data", "raw");
const outDir = path.join(root, "public", "data");
mkdirSync(rawDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const SOUTH = 48.851;
const NORTH = 48.8592;
const WEST = 2.3415;
const EAST = 2.3542;
const LAT0 = (SOUTH + NORTH) / 2;
const M_LAT = 111132.92 - 559.82 * Math.cos((2 * LAT0 * Math.PI) / 180);
const M_LON = 111412.84 * Math.cos((LAT0 * Math.PI) / 180);
const RES = 2;
const HEIGHT_M = (NORTH - SOUTH) * M_LAT;
const WIDTH_M = (EAST - WEST) * M_LON;
const W = Math.round(WIDTH_M / RES);
const H = Math.round(HEIGHT_M / RES);
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const LOCAL_OFFSET_H = 2;
const MAX_SHADOW = 180;
const SUN_LAT = 48.8551;
const SUN_LON = 2.3479;

const BUILDINGS_URL =
  "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&BBOX=2.3388,48.8492,2.3572,48.8610,EPSG:4326&SRSNAME=EPSG:4326&COUNT=4000&OUTPUTFORMAT=application/json";
const STREETS_URL =
  "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:troncon_de_route&BBOX=2.3415,48.8510,2.3542,48.8592,EPSG:4326&SRSNAME=EPSG:4326&COUNT=5000&OUTPUTFORMAT=application/json";
const FONTAINES_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/fontaines-a-boire/records?limit=50&where=in_bbox(geo_point_2d,48.8510,2.3415,48.8592,2.3542)";
const ILOTS_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/ilots-de-fraicheur-espaces-verts-frais/records?limit=40&where=in_bbox(geo_shape,48.8510,2.3415,48.8592,2.3542)";
const MF_URL =
  "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/HOR/H_75_latest-2025-2026.csv.gz";

async function cached(name, url) {
  const file = path.join(rawDir, name);
  if (!existsSync(file)) {
    process.stdout.write(`téléchargement ${name}…\n`);
    const res = await fetch(url, { headers: { "User-Agent": "ombre-paris/1.0 (hackathon mobilites)" } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
  }
  return file;
}

function toPx(lon, lat) {
  const east = (lon - WEST) * M_LON;
  const north = (lat - SOUTH) * M_LAT;
  return [east / RES, (HEIGHT_M - north) / RES];
}

function openRing(coords) {
  const ring = [];
  for (const c of coords) ring.push(toPx(c[0], c[1]));
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) ring.pop();
  }
  return ring;
}

function fillTri(grid, ax, ay, bx, by, cx, cy) {
  const minY = Math.min(ay, by, cy);
  const maxY = Math.max(ay, by, cy);
  if (maxY - minY < 1e-4) return;
  const yA = Math.max(0, Math.ceil(minY - 0.5));
  const yB = Math.min(H - 1, Math.floor(maxY - 0.5));
  if (yB < yA) return;
  const p = [
    [ax, ay],
    [bx, by],
    [cx, cy],
  ].sort((u, v) => u[1] - v[1]);
  const x0 = p[0][0];
  const y0 = p[0][1];
  const x1 = p[1][0];
  const y1 = p[1][1];
  const x2 = p[2][0];
  const y2 = p[2][1];
  if (y2 === y0) return;
  for (let y = yA; y <= yB; y++) {
    const py = y + 0.5;
    if (py < y0 || py > y2) continue;
    const xLong = x0 + ((x2 - x0) * (py - y0)) / (y2 - y0);
    let xShort;
    if (py < y1) {
      xShort = y1 === y0 ? x1 : x0 + ((x1 - x0) * (py - y0)) / (y1 - y0);
    } else {
      xShort = y2 === y1 ? x1 : x1 + ((x2 - x1) * (py - y1)) / (y2 - y1);
    }
    const left = xLong < xShort ? xLong : xShort;
    const right = xLong < xShort ? xShort : xLong;
    let xL = Math.max(0, Math.ceil(left - 0.5));
    let xR = Math.min(W - 1, Math.floor(right - 0.5));
    const row = y * W;
    for (let x = xL; x <= xR; x++) grid[row + x] = 1;
  }
}

function fillRings(grid, rings) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const yA = Math.max(0, Math.ceil(minY - 0.5));
  const yB = Math.min(H - 1, Math.floor(maxY - 0.5));
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
    const row = y * W;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xL = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xR = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xL; x <= xR; x++) grid[row + x] = 1;
    }
  }
}

function selfTest() {
  const grid = new Uint8Array(W * H);
  const ax = 80;
  const ay = 80;
  const bx = 90;
  const by = 80;
  const dx = 0;
  const dy = -10;
  fillTri(grid, ax, ay, bx, by, bx + dx, by + dy);
  fillTri(grid, ax, ay, bx + dx, by + dy, ax + dx, ay + dy);
  const north = grid[Math.round(ay + dy / 2) * W + 85];
  const south = grid[(ay + 4) * W + 85];
  if (!north || south) {
    throw new Error(`test d’ombre raté : nord=${north} sud=${south}`);
  }
  const noon = sunPosition(new Date(Date.UTC(2026, 5, 25, 12, 0, 0)), SUN_LAT, SUN_LON);
  const alt = degrees(noon.altitude);
  if (alt < 50 || alt > 70) throw new Error(`hauteur de soleil inattendue à 12 UTC : ${alt.toFixed(1)}°`);
  let best = null;
  for (let u = 10; u <= 14; u += 0.25) {
    const p = sunPosition(new Date(Date.UTC(2026, 5, 25, u, (u % 1) * 60, 0)), SUN_LAT, SUN_LON);
    if (!best || p.altitude > best.altitude) best = { u, ...p };
  }
  const az = degrees(best.azimuth);
  if (az < 150 || az > 210) {
    throw new Error(`azimut au midi solaire inattendu : ${az.toFixed(1)}° à ${best.u} UTC`);
  }
  console.log(
    `soleil ok — midi solaire ~ ${best.u.toFixed(2)} UTC, hauteur ${degrees(best.altitude).toFixed(1)}°, azimut ${az.toFixed(1)}°`,
  );
}

function roundRing(coords) {
  const out = coords.map((c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]);
  return out;
}

function intersectsView(coords) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of coords) {
    if (c[0] < minX) minX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] > maxY) maxY = c[1];
  }
  return !(maxX < WEST || minX > EAST || maxY < SOUTH || minY > NORTH);
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

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function writePng(file, grid, empty = false) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    const dest = y * (W * 4 + 1);
    raw[dest] = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const o = dest + 1 + x * 4;
      if (empty) {
        raw[o + 3] = 0;
      } else if (grid[row + x]) {
        raw[o] = 11;
        raw[o + 1] = 42;
        raw[o + 2] = 66;
        raw[o + 3] = 188;
      } else {
        raw[o] = 206;
        raw[o + 1] = 112;
        raw[o + 2] = 28;
        raw[o + 3] = 78;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(raw, { level: 4 });
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
}

function parseMeteo(file) {
  const text = gunzipSync(readFileSync(file)).toString("utf8");
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(";");
  const iPoste = head.indexOf("NUM_POSTE");
  const iNom = head.indexOf("NOM_USUEL");
  const iDate = head.indexOf("AAAAMMJJHH");
  const iT = head.indexOf("T");
  const iLat = head.indexOf("LAT");
  const iLon = head.indexOf("LON");
  const stations = {
    "75106001": { id: "75106001", hours: {} },
    "75114001": { id: "75114001", hours: {} },
  };
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split(";");
    const poste = c[iPoste];
    if (!stations[poste]) continue;
    if (!c[iDate].startsWith("20260625")) continue;
    const utc = Number(c[iDate].slice(8, 10));
    const local = utc + LOCAL_OFFSET_H;
    if (local < 0 || local > 23) continue;
    const t = Number(c[iT]);
    stations[poste].name = c[iNom];
    stations[poste].lat = Number(c[iLat]);
    stations[poste].lon = Number(c[iLon]);
    if (Number.isFinite(t)) stations[poste].hours[local] = t;
  }
  return stations;
}

function lineLengthMeters(coords) {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * M_LON;
    const dy = (coords[i][1] - coords[i - 1][1]) * M_LAT;
    len += Math.hypot(dx, dy);
  }
  return len;
}

function sampleLine(coords, step = 6) {
  const pts = [];
  if (coords.length < 2) return pts;
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1][0];
    const ay = coords[i - 1][1];
    const bx = coords[i][0];
    const by = coords[i][1];
    const dx = (bx - ax) * M_LON;
    const dy = (by - ay) * M_LAT;
    const seg = Math.hypot(dx, dy);
    if (seg < 0.5) continue;
    let dist = step - carry;
    while (dist <= seg) {
      const t = dist / seg;
      pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      dist += step;
    }
    carry = seg - (dist - step);
  }
  if (!pts.length) {
    const mid = Math.floor(coords.length / 2);
    pts.push(coords[mid]);
  }
  return pts;
}

function midpoint(coords) {
  const target = lineLengthMeters(coords) / 2;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * M_LON;
    const dy = (coords[i][1] - coords[i - 1][1]) * M_LAT;
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= target && seg > 0) {
      const t = (target - acc) / seg;
      return [
        Math.round((coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t) * 1e6) / 1e6,
        Math.round((coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t) * 1e6) / 1e6,
      ];
    }
    acc += seg;
  }
  const last = coords[coords.length - 1];
  return [Math.round(last[0] * 1e6) / 1e6, Math.round(last[1] * 1e6) / 1e6];
}

selfTest();

const buildingFile = await cached("buildings.json", BUILDINGS_URL);
const streetFile = await cached("streets.json", STREETS_URL);
const fontaineFile = await cached("fontaines.json", FONTAINES_URL);
const ilotFile = await cached("ilots.json", ILOTS_URL);
const meteoFile = await cached("H_75_latest.csv.gz", MF_URL);

const buildingsJson = JSON.parse(readFileSync(buildingFile, "utf8"));
const casters = [];
const buildingFeatures = [];
let unknown = 0;
let unknownInView = 0;
let withHeight = 0;
const heights = [];

for (const feature of buildingsJson.features) {
  const h = feature.properties.hauteur;
  const known = Number.isFinite(h) && h >= 2;
  const polys = polygonsOf(feature.geometry);
  const inView = polys.some((poly) => intersectsView(poly[0]));
  if (known) {
    withHeight++;
    heights.push(h);
  } else unknown++;
  if (!known && inView) unknownInView++;
  if (inView) {
    const geometry =
      feature.geometry.type === "Polygon"
        ? { type: "Polygon", coordinates: feature.geometry.coordinates.map(roundRing) }
        : {
            type: "MultiPolygon",
            coordinates: feature.geometry.coordinates.map((poly) => poly.map(roundRing)),
          };
    buildingFeatures.push({
      type: "Feature",
      properties: { known: known ? 1 : 0, h: known ? Math.round(h * 10) / 10 : null },
      geometry,
    });
  }
  if (!known) continue;
  for (const poly of polys) {
    const rings = poly.map(openRing).filter((r) => r.length >= 3);
    if (!rings.length) continue;
    casters.push({ rings, height: h });
  }
}
heights.sort((a, b) => a - b);
const median = heights[Math.floor(heights.length / 2)];

console.log(
  `bâtiments ${buildingsJson.features.length}, avec hauteur ${withHeight}, sans ${unknown} (dont ${unknownInView} dans le cadre), médiane ${median} m, max ${heights[heights.length - 1]} m`,
);
console.log(`grille ${W}×${H} px, ${RES} m, emprise ${WIDTH_M.toFixed(0)}×${HEIGHT_M.toFixed(0)} m, ${casters.length} emprises`);

const mask = new Uint8Array(W * H);
console.log("masque des emprises…");
for (const b of casters) fillRings(mask, b.rings);

const streetsJson = JSON.parse(readFileSync(streetFile, "utf8"));
const streetFeatures = [];
for (const feature of streetsJson.features) {
  const p = feature.properties;
  const pos = Number(p.position_par_rapport_au_sol);
  if (Number.isFinite(pos) && pos < 0) continue;
  if (p.prive === true) continue;
  const name = (p.nom_voie_ban_gauche || p.nom_voie_ban_droite || "").trim();
  const bike = [p.amenagement_cyclable_gauche, p.amenagement_cyclable_droit].some(
    (v) => v && /cycl/i.test(v),
  );
  const lines = linesOf(feature.geometry);
  for (const line of lines) {
    const len = lineLengthMeters(line);
    if (len < 8) continue;
    const samples = sampleLine(line, 6)
      .map(([lon, lat]) => {
        const [x, y] = toPx(lon, lat);
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) return null;
        const id = iy * W + ix;
        if (mask[id]) return null;
        return id;
      })
      .filter((id) => id != null);
    streetFeatures.push({
      type: "Feature",
      properties: {
        name,
        len: Math.round(len),
        imp: Number(p.importance) || 9,
        velo: bike ? 1 : 0,
        bridge: pos > 0 ? 1 : 0,
        mid: midpoint(line),
        n: samples.length,
        shade: HOURS.map(() => -1),
        winter: HOURS.map(() => -1),
      },
      geometry: { type: "LineString", coordinates: line.map((c) => roundRing([c])[0]) },
      _samples: samples,
    });
  }
}
console.log(`voies ${streetFeatures.length}`);

const shadeGrid = new Uint8Array(W * H);
const MIN_ALT = (0.5 * Math.PI) / 180;

function castHour(date) {
  const sun = sunPosition(date, SUN_LAT, SUN_LON);
  shadeGrid.fill(0);
  let capped = 0;
  let drawn = 0;
  if (sun.altitude > MIN_ALT) {
    for (const b of casters) {
      const off = shadowOffset(sun.altitude, sun.azimuth, b.height, MAX_SHADOW);
      if (!off) continue;
      if (off.capped) capped++;
      const dx = off.east / RES;
      const dy = -off.north / RES;
      drawn++;
      for (const ring of b.rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const c = ring[(i + 1) % ring.length];
          fillTri(shadeGrid, a[0], a[1], c[0], c[1], c[0] + dx, c[1] + dy);
          fillTri(shadeGrid, a[0], a[1], c[0] + dx, c[1] + dy, a[0] + dx, a[1] + dy);
        }
      }
    }
  }
  return { sun, capped, drawn, lit: sun.altitude > MIN_ALT };
}

function scoreStreets(key) {
  for (const street of streetFeatures) {
    const ids = street._samples;
    const idx = street._hourIdx;
    if (!ids.length || idx == null) continue;
    let hit = 0;
    for (const id of ids) if (shadeGrid[id]) hit++;
    street.properties[key][idx] = Math.round((hit / ids.length) * 1000) / 1000;
  }
}

const sunMeta = [];
for (const hour of HOURS) {
  const utc = hour - LOCAL_OFFSET_H;
  const t0 = Date.now();
  const { sun, capped, drawn, lit } = castHour(new Date(Date.UTC(2026, 5, 25, utc, 0, 0)));
  const file = path.join(outDir, `shade-${String(hour).padStart(2, "0")}.png`);
  writePng(file, shadeGrid);
  for (const street of streetFeatures) street._hourIdx = lit ? HOURS.indexOf(hour) : null;
  if (lit) scoreStreets("shade");
  sunMeta.push({
    hour,
    utc,
    altitude: Math.round(degrees(sun.altitude) * 10) / 10,
    azimuth: Math.round(degrees(sun.azimuth) * 10) / 10,
    cappedBuildings: capped,
    casters: drawn,
  });
  console.log(
    `${hour} h  soleil ${degrees(sun.altitude).toFixed(1)}° / az ${degrees(sun.azimuth).toFixed(0)}°  ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}

const WINTER_OFFSET_H = 1;
const winterMeta = [];
for (const hour of HOURS) {
  const utc = hour - WINTER_OFFSET_H;
  const t0 = Date.now();
  const { sun, capped, drawn, lit } = castHour(new Date(Date.UTC(2026, 11, 21, utc, 0, 0)));
  writePng(path.join(outDir, `shade-w-${String(hour).padStart(2, "0")}.png`), shadeGrid, !lit);
  for (const street of streetFeatures) street._hourIdx = lit ? HOURS.indexOf(hour) : null;
  if (lit) scoreStreets("winter");
  winterMeta.push({
    hour,
    utc,
    altitude: Math.round(degrees(sun.altitude) * 10) / 10,
    azimuth: Math.round(degrees(sun.azimuth) * 10) / 10,
    cappedBuildings: capped,
    casters: drawn,
  });
  console.log(
    `hiver ${hour} h  soleil ${degrees(sun.altitude).toFixed(1)}° / az ${degrees(sun.azimuth).toFixed(0)}°  ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}

for (const street of streetFeatures) {
  delete street._samples;
  delete street._hourIdx;
}

const meteo = parseMeteo(meteoFile);
const lux = meteo["75106001"];
const mont = meteo["75114001"];

const fontainesRaw = JSON.parse(readFileSync(fontaineFile, "utf8"));
const fontaines = {
  type: "FeatureCollection",
  features: fontainesRaw.results
    .filter((r) => r.dispo === "OUI" && r.geo_point_2d)
    .map((r) => ({
      type: "Feature",
      properties: {
        voie: r.voie || "",
        type: r.type_objet || "",
        modele: r.modele || "",
      },
      geometry: {
        type: "Point",
        coordinates: [
          Math.round(r.geo_point_2d.lon * 1e6) / 1e6,
          Math.round(r.geo_point_2d.lat * 1e6) / 1e6,
        ],
      },
    })),
};

const ilotsRaw = JSON.parse(readFileSync(ilotFile, "utf8"));
const ilots = {
  type: "FeatureCollection",
  features: ilotsRaw.results
    .filter((r) => r.categorie !== "Jardiniere" && r.geo_shape?.geometry)
    .map((r) => ({
      type: "Feature",
      properties: {
        nom: r.nom,
        veg: r.proportion_vegetation_haute == null ? null : Math.round(r.proportion_vegetation_haute),
        canicule: r.canicule_ouverture || "",
        categorie: r.categorie || r.type || "",
      },
      geometry: r.geo_shape.geometry,
    })),
};

const scene = {
  title: "Où marcher à l’ombre",
  date: "2026-06-25",
  dateLabel: "jeudi 25 juin 2026",
  timezone: "Europe/Paris",
  localOffsetHours: LOCAL_OFFSET_H,
  center: [SUN_LON, SUN_LAT],
  bounds: [
    [WEST, SOUTH],
    [EAST, NORTH],
  ],
  image: {
    width: W,
    height: H,
    resolutionMeters: RES,
    coordinates: [
      [WEST, NORTH],
      [EAST, NORTH],
      [EAST, SOUTH],
      [WEST, SOUTH],
    ],
  },
  hours: HOURS,
  sun: sunMeta,
  winter: {
    date: "2026-12-21",
    dateLabel: "lundi 21 décembre 2026",
    localOffsetHours: WINTER_OFFSET_H,
    sun: winterMeta,
  },
  maxShadowMeters: MAX_SHADOW,
  temperature: {
    station: lux.name,
    id: lux.id,
    lat: lux.lat,
    lon: lux.lon,
    distanceKm: 1.3,
    source:
      "Météo-France, données climatologiques de base horaires, département 75, fichier 2025-2026. Heures d’origine en UTC, affichées en heure légale (UTC+2).",
    byHour: lux.hours,
  },
  montsouris: {
    station: mont.name,
    id: mont.id,
    byHour: mont.hours,
  },
  stats: {
    buildingsFetched: buildingsJson.features.length,
    buildingsWithHeight: withHeight,
    buildingsUnknown: unknown,
    buildingsUnknownInView: unknownInView,
    heightMedian: median,
    heightMax: heights[heights.length - 1],
    heightMin: heights[0],
    streets: streetFeatures.length,
    fontaines: fontaines.features.length,
    ilots: ilots.features.length,
    altimetricPrecisionMeters: 1.5,
    planimetricPrecisionMeters: 2.5,
  },
};

writeFileSync(path.join(outDir, "buildings.geojson"), JSON.stringify({ type: "FeatureCollection", features: buildingFeatures }));
writeFileSync(path.join(outDir, "streets.geojson"), JSON.stringify({ type: "FeatureCollection", features: streetFeatures }));
writeFileSync(path.join(outDir, "fontaines.geojson"), JSON.stringify(fontaines));
writeFileSync(path.join(outDir, "ilots.geojson"), JSON.stringify(ilots));
writeFileSync(path.join(outDir, "scene.json"), JSON.stringify(scene));

const size = (name) => {
  const f = path.join(outDir, name);
  return existsSync(f) ? Math.round(readFileSync(f).length / 1024) : 0;
};
console.log("écrit", outDir);
console.log("scene", size("scene.json"), "ko, rues", size("streets.geojson"), "ko, bâtis", size("buildings.geojson"), "ko");
console.log("Luxembourg", lux.name, JSON.stringify(lux.hours));
console.log("Montsouris", mont.name, "16h", mont.hours[16], "17h", mont.hours[17]);
