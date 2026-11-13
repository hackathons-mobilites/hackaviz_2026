import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-600.css";
import "@fontsource/source-sans-3/latin-700.css";
import "./story.css";
import "./story-brand.css";
import "./story-disclosures.css";
import { createStoryMotion } from "./story-motion.js";
import { createRouteProjections } from "./story-geometry.js";
import { createStationPicker } from "./story-station-picker.js";
import { createShadeHeatmap } from "./story-heatmap.js";
import { createToolPreview } from "./story-preview.js";
import { shadeColor } from "./story-palette.js";
import { createHexAtlas } from "./story-hex.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/\s*·\s*/g, ", ").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n, d = 0) =>
  Number(n).toLocaleString("fr-FR", {
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  });
const colors = {
  shade: "#0055a4",
  sun: "#f4c64e",
  ink: "#1d1d1f",
  muted: "#6e6e73",
  route: "#142b44",
};
const line = (coords) =>
  coords
    .map((p, i) => (i ? "L" : "M") + p[0].toFixed(2) + "," + p[1].toFixed(2))
    .join(" ");
const text = (x, y, label, attrs = "") =>
  '<text x="' + x + '" y="' + y + '" ' + attrs + ">" + esc(label) + "</text>";
const svgLine = (x1, y1, x2, y2, attrs = "") =>
  '<line x1="' +
  x1 +
  '" y1="' +
  y1 +
  '" x2="' +
  x2 +
  '" y2="' +
  y2 +
  '" ' +
  attrs +
  "/>";
