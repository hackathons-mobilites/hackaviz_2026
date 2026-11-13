import "./story-hex.css";

import { shadeColor } from "./story-palette.js";
const percent = value => Math.round(value).toLocaleString("fr-FR") + " %";

export function createHexAtlas(data, motion) {
  const $ = id => document.getElementById(id);
  const svg = $("atlas");
  const panel = svg.closest("figure");
  const ns = "http://www.w3.org/2000/svg";
  const points = [...data.ring, ...data.cells.flatMap(cell => cell.ring)];
  const west = Math.min(...points.map(p => p[0]));
  const east = Math.max(...points.map(p => p[0]));
  const south = Math.min(...points.map(p => p[1]));
  const north = Math.max(...points.map(p => p[1]));
  const cosLat = Math.cos(48.86 * Math.PI / 180);
  const dx = (east - west) * cosLat, dy = north - south;
  const scale = Math.min(530 / dx, 370 / dy);
  const project = ([lon, lat]) => [
    (550 - dx * scale) / 2 + (lon - west) * cosLat * scale,
    32 + (370 - dy * scale) / 2 + (north - lat) * scale,
  ];
  const pathData = ring => ring.map((point, index) => {
    const [x, y] = project(point);
    return (index ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ") + " Z";
  function element(name, attributes, text) {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  }

  svg.replaceChildren();
  svg.append(element("title", {}, "L’ombre des rues de Paris au fil de la journée"));
  const description = element("desc", {}, "");
  svg.append(description);
  const outline = element("path", { d: pathData(data.ring), fill: "#e8ebec", stroke: "#cbd0d4", "stroke-width": 1.2 });
  svg.append(outline);
  const hexagons = data.cells.map(cell => {
    const polygon = element("path", { d: pathData(cell.ring), class: "atlas-hex", "data-hex": cell.id, stroke: "#f2f2f2", "stroke-width": 0.65, "stroke-linejoin": "round" });
    polygon.append(element("title", {}, ""));
    svg.append(polygon);
    return polygon;
  });

  let hour = 16;
  let timer = null;
  let playing = false;
  let visible = false;
  function announce() {
    const frame = data.hourly[data.hours.indexOf(hour)];
    $("atlas-announcement").textContent = "À " + hour + " heures, " + frame.lowShade + " secteurs sur " + frame.known + " ont moins de 40 % d’ombre sur leurs rues calculées.";
  }
  function render(nextHour) {
    hour = nextHour;
    const index = data.hours.indexOf(hour);
    const frame = data.hourly[index];
    hexagons.forEach((hex, i) => {
      const shade = data.cells[i].shade[index];
      hex.setAttribute("fill", shadeColor(shade));
      hex.dataset.shade = shade == null ? "" : String(shade);
      hex.querySelector("title").textContent = "Secteur " + (i + 1) + ", " + hour + " h : " + (shade == null ? "données insuffisantes" : percent(shade * 100) + " d’ombre sur les rues");
    });
    description.textContent = frame.known + " hexagones de 260 mètres de rayon. À " + hour + " heures, " + frame.lowShade + " ont moins de 40 % d’ombre sur leurs rues calculées. Même modèle que la carte Canopée, le 25 juin 2026.";
    $("atlas-hour-label").textContent = hour + " h";
    $("atlas-hour").value = String(hour);
    $("atlas-hour").setAttribute("aria-valuetext", hour + " heures");
    $("hero-percent").textContent = percent(frame.lowShadePercent);
  }
  function setPlaying(value) {
    playing = value;
    $("atlas-play").setAttribute("aria-pressed", String(value));
    $("atlas-play").setAttribute("aria-label", value ? "Mettre la journée en pause" : "Lire la journée de 7 h à 21 h");
    $("atlas-play").querySelector("span").textContent = value ? "Pause" : "Lire la journée";
    $("atlas-play").querySelector("path").setAttribute("d", value ? "M4 3h3v10H4zM10 3h3v10h-3z" : "M5 3v10l8-5z");
  }
  function stop(speak = false) {
    clearTimeout(timer);
    timer = null;
    setPlaying(false);
    if (speak) announce();
  }
  function play() {
    if (playing) return stop(true);
    if (motion.reduced() || document.hidden) return;
    render(data.hours[0]);
    setPlaying(true);
    function tick() {
      if (document.hidden || !visible || motion.reduced()) return stop();
      const next = data.hours[data.hours.indexOf(hour) + 1];
      if (next == null) return stop(true);
      render(next);
      timer = setTimeout(tick, 900);
    }
    timer = setTimeout(tick, 900);
  }
  render(hour);
  $("atlas-play").addEventListener("click", play);
  $("atlas-hour").addEventListener("input", event => {
    stop();
    render(Number(event.target.value));
  });
  $("atlas-hour").addEventListener("change", announce);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!visible) stop();
  }).observe(panel);
  motion.once(svg, () => {
    visible = true;
    motion.animate(svg, [{ opacity: 0 }, { opacity: 1 }], { duration: 750 });
    play();
  }, { amount: 0.35 });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  window.addEventListener("pagehide", () => stop());
  motion.onChange(reduced => {
    $("atlas-play").disabled = reduced;
    if (reduced) stop();
  });
}
