import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRouteProjections } from "../src/story-geometry.js";

const data = JSON.parse(readFileSync(new URL("../public/data/story.json", import.meta.url)));
const maps = createRouteProjections(data.examples);
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

test("Every route variant fits the shared viewBox and its reserved margins", () => {
  let comparisons = 0;
  for (const example of data.examples) {
    const { project, center, bounds } = maps.forExample(example.id);
    assert.deepEqual(project(center), [300, 210]);
    for (const comparison of example.comparisons) {
      comparisons++;
      for (const route of [comparison.shortest, comparison.preferred]) {
        for (const point of route.path) {
          const [x, y] = project(point);
          assert(x >= 48 - 1e-8 && x <= 552 + 1e-8, example.id + " horizontal clipping");
          assert(y >= 48 - 1e-8 && y <= 372 + 1e-8, example.id + " vertical clipping");
          assert(point[0] >= bounds[0] && point[0] <= bounds[2]);
          assert(point[1] >= bounds[1] && point[1] <= bounds[3]);
        }
      }
    }
  }
  assert.equal(comparisons, 24);
});

test("The same geographic segment has the same scale in all three maps", () => {
  const segment = data.examples[0].comparisons[0].shortest.path;
  const start = segment[0], end = segment.at(-1);
  const lengths = data.examples.map(({ id }) => {
    const { project } = maps.forExample(id);
    return distance(project(start), project(end));
  });
  assert.equal(lengths.length, 3);
  for (const length of lengths) assert(Math.abs(length - lengths[0]) < 1e-9);
  assert.equal(maps.scaleBar.pixels / maps.scaleBar.meters, maps.pixelsPerMeter);

  // Independently compare the drawing with spherical ground distances in Paris.
  // A shared local projection must preserve both north/south and east/west scale.
  for (const example of data.examples) {
    const { center, project } = maps.forExample(example.id);
    for (const delta of [[0.001, 0], [0, 0.001]]) {
      const point = [center[0] + delta[0], center[1] + delta[1]];
      const toRadians = Math.PI / 180;
      const a = Math.sin(delta[1] * toRadians / 2) ** 2 +
        Math.cos(center[1] * toRadians) * Math.cos(point[1] * toRadians) *
        Math.sin(delta[0] * toRadians / 2) ** 2;
      const groundMeters = 2 * 6371008.8 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const drawnMeters = distance(project(center), project(point)) / maps.pixelsPerMeter;
      assert(Math.abs(drawnMeters / groundMeters - 1) < 0.001);
    }
  }
});

test("Road context and source bounds do not alter route scale or framing", () => {
  const unrelatedRoadContext = data.examples.map(example => ({
    ...example,
    bounds: [-180, -90, 180, 90],
    roads: [[[0, 0], [90, 45]]],
  }));
  const changed = createRouteProjections(unrelatedRoadContext);
  assert.equal(changed.pixelsPerMeter, maps.pixelsPerMeter);
  for (const { id } of data.examples) {
    assert.deepEqual(changed.forExample(id).bounds, maps.forExample(id).bounds);
    assert.deepEqual(changed.forExample(id).center, maps.forExample(id).center);
  }
});

test("All eight contexts fit every example at one scale above the scale-bar strip", () => {
  let comparisons = 0;
  const testSegment = [[2.34, 48.86], [2.345, 48.865]];
  for (const season of ["ete", "hiver"]) {
    for (const hour of [10, 12, 14, 16]) {
      const context = createRouteProjections(data.examples, { season, hour });
      let sharedLength;
      for (const example of data.examples) {
        const { project, center, bounds } = context.forExample(example.id);
        const comparison = example.comparisons.find(c => c.season === season && c.hour === hour);
        comparisons++;
        assert.deepEqual(project(center), [300, 190]);
        const drawnLength = distance(...testSegment.map(project));
        if (sharedLength === undefined) sharedLength = drawnLength;
        assert(Math.abs(drawnLength - sharedLength) < 1e-9, "All examples use the same metric scale");
        for (const route of [comparison.shortest, comparison.preferred]) {
          for (const point of route.path) {
            const [x, y] = project(point);
            assert(x >= 48 - 1e-8 && x <= 552 + 1e-8, example.id + " horizontal clipping");
            assert(y >= 32 - 1e-8 && y <= 348 + 1e-8, example.id + " vertical clipping");
            assert(point[0] >= bounds[0] && point[0] <= bounds[2]);
            assert(point[1] >= bounds[1] && point[1] <= bounds[3]);
          }
        }
        // The scale cartouche starts at y=366. Endpoint circles have a
        // 12px radius plus 1.5px stroke, so they must stay completely above it.
        for (const endpoint of [comparison.shortest.path[0], comparison.shortest.path.at(-1)]) {
          assert(project(endpoint)[1] + 13.5 < 366, "Endpoint marker overlaps the scale bar");
        }
      }
      assert(Math.abs(context.scaleBar.pixels / 200 - context.pixelsPerMeter) < 1e-12);
    }
  }
  assert.equal(comparisons, 24);
});

test("Summer routes use the available space rather than fitting invisible winter detours", () => {
  const summer = createRouteProjections(data.examples, { season: "ete", hour: 16 });
  assert(summer.pixelsPerMeter > maps.pixelsPerMeter * 2);
  const example = data.examples.find(example => example.id === "republique");
  const comparison = example.comparisons.find(c => c.season === "ete" && c.hour === 16);
  const xs = comparison.preferred.path.map(point => summer.forExample(example.id).project(point)[0]);
  assert(Math.max(...xs) - Math.min(...xs) > 320, "République should fill over half the 600px frame");
  // The selected example is not an input: reordering the choices cannot change
  // the scale or recenter a map when the reader selects another route.
  const reordered = createRouteProjections([...data.examples].reverse(), { season: "ete", hour: 16 });
  assert.equal(reordered.pixelsPerMeter, summer.pixelsPerMeter);
  for (const { id } of data.examples) {
    assert.deepEqual(reordered.forExample(id).center, summer.forExample(id).center);
  }
});

test("The seasonal viewport fits all hours without zooming or recentering", () => {
  for (const season of ['ete','hiver']) {
    const stable = createRouteProjections(data.examples,{season});
    for (const example of data.examples) {
      const {project} = stable.forExample(example.id);
      for (const frame of example.comparisons.filter(c=>c.season===season)) {
        for(const route of [frame.shortest,frame.preferred]) for(const point of route.path) {
          const [x,y] = project(point);
          assert(x >= 48-1e-8 && x <= 552+1e-8);
          assert(y >= 32-1e-8 && y <= 348+1e-8);
        }
      }
    }
  }
});
