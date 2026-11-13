export const WALK_KMH = 5;
export const BIKE_KMH = 15;
const NORMAL = 50;

export function durationParts(minutes) {
  const total = Math.max(1, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  const parts = [];
  if (hours) parts.push([String(hours), "h"]);
  if (remainder) parts.push([String(remainder), "min"]);
  return parts;
}

function distance([lonA, latA], [lonB, latB]) {
  return Math.hypot((lonA - lonB) * 73400, (latA - latB) * 111132);
}

function connector(point, snapped, reverse = false) {
  const len = distance(point, snapped);
  return len ? [{ coords: reverse ? [snapped, point] : [point, snapped], len, s: -1 }] : [];
}

function leg(result, mode, origin, destination) {
  const segments = [
    ...(origin ? connector(origin, result.origin) : []),
    ...result.segments,
    ...(destination ? connector(destination, result.destination, true) : []),
  ].map((segment) => ({ ...segment, mode }));
  const length = segments.reduce((sum, segment) => sum + segment.len, 0);
  const speed = mode === "velo" ? BIKE_KMH : WALK_KMH;
  return { segments, length, minutes: length / (speed * 1000 / 60) };
}

function via(plan, origin, destination, preference, stop) {
  if (stop) {
    const first = plan(origin, stop, preference);
    const second = plan(stop, destination, preference);
    if (first.ok && second.ok) return { ...first, destination: second.destination, segments: [...first.segments, ...second.segments] };
  }
  return plan(origin, destination, preference);
}

function summarize(legs, neutral) {
  const segments = legs.flatMap((part) => part.segments);
  const length = legs.reduce((sum, part) => sum + part.length, 0);
  const minutes = legs.reduce((sum, part) => sum + part.minutes, 0);
  let known = 0;
  let shaded = 0;
  for (const { s, len } of segments) {
    if (s < 0) continue;
    known += len;
    shaded += s * len;
  }
  return { ok: true, legs, segments, length, minutes, neutral, sun: known && !neutral ? 1 - shaded / known : null };
}

export function createItineraryPlanner(router, stations) {
  let indexedStations;
  function nearest(point, component) {
    indexedStations ??= stations.flatMap((station) => {
      const coords = station.geometry.coordinates;
      const snap = router.snap(...coords);
      return snap.ok ? [{ coords, station, component: router.component(snap.edge) }] : [];
    });
    let closest;
    let gap = Infinity;
    for (const entry of indexedStations) {
      if (entry.component !== component) continue;
      const meters = distance(point, entry.coords);
      if (meters < gap) {
        closest = entry;
        gap = meters;
      }
    }
    return closest;
  }

  return function itinerary({ origin, destination, mode, preference, plan, stop }) {
    if (mode !== "velib") {
      const route = via(plan, origin, destination, preference, stop);
      if (!route.ok) return route;
      return summarize([leg(route, mode, origin, destination)], route.neutral);
    }
    const a = router.snap(...origin);
    const b = router.snap(...destination);
    if (!a.ok || !b.ok) return a.ok ? b : a;
    const component = router.component(a.edge);
    if (component !== router.component(b.edge)) {
      return { ok: false, message: "Ces deux points ne sont pas reliés sur le réseau calculé." };
    }
    const pickup = nearest(origin, component);
    const dropoff = nearest(destination, component);
    if (!pickup || !dropoff) return { ok: false, message: "Aucune station Vélib reliée à ce trajet." };
    if (pickup === dropoff) return { ok: false, message: "La même station Vélib dessert le départ et l’arrivée. Essayez le trajet à pied." };

    const first = plan(origin, pickup.coords, NORMAL);
    const cycle = via(plan, pickup.coords, dropoff.coords, preference, stop);
    const last = plan(dropoff.coords, destination, NORMAL);
    const failed = [first, cycle, last].find((part) => !part.ok);
    if (failed) return failed;
    const legs = [
      leg(first, "pied", origin, pickup.coords),
      leg(cycle, "velo"),
      leg(last, "pied", dropoff.coords, destination),
    ];
    return { ...summarize(legs, cycle.neutral), pickup: pickup.station, dropoff: dropoff.station };
  };
}
