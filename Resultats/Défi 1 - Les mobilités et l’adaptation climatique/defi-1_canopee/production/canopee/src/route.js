/**
 * Plus court chemin sur les axes BD TOPO déjà chargés.
 * Été : un mètre au soleil coûte plus cher. Hiver : un mètre à l’ombre coûte plus cher.
 * La part affichée est la moyenne des parts d’ombre des tronçons, pondérée par leur longueur.
 */

const LAT0 = 48.8551;
const M_LAT = 111132.92 - 559.82 * Math.cos((2 * LAT0 * Math.PI) / 180);
const M_LON = 111412.84 * Math.cos((LAT0 * Math.PI) / 180);
const SNAP_M = 14;
const BRIDGE_SNAP_M = 12;
const MAX_SNAP_M = 60;
const PREFERENCE = 30;

function xy(lon, lat) {
  return [(lon - 2.3479) * M_LON, (lat - LAT0) * M_LAT];
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function lineMeters(coords) {
  let total = 0;
  const parts = [];
  for (let i = 1; i < coords.length; i++) {
    const step = dist(xy(coords[i - 1][0], coords[i - 1][1]), xy(coords[i][0], coords[i][1]));
    parts.push(step);
    total += step;
  }
  return { total, parts };
}

function cutLine(coords, parts, fromM, toM) {
  const out = [];
  let walked = 0;
  const push = (lon, lat) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - lon) < 1e-8 && Math.abs(last[1] - lat) < 1e-8) return;
    out.push([lon, lat]);
  };
  for (let i = 1; i < coords.length; i++) {
    const step = parts[i - 1];
    const start = walked;
    const end = walked + step;
    if (end < fromM - 1e-6) {
      walked = end;
      continue;
    }
    if (start > toM + 1e-6) break;
    const a = coords[i - 1];
    const b = coords[i];
    const t0 = step === 0 ? 0 : Math.max(0, Math.min(1, (fromM - start) / step));
    const t1 = step === 0 ? 1 : Math.max(0, Math.min(1, (toM - start) / step));
    if (start >= fromM - 1e-6 && out.length === 0) push(a[0], a[1]);
    if (t0 > 0 && start < fromM) push(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0);
    if (t1 < 1 && end > toM) push(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
    else if (end <= toM + 1e-6) push(b[0], b[1]);
    walked = end;
  }
  return out;
}

