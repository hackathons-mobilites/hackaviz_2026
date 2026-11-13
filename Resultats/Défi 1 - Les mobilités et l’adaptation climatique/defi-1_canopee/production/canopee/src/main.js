import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-600.css";
import "@fontsource/source-sans-3/latin-700.css";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { pct } from "./annotations.js";
import { BIKE_KMH, createItineraryPlanner, durationParts, WALK_KMH } from "./itinerary.js";
import { registerMapIcons } from "./map-icons.js";
import { createLiveShade } from "./live-shade.js";
import { createRouter, indexBuildings } from "./router.js";
import { createPlaceVolumes, VOLUME_ZOOM } from "./place-volumes.js";
import { shadowOffset, sunPosition } from "./sun.js";
import "./style.css";

maplibregl.setWorkerUrl(mapWorkerUrl);

const scene = await fetch("data/scene.json").then((r) => r.json());
const treeMeta = await fetch("data/tree-cover.json").then((r) => r.json());
const params = new URLSearchParams(location.search);
let hour = Number(params.get("h"));
if (!scene.hours.includes(hour)) hour = 16;

let season = "ete";
let view = "today";
const LIVE_LAT = 48.8462;
const LIVE_LON = 2.3372;
const HIGH_ALT = (35 * Math.PI) / 180;
const live = {
  on: false,
  up: false,
  altitude: 0,
  azimuth: 0,
  mode: "neutral",
  weather: "wait",
  cover: null,
  temp: null,
  label: "",
};
let liveShade = null;
let weatherToken = 0;
let pointA = null;
let pointB = null;
let selectedStop = null;
let routeVisible = false;
let streetColorsMuted = false;
let nearbyPlaces = null;
let markerA = null;
let markerB = null;
let router = null;
let planItinerary = null;
let buildings = null;
let farKey = "";
let overviewKey = "";
const EMPTY = { type: "FeatureCollection", features: [] };
let amenities = EMPTY;
let stationCollection = EMPTY;
let velibCollection = EMPTY;
let showAllStations = false;
let armed = null;

const el = {
  nombre: document.getElementById("heure-nombre"),
  unite: document.getElementById("heure-unite"),
  dock: document.querySelector(".heure-dock"),
  weather: document.getElementById("meteo"),
  range: document.getElementById("heure"),
  direct: document.getElementById("direct"),
  precedent: document.getElementById("precedent"),
  suivant: document.getElementById("suivant"),
  lecture: document.getElementById("lecture"),
  goalIcon: document.getElementById("objectif-icone"),
  goalText: document.getElementById("objectif-but"),
  goalExtra: document.getElementById("objectif-suite"),
  methode: document.getElementById("methode"),
  corps: document.getElementById("methode-corps"),
  resultat: document.getElementById("trajet-resultat"),
  ete: document.getElementById("saison-ete"),
  hiver: document.getElementById("saison-hiver"),
  today: document.getElementById("vue-aujourdhui"),
  future: document.getElementById("vue-future"),
  now: document.getElementById("mode-direct"),
  pied: document.getElementById("allure-pied"),
  velo: document.getElementById("allure-velo"),
  velibMode: document.getElementById("allure-velib"),
  comparison: document.getElementById("trajet-comparaison"),
  legs: document.getElementById("trajet-etapes"),
  velib: document.getElementById("couche-velib"),
  explanation: document.getElementById("vue-explication"),
  contexte: document.getElementById("trajet-contexte"),
  water: document.getElementById("couche-eau"),
  cool: document.getElementById("couche-frais"),
  parks: document.getElementById("couche-parcs"),
  stations: document.getElementById("couche-stations"),
  insights: document.getElementById("constats"),
  stationSearch: document.getElementById("chercher-station"),
  stationCount: document.getElementById("stations-compte"),
  stationList: document.getElementById("stations-liste"),
  stationAll: document.getElementById("stations-toutes"),
  mapMode: document.getElementById("lecture-mode"),
  legendInfo: document.getElementById("cle-info"),
  scale: document.getElementById("degrade"),
  vueDessus: document.getElementById("vue-dessus"),
  vueInclinee: document.getElementById("vue-inclinee"),
  rotationHint: document.getElementById("aide-rotation"),
};

if (/macOS|Mac/i.test(navigator.userAgentData?.platform ?? navigator.platform)) {
  document.getElementById("touche-rotation").textContent = "⌃ Control";
}

let shadeStops = ["#F4D27A", "#5BA3D9", "#0055A4"];
let accept = 0;
let allure = "pied";
const OVERVIEW_ZOOM = 12.6;
const ROUTE_COLOR = getComputedStyle(document.documentElement).getPropertyValue("--trajet").trim();
const STREET_OPACITY = {
  "quartiers-ombre": 0.72,
  "rues-loin": 0.82,
  "rues-pres": 0.96,
};
const PLACE_RADIUS_METERS = 80;
const PLACE_LAYERS = {
  equipements: ["points-eau", "lieux-frais", "parcs-frais"],
  stations: ["stations-points"],
  velib: ["velib-points"],
};
let activePreset = null;
let paintingShade = false;

function shadeExpression(stops, value = ["get", "s"]) {
  if (stops.length >= 3) {
    return ["interpolate", ["linear"], value, 0, stops[0], 0.5, stops[1], 1, stops[2]];
  }
  return ["interpolate", ["linear"], value, 0, stops[0], 1, stops[1]];
}

function paintLegend(stops) {
  el.scale.style.setProperty("--degrade-ombre", `linear-gradient(90deg, ${stops.join(", ")})`);
  const cells = [...document.querySelectorAll("#degrade .hex")];
  const last = stops.length - 1;
  cells.forEach((cell, index) => {
    const t = cells.length <= 1 ? 0 : index / (cells.length - 1);
    const scaled = t * last;
    const i = Math.min(last - 1, Math.floor(scaled));
    cell.style.background = mixHex(stops[i], stops[i + 1], scaled - i);
  });
}

function paintExpression(stops) {
  const expression = shadeExpression(stops);
  for (const [id, prop] of [
    ["quartiers-ombre", "fill-color"],
    ["rues-loin", "line-color"],
    ["rues-pres", "line-color"],
  ]) {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, expression);
  }
  paintLegend(stops);
}

function mixHex(a, b, t) {
  const parse = (hex) => {
    const h = String(hex).replace("#", "");
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a;
  const mixed = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function refreshGradient() {
  paintLegend(shadeStops);
  if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) return;
  paintExpression(shadeStops);
}

function applyShade(stops, presetId) {
  shadeStops = stops.slice();
  activePreset = presetId;
  refreshGradient();
  paintingShade = true;
  const expose = document.getElementById("couleur-expose");
  const ombre = document.getElementById("couleur-ombre");
  if (expose) expose.value = stops[0];
  if (ombre) ombre.value = stops[stops.length - 1];
  paintingShade = false;
  for (const button of document.querySelectorAll(".presets button")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === presetId));
  }
}

const SHADE_COLOR = shadeExpression(shadeStops);

function padding() {
  if (window.innerWidth < 760) {
    return { top: Math.round(window.innerHeight * (window.innerWidth < 500 ? 0.5 : 0.48)), right: 10, bottom: 145, left: 10 };
  }
  return { top: 24, right: 24, bottom: 92, left: 348 };
}

function pointInRing(lon, lat, ring) {
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

function formatLength(meters) {
  return `${Math.round(meters).toLocaleString("fr-FR")}\u00a0m`;
}

function renderHour(h, speak) {
  hour = h;
  el.nombre.textContent = String(h);
  el.range.value = String(h);
  el.range.setAttribute("aria-valuetext", `${h} heures`);
  if (typeof renderCopy === "function") renderCopy();
  paintStreets();
  renderStations();
  if (pointA && pointB) drawRoute(speak);
  else if (speak) el.direct.textContent = `${h} heures`;
  const url = new URL(location.href);
  url.searchParams.set("h", String(h));
  history.replaceState(null, "", url);
}

function step(delta) {
  leaveLive();
  const index = scene.hours.indexOf(hour);
  renderHour(scene.hours[(index + delta + scene.hours.length) % scene.hours.length], true);
}

let playTimer = null;
const playIcon = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5.2 3.2v9.6L13 8z" fill="currentColor"/></svg>`;
const pauseIcon = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.6 3.2h2.2v9.6H4.6zM9.2 3.2h2.2v9.6H9.2z" fill="currentColor"/></svg>`;

function setPlayIcon(playing) {
  el.lecture.setAttribute("aria-pressed", String(playing));
  el.lecture.setAttribute("aria-label", playing ? "Pause" : "Lire les heures");
  el.lecture.innerHTML = playing ? pauseIcon : playIcon;
}

function stopPlay() {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  setPlayIcon(false);
}

function startPlay(userGesture) {
  if (playTimer) return;
  if (!userGesture && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const left = leaveLive();
  setPlayIcon(true);
  playTimer = setInterval(() => step(1), 1100);
  if (left) {
    renderCopy();
    paintStreets();
    renderStations();
    if (pointA && pointB) drawRoute(false);
  }
}

el.lecture.addEventListener("click", () => {
  if (live.on) return;
  if (playTimer) stopPlay();
  else startPlay(true);
});
el.precedent.addEventListener("click", () => { if (live.on) return; stopPlay(); step(-1); });
el.suivant.addEventListener("click", () => { if (live.on) return; stopPlay(); step(1); });
el.range.addEventListener("input", () => {
  if (live.on) {
    syncDock();
    return;
  }
  stopPlay();
  leaveLive();
  renderHour(Number(el.range.value), true);
});
window.addEventListener("keydown", (event) => {
  if (live.on) return;
  if (event.target.closest("input, textarea, select, dialog[open] button")) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    stopPlay();
    step(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    stopPlay();
    step(-1);
  }
});

const map = new maplibregl.Map({
  container: "carte",
  style: "https://tiles.openfreemap.org/styles/positron",
  bounds: scene.bounds,
  fitBoundsOptions: { padding: padding() },
  minZoom: 10,
  maxZoom: 18.5,
  maxPitch: 70,
  dragRotate: true,
  pitchWithRotate: true,
  touchPitch: true,
  attributionControl: true,
  locale: {
    "NavigationControl.ResetBearing": "Glisser pour tourner, cliquer pour le nord",
    "NavigationControl.ZoomIn": "Zoomer",
    "NavigationControl.ZoomOut": "Dézoomer",
  },
});
map.touchZoomRotate.enableRotation();
const navigation = new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true });
const distanceScale = new maplibregl.ScaleControl({ unit: "metric", maxWidth: 100 });
map.addControl(navigation, "top-right");
map.addControl(distanceScale, "bottom-right");
const mapControls = map.getContainer();
document.getElementById("commandes-carte").append(
  mapControls.querySelector(".maplibregl-ctrl-group"),
  mapControls.querySelector(".maplibregl-ctrl-scale"),
);
const placeVolumes = createPlaceVolumes(map);

