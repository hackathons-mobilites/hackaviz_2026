import * as maplibregl from "maplibre-gl";

const TAU = Math.PI * 2;

function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

function push(dst, x, y, z, color) {
  dst.push(x, y, z, color[0], color[1], color[2]);
}

function tri(dst, a, b, c, color) {
  push(dst, a[0], a[1], a[2], color);
  push(dst, b[0], b[1], b[2], color);
  push(dst, c[0], c[1], c[2], color);
}

function quad(dst, a, b, c, d, color) {
  tri(dst, a, b, c, color);
  tri(dst, a, c, d, color);
}

function shade(color, k) {
  return color.map((v) => Math.min(1, v * k));
}

function box(dst, cx, cy, z0, w, d, h, color) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - d / 2;
  const y1 = cy + d / 2;
  const z1 = z0 + h;
  const side = shade(color, 0.78);
  const top = shade(color, 1.12);
  quad(dst, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side);
  quad(dst, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], side);
  quad(dst, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], shade(color, 0.66));
  quad(dst, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], shade(color, 0.9));
  quad(dst, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], top);
}

function hash2(i, j) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(j + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h >>> 0) / 4294967296;
}

function sphere(dst, cx, cy, cz, radius, stacks, slices, color) {
  for (let i = 0; i < stacks; i++) {
    const v0 = (Math.PI * i) / stacks;
    const v1 = (Math.PI * (i + 1)) / stacks;
    for (let j = 0; j < slices; j++) {
      const u0 = (TAU * j) / slices;
      const u1 = (TAU * (j + 1)) / slices;
      const p = (v, u) => [
        cx + Math.sin(v) * Math.cos(u) * radius,
        cy + Math.sin(v) * Math.sin(u) * radius,
        cz + Math.cos(v) * radius * 0.82,
      ];
      quad(dst, p(v0, u0), p(v0, u1), p(v1, u1), p(v1, u0), shade(color, 0.7 + 0.4 * (1 - i / stacks)));
    }
  }
}

function prism(dst, cx, cy, z0, z1, radius, sides, color) {
  const side = shade(color, 0.8);
  const top = shade(color, 1.1);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * TAU;
    const a1 = ((i + 1) / sides) * TAU;
    const p0 = [cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius];
    const p1 = [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius];
    quad(dst, [p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], side);
    tri(dst, [cx, cy, z1], [p0[0], p0[1], z1], [p1[0], p1[1], z1], top);
  }
}

function bicycle(dst, x, color) {
  const tire = rgb("#172d30");
  const rim = rgb("#aac7c4");
  for (const y of [-0.88, 0.88]) {
    for (let i = 0; i < 12; i++) {
      const ring = (side, radius, step) => {
        const angle = step / 12 * TAU;
        return [x + side, y + Math.cos(angle) * radius, 0.52 + Math.sin(angle) * radius];
      };
      for (const side of [-0.09, 0.09]) {
        quad(dst, ring(side, 0.5, i), ring(side, 0.5, i + 1), ring(side, 0.37, i + 1), ring(side, 0.37, i), tire);
      }
      quad(dst, ring(-0.09, 0.5, i), ring(-0.09, 0.5, i + 1), ring(0.09, 0.5, i + 1), ring(0.09, 0.5, i), tire);
    }
    box(dst, x, y, 0.17, 0.07, 0.07, 0.7, rim);
  }
  const frame = ([y0, z0], [y1, z1], thickness, paint = color) => {
    const length = Math.hypot(y1 - y0, z1 - z0);
    const dy = (z0 - z1) / length * thickness;
    const dz = (y1 - y0) / length * thickness;
    const a = [x - thickness, y0 + dy, z0 + dz];
    const b = [x - thickness, y1 + dy, z1 + dz];
    const c = [x + thickness, y1 + dy, z1 + dz];
    const d = [x + thickness, y0 + dy, z0 + dz];
    quad(dst, a, b, c, d, paint);
    for (const side of [-thickness, thickness]) {
      quad(dst, [x + side, y0 - dy, z0 - dz], [x + side, y1 - dy, z1 - dz], [x + side, y1 + dy, z1 + dz], [x + side, y0 + dy, z0 + dz], shade(paint, 0.9));
    }
  };
  const rear = [-0.88, 0.52];
  const crank = [-0.12, 0.49];
  const seat = [-0.49, 1.22];
  const front = [0.54, 1.21];
  frame(rear, seat, 0.07);
  frame(rear, crank, 0.07);
  frame(crank, seat, 0.075);
  frame(crank, front, 0.13);
  frame(front, [0.88, 0.52], 0.07);
  frame(front, [0.47, 1.52], 0.06, rim);
  box(dst, x, -0.52, 1.22, 0.23, 0.37, 0.09, tire);
  box(dst, x, 0.47, 1.52, 0.56, 0.1, 0.08, tire);
  box(dst, x, 1.18, 0.06, 0.31, 0.32, 0.77, rgb("#52747b"));
}

