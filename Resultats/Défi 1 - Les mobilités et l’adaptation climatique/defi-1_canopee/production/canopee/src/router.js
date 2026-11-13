/**
 * Chemin sur les segments de 6 m déjà calculés.
 * Le coût des segments dépend du cran de soleil choisi.
 */

const CELL = 0.0011;
const MAX_SNAP_M = 60;
const SUN_PENALTY = { 0: 30, 33: 0.55, 50: 0, 67: 1.25, 100: 30 };
const LAT0 = 48.8566;
const LON0 = 2.3522;
const M_LAT = 111132.92 - 559.82 * Math.cos((2 * LAT0 * Math.PI) / 180);
const M_LON = 111412.84 * Math.cos((LAT0 * Math.PI) / 180);
const HEX_RADIUS_M = 260;

function nearestHex(lon, lat) {
  const x = (lon - LON0) * M_LON;
  const y = (lat - LAT0) * M_LAT;
  const fq = (Math.sqrt(3) * x / 3 - y / 3) / HEX_RADIUS_M;
  const fr = (2 * y / 3) / HEX_RADIUS_M;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(-fq - fr);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s + fq + fr);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  const cx = HEX_RADIUS_M * Math.sqrt(3) * (q + r / 2);
  const cy = HEX_RADIUS_M * 1.5 * r;
  return { q, r, lon: LON0 + cx / M_LON, lat: LAT0 + cy / M_LAT };
}

function gapMeters(lon, lat, lon2, lat2) {
  return Math.hypot((lon - lon2) * M_LON, (lat - lat2) * M_LAT);
}