function calmBasemap() {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const id = layer.id.toLowerCase();
    if (id.startsWith("place") || id.includes("country") || id.includes("state") || id.includes("continent")) continue;
    const floor = 16.2;
    if ((layer.minzoom ?? 0) < floor) map.setLayerZoomRange(layer.id, floor, layer.maxzoom ?? 24);
  }
}

function syncVolumes() {
  if (!map.getLayer("batis-volume")) return;
  const raised = map.getPitch() > 2;
  map.setLayoutProperty("batis-volume", "visibility", raised ? "visible" : "none");
  map.setLayoutProperty("batis-connus", "visibility", raised ? "none" : "visible");
  map.setLayoutProperty("batis-connus-line", "visibility", raised ? "none" : "visible");
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points) {
  const sorted = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const unique = [];
  for (const p of sorted) {
    const last = unique[unique.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    unique.push(p);
  }
  if (unique.length < 3) return null;
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const ring = lower.concat(upper);
  if (ring.length < 3) return null;
  ring.push(ring[0]);
  return ring;
}

function exteriorOf(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Polygon") return geometry.coordinates[0];
  if (geometry.type === "MultiPolygon") return geometry.coordinates[0]?.[0] || null;
  return null;
}

let shadowCache = { key: "", data: EMPTY };
let batisKey = "";

function sunNow() {
  if (live.on) {
    return {
      altitude: (live.altitude * 180) / Math.PI,
      azimuth: (live.azimuth * 180) / Math.PI,
      up: live.up,
    };
  }
  const list = season === "hiver" ? scene.winterSun : scene.sun;
  return list.find((item) => item.hour === hour) || null;
}

function buildShadows(collection) {
  const sun = sunNow();
  if (!collection || !sun?.up || sun.altitude <= 0.5) return EMPTY;
  const alt = (sun.altitude * Math.PI) / 180;
  const az = (sun.azimuth * Math.PI) / 180;
  const features = [];
  for (const feature of collection.features) {
    const h = feature.properties?.h;
    if (!h) continue;
    const ring = exteriorOf(feature.geometry);
    if (!ring || ring.length < 4) continue;
    const off = shadowOffset(alt, az, h, 180);
    if (!off) continue;
    const lat = ring[0][1] * Math.PI / 180;
    const dLon = off.east / (111320 * Math.cos(lat));
    const dLat = off.north / 110540;
    const cloud = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i];
      cloud.push(p, [p[0] + dLon, p[1] + dLat]);
    }
    const hull = convexHull(cloud);
    if (!hull) continue;
    features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [hull] } });
  }
  return { type: "FeatureCollection", features };
}

function paintBuildings() {
  if (!buildings || !map.getSource("batis") || !map.getSource("ombres")) return;
  const raised = map.getPitch() > 2;
  const zoom = map.getZoom();
  let data = null;
  let key = "";
  if (raised && zoom < 14.8) {
    data = buildings.cityMesh();
    key = "ville";
  } else if (zoom >= 14.8 || raised) {
    const box = map.getBounds();
    let west = box.getWest();
    let south = box.getSouth();
    let east = box.getEast();
    let north = box.getNorth();
    if (raised) {
      const c = map.getCenter();
      const span = Math.min(0.28, 0.5 / 2 ** Math.max(0, zoom - 12));
      west = c.lng - span;
      east = c.lng + span;
      south = c.lat - span * 0.7;
      north = c.lat + span * 0.7;
    } else {
      const pad = 0.0012;
      west -= pad;
      south -= pad;
      east += pad;
      north += pad;
    }
    data = buildings.featuresIn(west, south, east, north, raised ? 20000 : 3500);
    if (!data && raised) {
      data = buildings.cityMesh();
      key = "ville";
    } else if (data) {
      key = `${west.toFixed(3)}:${south.toFixed(3)}:${east.toFixed(3)}:${north.toFixed(3)}`;
    }
  }
  if (!data) {
    if (batisKey) {
      map.getSource("batis").setData(EMPTY);
      map.getSource("ombres").setData(EMPTY);
      batisKey = "";
      shadowCache = { key: "", data: EMPTY };
    }
    return;
  }
  if (batisKey !== key) {
    map.getSource("batis").setData(data);
    batisKey = key;
  }
  const shadowKey = live.on
    ? `live:${live.altitude.toFixed(3)}:${live.azimuth.toFixed(3)}:${key}`
    : `${key}:${season}:${hour}`;
  if (shadowCache.key !== shadowKey) {
    shadowCache = { key: shadowKey, data: buildShadows(data) };
    map.getSource("ombres").setData(shadowCache.data);
  }
  syncVolumes();
}

let liveCity = { token: "", overview: null, far: null };

function liveFraction(edge, ax, ay, bx, by) {
  return liveShade.fraction(edge, ax, ay, bx, by, live.altitude, live.azimuth, live.up);
}

function liveCityData() {
  const token = `${live.up ? 1 : 0}:${Math.round(live.altitude * 400)}:${Math.round(live.azimuth * 400)}`;
  if (liveCity.token === token && liveCity.overview) return liveCity;
  liveCity = {
    token,
    overview: router.liveOverview(liveFraction),
    far: router.liveFar(liveFraction),
  };
  return liveCity;
}