function buildModels() {
  const fountain = [];
  prism(fountain, 0, 0, 0.15, 1.15, 2.4, 8, rgb("#0878ad"));
  prism(fountain, 0, 0, 0.7, 1.35, 1.7, 8, rgb("#b7e4f5"));
  prism(fountain, 0, 0, 1.15, 3.1, 0.28, 6, rgb("#f4f7f8"));

  const velib = [];
  box(velib, 0, 0, 0.02, 5.4, 2.9, 0.045, rgb("#dce8e3"));
  for (const [x, color] of [[-1.8, "#79ad42"], [-0.6, "#3896ce"], [0.6, "#79ad42"], [1.8, "#3896ce"]]) {
    bicycle(velib, x, rgb(color));
  }

  const metro = [];
  const railing = rgb("#245449");
  box(metro, 0, 0, 0.04, 3.7, 4.5, 0.08, rgb("#163039"));
  for (let step = 0; step < 7; step++) {
    box(metro, 0, -1.77 + step * 0.48, 0.12, 3.2, 0.48, 0.22 + (6 - step) * 0.13, rgb("#bac8c8"));
  }
  for (const x of [-1.77, 1.77]) {
    box(metro, x, 0, 0.12, 0.18, 4.35, 0.44, railing);
    box(metro, x, 0, 1.42, 0.16, 4.4, 0.12, railing);
    for (let post = 0; post < 7; post++) box(metro, x, -2.1 + post * 0.7, 0.55, 0.09, 0.09, 0.88, railing);
    box(metro, x, -2.1, 0.55, 0.17, 0.17, 2.68, railing);
  }
  box(metro, 0, -2.1, 2.75, 3.75, 0.25, 0.65, rgb("#a93034"));
  for (const y of [-2.24, -1.96]) {
    const letter = rgb("#fff1ce");
    for (const x of [-0.23, 0.23]) box(metro, x, y, 2.88, 0.07, 0.02, 0.39, letter);
    for (const x of [-0.12, 0.12]) box(metro, x, y, 3.03, 0.2, 0.02, 0.08, letter);
    box(metro, 0, y, 2.96, 0.08, 0.02, 0.13, letter);
  }

  const bus = [];
  box(bus, 0, 0, 0.05, 3.1, 1.35, 0.12, rgb("#c4b08a"));
  box(bus, -1.3, 0.45, 0.15, 0.1, 0.1, 2.15, rgb("#5c656b"));
  box(bus, 1.3, 0.45, 0.15, 0.1, 0.1, 2.15, rgb("#5c656b"));
  box(bus, 0, 0, 2.25, 3.4, 1.6, 0.1, rgb("#e7eef3"));
  box(bus, 0, 0.55, 0.15, 2.4, 0.08, 1.3, rgb("#d5e4ef"));

  const gare = [];
  box(gare, 0, 0, 0.05, 8.2, 5.2, 0.25, rgb("#6d6256"));
  box(gare, 0, 0, 0.25, 7.2, 4.2, 4.4, rgb("#d9d0c4"));
  box(gare, 0, 0, 4.6, 8.4, 5.4, 0.4, rgb("#2c3a52"));
  box(gare, 3.1, 1.8, 0.25, 1.15, 1.15, 7.2, rgb("#8d8376"));
  box(gare, 3.1, 1.8, 7.3, 1.45, 1.45, 0.35, rgb("#2c3a52"));

  const cool = [];
  box(cool, -1.8, -1.4, 0.05, 0.16, 0.16, 2.7, rgb("#217464"));
  box(cool, 1.8, -1.4, 0.05, 0.16, 0.16, 2.7, rgb("#217464"));
  box(cool, -1.8, 1.4, 0.05, 0.16, 0.16, 2.7, rgb("#217464"));
  box(cool, 1.8, 1.4, 0.05, 0.16, 0.16, 2.7, rgb("#217464"));
  box(cool, 0, 0, 2.7, 4.4, 3.4, 0.14, rgb("#d7f3ea"));
  box(cool, 0, 0, 0.05, 3.2, 2.2, 0.12, rgb("#8fbf9a"));

  const tree = [];
  prism(tree, 0, 0, 0.12, 4.4, 0.28, 10, rgb("#6a4b30"));
  sphere(tree, 0, 0, 5.6, 2.05, 6, 14, rgb("#3d8638"));
  sphere(tree, 0, 0, 6.9, 1.25, 5, 12, rgb("#62b04c"));

  const lawn = [];
  prism(lawn, 0, 0, 0.7, 1.25, 3.4, 8, rgb("#b6e07a"));

  const path = [];
  box(path, 0, 0, 0.68, 12, 1.7, 0.28, rgb("#c4ae86"));

  return {
    fountain: Float32Array.from(fountain),
    velib: Float32Array.from(velib),
    metro: Float32Array.from(metro),
    bus: Float32Array.from(bus),
    gare: Float32Array.from(gare),
    cool: Float32Array.from(cool),
    tree: Float32Array.from(tree),
    lawn: Float32Array.from(lawn),
    path: Float32Array.from(path),
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const VERT = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_color;
layout(location = 2) in vec4 a_m0;
layout(location = 3) in vec4 a_m1;
layout(location = 4) in vec4 a_m2;
layout(location = 5) in vec4 a_m3;
uniform mat4 u_matrix;
out vec3 v_color;
void main() {
  mat4 local = mat4(a_m0, a_m1, a_m2, a_m3);
  gl_Position = u_matrix * local * vec4(a_pos, 1.0);
  v_color = a_color;
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform float u_grain;
in vec3 v_color;
out vec4 fragColor;
void main() {
  float speck = fract(sin(dot(gl_FragCoord.xy, vec2(127.1, 311.7))) * 43758.5453);
  fragColor = vec4(clamp(v_color + (speck - 0.5) * u_grain, 0.0, 1.0), 1.0);
}`;

export const VOLUME_ZOOM = 13;

const DRAW_ORDER = ["lawn", "path", "tree", "fountain", "velib", "cool", "bus", "metro", "gare"];

function localMatrix(lng, lat, yaw, scale, scaleZ) {
  const origin = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
  const unit = origin.meterInMercatorCoordinateUnits();
  const sxy = unit * scale;
  const sz = unit * (scaleZ ?? scale);
  const cos = Math.cos(yaw) * sxy;
  const sin = Math.sin(yaw) * sxy;
  return [
    cos, -sin, 0, 0,
    -sin, -cos, 0, 0,
    0, 0, sz, 0,
    origin.x, origin.y, 0, 1,
  ];
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
  return shader;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function noise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const n = (ix, iy) => hash2(ix, iy) * 2 - 1;
  const a = n(x0, y0);
  const b = n(x0 + 1, y0);
  const c = n(x0, y0 + 1);
  const d = n(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function grassTint(east, north) {
  const broad = noise(east / 16, north / 16);
  const fine = noise(east / 5.5, north / 5.5);
  const t = Math.min(1, Math.max(0, 0.46 + broad * 0.34 + fine * 0.18));
  return [0.28 + t * 0.34, 0.48 + t * 0.34, 0.22 + t * 0.18];
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function ringHas(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat)) {
      const x = ((ring[j][0] - ring[i][0]) * (lat - yi)) / (yj - yi) + ring[i][0];
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

function polyHas(lon, lat, polygons) {
  for (const rings of polygons) {
    if (!rings[0] || !ringHas(lon, lat, rings[0])) continue;
    let hole = false;
    for (let h = 1; h < rings.length; h++) if (ringHas(lon, lat, rings[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

function shapeBounds(polygons) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const rings of polygons) {
    for (const point of rings[0] || []) {
      west = Math.min(west, point[0]);
      east = Math.max(east, point[0]);
      south = Math.min(south, point[1]);
      north = Math.max(north, point[1]);
    }
  }
  return { west, east, south, north };
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(area) * 0.5 * 73400 * 111132;
}

function pushMerc(dst, lon, lat, z, color) {
  const origin = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
  const unit = origin.meterInMercatorCoordinateUnits();
  dst.push(origin.x, origin.y, z * unit, color[0], color[1], color[2]);
}

function appendRim(dst, ring, toM, toLL) {
  if (!ring || ring.length < 4) return;
  const open = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
  const n = open.length;
  if (n < 3) return;
  const meters = open.map((point) => toM(point[0], point[1]));
  let signed = 0;
  for (let i = 0; i < n; i++) {
    const a = meters[i];
    const b = meters[(i + 1) % n];
    signed += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = signed > 0;
  const width = 2.1;
  const rim = [0.17, 0.34, 0.15];
  const inner = meters.map((cur, i) => {
    const prev = meters[(i - 1 + n) % n];
    const next = meters[(i + 1) % n];
    let d1x = cur[0] - prev[0];
    let d1y = cur[1] - prev[1];
    let d2x = next[0] - cur[0];
    let d2y = next[1] - cur[1];
    const l1 = Math.hypot(d1x, d1y) || 1;
    const l2 = Math.hypot(d2x, d2y) || 1;
    d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
    const n1x = ccw ? -d1y : d1y;
    const n1y = ccw ? d1x : -d1x;
    const n2x = ccw ? -d2y : d2y;
    const n2y = ccw ? d2x : -d2x;
    let nx = n1x + n2x;
    let ny = n1y + n2y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const along = Math.max(0.45, n1x * nx + n1y * ny);
    const scale = Math.min(1.8, 1 / along);
    return [cur[0] + nx * width * scale, cur[1] + ny * width * scale];
  });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = toLL(meters[i][0], meters[i][1]);
    const b = toLL(meters[j][0], meters[j][1]);
    const c = toLL(inner[j][0], inner[j][1]);
    const d = toLL(inner[i][0], inner[i][1]);
    pushMerc(dst, a[0], a[1], 0.74, rim);
    pushMerc(dst, b[0], b[1], 0.74, rim);
    pushMerc(dst, c[0], c[1], 0.74, rim);
    pushMerc(dst, a[0], a[1], 0.74, rim);
    pushMerc(dst, c[0], c[1], 0.74, rim);
    pushMerc(dst, d[0], d[1], 0.74, rim);
  }
}

function appendPark(dst, polygons) {
  const anchor = polygons[0][0][0];
  const lon0 = anchor[0];
  const lat0 = anchor[1];
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const toM = (lon, lat) => [(lon - lon0) * 111320 * cosLat, (lat - lat0) * 110540];
  const toLL = (east, north) => [lon0 + east / (111320 * cosLat), lat0 + north / 110540];
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  let area = 0;
  for (const rings of polygons) {
    area += ringArea(rings[0]);
    for (let hole = 1; hole < rings.length; hole++) area -= ringArea(rings[hole]);
    for (const point of rings[0]) {
      const [east, north] = toM(point[0], point[1]);
      minE = Math.min(minE, east);
      maxE = Math.max(maxE, east);
      minN = Math.min(minN, north);
      maxN = Math.max(maxN, north);
    }
  }
  let step = 3.2;
  const spanE = Math.max(step, maxE - minE);
  const spanN = Math.max(step, maxN - minN);
  while ((spanE / step) * (spanN / step) > 2200 && step < 18) step *= 1.35;
  const cols = Math.max(1, Math.ceil(spanE / step));
  const rows = Math.max(1, Math.ceil(spanN / step));
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const e0 = minE + ix * step;
      const n0 = minN + iy * step;
      const [mlon, mlat] = toLL(e0 + step / 2, n0 + step / 2);
      if (!polyHas(mlon, mlat, polygons)) continue;
      const corners = [[e0, n0], [e0 + step, n0], [e0 + step, n0 + step], [e0, n0 + step]];
      const made = corners.map(([east, north]) => {
        const [lon, lat] = toLL(east, north);
        const wobble = noise(east / 16, north / 16);
        return { lon, lat, z: 0.5 + (wobble * 0.5 + 0.5) * 0.08, color: grassTint(east, north) };
      });
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        for (const k of [a, b, c]) pushMerc(dst, made[k].lon, made[k].lat, made[k].z, made[k].color);
      }
    }
  }
  for (const rings of polygons) appendRim(dst, rings[0], toM, toLL);
  return Math.max(0, area);
}

function stopShape(mode) {
  const text = String(mode || "");
  if (text.includes("TRAIN") || text.includes("RER")) return "gare";
  if (text.includes("BUS")) return "bus";
  return "metro";
}

export function createPlaceVolumes(map) {
  const models = buildModels();
  let amenities = null;
  let stations = null;
  let velib = null;
  let show = { water: true, cool: true, park: true, station: true, velib: true };
  let key = "";
  let count = 0;
  let generation = 0;
  let groups = {};
  let shapes = new Map();
  let ground = new Float32Array(0);
  let groundCount = 0;
  const layer = {
    id: "volumes-lieux",
    type: "custom",
    renderingMode: "3d",
    program: null,
    meshes: null,
    uploaded: -1,
    onAdd(_map, gl) {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(program));
      this.program = program;
      this.matrix = gl.getUniformLocation(program, "u_matrix");
      this.grain = gl.getUniformLocation(program, "u_grain");
      this.meshes = {};
      this.uploaded = -1;
      this.groundBuffer = gl.createBuffer();
      for (const [name, data] of Object.entries(models)) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const instances = gl.createBuffer();
        this.meshes[name] = { buffer, count: data.length / 6, instances, instancesCount: 0 };
      }
    },
    render(gl, options) {
      if ((!count && !groundCount) || !this.program) return;
      if (this.uploaded !== generation) {
        for (const [name, mesh] of Object.entries(this.meshes)) {
          const group = groups[name];
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instances);
          gl.bufferData(gl.ARRAY_BUFFER, group ? group.data : new Float32Array(0), gl.DYNAMIC_DRAW);
          mesh.instancesCount = group ? group.count : 0;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, ground, gl.DYNAMIC_DRAW);
        this.uploaded = generation;
      }
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.matrix, false, options.defaultProjectionData.mainMatrix);
      gl.uniform1f(this.grain, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-4, -8);
      for (let slot = 0; slot < 6; slot++) gl.enableVertexAttribArray(slot);
      if (groundCount) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.vertexAttribDivisor(0, 0);
        gl.vertexAttribDivisor(1, 0);
        for (let slot = 2; slot < 6; slot++) {
          gl.vertexAttribDivisor(slot, 0);
          gl.disableVertexAttribArray(slot);
        }
        gl.vertexAttrib4f(2, 1, 0, 0, 0);
        gl.vertexAttrib4f(3, 0, 1, 0, 0);
        gl.vertexAttrib4f(4, 0, 0, 1, 0);
        gl.vertexAttrib4f(5, 0, 0, 0, 1);
        gl.uniform1f(this.grain, 0.16);
        gl.drawArrays(gl.TRIANGLES, 0, groundCount);
        gl.uniform1f(this.grain, 0);
        for (let slot = 2; slot < 6; slot++) gl.enableVertexAttribArray(slot);
      }
      for (const name of DRAW_ORDER) {
        const mesh = this.meshes[name];
        if (!mesh || !mesh.instancesCount) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.vertexAttribDivisor(0, 0);
        gl.vertexAttribDivisor(1, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instances);
        for (let column = 0; column < 4; column++) {
          const loc = 2 + column;
          gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, column * 16);
          gl.vertexAttribDivisor(loc, 1);
        }
        gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, mesh.instancesCount);
      }
      for (let slot = 2; slot < 6; slot++) {
        gl.vertexAttribDivisor(slot, 0);
        gl.disableVertexAttribArray(slot);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    },
  };

  function hits(lon, lat, reach, box) {
    return lon >= box.west - reach && lon <= box.east + reach && lat >= box.south - reach && lat <= box.north + reach;
  }

  function viewBox() {
    const width = map.getContainer().clientWidth;
    const height = map.getContainer().clientHeight;
    const center = map.getCenter();
    const samples = [
      [0.04, 0.94], [0.5, 0.96], [0.96, 0.94],
      [0.08, 0.72], [0.5, 0.7], [0.92, 0.72],
      [0.18, 0.46], [0.5, 0.38], [0.82, 0.46],
    ];
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const [sx, sy] of samples) {
      const ll = map.unproject([width * sx, height * sy]);
      if (!Number.isFinite(ll.lng) || Math.abs(ll.lng - center.lng) > 0.25 || Math.abs(ll.lat - center.lat) > 0.2) continue;
      west = Math.min(west, ll.lng);
      east = Math.max(east, ll.lng);
      south = Math.min(south, ll.lat);
      north = Math.max(north, ll.lat);
    }
    const zoom = map.getZoom();
    const cap = Math.min(0.06, 0.014 * 2 ** (16 - zoom));
    west = Math.max(west, center.lng - cap);
    east = Math.min(east, center.lng + cap);
    south = Math.max(south, center.lat - cap);
    north = Math.min(north, center.lat + cap);
    if (!Number.isFinite(west)) {
      west = center.lng - cap;
      east = center.lng + cap;
      south = center.lat - cap;
      north = center.lat + cap;
    }
    return { west, east, south, north };
  }

  function rebuild() {
    const buckets = {};
    const push = (name, lng, lat, yaw, scale, scaleZ) => {
      const list = buckets[name] || (buckets[name] = []);
      list.push(...localMatrix(lng, lat, yaw, scale, scaleZ));
    };
    count = 0;
    const zoom = map.getZoom();
    const raised = map.getPitch() > 2 && zoom >= VOLUME_ZOOM;
    const groundScratch = [];
    if (!raised || !amenities) {
      groups = {};
      ground = new Float32Array(0);
      groundCount = 0;
      generation++;
      return 0;
    }
    const read = Math.min(1.85, Math.max(1, 1.32 ** (15.6 - zoom)));
    const detail = zoom >= 15.2 ? 1 : zoom >= 14.2 ? 0.7 : 0.45;
    const box = viewBox();
    for (const feature of amenities.features || []) {
      const [lon, lat] = feature.geometry.coordinates;
      const category = feature.properties.category;
      if (category === "water" && show.water && hits(lon, lat, 0, box)) {
        push("fountain", lon, lat, (hash(feature.properties.address || "") % 12) / 12 * TAU, 1.55 * read);
        count++;
      } else if (category === "cool" && show.cool && hits(lon, lat, 0, box)) {
        push("cool", lon, lat, (hash(feature.properties.name || "") % 8) / 8 * TAU, 1.4 * read);
        count++;
      } else if (category === "park" && show.park) {
        const shape = shapes.get(`${lon},${lat}`);
        if (!shape) continue;
        const bounds = shapeBounds(shape);
        if (bounds.west > box.east || bounds.east < box.west || bounds.south > box.north || bounds.north < box.south) continue;
        const area = appendPark(groundScratch, shape);
        count++;
        const random = rng(hash(feature.properties.name || `${lon},${lat}`));
        const trees = Math.max(3, Math.min(24, Math.round(Math.sqrt(Math.max(area, 1)) / 4.2)));
        const treeCount = Math.max(2, Math.round(trees * detail));
        let placed = 0;
        for (let attempt = 0; attempt < treeCount * 14 && placed < treeCount; attempt++) {
          const qlon = bounds.west + random() * (bounds.east - bounds.west);
          const qlat = bounds.south + random() * (bounds.north - bounds.south);
          if (!polyHas(qlon, qlat, shape)) continue;
          push("tree", qlon, qlat, random() * TAU, (0.7 + random() * 0.42) * read);
          placed++;
          count++;
        }
        if (area > 900) {
          const paths = Math.min(3, Math.max(1, Math.round(area / 3200)));
          const pathCount = Math.max(1, Math.round(paths * detail));
          let pathsPlaced = 0;
          for (let attempt = 0; attempt < pathCount * 8 && pathsPlaced < pathCount; attempt++) {
            const qlon = bounds.west + random() * (bounds.east - bounds.west);
            const qlat = bounds.south + random() * (bounds.north - bounds.south);
            if (!polyHas(qlon, qlat, shape)) continue;
            push("path", qlon, qlat, random() * TAU, (0.42 + random() * 0.28) * Math.min(read, 1.25));
            pathsPlaced++;
            count++;
          }
        }
      }
    }
    if (show.velib && velib) {
      for (const feature of velib.features || []) {
        const [lon, lat] = feature.geometry.coordinates;
        if (!hits(lon, lat, 0, box)) continue;
        push("velib", lon, lat, (hash(feature.properties.code || feature.properties.name || "") % 6) / 6 * TAU, 1.35 * read);
        count++;
      }
    }
    if (show.station && stations) {
      for (const feature of stations.features || []) {
        const [lon, lat] = feature.geometry.coordinates;
        if (!hits(lon, lat, 0, box)) continue;
        push(stopShape(feature.properties.mode), lon, lat, (hash(feature.properties.name || "") % 10) / 10 * TAU, 1.4 * read);
        count++;
      }
    }
    groups = {};
    for (const [name, values] of Object.entries(buckets)) {
      groups[name] = { data: Float32Array.from(values), count: values.length / 16 };
    }
    ground = Float32Array.from(groundScratch);
    groundCount = ground.length / 6;
    generation++;
    return count;
  }

  function sync() {
    const zoom = map.getZoom();
    const center = map.getCenter();
    const next = [
      map.getPitch() > 2 ? 1 : 0,
      zoom.toFixed(2),
      Math.round(map.getBearing() / 5),
      center.lng.toFixed(4),
      center.lat.toFixed(4),
      show.water ? 1 : 0,
      show.cool ? 1 : 0,
      show.park ? 1 : 0,
      show.station ? 1 : 0,
      show.velib ? 1 : 0,
      amenities ? amenities.features.length : 0,
      velib ? velib.features.length : 0,
    ].join(":");
    if (next === key) return count;
    key = next;
    const nextCount = rebuild();
    map.triggerRepaint();
    return nextCount;
  }

  return {
    layer,
    count: () => count,
    setData(places, stationRows, velibRows) {
      amenities = places;
      stations = stationRows;
      velib = velibRows || null;
      key = "";
      sync();
    },
    setShapes(collection) {
      shapes = new Map();
      for (const feature of collection?.features || []) {
        const anchor = feature.properties?.anchor;
        const polygons = polygonsOf(feature.geometry);
        if (!anchor || !polygons.length) continue;
        shapes.set(`${anchor[0]},${anchor[1]}`, polygons);
      }
      key = "";
      sync();
    },
    setVisible(next) {
      show = next;
      key = "";
      sync();
    },
    sync,
  };
}
