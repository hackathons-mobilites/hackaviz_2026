/** Rebuild the narrative from the same geometry and model as the route planner. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, indexBuildings } from "../src/router.js";
import { groundShadows } from "../src/story-preview-geometry.js";
import { createRouteProjections } from "../src/story-geometry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public/data");
const json = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
function binary(name) {
  let b;
  if (existsSync(path.join(dir, name))) b = readFileSync(path.join(dir, name));
  else {
    const manifest = json(name + ".parts.json");
    const parts = Array.from({ length: manifest.parts }, (_, i) =>
      readFileSync(path.join(dir, name + ".part" + String(i).padStart(3, "0"))),
    );
    b = gunzipSync(Buffer.concat(parts));
  }
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const scene = json("scene.json");
const stations = json("stations.json");
const trees = json("tree-cover.json");
const traffic = json("idfm-validations-2025.json");
const round = (n, digits = 1) => Number(n.toFixed(digits));
const distance = (a, b) =>
  Math.hypot((a[0] - b[0]) * 73400, (a[1] - b[1]) * 111132);
function inside(x, y) {
  let ok = false;
  for (let i = 0, j = scene.ring.length - 1; i < scene.ring.length; j = i++) {
    const a = scene.ring[i],
      b = scene.ring[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      ok = !ok;
  }
  return ok;
}
const trafficById = new Map(traffic.rows.map(row => [row.id, row]));
if (trafficById.size !== traffic.rows.length) throw new Error("Duplicate traffic identifiers");
const points = stations.features.map((f) => {
  const p = f.properties,
    coords = f.geometry.coordinates;
  const match = trafficById.get(String(p.id));
  // All four quarters are required; incomplete coverage is never annualised.
  const complete = match?.quarters.length === 4;
  return { ...p, coords, validations: complete ? match.freq : null,
    validationsLower: complete ? match.lower : null, trafficId: complete ? match.id : null,
    trafficName: complete ? match.nom : null };
});
const router = createRouter(
  binary("axes.bin"),
  inside,
  binary("tree-cover.bin"),
);
const known = (arr) => arr.filter(Number.isFinite);
const mean = (arr) => {
  const a = known(arr);
  return a.length ? round(a.reduce((s, v) => s + v, 0) / a.length) : null;
};
const hourly = scene.hours.map((hour, i) => ({
  hour,
  summerShade: mean(points.map((p) => p.shadeToday[i])),
  winterShade: mean(points.map((p) => p.shadeWinter[i])),
  futureShade: mean(points.map((p) => p.shadeFuture[i])),
  lowShade: points.filter(
    (p) => p.shadeToday[i] != null && p.shadeToday[i] < 40,
  ).length,
  futureLowShade: points.filter(
    (p) => p.shadeFuture[i] != null && p.shadeFuture[i] < 40,
  ).length,
  known: known(points.map((p) => p.shadeToday[i])).length,
}));
const examples = [
  {
    id: "republique",
    from: "Place de la République",
    to: "Arts et Métiers",
    a: [2.3635, 48.8667],
    b: [2.356, 48.8655],
  },
  {
    id: "bastille",
    from: "Place de la Bastille",
    to: "Saint-Paul",
    a: [2.3693, 48.8537],
    b: [2.3609, 48.8552],
  },
  {
    id: "luxembourg",
    from: "Jardin du Luxembourg · rue de Vaugirard",
    to: "Saint-Michel",
    a: [2.3354, 48.8491],
    b: [2.3439, 48.8533],
  },
];
const simplify = (segments) => {
  const pts = [segments[0].coords[0], ...segments.map((s) => s.coords[1])];
  return pts
    .filter((p, i) => i === 0 || i === pts.length - 1 || i % 3 === 0)
    .map((p) => p.map((v) => round(v, 6)));
};
const compress = (route) => ({
  meters: round(route.length),
  minutes: round(route.length / 75, 2),
  shadePercent: round(route.shade * 100),
  shadeMinutes: round((route.length * route.shade) / 75, 2),
  sunMinutes: round((route.length * (1 - route.shade)) / 75, 2),
  path: simplify(route.segments),
});
const buildings = indexBuildings(binary("batis.bin"));
const roadFrames = new Map();
for (const season of ["ete", "hiver"]) for (const hour of [10, 12, 14, 16]) {
  roadFrames.set(season + hour, router.farCollection(scene.hours.indexOf(hour), season).features);
}
const roads = roadFrames.get("ete16");
for (const example of examples) {
  example.comparisons = [];
  for (const season of ["ete", "hiver"])
    for (const hour of [10, 12, 14, 16]) {
      const args = [
        ...example.a,
        ...example.b,
        season,
        scene.hours.indexOf(hour),
        false,
      ];
      const shortest = router.plan(...args, null, 50),
        preferred = router.plan(...args, null, season === "hiver" ? 100 : 0);
      if (
        !shortest.ok ||
        !preferred.ok ||
        shortest.neutral ||
        preferred.neutral
      )
        throw new Error("Example could not be calculated: " + example.id);
      if (preferred.length + 1 < shortest.length)
        throw new Error("Shortest route invariant failed");
      example.comparisons.push({
        season,
        hour,
        shortest: compress(shortest),
        preferred: compress(preferred),
      });
    }
  const all = example.comparisons.flatMap((c) => [
    ...c.shortest.path,
    ...c.preferred.path,
  ]);
  const west = Math.min(...all.map((p) => p[0])) - 0.001,
    east = Math.max(...all.map((p) => p[0])) + 0.001;
  const south = Math.min(...all.map((p) => p[1])) - 0.0007,
    north = Math.max(...all.map((p) => p[1])) + 0.0007;
  example.roads = roads
    .filter((f) =>
      f.geometry.coordinates.some(
        (p) => p[0] >= west && p[0] <= east && p[1] >= south && p[1] <= north,
      ),
    )
    .map((f) => f.geometry.coordinates.map((p) => p.map((v) => round(v, 6))));
  example.bounds = [west, south, east, north];
  example.buildings = buildings.featuresIn(west, south, east, north, 20000).features
    .flatMap(f => f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    .map(polygon => polygon.map(ring => ring.map(p => p.map(v => round(v, 6)))));
  for (const comparison of example.comparisons) {
    comparison.streets = roadFrames.get(comparison.season + comparison.hour)
      .filter(f => f.geometry.coordinates.some(p => p[0] >= west && p[0] <= east && p[1] >= south && p[1] <= north))
      .map(f => ({ path: f.geometry.coordinates.map(p => p.map(v => round(v, 6))), shade: f.properties.s }));
  }
}
const previewBuildings = buildings.featuresIn(...examples[0].bounds, 20000);
writeFileSync(path.join(dir, "story-preview.json"), JSON.stringify({
  source: "IGN BD TOPO, Canopée c17a504", date: scene.date, hour: 16,
  buildings: previewBuildings,
  shadows: groundShadows(previewBuildings, scene.sun.find(s => s.hour === 16)),
}));
// Fill the whole comparison viewport with real context. A shorter route must
// not become an isolated island of streets floating in a blank rectangle.
const seasonMaps = Object.fromEntries(["ete", "hiver"].map(season => [season, createRouteProjections(examples, { season })]));
for (const example of examples) {
  const frames = Object.values(seasonMaps).map(m => m.forExample(example.id).bounds);
  const bounds = [Math.min(...frames.map(b => b[0])), Math.min(...frames.map(b => b[1])), Math.max(...frames.map(b => b[2])), Math.max(...frames.map(b => b[3]))];
  example.buildings = buildings.featuresIn(...bounds, 20000).features
    .flatMap(f => f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    .map(polygon => polygon.map(ring => ring.map(p => p.map(v => round(v, 6)))));
  for (const comparison of example.comparisons) {
    const [west, south, east, north] = seasonMaps[comparison.season].forExample(example.id).bounds;
    comparison.streets = roadFrames.get(comparison.season + comparison.hour)
      .filter(f => f.geometry.coordinates.some(p => p[0] >= west && p[0] <= east && p[1] >= south && p[1] <= north))
      .map(f => ({ path: f.geometry.coordinates.map(p => p.map(v => round(v, 6))), shade: f.properties.s }));
  }
}
const out = {
  generated: new Date().toISOString().slice(0, 10),
  method: {
    ...stations.method,
    upstreamCommit: "c17a504d7bab5cc8d97765ffde331f889df5d344",
    summer: scene.date,
    winter: scene.winterDate,
    speedMetersPerMinute: 75,
    preference: 30,
    trafficJoin:
      "Identifiant ID_ZdC identique et présence des quatre trimestres de 2025. Les non-correspondances restent sans donnée.",
    stationAggregation:
      "Moyenne simple des parts d’ombre des stations. À chaque station, moyenne des segments proches pondérée par leur longueur.",
  },
  climate: {
    source: "Météo-France, Le climat de la France, 2026, p. 7",
    url: "https://meteofrance.com/sites/default/files/files/editorial/le_climat_de_la_france_v1%20%281%29.pdf",
    threshold: "Température maximale > 35 °C",
    baseline: { period: "1976–2005", days: 1 },
    projections: [
      { year: 2050, days: 4, low: 2, high: 6 },
      { year: 2100, days: 8, low: 5, high: 12 },
    ],
  },
  hours: scene.hours,
  hourly,
  trees,
  stations: points,
  examples,
  ring: scene.ring,
  traffic: {
    ...traffic,
    rows: undefined,
    matched: points.filter((p) => p.validations != null).length,
  },
};
writeFileSync(path.join(dir, "story.json"), JSON.stringify(out));
console.log(
  JSON.stringify(
    {
      stations: points.length,
      trafficMatched: out.traffic.matched,
      hour16: hourly.find((h) => h.hour === 16),
      examples: examples.map((e) => ({
        id: e.id,
        at16: e.comparisons
          .filter((c) => c.hour === 16)
          .map((c) => ({
            season: c.season,
            shortest: c.shortest.minutes,
            preferred: c.preferred.minutes,
            sunBefore: c.shortest.sunMinutes,
            sunAfter: c.preferred.sunMinutes,
          })),
      })),
    },
    null,
    2,
  ),
);