function paintLiveStreets() {
  const zoom = map.getZoom();
  const overview = zoom < OVERVIEW_ZOOM;
  if (!live.up) el.mapMode.textContent = "Soleil couché";
  for (const id of ["gain-loin", "gain-pres"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
  if (!live.up || !liveShade) {
    if (map.getLayer("quartiers-ombre")) {
      map.setLayoutProperty("quartiers-ombre", "visibility", "none");
      map.setLayoutProperty("quartiers-filet", "visibility", "none");
    }
    map.getSource("rues-pres").setData(EMPTY);
    map.getSource("rues-loin").setData(EMPTY);
    map.setLayoutProperty("rues-loin", "visibility", "none");
    paintBuildings();
    return;
  }
  const ids = !overview && zoom >= 15 ? router.edgesIn(map.getBounds()) : null;
  if (ids) {
    if (map.getLayer("quartiers-ombre")) {
      map.setLayoutProperty("quartiers-ombre", "visibility", "none");
      map.setLayoutProperty("quartiers-filet", "visibility", "none");
    }
    map.getSource("rues-pres").setData(router.coloredEdges(ids, liveFraction));
    map.setLayoutProperty("rues-pres", "visibility", "visible");
    map.setLayoutProperty("rues-loin", "visibility", "none");
    paintBuildings();
    return;
  }
  const city = liveCityData();
  if (overview) {
    if (map.getLayer("quartiers-ombre")) {
      map.setLayoutProperty("quartiers-ombre", "visibility", "visible");
      map.setLayoutProperty("quartiers-filet", "visibility", "visible");
    }
    if (overviewKey !== city.token) {
      map.getSource("quartiers").setData(city.overview);
      overviewKey = city.token;
    }
    map.getSource("rues-pres").setData(EMPTY);
    map.setLayoutProperty("rues-loin", "visibility", "none");
    if (map.getPitch() > 2) paintBuildings();
    else if (batisKey && map.getSource("batis")) {
      map.getSource("batis").setData(EMPTY);
      map.getSource("ombres")?.setData(EMPTY);
      batisKey = "";
      shadowCache = { key: "", data: EMPTY };
    }
    return;
  }
  if (map.getLayer("quartiers-ombre")) {
    map.setLayoutProperty("quartiers-ombre", "visibility", "none");
    map.setLayoutProperty("quartiers-filet", "visibility", "none");
  }
  map.getSource("rues-pres").setData(EMPTY);
  if (farKey !== city.token) {
    map.getSource("rues-loin").setData(city.far);
    farKey = city.token;
  }
  map.setLayoutProperty("rues-loin", "visibility", "visible");
  paintBuildings();
}

function paintStreets() {
  const zoom = map.getZoom();
  const overview = zoom < OVERVIEW_ZOOM;
  el.scale.classList.toggle("echelle-rues", !overview);
  el.mapMode.textContent = overview ? "Ombre moyenne des rues par secteur" : "Part d’ombre sur chaque rue";
  if (!router || !map.getSource("rues-loin")) return;
  if (live.on) {
    paintLiveStreets();
    return;
  }
  const index = scene.hours.indexOf(hour);
  if (map.getLayer("quartiers-ombre")) {
    map.setLayoutProperty("quartiers-ombre", "visibility", overview ? "visible" : "none");
    map.setLayoutProperty("quartiers-filet", "visibility", overview ? "visible" : "none");
  }
  if (overview) {
    const key = `${season}:${index}:${view}`;
    if (overviewKey !== key) {
      map.getSource("quartiers").setData(router.overviewCollection(index, season, view === "future"));
      overviewKey = key;
    }
    map.getSource("rues-pres").setData(EMPTY);
    map.setLayoutProperty("rues-loin", "visibility", "none");
    map.setLayoutProperty("gain-loin", "visibility", "none");
    map.setLayoutProperty("gain-pres", "visibility", "none");
    if (map.getPitch() > 2) paintBuildings();
    else if (batisKey && map.getSource("batis")) {
      map.getSource("batis").setData(EMPTY);
      map.getSource("ombres")?.setData(EMPTY);
      batisKey = "";
      shadowCache = { key: "", data: EMPTY };
    }
    return;
  }
  const ids = zoom >= 15 ? router.edgesIn(map.getBounds()) : null;
  if (ids) {
    map.getSource("rues-pres").setData(router.nearCollection(ids, index, season, view === "future"));
    map.setLayoutProperty("rues-loin", "visibility", "none");
    map.setLayoutProperty("gain-loin", "visibility", "none");
    map.setLayoutProperty("gain-pres", "visibility", view === "future" ? "visible" : "none");
  } else {
    map.getSource("rues-pres").setData(EMPTY);
    const key = `${season}:${index}:${view}`;
    if (farKey !== key) {
      map.getSource("rues-loin").setData(router.farCollection(index, season, view === "future"));
      farKey = key;
    }
    map.setLayoutProperty("rues-loin", "visibility", "visible");
    map.setLayoutProperty("gain-loin", "visibility", view === "future" ? "visible" : "none");
    map.setLayoutProperty("gain-pres", "visibility", "none");
  }
  paintBuildings();
}

let resolveReady = () => {};
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

map.on("load", () => {
  calmBasemap();
  map.addSource("rues-loin", { type: "geojson", data: EMPTY });
  map.addSource("rues-pres", { type: "geojson", data: EMPTY });
  map.addSource("quartiers", { type: "geojson", data: EMPTY });
  map.addSource("batis", { type: "geojson", data: EMPTY });
  map.addSource("ombres", { type: "geojson", data: EMPTY });
  map.addSource("trajet", { type: "geojson", data: EMPTY });
  map.addSource("trajet-continu", { type: "geojson", data: EMPTY });
  map.addSource("trajet-velib", { type: "geojson", data: EMPTY });
  map.addSource("equipements", { type: "geojson", data: EMPTY, generateId: true });
  map.addSource("manques", { type: "geojson", data: EMPTY });
  map.addSource("projets", { type: "geojson", data: EMPTY });
  map.addSource("stations", { type: "geojson", data: EMPTY, generateId: true });
  map.addSource("velib", {
    type: "geojson",
    data: EMPTY,
    generateId: true,
    attribution: '<a href="https://opendata.paris.fr/explore/dataset/velib-emplacement-des-stations/" target="_blank" rel="noopener">Vélib’ Métropole / Smovengo (ODbL)</a>',
  });
  registerMapIcons(map);

  const beforeLabels = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  const add = (layer) => map.addLayer(layer, beforeLabels);
  const streetPaint = {
    "line-color": SHADE_COLOR,
    "line-opacity": STREET_OPACITY["rues-loin"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.9, 12, 1.55, 14.5, 3.2],
  };
  add({
    id: "quartiers-ombre",
    type: "fill",
    source: "quartiers",
    paint: { "fill-color": SHADE_COLOR, "fill-opacity": STREET_OPACITY["quartiers-ombre"] },
  });
  add({
    id: "quartiers-filet",
    type: "line",
    source: "quartiers",
    paint: { "line-color": "#ffffff", "line-opacity": 0.7, "line-width": 0.7 },
  });
  add({
    id: "gain-loin",
    type: "line",
    source: "rues-loin",
    filter: [">=", ["get", "g"], 0.08],
    layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#258251", "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 14.5, 7] },
  });
  add({
    id: "gain-pres",
    type: "line",
    source: "rues-pres",
    filter: [">=", ["get", "g"], 0.08],
    layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#258251", "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 7, 18.5, 11] },
  });
  add({
    id: "rues-loin",
    type: "line",
    source: "rues-loin",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: streetPaint,
  });
  add({
    id: "rues-pres",
    type: "line",
    source: "rues-pres",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": SHADE_COLOR,
      "line-opacity": STREET_OPACITY["rues-pres"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 15, 2.6, 17, 4.4, 18.5, 6.5],
    },
  });
  add({
    id: "ombres-sol",
    type: "fill",
    source: "ombres",
    paint: { "fill-color": "#2a313c", "fill-opacity": 0.38 },
  });
  add({
    id: "batis-connus",
    type: "fill",
    source: "batis",
    filter: ["==", ["get", "known"], 1],
    paint: { "fill-color": "#f6f0e4", "fill-opacity": 0.92 },
  });
  add({
    id: "batis-connus-line",
    type: "line",
    source: "batis",
    filter: ["==", ["get", "known"], 1],
    paint: { "line-color": "#c9bba4", "line-width": 0.6 },
  });
  add({
    id: "batis-inconnus",
    type: "line",
    source: "batis",
    filter: ["==", ["get", "known"], 0],
    paint: { "line-color": "#8d7760", "line-width": 1.1, "line-dasharray": [1.2, 1.1] },
  });
  add({
    id: "batis-volume",
    type: "fill-extrusion",
    source: "batis",
    filter: ["==", ["get", "known"], 1],
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-height": ["get", "h"],
      "fill-extrusion-base": 0,
      "fill-extrusion-color": "#e4d5c0",
      "fill-extrusion-opacity": 0.96,
      "fill-extrusion-vertical-gradient": true,
    },
  });
  add({
    id: "manques",
    type: "circle",
    source: "manques",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 17],
      "circle-color": ["case", ["==", ["get", "priority"], 2], "#9a3f09", "#c98d32"],
      "circle-opacity": 0.65,
      "circle-stroke-color": "#fffaf2",
      "circle-stroke-width": 1,
    },
  });
  add({
    id: "projets",
    type: "line",
    source: "projets",
    layout: { visibility: "none", "line-cap": "round" },
    paint: { "line-color": "#744a9b", "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.85 },
  });
  for (const [id, category, icon] of [
    ["points-eau", "water", "picto-fontaine"],
    ["lieux-frais", "cool", "picto-fraicheur"],
    ["parcs-frais", "park", "picto-arbre"],
  ]) {
    add({
      id,
      type: "symbol",
      source: "equipements",
      minzoom: 13,
      filter: ["==", ["get", "category"], category],
      layout: {
        "icon-image": icon,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 13, category === "water" ? 0.95 : 0.75, 16, category === "water" ? 1.25 : 1.1],
        "icon-allow-overlap": false,
        "icon-padding": 2,
      },
    });
  }
  add({
    id: "velib-points",
    type: "symbol",
    source: "velib",
    minzoom: 13,
    layout: {
      "icon-image": "picto-velo",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.72, 16, 1.05],
      "icon-allow-overlap": false,
      "icon-padding": 2,
    },
  });
  add({
    id: "stations-points",
    type: "symbol",
    source: "stations",
    minzoom: 12,
    layout: {
      visibility: "visible",
      "icon-image": ["case", [">=", ["get", "score"], 2], "picto-station-alerte", "picto-station"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 1.15],
      "icon-allow-overlap": false,
      "icon-padding": 2,
    },
  });
  map.addLayer(placeVolumes.layer);
  map.addLayer({
    id: "trajet-fond",
    type: "line",
    source: "trajet-continu",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": ["case", ["==", ["get", "mode"], "velo"], 13, 11] },
  });
  map.addLayer({
    id: "trajet-contour",
    type: "line",
    source: "trajet-continu",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ROUTE_COLOR, "line-width": ["case", ["==", ["get", "mode"], "velo"], 9, 7] },
  });
  map.addLayer({
    id: "trajet-couleur",
    type: "line",
    source: "trajet",
    minzoom: OVERVIEW_ZOOM,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": ["case", ["==", ["get", "mode"], "velo"], 5, 3.5],
      "line-color": ["case", ["<", ["get", "s"], 0], ROUTE_COLOR, SHADE_COLOR],
    },
  });
  map.addLayer({
    id: "trajet-stations-velib",
    type: "symbol",
    source: "trajet-velib",
    layout: { "icon-image": "picto-velo", "icon-size": 1.1, "icon-allow-overlap": true },
  });

  map.on("zoom", () => el.scale.classList.toggle("echelle-rues", map.getZoom() >= OVERVIEW_ZOOM));
  map.on("pitch", () => {
    syncVolumes();
    placeVolumes.sync();
    syncPlaceIcons();
    syncAim();
    syncRouteContrast();
    if (map.getPitch() > 2 && batisKey !== "ville" && map.getZoom() < 14.8) paintBuildings();
  });
  map.on("pitchend", () => { paintStreets(); placeVolumes.sync(); syncPlaceIcons(); });
  map.on("moveend", () => { paintStreets(); placeVolumes.sync(); syncPlaceIcons(); });
  map.on("click", onMapClick);
  renderHour(hour, false);

  const get = (url, kind) => fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return kind === "bin" ? r.arrayBuffer() : r.json();
  });
  const getPacked = async (name) => {
    if (typeof DecompressionStream === "undefined") throw new Error("Ce navigateur ne sait pas décompresser les données cartographiques.");
    const { parts } = await get(`data/${name}.parts.json`, "json");
    const buffers = await Promise.all(Array.from({ length: parts }, (_, i) => get(`data/${name}.part${String(i).padStart(3, "0")}`, "bin")));
    return new Response(new Blob(buffers).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  };
  Promise.all([
    getPacked("axes.bin"),
    getPacked("tree-cover.bin"),
    getPacked("batis.bin"),
    get("data/amenities.json", "json"),
    get("data/gaps.json", "json"),
    get("data/projects.json", "json"),
    get("data/stations.json", "json"),
    get("data/velib.json", "json"),
    (async () => {
      const parts = await Promise.all(Array.from({ length: 12 }, (_, i) => get(`data/park-part-${String(i).padStart(2, "0")}.json`, "json")));
      return {
        type: "FeatureCollection",
        source: "ilots-de-fraicheur-espaces-verts-frais",
        features: parts.flatMap((part) => part.features),
      };
    })(),
  ])
    .then(([axes, treeCover, batis, places, gaps, projects, stationRows, velib, parkShapes]) => {
      router = createRouter(axes, (lon, lat) => pointInRing(lon, lat, scene.ring), treeCover);
      planItinerary = createItineraryPlanner(router, velib.features);
      buildings = indexBuildings(batis);
      liveShade = createLiveShade(buildings);
      amenities = places;
      stationCollection = stationRows;
      velibCollection = velib;
      placeVolumes.setData(places, stationRows, velib);
      placeVolumes.setShapes(parkShapes);
      map.getSource("equipements").setData(places);
      map.getSource("manques").setData(gaps);
      map.getSource("projets").setData(projects);
      map.getSource("velib").setData(velib);
      paintStreets();
      syncView();
      note("Touchez la carte.");
      openStorySelection();
      resolveReady();
    })
    .catch((error) => {
      note("Les données de Paris n’ont pas pu être lues.");
      console.error(error);
    });
});