function inBounds(lon, lat, bounds) {
  const [[west, south], [east, north]] = bounds;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

export function buildGraph(features) {
  const ends = [];
  const edges = [];
  for (const feature of features) {
    const coords = feature.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const measured = lineMeters(coords);
    if (measured.total < 1) continue;
    const edge = {
      coords,
      parts: measured.parts,
      len: measured.total,
      shade: feature.properties.shade,
      winter: feature.properties.winter,
      bridge: feature.properties.bridge === 1,
      name: feature.properties.name || "",
    };
    edge.a = ends.length;
    ends.push({ x: xy(coords[0][0], coords[0][1]), bridge: edge.bridge, edge: edges.length, side: "a" });
    edge.b = ends.length;
    ends.push({
      x: xy(coords[coords.length - 1][0], coords[coords.length - 1][1]),
      bridge: edge.bridge,
      edge: edges.length,
      side: "b",
    });
    edges.push(edge);
  }

  const parent = ends.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };

  const cell = 12;
  const buckets = new Map();
  const keyOf = (p) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
  for (let i = 0; i < ends.length; i++) {
    const key = keyOf(ends[i].x);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  for (let i = 0; i < ends.length; i++) {
    const [cx, cy] = keyOf(ends[i].x).split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = buckets.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const gap = dist(ends[i].x, ends[j].x);
          const same = ends[i].bridge === ends[j].bridge;
          if (same ? gap <= SNAP_M : gap <= BRIDGE_SNAP_M) union(i, j);
        }
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < ends.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  const nodeOfEnd = new Array(ends.length);
  const nodes = [];
  for (const members of groups.values()) {
    const id = nodes.length;
    let x = 0;
    let y = 0;
    for (const index of members) {
      nodeOfEnd[index] = id;
      x += ends[index].x[0];
      y += ends[index].x[1];
    }
    nodes.push({ x: x / members.length, y: y / members.length });
  }
  for (const edge of edges) {
    edge.from = nodeOfEnd[edge.a];
    edge.to = nodeOfEnd[edge.b];
  }

  return { edges, nodes };
}

function projectPoint(edge, lon, lat) {
  const p = xy(lon, lat);
  let best = null;
  let walked = 0;
  for (let i = 1; i < edge.coords.length; i++) {
    const a = xy(edge.coords[i - 1][0], edge.coords[i - 1][1]);
    const b = xy(edge.coords[i][0], edge.coords[i][1]);
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
    const x = a[0] + abx * t;
    const y = a[1] + aby * t;
    const gap = Math.hypot(p[0] - x, p[1] - y);
    const along = walked + Math.hypot(abx, aby) * t;
    if (!best || gap < best.gap) {
      best = {
        gap,
        along,
        lon: edge.coords[i - 1][0] + (edge.coords[i][0] - edge.coords[i - 1][0]) * t,
        lat: edge.coords[i - 1][1] + (edge.coords[i][1] - edge.coords[i - 1][1]) * t,
      };
    }
    walked += edge.parts[i - 1];
  }
  return best;
}

function orient(edge, from, to) {
  if (edge.from === from && edge.to === to) return { len: edge.len, coords: edge.coords, forward: true };
  return {
    len: edge.len,
    coords: [...edge.coords].reverse(),
    forward: false,
  };
}

function piece(edge, fromM, toM) {
  const coords = cutLine(edge.coords, edge.parts, Math.min(fromM, toM), Math.max(fromM, toM));
  if (fromM > toM) coords.reverse();
  return { len: Math.abs(toM - fromM), coords, shade: edge.shade, winter: edge.winter, name: edge.name };
}

function dijkstra(adj, start, goal, weight) {
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const heap = [{ id: start, d: 0 }];
  const seen = new Set();
  while (heap.length) {
    heap.sort((a, b) => a.d - b.d);
    const current = heap.shift();
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    if (current.id === goal) break;
    for (const link of adj.get(current.id) || []) {
      const next = current.d + weight(link.piece);
      const known = dist.get(link.to);
      if (known == null || next < known) {
        dist.set(link.to, next);
        prev.set(link.to, { from: current.id, piece: link.piece });
        heap.push({ id: link.to, d: next });
      }
    }
  }
  if (!prev.has(goal) && start !== goal) return null;
  const pieces = [];
  let cursor = goal;
  while (cursor !== start) {
    const step = prev.get(cursor);
    if (!step) return null;
    pieces.push(step.piece);
    cursor = step.from;
  }
  pieces.reverse();
  return pieces;
}

function weightOf(piece, season, hourIndex, prefer) {
  const series = season === "hiver" ? piece.winter : piece.shade;
  const shade = series?.[hourIndex];
  if (shade == null || shade < 0 || !prefer) return piece.len;
  const exposure = season === "hiver" ? shade : 1 - shade;
  return piece.len * (1 + PREFERENCE * exposure);
}

function shadeBand(value) {
  if (value == null || value < 0) return "inconnu";
  if (value >= 0.6) return "ombre";
  if (value <= 0.35) return "soleil";
  return "mixte";
}

function summarize(pieces, season, hourIndex) {
  const segments = [];
  let length = 0;
  let known = 0;
  let shaded = 0;
  const names = [];
  for (const piece of pieces) {
    if (!piece.coords || piece.coords.length < 2 || piece.len < 0.4) continue;
    length += piece.len;
    const shade = (season === "hiver" ? piece.winter : piece.shade)?.[hourIndex];
    if (shade != null && shade >= 0 && piece.len > 0) {
      known += piece.len;
      shaded += shade * piece.len;
    }
    if (piece.name && names[names.length - 1] !== piece.name) names.push(piece.name);
    segments.push({ coords: piece.coords, band: shadeBand(shade), len: piece.len });
  }
  return {
    segments,
    length,
    shade: known > 0 ? shaded / known : null,
    sun: known > 0 ? 1 - shaded / known : null,
    names: names.filter(Boolean),
  };
}

export function snapToStreet(graph, point, bounds) {
  if (!inBounds(point[0], point[1], bounds)) return { ok: false, message: "Hors de la zone calculée." };
  let best = null;
  for (const edge of graph.edges) {
    const hit = projectPoint(edge, point[0], point[1]);
    if (!best || hit.gap < best.gap) best = { ...hit, edge };
  }
  if (!best || best.gap > MAX_SNAP_M) return { ok: false, message: "Pas de rue calculée ici." };
  return { ok: true, lon: best.lon, lat: best.lat, along: best.along, edge: best.edge, gap: best.gap };
}

export function planRoute(graph, origin, destination, bounds, season, hourIndex) {
  const stops = [origin, destination].map((point) => snapToStreet(graph, point, bounds));
  if (stops.some((stop) => !stop.ok)) return { ok: false, message: stops.find((stop) => !stop.ok).message };

  const sunUp = graph.edges.some((edge) => {
    const series = season === "hiver" ? edge.winter : edge.shade;
    return series[hourIndex] >= 0;
  });

  const adj = new Map();
  const add = (from, to, piece) => {
    if (piece.len < 0.4 || piece.coords.length < 2) return;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, piece });
  };
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    const forward = orient(edge, edge.from, edge.to);
    const backward = orient(edge, edge.to, edge.from);
    const base = { shade: edge.shade, winter: edge.winter, name: edge.name };
    add(edge.from, edge.to, { ...base, len: edge.len, coords: forward.coords });
    add(edge.to, edge.from, { ...base, len: edge.len, coords: backward.coords });
  }

  const extras = [];
  stops.forEach((stop, index) => {
    const id = `stop-${index}`;
    const edge = stop.edge;
    extras.push({ id, at: stop.along, edge, lon: stop.lon, lat: stop.lat });
    add(id, edge.from, piece(edge, stop.along, 0));
    add(edge.from, id, piece(edge, 0, stop.along));
    add(id, edge.to, piece(edge, stop.along, edge.len));
    add(edge.to, id, piece(edge, edge.len, stop.along));
  });
  if (stops[0].edge === stops[1].edge) {
    add("stop-0", "stop-1", piece(stops[0].edge, extras[0].at, extras[1].at));
    add("stop-1", "stop-0", piece(stops[0].edge, extras[1].at, extras[0].at));
  }

  const pieces = dijkstra(adj, "stop-0", "stop-1", (piece) => weightOf(piece, season, hourIndex, sunUp));
  if (!pieces) return { ok: false, message: "Pas de chemin sur les rues calculées." };

  const summary = summarize(pieces, season, hourIndex);
  return {
    ok: true,
    neutral: !sunUp,
    origin: [stops[0].lon, stops[0].lat],
    destination: [stops[1].lon, stops[1].lat],
    ...summary,
  };
}