export function createRouter(buffer, inside, treeBuffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "OMB2") throw new Error(`axes.bin illisible (${magic})`);
  const nEdges = view.getUint32(40, true);
  const nNodes = view.getUint32(44, true);
  const nChunks = view.getUint32(48, true);
  const treeView = new DataView(treeBuffer);
  const treeMagic = String.fromCharCode(...new Uint8Array(treeBuffer, 0, 4));
  if (treeMagic !== "TREE" || treeView.getUint32(4, true) !== nEdges) {
    throw new Error("tree-cover.bin incompatible avec axes.bin");
  }
  const treeToday = new Uint8Array(treeBuffer, 8, nEdges);
  const treeFuture = new Uint8Array(treeBuffer, 8 + nEdges, nEdges);
  let o = 64;
  const from = new Int32Array(buffer, o, nEdges);
  o += nEdges * 4;
  const to = new Int32Array(buffer, o, nEdges);
  o += nEdges * 4;
  const ax = new Float32Array(buffer, o, nEdges);
  o += nEdges * 4;
  const ay = new Float32Array(buffer, o, nEdges);
  o += nEdges * 4;
  const bx = new Float32Array(buffer, o, nEdges);
  o += nEdges * 4;
  const by = new Float32Array(buffer, o, nEdges);
  o += nEdges * 4;
  const len = new Float32Array(buffer, o, nEdges);
  o += nEdges * 4;
  const shade = new Uint8Array(buffer, o, nEdges * 15);
  o += nEdges * 15;
  const winter = new Uint8Array(buffer, o, nEdges * 15);
  o += nEdges * 15;
  o += nEdges;
  while (o % 4) o++;
  const chunkStart = new Uint32Array(buffer, o, nChunks);
  o += nChunks * 4;
  const chunkCount = new Uint16Array(buffer, o, nChunks);

  const chunkCoords = new Array(nChunks);
  for (let c = 0; c < nChunks; c++) {
    const start = chunkStart[c];
    const count = chunkCount[c];
    const coords = [[ax[start], ay[start]]];
    for (let k = 0; k < count; k++) coords.push([bx[start + k], by[start + k]]);
    chunkCoords[c] = coords;
  }

  const hexes = new Map();
  for (let c = 0; c < nChunks; c++) {
    const coords = chunkCoords[c];
    const middle = coords[Math.floor(coords.length / 2)];
    const hex = nearestHex(middle[0], middle[1]);
    const key = `${hex.q},${hex.r}`;
    if (!hexes.has(key)) hexes.set(key, { ...hex, chunks: [] });
    hexes.get(key).chunks.push(c);
  }

  const buckets = new Map();
  for (let e = 0; e < nEdges; e++) {
    const key = `${Math.floor(((ax[e] + bx[e]) / 2) / CELL)},${Math.floor(((ay[e] + by[e]) / 2) / CELL)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(e);
  }

  const deg = new Int32Array(nNodes);
  let links = 0;
  for (let e = 0; e < nEdges; e++) {
    if (from[e] === to[e]) continue;
    deg[from[e]]++;
    deg[to[e]]++;
    links += 2;
  }
  const off = new Int32Array(nNodes + 1);
  for (let i = 0; i < nNodes; i++) off[i + 1] = off[i] + deg[i];
  const adjTo = new Int32Array(links);
  const adjEdge = new Int32Array(links);
  const cursor = off.slice(0);
  for (let e = 0; e < nEdges; e++) {
    const a = from[e];
    const b = to[e];
    if (a === b) continue;
    let k = cursor[a]++;
    adjTo[k] = b;
    adjEdge[k] = e;
    k = cursor[b]++;
    adjTo[k] = a;
    adjEdge[k] = e;
  }

  const dist = new Float64Array(nNodes + 2);
  const stamp = new Int32Array(nNodes + 2);
  const settled = new Int32Array(nNodes + 2);
  const prevFrom = new Int32Array(nNodes + 2);
  const prevEdge = new Int32Array(nNodes + 2);
  const prevStamp = new Int32Array(nNodes + 2);
  let generation = 1;

  function share(edge, hourIndex, season, future = false) {
    const table = season === "hiver" ? winter : shade;
    const v = table[edge * 15 + hourIndex];
    if (v === 255) return -1;
    const base = v / 100;
    if (season === "hiver") return base;
    const cover = (future ? treeFuture[edge] : treeToday[edge]) / 100;
    return 1 - (1 - base) * (1 - cover);
  }

  function gain(edge, hourIndex, season) {
    if (season === "hiver" || shade[edge * 15 + hourIndex] === 255) return 0;
    return share(edge, hourIndex, season, true) - share(edge, hourIndex, season, false);
  }

  function meanChunk(c, hourIndex, season, future) {
    const start = chunkStart[c];
    const count = chunkCount[c];
    let sum = 0;
    let n = 0;
    for (let k = 0; k < count; k++) {
      const s = share(start + k, hourIndex, season, future);
      if (s < 0) continue;
      sum += s;
      n++;
    }
    return n ? sum / n : -1;
  }

  function featuresFrom(coordsList, values, gains) {
    const features = [];
    for (let i = 0; i < coordsList.length; i++) {
      if (values[i] < 0) continue;
      features.push({
        type: "Feature",
        properties: { s: values[i], g: gains[i] },
        geometry: { type: "LineString", coordinates: coordsList[i] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  function farCollection(hourIndex, season, future = false) {
    const values = new Array(nChunks);
    const gains = new Array(nChunks).fill(0);
    for (let c = 0; c < nChunks; c++) {
      values[c] = meanChunk(c, hourIndex, season, future);
      if (future && season === "ete") {
        const start = chunkStart[c];
        const count = chunkCount[c];
        for (let k = 0; k < count; k++) gains[c] += gain(start + k, hourIndex, season);
        gains[c] /= count;
      }
    }
    return featuresFrom(chunkCoords, values, gains);
  }

  function overviewCollection(hourIndex, season, future = false) {
    const features = [];
    for (const hex of hexes.values()) {
      if (!inside(hex.lon, hex.lat)) continue;
      let sum = 0;
      let weight = 0;
      for (const c of hex.chunks) {
        const value = meanChunk(c, hourIndex, season, future);
        if (value < 0) continue;
        const count = chunkCount[c];
        sum += value * count;
        weight += count;
      }
      if (weight < 8) continue;
      const ring = [];
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        ring.push([
          hex.lon + HEX_RADIUS_M * Math.cos(angle) / M_LON,
          hex.lat + HEX_RADIUS_M * Math.sin(angle) / M_LAT,
        ]);
      }
      ring.push(ring[0]);
      features.push({ type: "Feature", properties: { s: sum / weight }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
    return { type: "FeatureCollection", features };
  }

  function edgesIn(bounds) {
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    if (east - west > 0.03 || north - south > 0.02) return null;
    const ids = [];
    const x0 = Math.floor(west / CELL) - 1;
    const x1 = Math.floor(east / CELL) + 1;
    const y0 = Math.floor(south / CELL) - 1;
    const y1 = Math.floor(north / CELL) + 1;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = buckets.get(`${x},${y}`);
        if (!list) continue;
        for (const e of list) {
          if (ax[e] < west && bx[e] < west) continue;
          if (ax[e] > east && bx[e] > east) continue;
          if (ay[e] < south && by[e] < south) continue;
          if (ay[e] > north && by[e] > north) continue;
          ids.push(e);
        }
      }
    }
    return ids.length > 14000 ? null : ids;
  }

  function nearCollection(ids, hourIndex, season, future = false) {
    const features = [];
    for (const e of ids) {
      const s = share(e, hourIndex, season, future);
      if (s < 0) continue;
      features.push({
        type: "Feature",
        properties: { s, g: future ? gain(e, hourIndex, season) : 0 },
        geometry: {
          type: "LineString",
          coordinates: [
            [ax[e], ay[e]],
            [bx[e], by[e]],
          ],
        },
      });
    }
    return { type: "FeatureCollection", features };
  }

  function shadeAround(lon, lat, radiusMeters, hourIndex, season, future = false) {
    const lonRadius = radiusMeters / M_LON;
    const latRadius = radiusMeters / M_LAT;
    const x0 = Math.floor((lon - lonRadius) / CELL);
    const x1 = Math.floor((lon + lonRadius) / CELL);
    const y0 = Math.floor((lat - latRadius) / CELL);
    const y1 = Math.floor((lat + latRadius) / CELL);
    let known = 0;
    let shaded = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = buckets.get(`${x},${y}`);
        if (!list) continue;
        for (const edge of list) {
          const midLon = (ax[edge] + bx[edge]) / 2;
          const midLat = (ay[edge] + by[edge]) / 2;
          if (gapMeters(lon, lat, midLon, midLat) > radiusMeters) continue;
          const s = share(edge, hourIndex, season, future);
          if (s < 0) continue;
          known += len[edge];
          shaded += s * len[edge];
        }
      }
    }
    return known ? shaded / known : null;
  }

  function project(edge, lon, lat) {
    const abx = (bx[edge] - ax[edge]) * M_LON;
    const aby = (by[edge] - ay[edge]) * M_LAT;
    const apx = (lon - ax[edge]) * M_LON;
    const apy = (lat - ay[edge]) * M_LAT;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
    const plon = ax[edge] + (bx[edge] - ax[edge]) * t;
    const plat = ay[edge] + (by[edge] - ay[edge]) * t;
    return { t, lon: plon, lat: plat, gap: gapMeters(lon, lat, plon, plat) };
  }

  function snap(lon, lat) {
    if (!inside(lon, lat)) return { ok: false, message: "Hors de la zone calculée." };
    const cx = Math.floor(lon / CELL);
    const cy = Math.floor(lat / CELL);
    let best = null;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const list = buckets.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const edge of list) {
          const hit = project(edge, lon, lat);
          if (!best || hit.gap < best.gap) best = { ...hit, edge };
        }
      }
    }
    if (!best || best.gap > MAX_SNAP_M) return { ok: false, message: "Pas de rue calculée ici." };
    return { ok: true, lon: best.lon, lat: best.lat, t: best.t, edge: best.edge, gap: best.gap };
  }

  let components;
  function component(edge) {
    if (!components) {
      components = new Int32Array(nNodes).fill(-1);
      const queue = new Int32Array(nNodes);
      for (let start = 0; start < nNodes; start++) {
        if (components[start] !== -1) continue;
        components[start] = start;
        queue[0] = start;
        let end = 1;
        for (let i = 0; i < end; i++) {
          const node = queue[i];
          for (let k = off[node]; k < off[node + 1]; k++) {
            const next = adjTo[k];
            if (components[next] !== -1) continue;
            components[next] = start;
            queue[end++] = next;
          }
        }
      }
    }
    return components[from[edge]];
  }

  function plan(lonA, latA, lonB, latB, season, hourIndex, future = false, live = null, accept = 0) {
    const a = snap(lonA, latA);
    if (!a.ok) return a;
    const b = snap(lonB, latB);
    if (!b.ok) return b;
    const nodeA = nNodes;
    const nodeB = nNodes + 1;
    generation++;
    if (generation >= 0x7ffffffe) {
      stamp.fill(0);
      settled.fill(0);
      prevStamp.fill(0);
      generation = 1;
    }
    const table = season === "hiver" ? winter : shade;
    const sunUp = live ? Boolean(live.up) : table[a.edge * 15 + hourIndex] !== 255;
    const fracOf = (edge) => (
      live
        ? live.fraction(edge, ax[edge], ay[edge], bx[edge], by[edge])
        : share(edge, hourIndex, season, future)
    );
    const penalty = SUN_PENALTY[accept] ?? 0;
    const factor = (edge) => {
      if (!sunUp || penalty === 0) return 1;
      const frac = fracOf(edge);
      if (!(frac >= 0)) return 1;
      const exposure = accept > 50 ? frac : 1 - frac;
      return 1 + penalty * exposure;
    };

    const extras = new Map();
    const addExtra = (fromNode, toNode, edge, portion) => {
      let list = extras.get(fromNode);
      if (!list) extras.set(fromNode, (list = []));
      list.push({ to: toNode, edge, portion });
    };
    addExtra(nodeA, from[a.edge], a.edge, a.t * len[a.edge]);
    addExtra(from[a.edge], nodeA, a.edge, a.t * len[a.edge]);
    addExtra(nodeA, to[a.edge], a.edge, (1 - a.t) * len[a.edge]);
    addExtra(to[a.edge], nodeA, a.edge, (1 - a.t) * len[a.edge]);
    addExtra(nodeB, from[b.edge], b.edge, b.t * len[b.edge]);
    addExtra(from[b.edge], nodeB, b.edge, b.t * len[b.edge]);
    addExtra(nodeB, to[b.edge], b.edge, (1 - b.t) * len[b.edge]);
    addExtra(to[b.edge], nodeB, b.edge, (1 - b.t) * len[b.edge]);
    if (a.edge === b.edge) {
      const portion = Math.abs(a.t - b.t) * len[a.edge];
      addExtra(nodeA, nodeB, a.edge, portion);
      addExtra(nodeB, nodeA, a.edge, portion);
    }

    const distOf = (node) => (stamp[node] === generation ? dist[node] : Infinity);
    const heapN = [nodeA];
    const heapD = [0];
    dist[nodeA] = 0;
    stamp[nodeA] = generation;
    const push = (id, d) => {
      let i = heapN.length;
      heapN.push(id);
      heapD.push(d);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapD[p] <= heapD[i]) break;
        const tn = heapN[p];
        const td = heapD[p];
        heapN[p] = heapN[i];
        heapD[p] = heapD[i];
        heapN[i] = tn;
        heapD[i] = td;
        i = p;
      }
    };
    const pop = () => {
      const id = heapN[0];
      const d = heapD[0];
      const ln = heapN.pop();
      const ld = heapD.pop();
      if (heapN.length) {
        heapN[0] = ln;
        heapD[0] = ld;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heapN.length && heapD[l] < heapD[m]) m = l;
          if (r < heapN.length && heapD[r] < heapD[m]) m = r;
          if (m === i) break;
          const tn = heapN[m];
          const td = heapD[m];
          heapN[m] = heapN[i];
          heapD[m] = heapD[i];
          heapN[i] = tn;
          heapD[i] = td;
          i = m;
        }
      }
      return { id, d };
    };

    const relax = (node, next, edge, portion) => {
      const nd = distOf(node) + portion * factor(edge);
      if (nd < distOf(next)) {
        dist[next] = nd;
        stamp[next] = generation;
        prevFrom[next] = node;
        prevEdge[next] = edge;
        prevStamp[next] = generation;
        push(next, nd);
      }
    };

    let found = nodeA === nodeB;
    while (heapN.length) {
      const current = pop();
      if (settled[current.id] === generation) continue;
      if (current.d > distOf(current.id) + 1e-6) continue;
      settled[current.id] = generation;
      if (current.id === nodeB) {
        found = true;
        break;
      }
      if (current.id < nNodes) {
        for (let k = off[current.id]; k < off[current.id + 1]; k++) {
          relax(current.id, adjTo[k], adjEdge[k], len[adjEdge[k]]);
        }
      }
      const extra = extras.get(current.id);
      if (extra) {
        for (const link of extra) relax(current.id, link.to, link.edge, link.portion);
      }
    }
    if (!found) return { ok: false, message: "Pas de chemin sur les rues calculées." };

    const chain = [nodeB];
    let cursor = nodeB;
    let guard = 0;
    while (cursor !== nodeA) {
      if (prevStamp[cursor] !== generation) return { ok: false, message: "Pas de chemin sur les rues calculées." };
      cursor = prevFrom[cursor];
      if (++guard > nEdges + 2) return { ok: false, message: "Pas de chemin sur les rues calculées." };
      chain.push(cursor);
    }
    chain.reverse();

    const tOf = (node, edge) => {
      if (node === nodeA) return a.t;
      if (node === nodeB) return b.t;
      if (from[edge] === node) return 0;
      if (to[edge] === node) return 1;
      return null;
    };

    const segments = [];
    let length = 0;
    let known = 0;
    let shaded = 0;
    let shadedToday = 0;
    for (let i = 1; i < chain.length; i++) {
      const edge = prevEdge[chain[i]];
      const t0 = tOf(chain[i - 1], edge);
      const t1 = tOf(chain[i], edge);
      if (t0 == null || t1 == null) continue;
      const portion = Math.abs(t1 - t0) * len[edge];
      if (portion === 0) continue;
      const s = fracOf(edge);
      const lon0 = ax[edge] + (bx[edge] - ax[edge]) * t0;
      const lat0 = ay[edge] + (by[edge] - ay[edge]) * t0;
      const lon1 = ax[edge] + (bx[edge] - ax[edge]) * t1;
      const lat1 = ay[edge] + (by[edge] - ay[edge]) * t1;
      segments.push({
        coords: [
          [lon0, lat0],
          [lon1, lat1],
        ],
        s,
        len: portion,
      });
      length += portion;
      if (s >= 0) {
        known += portion;
        shaded += s * portion;
        shadedToday += (live ? s : share(edge, hourIndex, season, false)) * portion;
      }
    }
    return {
      ok: true,
      neutral: !sunUp,
      origin: [a.lon, a.lat],
      destination: [b.lon, b.lat],
      segments,
      length,
      shade: known > 0 ? shaded / known : null,
      todayShade: known > 0 ? shadedToday / known : null,
    };
  }

  function coloredEdges(ids, fraction) {
    const features = [];
    for (const e of ids) {
      const s = fraction(e, ax[e], ay[e], bx[e], by[e]);
      if (!(s >= 0)) continue;
      features.push({
        type: "Feature",
        properties: { s, g: 0 },
        geometry: {
          type: "LineString",
          coordinates: [
            [ax[e], ay[e]],
            [bx[e], by[e]],
          ],
        },
      });
    }
    return { type: "FeatureCollection", features };
  }

  function chunkSample(c, fraction) {
    const count = chunkCount[c];
    if (!count) return -1;
    const edge = chunkStart[c] + (count >> 1);
    return fraction(edge, ax[edge], ay[edge], bx[edge], by[edge]);
  }

  function liveFar(fraction) {
    const values = new Array(nChunks);
    const gains = new Array(nChunks).fill(0);
    for (let c = 0; c < nChunks; c++) values[c] = chunkSample(c, fraction);
    return featuresFrom(chunkCoords, values, gains);
  }

  function liveOverview(fraction) {
    const features = [];
    for (const hex of hexes.values()) {
      if (!inside(hex.lon, hex.lat)) continue;
      let sum = 0;
      let weight = 0;
      for (const c of hex.chunks) {
        const value = chunkSample(c, fraction);
        if (!(value >= 0)) continue;
        const count = chunkCount[c];
        sum += value * count;
        weight += count;
      }
      if (weight < 8) continue;
      const ring = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        ring.push([
          hex.lon + (HEX_RADIUS_M * Math.cos(angle)) / M_LON,
          hex.lat + (HEX_RADIUS_M * Math.sin(angle)) / M_LAT,
        ]);
      }
      ring.push(ring[0]);
      features.push({
        type: "Feature",
        properties: { s: sum / weight },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  return { nEdges, nChunks, farCollection, overviewCollection, liveFar, liveOverview, edgesIn, nearCollection, coloredEdges, shadeAround, snap, component, plan };
}

export function indexBuildings(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "BAT1") throw new Error(`batis.bin illisible (${magic})`);
  const count = view.getUint32(4, true);
  const offset = new Uint32Array(count);
  const hdm = new Uint16Array(count);
  const minLon = new Float32Array(count);
  const minLat = new Float32Array(count);
  const maxLon = new Float32Array(count);
  const maxLat = new Float32Array(count);
  let o = 8;
  for (let i = 0; i < count; i++) {
    offset[i] = o;
    const h = view.getUint16(o, true);
    hdm[i] = h;
    o += 2;
    const nParts = view.getUint8(o++);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < nParts; p++) {
      const nRings = view.getUint8(o++);
      for (let r = 0; r < nRings; r++) {
        const nPts = view.getUint16(o, true);
        o += 2;
        for (let k = 0; k < nPts; k++) {
          const lon = view.getInt32(o, true) / 1e6;
          const lat = view.getInt32(o + 4, true) / 1e6;
          o += 8;
          if (lon < minX) minX = lon;
          if (lat < minY) minY = lat;
          if (lon > maxX) maxX = lon;
          if (lat > maxY) maxY = lat;
        }
      }
    }
    minLon[i] = minX;
    minLat[i] = minY;
    maxLon[i] = maxX;
    maxLat[i] = maxY;
  }

  function readRing(at, nPts) {
    const coords = new Array(nPts + 1);
    for (let k = 0; k < nPts; k++) {
      coords[k] = [view.getInt32(at, true) / 1e6, view.getInt32(at + 4, true) / 1e6];
      at += 8;
    }
    coords[nPts] = coords[0];
    return { coords, at };
  }

  function simplifyClosed(coords, maxPts) {
    const n = coords.length - 1;
    if (n <= maxPts) return coords;
    const step = Math.ceil(n / maxPts);
    const out = [];
    for (let i = 0; i < n; i += step) out.push(coords[i]);
    out.push(out[0]);
    return out;
  }

  function exteriorRing(i) {
    let at = offset[i] + 2;
    if (view.getUint8(at++) < 1) return null;
    if (view.getUint8(at++) < 1) return null;
    const nPts = view.getUint16(at, true);
    at += 2;
    return simplifyClosed(readRing(at, nPts).coords, 6);
  }

  let mesh = null;
  function cityMesh() {
    if (mesh) return mesh;
    const features = [];
    for (let i = 0; i < count; i++) {
      const ring = exteriorRing(i);
      if (!ring || ring.length < 4) continue;
      const known = hdm[i] > 0;
      features.push({
        type: "Feature",
        properties: { known: known ? 1 : 0, h: known ? hdm[i] / 10 : 0 },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
    mesh = { type: "FeatureCollection", features };
    return mesh;
  }

  function featuresIn(west, south, east, north, limit = 3500) {
    const features = [];
    for (let i = 0; i < count; i++) {
      if (maxLon[i] < west || minLon[i] > east || maxLat[i] < south || minLat[i] > north) continue;
      features.push(i);
      if (features.length > limit) return null;
    }
    const out = [];
    for (const i of features) {
      let at = offset[i] + 2;
      const nParts = view.getUint8(at++);
      const parts = [];
      for (let p = 0; p < nParts; p++) {
        const nRings = view.getUint8(at++);
        const rings = [];
        for (let r = 0; r < nRings; r++) {
          const nPts = view.getUint16(at, true);
          at += 2;
          const read = readRing(at, nPts);
          at = read.at;
          rings.push(read.coords);
        }
        parts.push(rings);
      }
      const known = hdm[i] > 0;
      out.push({
        type: "Feature",
        properties: { known: known ? 1 : 0, h: known ? hdm[i] / 10 : 0 },
        geometry:
          parts.length === 1
            ? { type: "Polygon", coordinates: parts[0] }
            : { type: "MultiPolygon", coordinates: parts },
      });
    }
    return { type: "FeatureCollection", features: out };
  }

  const INDEX_CELL = 0.002;
  let grid = null;

  function ensureGrid() {
    if (grid) return;
    grid = new Map();
    for (let i = 0; i < count; i++) {
      if (!(hdm[i] > 0) || !Number.isFinite(minLon[i])) continue;
      const x0 = Math.floor(minLon[i] / INDEX_CELL);
      const x1 = Math.floor(maxLon[i] / INDEX_CELL);
      const y0 = Math.floor(minLat[i] / INDEX_CELL);
      const y1 = Math.floor(maxLat[i] / INDEX_CELL);
      if (x1 - x0 > 20 || y1 - y0 > 20) continue;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  const ringCache = new Array(count);
  function exterior(i) {
    if (ringCache[i] !== undefined) return ringCache[i];
    let at = offset[i] + 2;
    const nParts = view.getUint8(at++);
    if (nParts < 1) {
      ringCache[i] = null;
      return null;
    }
    const nRings = view.getUint8(at++);
    if (nRings < 1) {
      ringCache[i] = null;
      return null;
    }
    const nPts = view.getUint16(at, true);
    at += 2;
    const read = readRing(at, nPts);
    ringCache[i] = read.coords;
    return read.coords;
  }

  function inBox(west, south, east, north) {
    ensureGrid();
    const x0 = Math.floor(west / INDEX_CELL);
    const x1 = Math.floor(east / INDEX_CELL);
    const y0 = Math.floor(south / INDEX_CELL);
    const y1 = Math.floor(north / INDEX_CELL);
    const seen = new Set();
    const out = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const list = grid.get(`${x},${y}`);
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (maxLon[i] < west || minLon[i] > east || maxLat[i] < south || minLat[i] > north) continue;
          out.push(i);
        }
      }
    }
    return out;
  }

  function heightOf(i) {
    return hdm[i] / 10;
  }

  return { count, featuresIn, cityMesh, inBox, exterior, heightOf };
}