let lastNarrow = window.innerWidth < 760;
window.addEventListener("resize", () => {
  const narrow = window.innerWidth < 760;
  if (narrow !== lastNarrow) {
    lastNarrow = narrow;
    const bounds = pointA && pointB
      ? new maplibregl.LngLatBounds().extend(pointA).extend(pointB)
      : scene.bounds;
    map.fitBounds(bounds, { padding: padding(), maxZoom: 16, duration: 0 });
  }
});

function borne(letter) {
  const node = document.createElement("div");
  node.className = "borne";
  node.textContent = letter;
  node.setAttribute("aria-label", letter === "A" ? "Départ" : "Arrivée");
  return new maplibregl.Marker({ element: node, anchor: "center" });
}

function showBorne(letter, lngLat) {
  const current = letter === "A" ? markerA : markerB;
  const marker = current || borne(letter);
  marker.setLngLat(lngLat).addTo(map);
  if (letter === "A") markerA = marker;
  else markerB = marker;
}

function hideBorne(letter) {
  (letter === "A" ? markerA : markerB)?.remove();
}

function syncRouteContrast() {
  const muted = routeVisible && map.getPitch() <= 2;
  if (muted === streetColorsMuted) return;
  streetColorsMuted = muted;
  for (const [layer, opacity] of Object.entries(STREET_OPACITY)) {
    const property = layer === "quartiers-ombre" ? "fill-opacity" : "line-opacity";
    map.setPaintProperty(layer, property, muted ? opacity * 0.35 : opacity);
  }
  const iconOpacity = muted
    ? ["case", ["boolean", ["feature-state", "nearRoute"], false], 1, 0.25]
    : 1;
  for (const layers of Object.values(PLACE_LAYERS)) {
    for (const layer of layers) map.setPaintProperty(layer, "icon-opacity", iconOpacity);
  }
}

function clearLine() {
  map.getSource("trajet")?.setData(EMPTY);
  map.getSource("trajet-continu")?.setData(EMPTY);
  map.getSource("trajet-velib")?.setData(EMPTY);
  routeVisible = false;
  syncRouteContrast();
  updateNearbyPlaces([]);
}

const ICON_EAU = `<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="#0878ad"/><rect x="4.2" y="5.4" width="7.2" height="1.8" rx="0.6" fill="#fff"/><path d="M5.6 11.2h6.6l-.9 2.2H6.5z" fill="#fff"/></svg>`;
const ICON_FRAIS = `<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.5" fill="#eaf8f5" stroke="#217464" stroke-width="1.2"/><path d="M4.8 9h8.4M6.4 6.2l5.2 5.6M6.4 11.8l5.2-5.6" fill="none" stroke="#176c61" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const ICON_PARC = `<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.5" fill="#f1f8e9" stroke="#4c872f" stroke-width="1.2"/><path d="M9 9.2v4" stroke="#6a4b30" stroke-width="1.3" stroke-linecap="round"/><circle cx="6.8" cy="8.8" r="2" fill="#397b38"/><circle cx="9" cy="6.6" r="2.4" fill="#397b38"/><circle cx="11.2" cy="8.8" r="2" fill="#397b38"/></svg>`;
const ICON_SOLEIL = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.4" fill="#da6840"/><g fill="none" stroke="#da6840" stroke-width="1.7" stroke-linecap="round"><path d="M12 3.2v2.3M12 18.5V20.8M3.2 12h2.3M18.5 12h2.3M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6"/></g></svg>`;
const ICON_OMBRE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 17.2c2.4 1.5 4.4 1.2 6.6-.2 2.2-1.4 4.2-1.6 6.6-.1 2.2 1.3 4.1 1.5 6.3.2" fill="none" stroke="#176778" stroke-width="1.6" stroke-linecap="round"/><path d="M7.2 16.2V8.2h3.4v8M10.6 16.2V5.6H16.4v10.6" fill="#176778"/></svg>`;
const ICON_TEMPS = `<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.2" fill="none" stroke="#0071e3" stroke-width="1.6"/><path d="M9 5.6V9l2.4 1.6" fill="none" stroke="#0071e3" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_DISTANCE = `<svg viewBox="0 0 18 18" aria-hidden="true"><g transform="rotate(-38 9 9)" fill="none" stroke="#36556f" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="2.3" y="6" width="13.4" height="6" rx="1.2"/><path d="M5.3 6v2.3M9 6v1.5M12.7 6v2.3"/></g></svg>`;

function iconNode(markup) {
  const holder = document.createElement("span");
  holder.innerHTML = markup;
  return holder.firstElementChild;
}

function statCard(markup, parts, featured = false) {
  const card = document.createElement("div");
  card.className = featured ? "stat stat-temps" : "stat";
  const row = document.createElement("span");
  row.className = "stat-chiffre";
  for (const [value, unit] of parts) {
    const number = document.createElement("strong");
    number.textContent = value;
    const label = document.createElement("span");
    label.textContent = unit ? ` ${unit}` : "";
    const pair = document.createElement("span");
    pair.className = "stat-unite";
    pair.append(number, label);
    if (row.childElementCount) row.append(" ");
    row.append(pair);
  }
  card.append(iconNode(markup), row);
  return card;
}

function note(text) {
  el.resultat.className = "trajet-resultat";
  el.resultat.textContent = text;
  el.comparison.hidden = true;
  el.legs.hidden = true;
}

function updateNearbyPlaces(segments) {
  if (!segments.length && !nearbyPlaces) return;
  const radius = PLACE_RADIUS_METERS;
  const project = ([lon, lat]) => [lon * 73400, lat * 111132];
  const edges = segments.map(({ coords: [a, b] }) => {
    const [x, y] = project(a);
    const [bx, by] = project(b);
    const dx = bx - x;
    const dy = by - y;
    return { x, y, dx, dy, length2: dx ** 2 + dy ** 2 || 1 };
  });
  const closeToRoute = (coordinates) => {
    const [px, py] = project(coordinates);
    return edges.some(({ x, y, dx, dy, length2 }) => {
      const tx = px - x;
      const ty = py - y;
      if (tx < Math.min(0, dx) - radius || tx > Math.max(0, dx) + radius ||
          ty < Math.min(0, dy) - radius || ty > Math.max(0, dy) + radius) return false;
      const t = Math.max(0, Math.min(1, (tx * dx + ty * dy) / length2));
      return (tx - t * dx) ** 2 + (ty - t * dy) ** 2 <= radius ** 2;
    });
  };
  const nearby = {};
  for (const [source, collection] of Object.entries({
    equipements: amenities,
    stations: stationCollection,
    velib: velibCollection,
  })) {
    const previous = nearbyPlaces?.[source] ?? new Set();
    const next = new Set();
    if (edges.length) collection.features.forEach((feature, id) => {
      if (closeToRoute(feature.geometry.coordinates)) next.add(id);
    });
    for (const id of previous) {
      if (!next.has(id)) map.removeFeatureState({ source, id }, "nearRoute");
    }
    for (const id of next) {
      if (!previous.has(id)) map.setFeatureState({ source, id }, { nearRoute: true });
    }
    nearby[source] = next;
  }
  nearbyPlaces = edges.length ? nearby : null;
}

function routeMeetings() {
  const counts = { water: 0, cool: 0, park: 0 };
  for (const id of nearbyPlaces?.equipements ?? []) {
    const category = amenities.features[id].properties.category;
    if (category in counts) counts[category]++;
  }
  const { water, cool, park: parks } = counts;
  el.contexte.replaceChildren();
  if (!water && !cool && !parks) {
    el.contexte.removeAttribute("aria-label");
    return "";
  }
  const lead = document.createElement("span");
  lead.className = "passe";
  lead.textContent = "On passe par";
  el.contexte.append(lead);
  const add = (count, markup) => {
    const n = document.createElement("span");
    n.textContent = String(count);
    el.contexte.append(n, iconNode(markup));
  };
  if (water) add(water, ICON_EAU);
  if (cool) add(cool, ICON_FRAIS);
  if (parks) add(parks, ICON_PARC);
  const label = [
    water ? `${water} fontaine${water > 1 ? "s" : ""}` : "",
    cool ? `${cool} lieu${cool > 1 ? "x" : ""} frais` : "",
    parks ? `${parks} parc${parks > 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(", ");
  el.contexte.setAttribute("aria-label", label);
  return label;
}

