const normalize = (value) => String(value)
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("fr")
  .replace(/[’'\-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/** Searchable station choice. onSelect receives a string id after an explicit
 * choice; setValue synchronises a scatterplot selection without firing it. */
export function createStationPicker(container, stations, selectedId, onSelect) {
  const items = stations.map(station => ({
    id: String(station.id),
    name: station.name,
    search: normalize(station.name + ' ' + (station.trafficName || '')),
  }));
  const byId = new Map(items.map(station => [station.id, station]));
  const shortcutNames = ["Châtelet", "République", "Gare de Lyon"];
  const shortcuts = shortcutNames
    .map(name => items.find(station => normalize(station.name) === normalize(name)))
    .filter(Boolean);
  const initialSuggestions = [...shortcuts, ...items.filter(station => !shortcuts.includes(station))];
  let selected = byId.get(String(selectedId));
  let visible = [];
  let activeIndex = -1;
  let isOpen = false;
  const events = new AbortController();
  const listen = (element, event, callback) =>
    element.addEventListener(event, callback, { signal: events.signal });
  const prefix = container.id || "station-picker";

  container.innerHTML = `
    <div class="station-picker-sign">
      <input class="station-picker-input" type="search" role="combobox"
        aria-autocomplete="list" aria-expanded="false" autocomplete="off"
        spellcheck="false" placeholder="Rechercher une station" aria-label="Rechercher une station" />
      <button class="station-picker-toggle" type="button" aria-label="Afficher les stations" aria-expanded="false"><span class="station-picker-chevron" aria-hidden="true"></span></button>
    </div>
    <div class="station-picker-panel" hidden>
      <ul class="station-picker-results" role="listbox" aria-label="Stations proposées" hidden></ul>
    </div>
    <span class="sr-only station-picker-help">Saisissez un nom. Utilisez les flèches pour parcourir les propositions, puis Entrée pour choisir.</span>
    <span class="sr-only station-picker-status" role="status" aria-live="polite"></span>`;
  const input = container.querySelector(".station-picker-input");
  const sign = container.querySelector(".station-picker-sign");
  const trigger = container.querySelector(".station-picker-toggle");
  const panel = container.querySelector(".station-picker-panel");
  const list = container.querySelector(".station-picker-results");
  const help = container.querySelector(".station-picker-help");
  const status = container.querySelector(".station-picker-status");
  input.id = prefix + "-input";
  panel.id = prefix + "-panel";
  trigger.setAttribute("aria-controls", panel.id);
  list.id = prefix + "-results";
  help.id = prefix + "-help";
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-describedby", help.id);

  function close() {
    isOpen = false;
    activeIndex = -1;
    list.hidden = true;
    panel.hidden = true;
    sign.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    input.value = selected?.name || "";
    status.textContent = "";
  }

  function setActive(index) {
    activeIndex = index;
    for (const [i, option] of [...list.querySelectorAll("[role=option]")].entries()) {
      option.classList.toggle("is-active", i === activeIndex);
      option.setAttribute("aria-selected", String(i === activeIndex));
    }
    const active = list.querySelector(".is-active");
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      // Keep keyboard navigation inside the list. scrollIntoView also moves
      // ancestor scrollers, including the page, even when focus stays here.
      const top = active.offsetTop;
      const bottom = top + active.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
    } else input.removeAttribute("aria-activedescendant");
  }

  function open(query = "") {
    const search = normalize(query);
    const words = search.split(" ").filter(Boolean);
    const matches = search
      ? items.filter(station => words.every(word => station.search.includes(word)))
        .sort((a, b) => Number(b.search.startsWith(search)) - Number(a.search.startsWith(search)) ||
          a.name.localeCompare(b.name, "fr"))
      : initialSuggestions;
    visible = matches.slice(0, 6);
    list.replaceChildren();
    for (const [index, station] of visible.entries()) {
      const option = document.createElement("li");
      option.className = "station-picker-option";
      option.id = prefix + "-option-" + index;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.dataset.stationId = station.id;
      option.textContent = station.name;
      list.append(option);
    }
    if (!visible.length) {
      const empty = document.createElement("li");
      empty.className = "station-picker-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "Aucune station trouvée";
      list.append(empty);
    }
    isOpen = true;
    sign.classList.add("is-open");
    panel.hidden = false;
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-expanded", "true");
    setActive(-1);
    status.textContent = matches.length
      ? visible.length + " proposition" + (visible.length > 1 ? "s" : "") +
        (matches.length > visible.length ? " sur " + matches.length + ". Précisez votre recherche." : ".")
      : "Aucune station trouvée.";
  }

  function setValue(id) {
    const station = byId.get(String(id));
    if (!station) return false;
    selected = station;
    input.title = station.name;
    close();
    return true;
  }

  function choose(id) {
    if (setValue(id)) {
      trigger.focus({ preventScroll: true });
      onSelect(String(id));
    }
  }

  listen(trigger, "pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    trigger.focus({ preventScroll: true });
  });
  listen(trigger, "click", () => {
    if (isOpen) close();
    else {
      input.value = "";
      input.focus({ preventScroll: true });
      open();
    }
  });
  listen(input, "pointerdown", event => {
    if (event.button !== 0 || isOpen) return;
    event.preventDefault();
    input.value = "";
    input.focus({ preventScroll: true });
    open();
  });
  listen(input, "focus", () => {
    if (!isOpen) { input.value = ""; open(); }
  });
  listen(input, "input", () => open(input.value));
  listen(container, "focusout", event => {
    if (!container.contains(event.relatedTarget)) close();
  });
  listen(document, "pointerdown", event => {
    if (!container.contains(event.target)) close();
  });
  // Keep focus on the combobox while choosing an option with mouse or touch.
  listen(list, "pointerdown", event => event.preventDefault());
  listen(list, "click", event => {
    const option = event.target.closest("[data-station-id]");
    if (option && list.contains(option)) choose(option.dataset.stationId);
  });
  listen(input, "keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) open(input.value);
      if (visible.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = activeIndex < 0
          ? (step === 1 ? 0 : visible.length - 1)
          : (activeIndex + step + visible.length) % visible.length;
        setActive(next);
      }
    } else if (event.key === "Enter" && isOpen) {
      const choice = activeIndex >= 0
        ? visible[activeIndex]
        : visible.find(station => normalize(station.name) === normalize(input.value)) || (visible.length === 1 ? visible[0] : null);
      if (choice) {
        event.preventDefault();
        choose(choice.id);
      }
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      close();
      trigger.focus({ preventScroll: true });
    }
  });
  setValue(selectedId);

  return {
    setValue,
    destroy() { events.abort(); },
  };
}