async function init() {
  const entryHash = location.hash;
  let interacted = false;
  const entryEvents = new AbortController();
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    window.addEventListener(event, () => { interacted = true; }, { passive: true, once: true, signal: entryEvents.signal });
  }
  const [response, hexResponse] = await Promise.all([fetch("./data/story.json"), fetch("./data/story-hex.json")]);
  if (!response.ok || !hexResponse.ok) throw new Error("Données indisponibles");
  const [data, hexData] = await Promise.all([response.json(), hexResponse.json()]);
  const motion = createStoryMotion();
  createShadeHeatmap($("shade-heatmap"), data.stations, data.hours, motion);
  const at16 = data.hours.indexOf(16),
    at = data.hourly.find((d) => d.hour === 16);
  $("load-status").hidden = true;
  $("low-shade-count").textContent = at.lowShade;
  $("data-date").textContent =
    "Calculs préparés le " +
    new Date(data.generated + "T12:00:00").toLocaleDateString("fr-FR") +
    ". Les données dérivées conservent les licences de leurs sources.";
  createHexAtlas(hexData, motion);

  const climate = [
    { label: "1976–2005", note: "Référence", days: 1 },
    ...data.climate.projections.map((p) => ({
      ...p,
      label: p.year,
      note: "Horizon",
    })),
  ];
  $("climate-bars").innerHTML = climate.map((r, i) => `
    <div class="climate-row ${i ? "" : "reference"}">
      <div class="climate-row-label">${r.label}<small>${r.note}</small></div>
      <div class="bar-track" aria-hidden="true">
        ${r.low ? `<span class="climate-range" style="left:${r.low / 12 * 100}%;width:${(r.high - r.low) / 12 * 100}%"></span>` : ""}
        <span class="climate-bar" style="left:${r.days / 12 * 100}%"></span>
      </div>
      <div class="climate-value">${r.days} j/an<small>${r.low ? `${r.low} à ${r.high} jours` : "Moyenne"}</small></div>
    </div>`).join("") + '<div class="climate-axis" aria-hidden="true"><span>0</span><span>6</span><span>12</span></div>';
  motion.once($("climate-bars"), () => {
    $("climate-bars").querySelectorAll(".climate-row").forEach((row, i) => {
      motion.animate(row.querySelector(".climate-range"), [{ transform: "scaleX(0)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1 }], { duration: 1000, delay: i * 180 });
      motion.animate(row.querySelector(".climate-bar"), [{ transform: "translateX(-50%) scale(0)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 650, delay: 300 + i * 180 });
    });
  }, { amount: 0.3 });
  const waterGroups = [
    { label: "250 m ou moins", stations: data.stations.filter(s => Number.isFinite(s.waterMeters) && s.waterMeters <= 250) },
    { label: "251 à 500 m", stations: data.stations.filter(s => s.waterMeters > 250 && s.waterMeters <= 500) },
    { label: "Plus de 500 m", stations: data.stations.filter(s => s.waterMeters > 500) },
  ];
  $("water-count").textContent = waterGroups[1].stations.length + waterGroups[2].stations.length;
  $("water-chart").innerHTML = waterGroups.map(group => `<div class="water-group"><strong>${group.stations.length}</strong><span>${group.label}</span><div class="water-dots" aria-hidden="true">${group.stations.map(station => `<i title="${esc(station.name)} : ${station.waterMeters} m"></i>`).join("")}</div></div>`).join("");
  motion.once($("water-chart"), () => {
    $("water-chart").querySelectorAll(".water-dots i").forEach((dot, i) => motion.animate(dot, [{ opacity: 0, transform: "scale(.2)" }, { opacity: 1, transform: "scale(1)" }], { duration: 500, delay: i * 4 }));
  });
  createToolPreview(data, motion);

  const climateFactor = document.querySelector(".climate-lead .giant");
  motion.once(climateFactor, () => motion.count(climateFactor, 1, 4, { duration: 1300, format: value => "×" + fmt(value) }));

  // A partial one-to-one join is kept explicit; no traffic is imputed.
  const matched = data.stations.filter((p) => Number.isFinite(p.validations));
  const byName = [...matched].sort((a, b) =>
    a.name.localeCompare(b.name, "fr"),
  );
  let selected = matched.find((p) => p.name === "Châtelet") || matched[0];
  const stationPicker = createStationPicker($("station-picker"), byName, selected.id, (id) => {
    selected = matched.find((s) => s.id === id);
    stationDetail();
    motion.animate($("station-detail"), [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 500 });
  });
  $("traffic-coverage").innerHTML =
    matched.length +
    " stations sur " +
    data.stations.length +
    '. Un point par station. Validations IDFM 2025 ; ombre modélisée à 16 h.';
  $("traffic-source").href = data.traffic.url;
  const busyStations = [...matched].sort((a, b) => b.validations - a.validations).slice(0, 10);
  const busyExposed = busyStations.filter(s => s.shadeToday[at16] < 40).length;
  $("station-analysis").textContent = busyExposed + ' des 10 pôles les plus fréquentés de notre périmètre ont moins de 40 % d’ombre autour du point de station étudié. Croiser usage et exposition aide à prioriser les accès à protéger.';
  $("station-table").innerHTML = byName
    .map(
      (s) =>
        '<tr><th scope="row">' +
        esc(s.name) +
        "</th><td>" +
        fmt(s.validations) +
        "</td><td>" +
        s.shadeToday[at16] +
        " %</td><td>" +
        fmt(s.waterMeters) +
        " m</td></tr>",
    )
    .join("");
  function stationDetail() {
    const s = selected,
      shade = s.shadeToday[at16];
    $("station-detail").innerHTML =
      '<dl class="station-values"><div><dt>Validations du pôle, 2025</dt><dd>' +
      fmt(s.validations / 1e6, 1) +
      " M</dd></div><div><dt>Rues à l’ombre, 16 h</dt><dd>" +
      shade +
      " %</dd></div><div><dt>Fontaine la plus proche</dt><dd>" +
      fmt(s.waterMeters) +
      " m</dd></div><div><dt>Lieu frais le plus proche</dt><dd>" +
      fmt(s.coolMeters) +
      ' m</dd></div></dl><p class="small">Distances à vol d’oiseau.</p><a class="text-link" href="./index.html?station=' +
      encodeURIComponent(s.id) +
      '&h=16">Voir cette station</a>';
    $("scatter")
      .querySelectorAll(".scatter-point")
      .forEach((p) => {
        const active = p.dataset.station === s.id;
        p.classList.toggle("selected", active);
        p.setAttribute("r", active ? "7" : "4.2");
      });
  }
  function drawScatter() {
    const maximum =
      Math.ceil(Math.max(...matched.map((s) => s.validations)) / 10000000) *
      10000000;
    const x = (v) => 65 + v * 6.05,
      y = (v) => 350 - (v / maximum) * 300;
    let svg =
      '<title id="scatter-title">Fréquentation et exposition des abords</title><desc id="scatter-desc">' +
      matched.length +
      " stations. Exposition au soleil de 0 à 100 % ; validations de 0 à " + maximum / 1e6 + " millions. Tableau disponible après le graphique.</desc>";
    svg +=
      '<rect x="' +
      x(60) +
      '" y="40" width="' +
      (x(100) - x(60)) +
      '" height="310" fill="#f6e8bc" opacity=".65"/>';
    for (const v of [0, 20, 40, 60, 80, 100]) {
      svg +=
        svgLine(x(v), 40, x(v), 350, 'class="grid"') +
        text(x(v), 376, v + " %", 'text-anchor="middle"');
    }
    for (let v = 0; v <= maximum / 1e6; v += 10) {
      svg +=
        svgLine(65, y(v * 1e6), 670, y(v * 1e6), 'class="grid"') +
        text(53, y(v * 1e6) + 5, v, 'text-anchor="end"');
    }
    svg +=
      text(16, 18, "Validations annuelles", 'text-anchor="start" class="axis-label"') +
      text(16, 36, "en millions", 'text-anchor="start" style="font-size:12px"') +
      text(
        368,
        414,
        "Rues au soleil autour de la station",
        'text-anchor="middle" class="axis-label"',
      ) +
      text(
        x(80),
        62,
        "Abords peu ombragés",
        'text-anchor="middle" style="font-size:12px"',
      );
    svg += matched
      .map(
        (s) =>
          '<circle class="scatter-point" data-station="' +
          esc(s.id) +
          '" cx="' +
          x(100 - s.shadeToday[at16]) +
          '" cy="' +
          y(s.validations) +
          '" r="4.2" fill="' +
          (s.shadeToday[at16] < 40 ? colors.sun : colors.shade) +
          '" opacity=".75"><title>' +
          esc(s.name) +
          " : " +
          fmt(s.validations) +
          " validations, " +
          s.shadeToday[at16] +
          " % d’ombre</title></circle>",
      )
      .join("");
    const labels = [...matched]
      .sort((a, b) => b.validations - a.validations)
      .slice(0, 3);
    svg += labels
      .map((s) =>
        text(
          x(100 - s.shadeToday[at16]) - 10,
          y(s.validations) - 10,
          s.name,
          'text-anchor="end" style="font-size:12px;font-weight:600;pointer-events:none"',
        ),
      )
      .join("");
    $("scatter").innerHTML = svg;
    $("scatter").addEventListener("click", (event) => {
      const hit = event.target.closest("[data-station]");
      if (hit) {
        selected = matched.find((s) => s.id === hit.dataset.station);
        stationPicker.setValue(selected.id);
        stationDetail();
        motion.animate($("station-detail"), [{ opacity: 0.2 }, { opacity: 1 }], { duration: 400 });
      }
    });
    stationDetail();
  }
  drawScatter();
  motion.once($("scatter"), () => {
    $("scatter").querySelectorAll(".scatter-point").forEach(point => {
      point.style.transformBox = "fill-box";
      point.style.transformOrigin = "center";
      motion.animate(point, [{ opacity: 0, transform: "scale(0.15)" }, { opacity: 0.75, transform: "scale(1)" }], { duration: 800, delay: Number(point.getAttribute("cx")) * 1.2 });
    });
  }, { amount: 0.3 });
  motion.once($("low-shade-count"), () => motion.count($("low-shade-count"), 0, at.lowShade, { duration: 1400, format: fmt }));

  let profileSeason = "ete",
    profileHour = 16;
  let previousProfile = null;
  let profileDrawing = null;
  function animateProfile() {
    motion.draw(profileDrawing.curve, 1600);
    motion.animate(profileDrawing.area, [{ opacity: 0 }, { opacity: 0.12 }], { duration: 1100, delay: 350 });
    $("profile").querySelectorAll("[data-profile-point]").forEach((point, i) =>
      motion.animate(point, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: i * 90 }),
    );
  }
  function profile(animate = false) {
    const oldValue = previousProfile?.value;
    const winter = profileSeason === "hiver",
      color = winter ? colors.sun : colors.shade;
    const values = data.hourly.map((d) => ({
      hour: d.hour,
      value: winter
        ? d.winterShade == null
          ? null
          : 100 - d.winterShade
        : d.summerShade,
    }));
    const current = values.find((d) => d.hour === profileHour),
      available = values.filter((d) => d.value != null);
    const x = (h) => 80 + (h - 7) * 37,
      y = (v) => 260 - v * 2.1;
    let svg =
      "<title>" +
      esc(winter ? "Soleil en hiver" : "Ombre en été") +
      " autour des stations</title><desc>Moyenne des parts des rues autour de chaque station ; de 7 h à 21 h. Valeur sélectionnée : " +
      (current.value == null ? "nuit" : fmt(current.value, 1) + " %") +
      ".</desc>";
    for (const v of [0, 25, 50, 75, 100])
      svg +=
        svgLine(80, y(v), 598, y(v), 'class="grid"') +
        text(68, y(v) + 5, v + " %", 'text-anchor="end"');
    for (const h of [7, 10, 13, 16, 19, 21])
      svg += text(x(h), 285, h + " h", 'text-anchor="middle"');
    if (winter) {
      svg +=
        '<rect x="80" y="50" width="' +
        (x(9) - 80) +
        '" height="210" fill="#445263" opacity=".1"/><rect x="' +
        x(17) +
        '" y="50" width="' +
        (600 - x(17)) +
        '" height="210" fill="#445263" opacity=".1"/>' +
        text(x(8), 160, "Nuit", 'text-anchor="middle"') +
        text(x(19), 160, "Nuit", 'text-anchor="middle"');
    }
    const pts = available.map((v) => [x(v.hour), y(v.value)]);
    svg +=
      '<path data-profile-area d="' +
      line([[pts[0][0], 260], ...pts, [pts.at(-1)[0], 260]]) +
      'Z" fill="' +
      color +
      '" opacity=".12"/><path data-profile-line d="' +
      line(pts) +
      '" fill="none" stroke="' +
      color +
      '" stroke-width="3" stroke-linejoin="round"/>';
    svg += available
      .map(
        (v) =>
          '<circle data-profile-point cx="' +
          x(v.hour) +
          '" cy="' +
          y(v.value) +
          '" r="3" fill="' +
          color +
          '"><title>' +
          v.hour +
          " h : " +
          fmt(v.value, 1) +
          " %</title></circle>",
      )
      .join("");
    svg += svgLine(
      x(profileHour),
      40,
      x(profileHour),
      260,
      'data-profile-guide stroke="' + colors.ink + '" stroke-dasharray="3 5"',
    );
    if (current.value != null)
      svg +=
        '<circle data-profile-marker cx="' +
        x(profileHour) +
        '" cy="' +
        y(current.value) +
        '" r="6" fill="' +
        color +
        '" stroke="#ffffff" stroke-width="2"/>';
    $("profile").innerHTML = svg;
    const curve = $("profile").querySelector("[data-profile-line]");
    profileDrawing = { curve, area: $("profile").querySelector("[data-profile-area]") };
    if (previousProfile && previousProfile.season === profileSeason && previousProfile.hour !== profileHour && motion.entered($("profile"))) {
      const deltaX = x(previousProfile.hour) - x(profileHour);
      motion.animate($("profile").querySelector("[data-profile-guide]"), [{ transform: "translateX(" + deltaX + "px)" }, { transform: "translateX(0px)" }], { duration: 180 });
      if (current.value != null && previousProfile.value != null) motion.animate($("profile").querySelector("[data-profile-marker]"), [{ transform: "translate(" + deltaX + "px," + (y(previousProfile.value) - y(current.value)) + "px)" }, { transform: "translate(0px,0px)" }], { duration: 180 });
    }
    previousProfile = { season: profileSeason, hour: profileHour, value: current.value };
    motion.refresh(true);
    $("profile-title").textContent = winter
      ? "Le soleil au fil des heures"
      : "L’ombre au fil des heures";
    $("profile-hour-label").textContent = profileHour + " h";
    $("profile-hour").value = String(profileHour);
    $("profile-hour").setAttribute("aria-valuetext", profileHour + " heures");
    $("season-statement").innerHTML =
      current.value == null
        ? "<strong>La nuit</strong>"
        : "<strong>" +
          fmt(current.value) +
          " %</strong><br>des rues " +
          (winter ? "au soleil" : "à l’ombre") +
          ", en moyenne.";
    if (animate) {
      animateProfile();
      if (current.value != null) motion.count($("season-statement").querySelector("strong"), oldValue ?? 0, current.value, { duration: 850, format: value => fmt(value) + " %" });
    }
  }
  document.querySelectorAll("[data-profile]").forEach((b) =>
    b.addEventListener("click", () => {
      profileSeason = b.dataset.profile;
      document
        .querySelectorAll("[data-profile]")
        .forEach((btn) => btn.setAttribute("aria-pressed", String(btn === b)));
      profile(true);
    }),
  );
  $("profile-hour").addEventListener("input", (e) => {
    profileHour = Number(e.target.value);
    profile();
  });
  // Read the plotted hour directly; the value and the existing slider stay in sync.
  function readProfilePointer(event) {
    const svg = $("profile"), rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) * 650 / rect.width;
    const y = (event.clientY - rect.top) * 330 / rect.height;
    if (x < 80 || x > 598 || y < 40 || y > 260) return;
    const hour = Math.max(7, Math.min(21, Math.round(7 + (x - 80) / 518 * 14)));
    if (hour === profileHour) return;
    profileHour = hour;
    profile();
  }
  $("profile").addEventListener("pointerdown", event => {
    $("profile").setPointerCapture(event.pointerId);
    readProfilePointer(event);
  });
  $("profile").addEventListener("pointermove", event => {
    if (event.pointerType === "mouse" || $("profile").hasPointerCapture(event.pointerId)) readProfilePointer(event);
  });
  profile();
  motion.once($("profile"), animateProfile, { amount: 0.3 });

  const routeValue = name => document.querySelector('input[name="' + name + '"]:checked').value;
  let routeDrawing = null;
  let cancelRoute = () => {};
  let routeHasPlayed = false;
  function animateRoute() {
    cancelRoute();
    routeHasPlayed = true;
    const { path, halo, marker, avoided } = routeDrawing;
    const stopTrace = motion.trace(path, halo, marker, 1900);
    const bars = [...$("route-bars").querySelectorAll(".route-bar")].map((bar, i) => {
      bar.style.transformOrigin = "left center";
      return motion.animate(bar, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 950, delay: 200 + i * 200 });
    });
    const count = avoided > 0.05 ? motion.count($("route-benefit").querySelector(".route-benefit-number"), 0, avoided, { duration: 1200, format: value => "−" + fmt(value, 1) + " min" }) : null;
    cancelRoute = () => {
      stopTrace();
      bars.forEach(animation => animation?.cancel());
      count?.cancel();
    };
  }
  function route(animate = false) {
    cancelRoute();
    const example = data.examples.find((e) => e.id === routeValue("route-choice")),
      season = routeValue("route-season"),
      hour = Number(routeValue("route-hour"));
    const routeMaps = createRouteProjections(data.examples, { season });
    const comparison = example.comparisons.find(
      (c) => c.season === season && c.hour === hour,
    );
    const a = comparison.shortest,
      b = comparison.preferred,
      winter = season === "hiver";
    $("route-title").textContent = winter ? "Plus de soleil, quel détour ?" : "Moins de soleil, quel détour ?";
    const avoided = winter
        ? a.shadeMinutes - b.shadeMinutes
        : a.sunMinutes - b.sunMinutes,
      detour = b.minutes - a.minutes;
    const p = routeMaps.forExample(example.id).project;
    let svg =
      "<title>" +
      esc(example.from + " vers " + example.to) +
      "</title><desc>Comparaison du chemin le plus court, en tirets, et de Canopée, en bleu nuit. " +
      fmt(a.minutes, 1) +
      " contre " +
      fmt(b.minutes, 1) +
      " minutes.</desc>";
    svg += '<g data-route-buildings fill="#f6f0e4" stroke="#c9bba4" stroke-width=".65" fill-rule="evenodd">' + example.buildings.map(polygon => '<path d="' + polygon.map(ring => line(ring.map(p)) + 'Z').join(' ') + '"/>').join('') + '</g>';
    svg += '<g data-route-roads>' + comparison.streets.map(street => '<path d="' + line(street.path.map(p)) + '" fill="none" stroke="' + shadeColor(street.shade) + '" stroke-width="3" stroke-linecap="round"/>').join('') + '</g>';
    svg +=
      '<path d="' +
      line(a.path.map(p)) +
      '" fill="none" stroke="#7d848b" stroke-width="4" stroke-dasharray="5 6" stroke-linecap="round"/><path data-route-halo d="' +
      line(b.path.map(p)) +
      '" fill="none" stroke="#fffaf2" stroke-width="10"/><path data-route-path d="' +
      line(b.path.map(p)) +
      '" fill="none" stroke="' +
      colors.route +
      '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle data-route-marker r="6" fill="' +
      colors.route +
      '" stroke="#ffffff" stroke-width="3" opacity="0" aria-hidden="true"/>';
    // Offset only the map label, never the route geometry.
    for (const [point, label] of [
      [a.path[0], "A"],
      [a.path.at(-1), "M"],
    ]) {
      const [x, y] = p(point);
      svg +=
        '<circle cx="' +
        x +
        '" cy="' +
        y +
        '" r="12" fill="' +
        colors.ink +
        '" stroke="#ffffff" stroke-width="3"/>' +
        text(
          x,
          y + 5,
          label,
          'text-anchor="middle" style="fill:#ffffff;font-size:13px;font-weight:700"',
        );
    }
    const scaleX = 24, scaleY = 386, scaleWidth = routeMaps.scaleBar.pixels;
    svg += '<g data-route-scale aria-hidden="true"><rect x="14" y="366" width="' + (scaleWidth + 20) + '" height="44" rx="5" fill="#ffffff" opacity=".9"/>' +
      svgLine(scaleX, scaleY, scaleX + scaleWidth, scaleY, 'stroke="#1d1d1f" stroke-width="2"') +
      svgLine(scaleX, scaleY - 5, scaleX, scaleY + 1, 'stroke="#1d1d1f" stroke-width="2"') +
      svgLine(scaleX + scaleWidth, scaleY - 5, scaleX + scaleWidth, scaleY + 1, 'stroke="#1d1d1f" stroke-width="2"') +
      text(scaleX + scaleWidth / 2, scaleY + 18, routeMaps.scaleBar.meters + " m", 'text-anchor="middle" style="font-size:12px"') + '</g>';
    $("route-map").innerHTML = svg;
    $("route-map").dataset.pixelsPerMeter = String(routeMaps.pixelsPerMeter);
    const routePath = $("route-map").querySelector("[data-route-path]");
    routeDrawing = {
      path: routePath,
      halo: $("route-map").querySelector("[data-route-halo]"),
      marker: $("route-map").querySelector("[data-route-marker]"),
      avoided,
    };
    $("route-benefit").innerHTML =
      avoided > 0.05
        ? '<div class="route-benefit-number">−' +
          fmt(avoided, 1) +
          " min</div><p>" +
          (winter ? "à l’ombre" : "au soleil") +
          "</p>"
        : '<div class="route-benefit-number no-gain">Pas de gain ' +
          (winter ? "de soleil" : "d’ombre") +
          "</div>";
    const max = Math.max(a.minutes, b.minutes);
    $("route-bars").innerHTML = [
      ["Le plus court", a],
      ["Canopée", b],
    ]
      .map(
        ([name, r]) =>
          '<div class="route-bars-row"><div class="route-bar-label"><strong>' +
          name +
          "</strong><span>" +
          fmt(r.minutes, 1) +
          " min, " +
          fmt(r.meters) +
          ' m</span></div><div class="route-bar" style="width:' +
          (r.minutes / max) * 100 +
          '%" aria-hidden="true"><span class="shade-fill" style="width:' +
          r.shadePercent +
          '%"></span><span class="sun-fill" style="width:' +
          (100 - r.shadePercent) +
          '%"></span></div><small>' +
          fmt(r.shadeMinutes, 1) +
          " min à l’ombre, " +
          fmt(r.sunMinutes, 1) +
          " min au soleil</small></div>",
      )
      .join("");
    $("route-tradeoff").textContent =
      detour > 0.05
        ? "+" +
          fmt(detour, 1) +
          " min de marche"
        : "Durée inchangée";
    $("route-table").innerHTML = [
      ["Le plus court", a],
      ["Canopée", b],
    ]
      .map(
        ([name, r]) =>
          '<tr><th scope="row">' +
          name +
          "</th><td>" +
          fmt(r.meters) +
          " m</td><td>" +
          fmt(r.minutes, 1) +
          " min</td><td>" +
          fmt(r.sunMinutes, 1) +
          " min</td><td>" +
          fmt(r.shadeMinutes, 1) +
          " min</td></tr>",
      )
      .join("");
    const params = new URLSearchParams({
      a: example.a.join(","),
      b: example.b.join(","),
      season,
      h: String(hour),
      accept: winter ? "100" : "0",
    });
    $("try-route").href = "./index.html?" + params;
    if (animate) animateRoute();
    motion.refresh(true);
  }
  ["route-choice", "route-season", "route-hour"].forEach((id) =>
    $(id).addEventListener("change", () => route(true)),
  );
  route();
  motion.once($("route-map"), () => {
    if (!routeHasPlayed) animateRoute();
  }, { amount: 0.35 });

  $("future-before").textContent = at.lowShade;
  $("future-after").textContent = at.futureLowShade;
  $("future-insight").innerHTML =
    "Ombre moyenne : <strong>" +
    fmt(at.summerShade, 1) +
    " à " +
    fmt(at.futureShade, 1) +
    " %</strong>";
  const top = [...data.stations]
    .filter((s) => s.shadeToday[at16] != null && s.shadeFuture[at16] != null)
    .sort(
      (a, b) =>
        b.shadeFuture[at16] -
          b.shadeToday[at16] -
          (a.shadeFuture[at16] - a.shadeToday[at16]) ||
        a.name.localeCompare(b.name, "fr"),
    )
    .slice(0, 6);
  $("future-chart").innerHTML =
    top
      .map((s) => {
        const a = s.shadeToday[at16],
          b = s.shadeFuture[at16];
        return (
          '<div class="future-row"><span>' +
          esc(s.name) +
          '</span><div class="future-line" aria-hidden="true"><span class="future-segment" style="left:' +
          a +
          "%;width:" +
          (b - a) +
          '%"></span><span class="future-dot before" style="left:' +
          a +
          '%"></span><span class="future-dot" style="left:' +
          b +
          '%"></span></div><b>' +
          a +
          " à " +
          b +
          " %</b></div>"
        );
      })
      .join("") +
    '<div class="future-axis" aria-hidden="true"><span>0 %</span><span>50 %</span><span>100 %</span></div>';
  motion.once($("future-chart"), () => {
    $("future-chart").querySelectorAll(".future-row").forEach((row, i) => {
      const segment = row.querySelector(".future-segment");
      const before = row.querySelector(".future-dot.before");
      const after = row.querySelector(".future-dot:not(.before)");
      const distance = (parseFloat(before.style.left) - parseFloat(after.style.left)) / 100 * row.querySelector(".future-line").clientWidth;
      segment.style.transformOrigin = "left center";
      motion.animate(segment, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 1000, delay: i * 140 });
      motion.animate(after, [{ transform: "translateX(calc(-50% + " + distance + "px))" }, { transform: "translateX(-50%)" }], { duration: 1000, delay: i * 140 });
      motion.animate(row.querySelector("b"), [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: 500 + i * 140 });
    });
  }, { amount: 0.3 });
  motion.once($("future-after"), () => motion.count($("future-after"), at.lowShade, at.futureLowShade, { duration: 1600, format: fmt }));
  const chapters = [...document.querySelectorAll("section.chapter")];
  let chapterObserver;
  function observeChapters() {
    chapterObserver?.disconnect();
    // Pixel margins avoid a collapsed observation band on wide, short screens.
    chapterObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        document.querySelectorAll(".chapter-nav a").forEach(a => {
          const active = a.hash === "#" + entry.target.id;
          a.classList.toggle("active", active);
          if (active) a.setAttribute("aria-current", "location");
          else a.removeAttribute("aria-current");
        });
      }
    }, { rootMargin: `-${innerHeight * 0.15}px 0px -${innerHeight * 0.55}px 0px`, threshold: 0 });
    chapters.forEach(section => chapterObserver.observe(section));
  }
  observeChapters();
  window.addEventListener("resize", observeChapters, { passive: true });
  chapters.forEach(section => {
    const intro = section.querySelector(".section-intro");
    if (!intro) return;
    motion.once(intro, () => {
      motion.animate(intro.querySelector("h2"), [{ opacity: 0, transform: "translateY(28px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 850 });
      motion.animate(intro.querySelector("p"), [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 800, delay: 180 });
    });
  });
  motion.once($("hero-title"), () => motion.animate($("hero-title"), [{ opacity: 0, transform: "translateY(28px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 1000 }));
  await document.fonts.ready;
  // Restore only an explicit entry anchor after the charts have their final height.
  // Never move the page after a visitor has begun interacting with it.
  if (entryHash && location.hash === entryHash && !interacted) {
    const target = document.getElementById(decodeURIComponent(entryHash.slice(1)));
    target?.scrollIntoView({ behavior: "instant", block: "start" });
  }
  entryEvents.abort();
}
init().catch((error) => {
  console.error(error);
  const el = $("load-status");
  el.hidden = false;
  el.innerHTML =
    'Les graphiques n’ont pas pu être chargés. <a href="./dataviz">Réessayer</a> ou <a href="./index.html">ouvrir la carte</a>.';
  el.setAttribute("role", "alert");
});