function stationProfile(feature) {
  const p = feature.properties;
  const index = scene.hours.indexOf(hour);
  const shade = live.on
    ? null
    : season === "hiver" ? p.shadeWinter[index] : view === "future" ? p.shadeFuture[index] : p.shadeToday[index];
  const shadeGap = shade != null && shade < 40;
  const waterGap = p.waterMeters > 350;
  const coolGap = p.coolMeters > 300;
  return { feature, shade, score: Number(shadeGap) + Number(waterGap) + Number(coolGap) };
}

function modeLabel(mode) {
  const names = { METRO: "Métro", TRAM: "Tram", RER: "RER", TRAIN: "Train", VAL: "Val" };
  return String(mode || "Arrêt").split(" / ").map((part) => names[part] || part).join(", ");
}

function stationText(profile) {
  if (live.on) return "";
  if (profile.shade == null) return "Soleil couché.";
  return season === "hiver"
    ? `${Math.round(100 - profile.shade)} % de soleil autour.`
    : `${profile.shade} % d’ombre autour.`;
}

function renderStationList(profiles) {
  const query = el.stationSearch.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const ranked = [...profiles].sort((a, b) => b.score - a.score || (a.shade ?? 101) - (b.shade ?? 101) || b.feature.properties.waterMeters - a.feature.properties.waterMeters);
  const matching = query
    ? ranked.filter(({ feature }) => feature.properties.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(query))
    : ranked;
  const visible = query || showAllStations ? matching : matching.slice(0, 10);
  el.stationCount.textContent = query
    ? `${matching.length} station${matching.length > 1 ? "s" : ""} trouvée${matching.length > 1 ? "s" : ""}.`
    : live.on
      ? `${visible.length} sur ${matching.length}.`
      : `${visible.length} sur ${matching.length}, à ${hour} h.`;
  el.stationList.replaceChildren();
  for (const profile of visible) {
    const p = profile.feature.properties;
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("strong");
    name.textContent = p.name;
    const details = document.createElement("span");
    details.textContent = stationText(profile) ? `${modeLabel(p.mode)}. ${stationText(profile)}` : modeLabel(p.mode);
    button.append(name, details);
    button.addEventListener("click", () => {
      const coords = profile.feature.geometry.coordinates;
      map.flyTo({ center: coords, zoom: 15.4, padding: padding(), duration: 450 });
      showStationPopup(profile.feature, coords, profile);
    });
    li.append(button);
    el.stationList.append(li);
  }
  el.stationAll.hidden = Boolean(query) || showAllStations;
}

function renderStations() {
  if (!stationCollection.features?.length) return;
  const profiles = stationCollection.features.map(stationProfile);
  const lowShade = profiles.filter((p) => p.shade != null && p.shade < 40).length;
  const count = profiles.length;
  const day = profiles.some((p) => p.shade != null);
  el.insights.textContent = live.on
    ? ""
    : day
      ? `${lowShade} stations sur ${count} ont moins de 40 % d’ombre à ${hour} h.`
      : "Soleil couché.";
  renderStationList(profiles);
  if (map.getSource("stations")) {
    map.getSource("stations").setData({
      type: "FeatureCollection",
      features: profiles.map(({ feature, shade, score }) => ({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          category: "station",
          name: feature.properties.name,
          mode: feature.properties.mode,
          waterMeters: feature.properties.waterMeters,
          coolMeters: feature.properties.coolMeters,
          shade,
          score,
        },
      })),
    });
  }
}

el.stationSearch.addEventListener("input", () => renderStationList(stationCollection.features.map(stationProfile)));
el.stationAll.addEventListener("click", () => { showAllStations = true; renderStationList(stationCollection.features.map(stationProfile)); });

function routePlan(origin, destination, preference) {
  const hourIndex = scene.hours.indexOf(hour);
  const solar = live.on && liveShade ? { up: live.up, fraction: liveFraction } : null;
  return router.plan(...origin, ...destination, season, hourIndex, !solar && view === "future", solar, preference);
}

function renderLegs(result) {
  el.legs.replaceChildren();
  el.legs.hidden = !result.pickup;
  if (!result.pickup) return;
  const pickup = result.pickup.properties.name;
  const dropoff = result.dropoff.properties.name;
  const labels = [`À pied vers ${pickup}`, `En Vélib jusqu’à ${dropoff}`, "À pied jusqu’à l’arrivée"];
  for (const label of labels) {
    const row = document.createElement("li");
    row.textContent = label;
    el.legs.append(row);
  }
}

function drawRoute(speak) {
  if (!pointA || !pointB || !planItinerary || !map.getSource("trajet")) return;
  const request = {
    origin: pointA,
    destination: pointB,
    mode: allure,
    plan: routePlan,
    stop: selectedStop?.geometry.coordinates,
  };
  const result = planItinerary({ ...request, preference: accept });
  showBorne("A", pointA);
  showBorne("B", pointB);
  if (!result.ok) {
    clearLine();
    note(result.message);
    el.contexte.replaceChildren();
    el.direct.textContent = result.message;
    return;
  }
  map.getSource("trajet").setData({
    type: "FeatureCollection",
    features: result.segments.map((segment) => ({
      type: "Feature",
      properties: { s: segment.s, mode: segment.mode },
      geometry: { type: "LineString", coordinates: segment.coords },
    })),
  });
  map.getSource("trajet-continu").setData({
    type: "FeatureCollection",
    features: result.legs.filter((leg) => leg.segments.length).map(({ segments }) => {
      const coordinates = [segments[0].coords[0]];
      for (const { coords: [start, end] } of segments) {
        const last = coordinates.at(-1);
        if (last[0] !== start[0] || last[1] !== start[1]) coordinates.push(start);
        coordinates.push(end);
      }
      return {
        type: "Feature",
        properties: { mode: segments[0].mode },
        geometry: { type: "LineString", coordinates },
      };
    }),
  });
  map.getSource("trajet-velib").setData({
    type: "FeatureCollection",
    features: result.pickup ? [result.pickup, result.dropoff] : [],
  });
  routeVisible = result.segments.length > 0;
  updateNearbyPlaces(result.segments);
  syncRouteContrast();
  const duration = durationParts(result.minutes);
  const sunShare = result.sun;
  const shareLabel = sunShare == null
    ? (result.neutral ? "Soleil couché" : "Part de soleil inconnue")
    : `${pct(sunShare)} au soleil`;
  el.resultat.className = "trajet-cartes";
  el.resultat.replaceChildren(
    statCard(ICON_TEMPS, duration, true),
    statCard(ICON_DISTANCE, [[Math.round(result.length).toLocaleString("fr-FR"), "m"]]),
    statCard(ICON_SOLEIL, [[sunShare == null ? "—" : String(Math.round(sunShare * 100)), sunShare == null ? "" : "% soleil"]]),
  );
  const normal = accept === 50 ? result : planItinerary({ ...request, preference: 50 });
  el.comparison.hidden = !normal.ok;
  if (normal.ok) {
    const normalTime = durationParts(normal.minutes).map((part) => part.join(" ")).join(" ");
    const comparisonSun = normal.sun == null ? "" : ` et ${pct(normal.sun)} au soleil`;
    el.comparison.textContent = accept === 50 ? "Trajet de référence" : `Normal : ${normalTime}${comparisonSun}`;
  }
  renderLegs(result);
  const meetings = routeMeetings();
  const time = duration.map((part) => part.join(" ")).join(" ");
  const announcement = `${time}, ${formatLength(result.length)}. ${shareLabel}. ${meetings}`.trim();
  if (speak || el.direct.textContent !== announcement) el.direct.textContent = announcement;
}

const streetToken = { a: 0, b: 0 };

function streetName(properties) {
  const street = properties?.street || properties?.name || "";
  if (street && !/^\d/.test(street)) return street;
  const label = properties?.label || "";
  const fromLabel = label.split(",")[0].replace(/^\d+\s*/, "").trim();
  return fromLabel || street || "Rue sans nom";
}

function labelPoint(letter, lon, lat) {
  const token = ++streetToken[letter];
  const input = document.getElementById(letter === "a" ? "adresse-a" : "adresse-b");
  const url = new URL("https://data.geopf.fr/geocodage/reverse");
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("limit", "1");
  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      if (streetToken[letter] !== token) return;
      input.value = streetName(data.features?.[0]?.properties);
    })
    .catch(() => {
      if (streetToken[letter] !== token) return;
      if (!input.value) input.value = "Rue sans nom";
    });
}

