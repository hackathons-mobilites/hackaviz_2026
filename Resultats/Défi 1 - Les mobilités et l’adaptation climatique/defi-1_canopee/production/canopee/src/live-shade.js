/**
 * Ombre des rues pour l’instant courant.
 * Même règle que le précalcul : depuis un point de rue, on marche vers le
 * soleil. Un bâtiment bloque si sa hauteur ≥ distance × tan(élévation),
 * dans la limite de 180 m. Pas de hauteur, pas d’ombre. Soleil couché, rien.
 */

const RAD = Math.PI / 180;
const MIN_ALT = 0.5 * RAD;
const MAX_M = 180;
const STEP_M = 6;
const M_LON = 111320;
const M_LAT = 110540;
const TILE = 0.0022;

export function createLiveShade(buildings) {
  const tiles = new Map();
  const edgeCache = new Map();
  let cacheToken = "";

  function tileOf(ix, iy) {
    const key = `${ix},${iy}`;
    const found = tiles.get(key);
    if (found) return found;
    const west = ix * TILE;
    const south = iy * TILE;
    const east = west + TILE;
    const north = south + TILE;
    const midLat = (south + north) / 2;
    const mLon = M_LON * Math.cos(midLat * RAD);
    const width = TILE * mLon;
    const height = TILE * M_LAT;
    const nx = Math.max(8, Math.round(width / STEP_M));
    const ny = Math.max(8, Math.round(height / STEP_M));
    const cellX = width / nx;
    const cellY = height / ny;
    const grid = new Uint16Array(nx * ny);
    const ids = buildings.inBox(west, south, east, north);
    for (const id of ids) {
      const meters = buildings.heightOf(id);
      if (!(meters > 0)) continue;
      const ring = buildings.exterior(id);
      if (!ring || ring.length < 4) continue;
      fillRing(grid, ring, Math.round(meters * 10), west, south, mLon, nx, ny, cellX, cellY);
    }
    const tile = { west, south, mLon, nx, ny, cellX, cellY, grid };
    if (tiles.size > 1800) tiles.clear();
    tiles.set(key, tile);
    return tile;
  }

  function heightAt(lon, lat) {
    const ix = Math.floor(lon / TILE);
    const iy = Math.floor(lat / TILE);
    const tile = tileOf(ix, iy);
    const x = Math.floor(((lon - tile.west) * tile.mLon) / tile.cellX);
    const y = Math.floor(((lat - tile.south) * M_LAT) / tile.cellY);
    if (x < 0 || y < 0 || x >= tile.nx || y >= tile.ny) return 0;
    return tile.grid[y * tile.nx + x] / 10;
  }

  function probe(lon, lat, altitude, azimuth) {
    if (!(altitude > MIN_ALT)) return "down";
    if (heightAt(lon, lat) > 0) return "in";
    const mLon = M_LON * Math.cos(lat * RAD);
    const east = Math.sin(azimuth) / mLon;
    const north = Math.cos(azimuth) / M_LAT;
    const tanAlt = Math.tan(altitude);
    for (let dist = STEP_M; dist <= MAX_M; dist += STEP_M) {
      const h = heightAt(lon + east * dist, lat + north * dist);
      if (h > 0 && h + 0.05 >= dist * tanAlt) return "shade";
    }
    return "sun";
  }

  function fraction(edge, ax, ay, bx, by, altitude, azimuth, up) {
    if (!up || !(altitude > MIN_ALT)) return -1;
    const token = `${Math.round(altitude * 2000)}:${Math.round(azimuth * 2000)}`;
    if (token !== cacheToken) {
      edgeCache.clear();
      cacheToken = token;
    }
    const cached = edgeCache.get(edge);
    if (cached != null) return cached;
    let known = 0;
    let shaded = 0;
    for (const t of [0.2, 0.5, 0.8]) {
      const status = probe(ax + (bx - ax) * t, ay + (by - ay) * t, altitude, azimuth);
      if (status === "in" || status === "down") continue;
      known += 1;
      if (status === "shade") shaded += 1;
    }
    const value = known ? shaded / known : -1;
    edgeCache.set(edge, value);
    return value;
  }

  return { fraction };
}

function fillRing(grid, ring, decimeters, west, south, mLon, nx, ny, cellX, cellY) {
  const pts = ring.map(([lon, lat]) => [(lon - west) * mLon, (lat - south) * M_LAT]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY / cellY));
  const y1 = Math.min(ny - 1, Math.floor(maxY / cellY));
  for (let y = y0; y <= y1; y++) {
    const py = (y + 0.5) * cellY;
    const xs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if ((a[1] > py) === (b[1] > py)) continue;
      const t = (py - a[1]) / (b[1] - a[1]);
      xs.push(a[0] + t * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = Math.max(0, Math.ceil(xs[k] / cellX - 0.5));
      const xEnd = Math.min(nx - 1, Math.floor(xs[k + 1] / cellX - 0.5));
      for (let x = xStart; x <= xEnd; x++) {
        const idx = y * nx + x;
        if (decimeters > grid[idx]) grid[idx] = decimeters;
      }
    }
  }
}
