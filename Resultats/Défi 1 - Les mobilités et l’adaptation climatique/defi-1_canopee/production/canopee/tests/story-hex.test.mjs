import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHexSource, hexId } from "../scripts/prepare-story-hex.mjs";

const data = JSON.parse(readFileSync(new URL("../public/data/story-hex.json", import.meta.url)));

test("Hexagons keep one stable geometry and a complete hourly series", () => {
  assert.deepEqual(data.hours, Array.from({ length: 15 }, (_, index) => index + 7));
  assert.equal(new Set(data.cells.map(cell => cell.id)).size, data.cells.length);
  assert.equal(data.method.radiusMeters, 260);
  assert.equal(data.method.minKnownSegments, 8);
  assert.equal(data.date, "2026-06-25");
  for (const cell of data.cells) {
    assert.equal(cell.ring.length, 7);
    assert.deepEqual(cell.ring[0], cell.ring.at(-1));
    assert.equal(cell.shade.length, data.hours.length);
    assert(cell.shade.every(value => value === null || Number.isFinite(value) && value >= 0 && value <= 1));
  }
  for (const [index, frame] of data.hourly.entries()) {
    assert.equal(frame.known, data.cells.filter(cell => cell.shade[index] !== null).length);
    assert(frame.lowShade >= 0 && frame.lowShade <= frame.known);
    assert.equal(frame.lowShadePercent, Number((100 * frame.lowShade / frame.known).toFixed(1)));
  }
});

test("Morning, afternoon and evening reproduce the map model without resampling stations", () => {
  const { scene, router } = loadHexSource();
  const stored = new Map(data.cells.map(cell => [cell.id, cell]));
  for (const hour of [7, 16, 21]) {
    const index = data.hours.indexOf(hour);
    const features = router.overviewCollection(scene.hours.indexOf(hour), "ete", false).features;
    assert.equal(features.length, data.hourly[index].known);
    assert.equal(features.filter(feature => feature.properties.s < 0.4).length, data.hourly[index].lowShade);
    for (const feature of features) {
      const originalRing = feature.geometry.coordinates[0];
      const cell = stored.get(hexId(originalRing));
      assert(cell, "Every live map hexagon must exist in the narrative");
      assert(Math.abs(cell.shade[index] - feature.properties.s) <= 0.00005001, "Only four-decimal serialization may change a value");
      for (let i = 0; i < originalRing.length; i++) {
        for (let coordinate = 0; coordinate < 2; coordinate++) {
          assert(Math.abs(cell.ring[i][coordinate] - originalRing[i][coordinate]) <= 0.000000501);
        }
      }
    }
  }
});