function place(lngLat, which) {
  if (!router) {
    note("Chargement de Paris…");
    return;
  }
  const point = [lngLat.lng ?? lngLat[0], lngLat.lat ?? lngLat[1]];
  const snap = router.snap(point[0], point[1]);
  if (!snap.ok) {
    if (!(pointA && pointB)) note(snap.message);
    el.direct.textContent = snap.message;
    return;
  }
  const target = which || armed || (pointA && !pointB ? "b" : "a");
  armed = null;
  if (target === "b" && !pointA) {
    note("Choisissez d’abord le départ.");
    el.direct.textContent = "Choisissez d’abord le départ.";
    return;
  }
  if (target === "a") {
    pointA = point;
    pointB = null;
    selectedStop = null;
    document.getElementById("adresse-b").value = "";
    if (!which) labelPoint("a", snap.lon, snap.lat);
    clearLine();
    hideBorne("B");
    showBorne("A", [snap.lon, snap.lat]);
    note("Départ posé.");
    el.contexte.replaceChildren();
    el.direct.textContent = "Départ posé. Choisissez l’arrivée.";
    return;
  }
  pointB = point;
  if (!which) labelPoint("b", snap.lon, snap.lat);
  drawRoute(true);
}

function syncAim() {
  const tilted = map.getPitch() > 2;
  el.vueDessus.setAttribute("aria-pressed", String(!tilted));
  el.vueInclinee.setAttribute("aria-pressed", String(tilted));
  el.rotationHint.hidden = !tilted;
}

function aimView(tilted) {
  const zoom = map.getZoom();
  map.easeTo({ pitch: tilted ? 60 : 0, zoom: tilted ? Math.max(zoom, VOLUME_ZOOM) : zoom, bearing: 0, duration: 650 });
}

