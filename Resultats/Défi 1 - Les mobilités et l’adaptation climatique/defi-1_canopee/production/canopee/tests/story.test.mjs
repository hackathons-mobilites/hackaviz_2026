import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const data = JSON.parse(
  readFileSync(new URL("../public/data/story.json", import.meta.url)),
);

test("Station denominators and unique traffic joins are consistent", () => {
  assert.equal(
    new Set(data.stations.map((s) => s.id)).size,
    data.stations.length,
  );
  const matched = data.stations.filter((s) => s.validations != null);
  assert.equal(matched.length, data.traffic.matched);
  assert.equal(new Set(matched.map((s) => s.trafficId)).size, matched.length);
  assert(
    matched.every((s) => Number.isInteger(s.validations) && s.validations > 0),
  );
  assert(
    data.stations.some((s) => s.validations === null),
    "unmatched stations must remain missing, not zero",
  );
  for (let i = 0; i < data.hours.length; i++) {
    const known = data.stations.filter((s) => s.shadeToday[i] != null);
    assert.equal(data.hourly[i].known, known.length);
    assert.equal(
      data.hourly[i].lowShade,
      known.filter((s) => s.shadeToday[i] < 40).length,
    );
    assert.equal(
      data.hourly[i].futureLowShade,
      known.filter((s) => s.shadeFuture[i] < 40).length,
    );
    for (const s of known) assert(s.shadeFuture[i] >= s.shadeToday[i]);
  }
});

test("Night is missing daylight, not zero shade or a sunny street", () => {
  assert.equal(data.hourly.find((h) => h.hour === 7).winterShade, null);
  assert.equal(data.hourly.find((h) => h.hour === 21).winterShade, null);
  assert(data.hourly.find((h) => h.hour === 13).winterShade > 0);
});

test("Traffic totals come from four official quarters and join on stable IDs", () => {
  const traffic = JSON.parse(readFileSync(new URL('../public/data/idfm-validations-2025.json',import.meta.url)));
  assert.equal(new URL(traffic.download).hostname, 'data.iledefrance-mobilites.fr');
  assert.equal(traffic.files.length,4);
  assert.deepEqual(traffic.files.map(f=>f.days),[90,91,92,92]);
  const rows = new Map(traffic.rows.map(r=>[r.id,r]));
  for(const station of data.stations) {
    const source = rows.get(station.id);
    if(source?.quarters.length===4) {
      assert.equal(station.validations,source.freq);
      assert.equal(station.validationsLower,source.lower);
      assert(source.freq >= source.lower);
      assert(source.freq - source.lower <= source.maskedRows * 5);
    } else assert.equal(station.validations,null);
  }
});

test("All 24 route comparisons preserve distance, time and optimization constraints", () => {
  let count = 0;
  for (const e of data.examples)
    for (const c of e.comparisons) {
      count++;
      const a = c.shortest,
        b = c.preferred;
      assert(b.meters >= a.meters - 1, e.id + " shortest distance");
      for (const r of [a, b]) {
        assert(
          Math.abs(r.shadeMinutes + r.sunMinutes - r.minutes) < 0.025,
          "time split",
        );
        assert(
          Math.abs(r.minutes - r.meters / data.method.speedMetersPerMinute) <
            0.015,
          "walking speed",
        );
        assert(r.shadePercent >= 0 && r.shadePercent <= 100);
        assert(r.path.length >= 2);
      }
      assert.deepEqual(a.path[0], b.path[0]);
      assert.deepEqual(a.path.at(-1), b.path.at(-1));
      const adverse = (r) =>
        c.season === "ete" ? r.sunMinutes : r.shadeMinutes;
      // Rounding permits a small error but not a worse weighted path.
      assert(
        b.minutes + 30 * adverse(b) <= a.minutes + 30 * adverse(a) + 0.65,
        e.id + " objective",
      );
    }
  assert.equal(count, 24);
});

test("Narrative paths still match the current tool preference API", async () => {
  const { loadHexSource } = await import('../scripts/prepare-story-hex.mjs');
  const { router, scene } = loadHexSource();
  const example = data.examples.find(e => e.id === 'bastille');
  for (const season of ['ete', 'hiver']) {
    const comparison = example.comparisons.find(c => c.season === season && c.hour === 16);
    for (const [name, accept] of [['shortest',50], ['preferred',season === 'hiver' ? 100 : 0]]) {
      const result = router.plan(...example.a,...example.b,season,scene.hours.indexOf(16),false,null,accept);
      assert(result.ok);
      assert(Math.abs(result.length-comparison[name].meters)<.1);
      assert(Math.abs(result.shade*100-comparison[name].shadePercent)<.1);
    }
  }
});

test("3D preview preserves measured heights and excludes unknown-height shadows", async () => {
  const preview = JSON.parse(readFileSync(new URL('../public/data/story-preview.json',import.meta.url)));
  const { groundShadows } = await import('../src/story-preview-geometry.js');
  const scene = JSON.parse(readFileSync(new URL('../public/data/scene.json',import.meta.url)));
  assert(preview.buildings.features.length > 500);
  assert.equal(preview.shadows.features.length, preview.buildings.features.filter(f=>f.properties.h>0).length);
  assert.deepEqual(groundShadows(preview.buildings,scene.sun.find(s=>s.hour===16)),preview.shadows);
  assert.equal(groundShadows(preview.buildings,{up:false,altitude:-5}).features.length,0);
});
