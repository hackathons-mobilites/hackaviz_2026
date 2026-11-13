import "./story-heatmap.css";
import { shadeColor } from "./story-palette.js";

// Deliberate geographic examples, not a random or representative sample.
const STATION_NAMES = [
  "Châtelet", "République", "Bastille", "Gare de Lyon", "Luxembourg", "Nation",
  "Porte Maillot", "Stalingrad", "Belleville", "Trocadéro", "Cité universitaire", "Colette Besson",
];

/** An independent view of the actual summer shade estimates, with one tab stop
 * and arrow-key navigation through the matrix. It never changes other charts. */
export function createShadeHeatmap(container, stations, hours, motion) {
  const selectedStations = STATION_NAMES
    .map(name => stations.find(station => station.name === name))
    .filter(Boolean);
  const columns = hours.map((hour, index) => ({ hour, index }))
    .filter(({ hour }) => hour >= 7 && hour <= 21);
  const events = new AbortController();
  const listen = (element, name, callback) =>
    element.addEventListener(name, callback, { signal: events.signal });
  const prefix = container.id || "shade-heatmap";
  let activeRow = 0;
  let activeColumn = Math.max(0, columns.findIndex(({ hour }) => hour === 16));
  let markedCell = null;
  let tabStop = null;
  let markedRow = null;
  let markedHeader = null;
  let keyboardNavigation = false;
  const matrix = [];

  container.innerHTML = `
    <p class="sr-only shade-heatmap-summary"></p>
    <div class="shade-heatmap-scroll">
      <div class="shade-heatmap-grid" role="grid" aria-label="Ombre autour des stations au fil de la journée"></div>
    </div>
    <div class="shade-heatmap-legend" aria-label="Échelle de couleur de 0 à 100 pour cent d’ombre">
      <span>Part d’ombre</span>
      <div class="shade-heatmap-legend-key" aria-hidden="true">
        <span>0 %</span><span class="shade-heatmap-legend-ramp"></span><span>100 %</span>
      </div>
    </div>`;
  const grid = container.querySelector(".shade-heatmap-grid");
  const summary = container.querySelector(".shade-heatmap-summary");
  summary.id = prefix + "-summary";
  summary.textContent = selectedStations.length + " stations choisies pour illustrer des quartiers différents, " +
    columns.length + " heures de 7 à 21 heures. Les couleurs foncées indiquent plus d’ombre. " +
    "Chaque valeur est la part d’ombre modélisée des rues dans un rayon de 250 mètres, le 25 juin. " +
    "Une seule case est accessible par Tabulation. Utilisez ensuite les flèches pour parcourir les stations et les heures.";
  grid.setAttribute("aria-describedby", summary.id);
  grid.setAttribute("aria-rowcount", String(selectedStations.length + 1));
  grid.setAttribute("aria-colcount", String(columns.length + 1));
  grid.style.setProperty("--heatmap-columns", columns.length);
  const header = document.createElement("div");
  header.className = "shade-heatmap-row shade-heatmap-header";
  header.setAttribute("role", "row");
  header.setAttribute("aria-rowindex", "1");
  const corner = document.createElement("span");
  corner.className = "shade-heatmap-station";
  corner.setAttribute("role", "columnheader");
  corner.textContent = "Station";
  header.append(corner);
  const columnHeaders = columns.map(({ hour }, index) => {
    const label = document.createElement("span");
    label.className = "shade-heatmap-hour";
    label.setAttribute("role", "columnheader");
    label.setAttribute("aria-colindex", String(index + 2));
    label.textContent = hour + " h";
    header.append(label);
    return label;
  });
  grid.append(header);

  let detail = document.getElementById("heatmap-detail");
  if (!detail) {
    detail = document.createElement("p");
    detail.className = "shade-heatmap-detail";
    detail.setAttribute("aria-live", "polite");
    container.append(detail);
  }

  function show(rowIndex, columnIndex, { moveFocus = false, updateTabStop = true } = {}) {
    const cell = matrix[rowIndex]?.[columnIndex];
    if (!cell) return;
    if (markedCell) {
      markedCell.classList.remove("is-active");
    }
    markedRow?.classList.remove("is-active");
    markedHeader?.classList.remove("is-active");
    if (updateTabStop) {
      if (tabStop) tabStop.tabIndex = -1;
      tabStop = cell;
      cell.tabIndex = 0;
      activeRow = rowIndex;
      activeColumn = columnIndex;
    }
    markedCell = cell;
    markedRow = cell.parentElement;
    markedHeader = columnHeaders[columnIndex];
    cell.classList.add("is-active");
    markedRow.classList.add("is-active");
    markedHeader.classList.add("is-active");
    const station = selectedStations[rowIndex];
    const { hour, index } = columns[columnIndex];
    const value = station.shadeToday[index];
    const name = document.createElement("strong");
    name.textContent = station.name;
    detail.replaceChildren(name, document.createTextNode(" à " + hour + " h : " +
      (Number.isFinite(value) ? value + " % des rues à l’ombre." : "ombre non calculée.")));
    if (moveFocus) {
      cell.focus({ preventScroll: true });
      cell.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
    }
  }

  for (const [rowIndex, station] of selectedStations.entries()) {
    const row = document.createElement("div");
    row.className = "shade-heatmap-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(rowIndex + 2));
    const name = document.createElement("span");
    name.className = "shade-heatmap-station";
    name.setAttribute("role", "rowheader");
    name.textContent = station.name;
    row.append(name);
    const cells = columns.map(({ hour, index }, columnIndex) => {
      const value = station.shadeToday[index];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "shade-heatmap-cell";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", String(columnIndex + 2));
      cell.tabIndex = -1;
      cell.setAttribute("aria-label", station.name + ", " + hour + " heures, " +
        (Number.isFinite(value) ? value + " pour cent d’ombre" : "ombre non calculée"));
      if (Number.isFinite(value)) cell.style.backgroundColor = shadeColor(value / 100);
      else cell.classList.add("is-missing");
      cell.dataset.shade = Number.isFinite(value) ? value : "";
      cell.dataset.hour = hour;
      cell.dataset.station = station.id;
      listen(cell, "pointerenter", () => {
        // Scrolling the focused cell into view can move a different cell under
        // a stationary pointer. Keep the keyboard's reading until it moves.
        if (!keyboardNavigation) show(rowIndex, columnIndex, { updateTabStop: false });
      });
      listen(cell, "pointermove", event => {
        if (!event.movementX && !event.movementY) return;
        keyboardNavigation = false;
        if (markedCell !== cell) show(rowIndex, columnIndex, { updateTabStop: false });
      });
      listen(cell, "focus", () => {
        if (markedCell !== cell || tabStop !== cell) show(rowIndex, columnIndex);
      });
      listen(cell, "click", () => {
        keyboardNavigation = false;
        show(rowIndex, columnIndex);
      });
      row.append(cell);
      return cell;
    });
    matrix.push(cells);
    grid.append(row);
  }

  listen(grid, "keydown", event => {
    let row = activeRow, column = activeColumn;
    if (event.key === "ArrowLeft") column = Math.max(0, column - 1);
    else if (event.key === "ArrowRight") column = Math.min(columns.length - 1, column + 1);
    else if (event.key === "ArrowUp") row = Math.max(0, row - 1);
    else if (event.key === "ArrowDown") row = Math.min(selectedStations.length - 1, row + 1);
    else if (event.key === "Home") {
      column = 0;
      if (event.ctrlKey || event.metaKey) row = 0;
    } else if (event.key === "End") {
      column = columns.length - 1;
      if (event.ctrlKey || event.metaKey) row = selectedStations.length - 1;
    } else return;
    event.preventDefault();
    keyboardNavigation = true;
    show(row, column, { moveFocus: true });
  });
  show(activeRow, activeColumn);

  const stopObserving = motion.once(container, () => {
    matrix.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
      motion.animate(cell,
        [{ opacity: 0, transform: "scale(0.35)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 650, delay: columnIndex * 55 + rowIndex * 9 });
    }));
  }, { amount: 0.25 });

  return {
    destroy() {
      events.abort();
      stopObserving?.();
    },
  };
}