function syncPlaceIcons() {
  const volumesOn = map.getPitch() > 2 && map.getZoom() >= VOLUME_ZOOM;
  for (const [id, visible] of [
    ["points-eau", el.water.checked && !volumesOn],
    ["lieux-frais", el.cool.checked && !volumesOn],
    ["parcs-frais", el.parks.checked && !volumesOn],
    ["stations-points", el.stations.checked && !volumesOn],
    ["velib-points", el.velib.checked && !volumesOn],
    ["trajet-stations-velib", !volumesOn || !el.velib.checked],
  ]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

function parisNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return { hour, minute, label: `${hour} h ${minute}` };
}

function syncDock() {
  const locked = live.on;
  el.dock.classList.toggle("is-live", locked);
  el.range.disabled = locked;
  el.precedent.disabled = locked;
  el.suivant.disabled = locked;
  el.lecture.disabled = locked;
  if (locked) {
    const clock = parisNow();
    live.label = clock.label;
    el.nombre.textContent = String(clock.hour);
    el.unite.textContent = ` h ${clock.minute}`;
    el.range.step = "0.01";
    const position = clock.hour + Number(clock.minute) / 60;
    el.range.value = String(Math.min(21, Math.max(7, position)));
    el.range.setAttribute("aria-valuetext", clock.label);
    return;
  }
  el.nombre.textContent = String(hour);
  el.unite.textContent = " h";
  el.range.step = "1";
  el.range.value = String(hour);
  el.range.setAttribute("aria-valuetext", `${hour} heures`);
}

function formatTemp(value) {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} °C`;
}

function pressMoments() {
  el.now.setAttribute("aria-pressed", String(live.on));
  el.ete.setAttribute("aria-pressed", String(!live.on && season === "ete"));
  el.hiver.setAttribute("aria-pressed", String(!live.on && season === "hiver"));
  el.today.setAttribute("aria-pressed", String(!live.on && view === "today"));
  el.future.setAttribute("aria-pressed", String(!live.on && view === "future"));
}

function currentSun() {
  const now = new Date();
  const position = sunPosition(now, LIVE_LAT, LIVE_LON);
  live.altitude = position.altitude;
  live.azimuth = position.azimuth;
  live.up = position.altitude > (0.5 * Math.PI) / 180;
  live.label = parisNow(now).label;
  if (!live.up) live.mode = "neutral";
  else if (live.altitude < HIGH_ALT) live.mode = "sun";
  else if (live.weather === "ok" && live.cover < 50) live.mode = "shade";
  else live.mode = "neutral";
}

function sunSentence() {
  if (accept === 33) return "Un détour seulement s’il vaut le temps.";
  if (accept === 50) return "Le trajet le plus court sert de référence.";
  if (live.on && !live.up) return "Soleil couché.";
  if (accept <= 0) return "Le trajet évite le soleil.";
  if (accept >= 100) return "Le trajet cherche le soleil.";
  return "Le trajet privilégie les rues au soleil.";
}

function renderCopy() {
  syncDock();
  pressMoments();
  const seek = accept > 50;
  el.goalIcon.replaceChildren(iconNode((live.on && !live.up) || seek ? ICON_SOLEIL : ICON_OMBRE));
  el.goalText.textContent = sunSentence();
  if (live.on) {
    el.goalExtra.textContent = "";
    if (live.weather === "ok") {
      const sky = live.cover >= 50 ? "Couvert" : "Dégagé";
      el.weather.textContent = `${formatTemp(live.temp)}, ${sky}`;
    } else {
      el.weather.textContent = live.weather === "miss" ? "Météo indisponible" : "Météo en cours de chargement";
    }
  } else {
    const temp = view === "today" && season === "ete" ? scene.temperature.byHour[hour] : null;
    el.weather.textContent = Number.isFinite(temp) ? `${formatTemp(temp)}, ciel dégagé (modèle)` : "Ciel dégagé (modèle)";
    el.goalExtra.textContent = view === "today"
      ? ""
      : season === "hiver"
        ? "L’ombre reste celle des bâtiments."
        : "Les jeunes arbres sont plus grands.";
  }
  refreshGradient();
}

function leaveLive() {
  if (!live.on) return false;
  live.on = false;
  farKey = "";
  overviewKey = "";
  shadowCache = { key: "", data: EMPTY };
  batisKey = "";
  stopLiveTimer();
  syncDock();
  return true;
}

function enterLive() {
  if (!router || !buildings || !liveShade) {
    note("Chargement de Paris…");
    return;
  }
  stopPlay();
  live.on = true;
  live.weather = live.weather === "ok" ? "ok" : "wait";
  currentSun();
  farKey = "";
  overviewKey = "";
  shadowCache = { key: "", data: EMPTY };
  batisKey = "";
  syncView();
  loadWeather();
  startLiveTimer();
}

let liveTimer = 0;

function stopLiveTimer() {
  if (liveTimer) window.clearInterval(liveTimer);
  liveTimer = 0;
}

function startLiveTimer() {
  stopLiveTimer();
  liveTimer = window.setInterval(() => {
    tickLive();
  }, 60_000);
}

function tickLive() {
  if (!live.on) {
    stopLiveTimer();
    return;
  }
  currentSun();
  renderCopy();
  paintStreets();
  if (pointA && pointB) drawRoute(false);
  loadWeather();
}

async function loadWeather() {
  const token = ++weatherToken;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(LIVE_LAT));
  url.searchParams.set("longitude", String(LIVE_LON));
  url.searchParams.set("current", "cloud_cover,temperature_2m,is_day");
  url.searchParams.set("timezone", "Europe/Paris");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    const current = data.current || {};
    if (!Number.isFinite(current.cloud_cover) || !Number.isFinite(current.temperature_2m)) throw new Error("champs");
    if (token !== weatherToken || !live.on) return;
    live.cover = current.cloud_cover;
    live.temp = current.temperature_2m;
    live.weather = "ok";
  } catch {
    if (token !== weatherToken || !live.on) return;
    if (live.weather !== "ok") {
      live.cover = null;
      live.temp = null;
      live.weather = "miss";
    }
  }
  currentSun();
  renderCopy();
}

function syncView() {
  renderCopy();
  for (const [id, visible] of [
    ["legende-gain", view === "future" && season === "ete" && !live.on],
    ["legende-manque", view === "future"],
    ["legende-projet", view === "future"],
    ["legende-alerte", el.stations.checked],
  ]) {
    const row = document.getElementById(id);
    if (row) row.hidden = !visible;
  }
  syncPlaceIcons();
  for (const [id, visible] of [
    ["manques", view === "future"],
    ["projets", view === "future"],
  ]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
  paintStreets();
  renderStations();
  placeVolumes.setVisible({
    water: el.water.checked,
    cool: el.cool.checked,
    park: el.parks.checked,
    station: el.stations.checked,
    velib: el.velib.checked,
  });
  if (pointA && pointB) drawRoute(false);
}

function placeTitle(value) {
  if (!value) return "";
  return value.toLocaleLowerCase("fr-FR").replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letter) => sep + letter.toLocaleUpperCase("fr-FR"));
}

function openFiche(lngLat, nom, type, info, action) {
  const box = document.createElement("div");
  box.className = "fiche-corps";
  const title = document.createElement("strong");
  title.className = "fiche-nom";
  title.textContent = nom || "Lieu";
  const kind = document.createElement("p");
  kind.className = "fiche-type";
  kind.textContent = type;
  box.append(title, kind);
  if (info) {
    const line = document.createElement("p");
    line.className = "fiche-info";
    line.textContent = info;
    box.append(line);
  }
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px", className: "fiche", offset: 16 })
    .setLngLat(lngLat)
    .setDOMContent(box)
    .addTo(map);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fiche-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.run();
      popup.remove();
    });
    box.append(button);
  }
  return popup;
}

function showStationPopup(feature, lngLat, suppliedProfile) {
  const p = feature.properties;
  const profile = suppliedProfile || {
    feature,
    shade: p.shade == null || p.shade === "null" ? null : Number(p.shade),
    score: Number(p.score),
  };
  const point = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
  openFiche(point, p.name, modeLabel(p.mode), stationText(profile), pointA && router?.snap(point[0], point[1]).ok
    ? {
        label: "Itinéraire",
        run() {
          pointB = point;
          selectedStop = null;
          document.getElementById("adresse-b").value = p.name;
          drawRoute(true);
          const bounds = new maplibregl.LngLatBounds();
          bounds.extend(pointA);
          bounds.extend(pointB);
          map.fitBounds(bounds, { padding: padding(), maxZoom: 16, duration: 450 });
        },
      }
    : null);
}

function popup(feature, lngLat) {
  if (feature.properties?.category === "velib") {
    const capacity = feature.properties.capacity;
    const places = Number.isFinite(capacity) ? `${capacity} emplacements` : "";
    openFiche(lngLat, feature.properties.name, "Vélib", places);
    return;
  }
  if (feature.properties.category === "station") {
    showStationPopup(feature, feature.geometry.coordinates);
    return;
  }
  const p = feature.properties;
  const isTrue = (value) => value === true || value === "true";
  let nom = p.name || "Lieu";
  let type = "Lieu";
  let info = "";
  if (p.category === "water") {
    nom = placeTitle(p.address) || p.name;
    type = "Fontaine";
    info = p.name && p.name !== nom ? p.name : "";
  } else if (p.category === "park") {
    type = "Parc";
    info = p.canopy == null ? "" : `${Math.round(Number(p.canopy) * 100)} % de végétation haute`;
  } else if (p.category === "cool") {
    type = p.kind || "Lieu frais";
    info = isTrue(p.free) ? "Accès gratuit." : placeTitle(p.address);
  } else if (isTrue(p.waterGap) || isTrue(p.refugeGap)) {
    nom = "Secteur éloigné";
    type = "Manque";
    info = isTrue(p.waterGap) ? `Fontaine à ${p.nearestWater} m.` : `Lieu frais à ${p.nearestRefuge} m.`;
  } else if (p.year || p.status) {
    type = "Projet";
    info = [p.status, p.year].filter(Boolean).join(", ");
  }
  const canStop = p.category === "water" || (p.category === "cool" && isTrue(p.free));
  openFiche(lngLat, nom, type, info, canStop && pointA && pointB
    ? {
        label: "Étape",
        run() {
          selectedStop = feature;
          drawRoute(true);
        },
      }
    : null);
}

function onMapClick(event) {
  const ids = ["trajet-stations-velib", "velib-points", "stations-points", "points-eau", "lieux-frais", "parcs-frais", "manques", "projets"].filter((id) => map.getLayer(id));
  const feature = map.queryRenderedFeatures(event.point, { layers: ids })[0];
  if (feature) {
    popup(feature, event.lngLat);
    return;
  }
  place(event.lngLat);
}

async function searchAddress(letter) {
  const input = document.getElementById(`adresse-${letter}`);
  const results = document.getElementById(`choix-${letter}`);
  const query = input.value.trim();
  if (!query) return;
  results.replaceChildren();
  const status = document.createElement("p");
  status.className = "etat";
  status.textContent = "Recherche en cours…";
  results.append(status);
  try {
    const terms = /paris/i.test(query) ? query : `${query} Paris`;
    const url = new URL("https://data.geopf.fr/geocodage/search");
    url.searchParams.set("q", terms);
    url.searchParams.set("limit", "5");
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    const choices = (data.features || []).filter((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return pointInRing(lon, lat, scene.ring);
    });
    results.replaceChildren();
    if (!choices.length) {
      status.textContent = "Aucune adresse trouvée dans Paris. Précisez la rue et le numéro.";
      results.append(status);
      return;
    }
    for (const feature of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = feature.properties.label;
      button.addEventListener("click", () => {
        const [lon, lat] = feature.geometry.coordinates;
        place([lon, lat], letter);
        input.value = feature.properties.label;
        results.replaceChildren();
        if (pointA && pointB) {
          const bounds = new maplibregl.LngLatBounds();
          bounds.extend(pointA);
          bounds.extend(pointB);
          map.fitBounds(bounds, { padding: padding(), maxZoom: 16, duration: 450 });
        }
        else map.flyTo({ center: [lon, lat], zoom: 15.5, duration: 450 });
      });
      results.append(button);
    }
  } catch (error) {
    status.textContent = "Recherche indisponible. Placez le point sur la carte.";
    results.replaceChildren(status);
    console.error(error);
  }
}

for (const letter of ["a", "b"]) {
  document.getElementById(`form-${letter}`).addEventListener("submit", (event) => {
    event.preventDefault();
    searchAddress(letter);
  });
}
el.vueDessus.addEventListener("click", () => aimView(false));
el.vueInclinee.addEventListener("click", () => aimView(true));
el.legendInfo.addEventListener("click", () => {
  el.mapMode.hidden = !el.mapMode.hidden;
  el.legendInfo.setAttribute("aria-expanded", String(!el.mapMode.hidden));
});
el.today.addEventListener("click", () => { leaveLive(); view = "today"; syncView(); });
el.future.addEventListener("click", () => { leaveLive(); view = "future"; syncView(); });
el.now.addEventListener("click", () => enterLive());
for (const input of [el.water, el.cool, el.parks, el.stations, el.velib]) input.addEventListener("change", syncView);
function setAllure(next) {
  allure = next;
  el.pied.setAttribute("aria-pressed", String(next === "pied"));
  el.velo.setAttribute("aria-pressed", String(next === "velo"));
  el.velibMode.setAttribute("aria-pressed", String(next === "velib"));
  if (pointA && pointB) drawRoute(false);
}

el.pied.addEventListener("click", () => setAllure("pied"));
el.velo.addEventListener("click", () => setAllure("velo"));
el.velibMode.addEventListener("click", () => setAllure("velib"));
for (const button of document.querySelectorAll("#soleil-crans button")) {
  button.addEventListener("click", () => {
    accept = Number(button.dataset.accept);
    for (const other of document.querySelectorAll("#soleil-crans button")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    renderCopy();
    if (pointA && pointB) drawRoute(false);
  });
}

function setSeason(next) {
  leaveLive();
  season = next;
  renderHour(hour, Boolean(pointA && pointB));
  syncView();
}

function openStorySelection() {
  if (params.get("season") === "hiver") setSeason("hiver");
  const parsePoint = (key) => {
    const parts = params.get(key)?.split(",");
    if (parts?.length !== 2 || parts.some((part) => !part.trim())) return null;
    const point = parts.map(Number);
    return point.every(Number.isFinite) && router.snap(...point).ok ? point : null;
  };
  const a = parsePoint("a");
  const b = parsePoint("b");
  if (a && b) {
    const requested = params.get("accept");
    if (["0", "33", "50", "67", "100"].includes(requested)) accept = Number(requested);
    else if (season === "hiver") accept = 100;
    for (const button of document.querySelectorAll("#soleil-crans button")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.accept) === accept));
    }
    renderCopy();
    place(a, "a");
    place(b, "b");
    document.getElementById("adresse-a").value = "Départ de l’exemple";
    document.getElementById("adresse-b").value = "Station de l’exemple";
    const bounds = new maplibregl.LngLatBounds(a, a).extend(b);
    const route = routePlan(a, b, accept);
    if (route.ok) {
      for (const { coords } of route.segments) for (const point of coords) bounds.extend(point);
    }
    map.fitBounds(bounds, { padding: padding(), maxZoom: 16, duration: 0 });
    return;
  }
  const station = stationCollection.features.find((feature) => feature.properties.id === params.get("station"));
  if (station) {
    const center = station.geometry.coordinates;
    map.jumpTo({ center, zoom: 15.4, padding: padding() });
    showStationPopup(station, center, stationProfile(station));
  }
}

el.ete.addEventListener("click", () => setSeason("ete"));
el.hiver.addEventListener("click", () => setSeason("hiver"));
document.getElementById("inverser").addEventListener("click", () => {
  const champA = document.getElementById("adresse-a");
  const champB = document.getElementById("adresse-b");
  [champA.value, champB.value] = [champB.value, champA.value];
  document.getElementById("choix-a").replaceChildren();
  document.getElementById("choix-b").replaceChildren();
  [pointA, pointB] = [pointB, pointA];
  selectedStop = null;
  if (pointA) showBorne("A", pointA);
  else hideBorne("A");
  if (pointB) showBorne("B", pointB);
  else hideBorne("B");
  if (pointA && pointB) drawRoute(true);
  else {
    clearLine();
    note(pointA ? "Départ posé." : "Touchez la carte.");
    el.contexte.replaceChildren();
  }
});
document.getElementById("effacer").addEventListener("click", () => {
  pointA = null;
  pointB = null;
  selectedStop = null;
  armed = null;
  for (const letter of ["a", "b"]) {
    document.getElementById(`adresse-${letter}`).value = "";
    document.getElementById(`choix-${letter}`).replaceChildren();
  }
  clearLine();
  hideBorne("A");
  hideBorne("B");
  note("Touchez la carte.");
  el.contexte.replaceChildren();
  el.direct.textContent = "Trajet effacé.";
});

if (params.has("test")) {
  window.__ombre = {
    get map() {
      return map;
    },
    place: (lon, lat, which) => place([lon, lat], which),
    season: setSeason,
    hour: (h) => { leaveLive(); renderHour(h, false); },
    now: () => enterLive(),
    live: () => ({ ...live, hour, season, view, slider: Number(el.range.value) }),
    shade: () => shadeStops.slice(),
    preset: () => activePreset,
    volumes: () => placeVolumes.count(),
    ready,
  };
}

const stats = scene.stats;
const sunRows = scene.sun
  .map(
    (s) =>
      `<tr><th>${s.hour} h</th><td>${s.altitude.toLocaleString("fr-FR")}°</td><td>${s.azimuth.toLocaleString("fr-FR")}°</td><td>${scene.temperature.byHour[s.hour] ?? "—"}</td></tr>`,
  )
  .join("");
el.corps.innerHTML = `
  <p>Le ${scene.dateLabel}, de 7 h à 21 h, heure de Paris. Le 21 décembre n’est pas une autre carte : le bouton Hiver reprend les mêmes axes avec le soleil de cette date. Le ciel est supposé dégagé. Ce n’est pas une température, et ce n’est pas un extrait de jveuxdusoleil.fr.</p>
  <h3>Deux horizons</h3>
  <p>Aujourd’hui montre les équipements et les arbres recensés en 2026. Vers 2036 est un scénario conditionnel : les infrastructures de fraîcheur restent à leur niveau actuel, tandis que les arbres déjà recensés comme jeunes gagnent un rayon de canopée supposé de 2 m. Les liserés verts montrent les tronçons où cette hypothèse fait gagner au moins 8 points de couverture moyenne. Chaque halo orange représente une maille de 350 m dont le centre est à plus de 350 m d’une fontaine disponible et/ou à plus de 600 m d’un lieu frais gratuit ou d’un espace vert à au moins 25 % de végétation haute. Ces seuils sont des choix de visualisation, pas une norme sanitaire. Les 9 tracés violets sont des projets de transport dont la mise en service est estimée entre 2027 et 2036 ; leur réalisation et leur date ne sont pas garanties. Les plantations encore à venir ne sont pas placées sur la carte faute de localisation vérifiable. Les rues et bâtiments restent ceux d’aujourd’hui. Ce scénario ne prévoit ni la météo d’un jour de 2036, ni la température future d’un quartier.</p>
  <h3>Le soleil</h3>
  <p>À chaque heure ronde, pour le point 48,857° N, 2,352° E. Jours depuis le 1<sup>er</sup> janvier 2000, 12 h UTC. Anomalie moyenne M = 357,5291° + 0,98560028° × j. Équation du centre C = 1,9148° sin M + 0,0200° sin 2M + 0,0003° sin 3M. Longitude écliptique λ = M + C + 102,9372° + 180°. Déclinaison δ = arcsin(sin λ sin ε), ε = 23,4397°. Puis hauteur et azimut. Modèle de aa.quae.nl, le même que SunCalc, à environ un degré près. L’heure Météo-France est en UTC ; l’affichage est en heure légale, UTC+2 en juin et UTC+1 en décembre.</p>
  <h3>L’ombre</h3>
  <p>${stats.buildingsWithHeight.toLocaleString("fr-FR")} bâtiments de la BD TOPO ont une hauteur photogrammétrique (altimétrie annoncée ${stats.altimetricPrecisionMeters.toLocaleString("fr-FR")} m, planimétrie ${stats.planimetricPrecisionMeters.toLocaleString("fr-FR")} m). L’ombre des bâtiments est portée au plus à ${scene.maxShadowMeters} m. Pas de toit en pente ni de hauteur par défaut.</p>
  <p>Pour l’été, ${treeMeta.treesUsed.toLocaleString("fr-FR")} arbres du jeu « Les arbres » de Paris sont utilisés, dont ${treeMeta.youngTrees.toLocaleString("fr-FR")} classés « Jeune ». Le rayon de houppier actuel est une approximation de 30 % de la hauteur déclarée, limitée entre 1,5 et 6 m. En 2036, seuls ces jeunes arbres gagnent 2 m de rayon, avec un maximum de 8 m. La portion de rue sous les disques est additionnée puis plafonnée à 100 %. Cette couverture n’est pas une mesure de couronne ni une projection physique de l’ombre selon l’azimut du soleil. La météo, l’état sanitaire, l’abattage et la croissance réelle des arbres sont inconnus. En hiver, seule l’ombre des bâtiments est calculée.</p>
  <p>${stats.buildingsUnknownDrawn.toLocaleString("fr-FR")} emprises dans Paris n’ont pas de hauteur. Elles restent un contour en pointillés, sans volume, et ne projettent rien.</p>
  <h3>La couleur</h3>
  <p>L’axe est découpé en tronçons d’environ ${scene.sampleMeters} m. La couleur combine la part d’ombre calculée pour les bâtiments et la couverture de canopée estimée, de 0 à 100&nbsp;%. À l’échelle de Paris, la carte regroupe ces tronçons dans des hexagones de rayon 260 m : chaque couleur est la moyenne des rues calculées de ce secteur, pondérée par le nombre de tronçons. Les secteurs avec moins de huit tronçons connus ne sont pas affichés. En zoomant, les hexagones cèdent la place aux rues, regroupées en bouts d’environ ${scene.chunkMeters} m puis montrées tronçon par tronçon. Un hexagone n’est ni une mesure de température, ni une mesure uniforme de toutes ses surfaces.</p>
  <h3>Les stations de transport</h3>
  <p>Les points de gare ou de station situés dans Paris viennent du jeu « Gares et stations du réseau ferré d’Île-de-France (donnée généralisée) » d’Île-de-France Mobilités. Ce sont des points représentatifs, pas les entrées. Autour de chaque point, la part d’ombre est la moyenne pondérée par longueur des tronçons de rue dont le centre se trouve dans un rayon de 250 m. Les distances à la fontaine disponible et au lieu frais gratuit ou espace vert sont calculées à vol d’oiseau, pas à pied. Les trois points d’attention sont : moins de 40 % d’ombre, plus de 350 m d’une fontaine et plus de 300 m d’un lieu frais. Ces seuils permettent la comparaison ; ils ne constituent pas une norme de santé ou d’accessibilité. Une alerte sur le pictogramme de station signale au moins deux points d’attention. La fiche et la liste textuelle donnent les valeurs précises.</p>
  <h3>Le trajet</h3>
  <p>Le tracé suit les axes BD TOPO calculés dans Paris. Le cran Normal minimise la distance sur ce réseau et sert de référence. Les autres crans pondèrent les tronçons selon leur part d’ombre calculée. Le pourcentage de soleil est pondéré par la distance sur les tronçons dont l’exposition est connue. Les adresses proviennent de la Base Adresse Nationale.</p>
  <p>À pied et à vélo personnel, le trajet relie le départ à l’arrivée. La durée est estimée à ${WALK_KMH} km/h à pied et ${BIKE_KMH} km/h à vélo. Le réseau utilisé est commun aux deux modes, avec des sens de circulation et des accès cyclables à vérifier.</p>
  <p>En Vélib, les stations de prise et de dépôt sont les plus proches à vol d’oiseau de chaque extrémité parmi les stations reliées au trajet. Les deux portions à pied prennent le chemin le plus court. Le cran de soleil s’applique au trajet entre les stations. La durée additionne les trois portions, hors temps de prise et de dépôt. Les bornettes et les vélos disponibles sont à vérifier auprès de Vélib’ Métropole.</p>
  <h3>Hauteur du soleil et air</h3>
  <table>
    <caption>Station ${scene.temperature.station} (${scene.temperature.id}), le 25 juin 2026. La couleur de la carte n’utilise pas ces températures.</caption>
    <thead><tr><th>Heure</th><th>Hauteur</th><th>Azimut</th><th>Air (°C)</th></tr></thead>
    <tbody>${sunRows}</tbody>
  </table>
  <h3>Sources</h3>
  <ul>
    <li>IGN, BD TOPO, bâtiments et tronçons de route du département 75, WFS Géoplateforme. Contour de Paris : API Géo. Licence Ouverte.</li>
    <li>Ville de Paris / Eau de Paris : Fontaines à boire, Îlots de fraîcheur — équipements / activités, Îlots de fraîcheur — espaces verts frais. ODbL. Les jeux ont été relevés lors de la génération du prototype.</li>
    <li>Ville de Paris : Les arbres, hauteurs, stades de développement et emplacements. ODbL. Relevé lors de la génération du prototype.</li>
    <li>Île-de-France Mobilités : Lignes de transport en projet en Île-de-France. Dates estimées et statuts fournis par le jeu. Licence Ouverte.</li>
    <li>Île-de-France Mobilités : Gares et stations du réseau ferré d’Île-de-France (donnée généralisée). Points représentatifs, licence Ouverte v2.</li>
    <li>Smovengo / Syndicat Autolib’ Vélib’ Métropole, via <a href="https://opendata.paris.fr/explore/dataset/velib-emplacement-des-stations/">Open Data Paris</a>. Stations situées dans le contour de Paris utilisé par Canopée. <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0</a>. <a href="./data/velib.json" download>Télécharger le GeoJSON</a>.</li>
    <li>Base Adresse Nationale / IGN : service de géocodage Géoplateforme.</li>
    <li>${scene.temperature.source} À Luxembourg, ${scene.temperature.byHour[16] ?? "—"} °C à 16 h. À Montsouris, ${scene.montsouris.byHour[16] ?? "—"} °C à la même heure.</li>
    <li>Météo en mode Direct : <a href="https://open-meteo.com/en/license">Open-Meteo, CC BY 4.0</a>. Température de l’air et couverture nuageuse.</li>
    <li>Fond : OpenFreeMap, données OpenStreetMap. ODbL.</li>
  </ul>
`;
document.getElementById("fermer-methode").addEventListener("click", () => el.methode.close());
document.getElementById("ouvrir-methode").addEventListener("click", () => el.methode.showModal());

renderHour(hour, false);
