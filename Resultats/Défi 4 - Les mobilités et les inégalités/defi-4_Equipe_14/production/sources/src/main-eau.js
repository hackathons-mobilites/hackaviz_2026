// Score eau des lignes de métro, RER et tram (index-eau.html) : carte complète affichée d'emblée, chaque ligne colorée
// selon son score sur une échelle divergente rouge (peu d'eau) → lavande (intermédiaire) → bleu (bien équipée), stations
// colorées selon l'eau (fontaine dans la station, point d'eau à moins de 100 m, rien) ; classement des lignes dans le
// cartouche de droite (meilleure en haut). Survol d'une ligne (carte ou classement) : mise en avant + détail.
// Page légère : MapLibre seul, données de l'étape 21 (pipeline/21-eau-lignes.json).
import { Map, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Credits } from "./creditsCarte.js";

const DONNEES = "./idf-mobilites/pipeline/21-eau-lignes.json";
const STYLE = "https://openmaptiles.data.gouv.fr/styles/positron/style.json";
// niveaux d'eau d'une station (étape 21), même couleur pour le point de la station et pour sa portion de ligne (du milieu
// du trajet depuis la station précédente au milieu du trajet vers la suivante) : échelle divergente bleu (fontaine) →
// lavande → rouge (rien à moins de 300 m)
const COULEURS_EAU = { fontaine: "#08306b", toilettes: "#2f6fb0", p100: "#6a9ccc", p200: "#c4b4cc", p300: "#e07b6a", aucun: "#b2182b" };
const ZOOM_AVANT = 0.4; // points de toutes les stations visibles dès ce zoom avant au-delà du cadrage initial
const LIBELLES_EAU = {
  fontaine: "fontaine dans la station",
  toilettes: "toilettes dans la gare (eau probable)",
  p100: "point d'eau à moins de 100 m",
  p200: "point d'eau entre 100 et 200 m",
  p300: "point d'eau entre 200 et 300 m",
  aucun: "pas d'eau à moins de 300 m",
};
const NIVEAUX = ["fontaine", "toilettes", "p100", "p200", "p300", "aucun"];
// libellés accordés au nombre de stations (bloc de détail, classement) : [singulier, pluriel]
const COMPTES_EAU = {
  fontaine: ["fontaine sur la ligne", "fontaines sur la ligne"],
  toilettes: ["toilette sur la ligne (eau probable)", "toilettes sur la ligne (eau probable)"],
  p100: ["point d'eau à moins de 100 m", "points d'eau à moins de 100 m"],
  p200: ["point d'eau entre 100 et 200 m", "points d'eau entre 100 et 200 m"],
  p300: ["point d'eau entre 200 et 300 m", "points d'eau entre 200 et 300 m"],
  aucun: ["station sans eau à moins de 300 m", "stations sans eau à moins de 300 m"],
};
const compte = (n, k) => `${k} ${COMPTES_EAU[n][k > 1 ? 1 : 0]}`;
const MODES = { métro: "Métro", RER: "RER", tram: "Tramway" };

const $ = (s) => document.querySelector(s);
const map = new Map({ container: "mapContainer", style: STYLE, center: [2.35, 48.86], zoom: 10, attributionControl: false });
map.addControl(new Credits(), "bottom-right");

// clarté d'une couleur "#rrggbb" ou "rgb(r,g,b)" (texte noir ou blanc par-dessus)
const clarte = (c) => {
  const [r, g, b] = c.startsWith("#") ? [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)) : c.match(/\d+/g).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
// pastille d'une ligne dans le cartouche : couleur officielle de la ligne, forme selon le mode (comme la signalétique) :
// métro = numéro seul dans un cercle, RER = lettre dans un carré aux bords arrondis, tram = « T… » entre deux barres (plan RATP)
const badge = (l) => {
  const fond = l.couleur;
  const texte = l.mode === "métro" ? l.ligne.replace(/^M/, "") : l.mode === "RER" ? l.ligne.replace(/^RER\s*/, "") : l.ligne;
  const forme = { métro: "metro", RER: "rer", tram: "tram" }[l.mode];
  // tram (plan RATP) : numéro noir sur fond blanc entre deux barres de la couleur de la ligne
  if (l.mode === "tram") return `<span class="badge tram" style="border-color:${fond}">${texte}</span>`;
  return `<span class="badge ${forme}${texte.length > 2 ? " long" : ""}" style="background:${fond};color:${clarte(fond) > 150 ? "#000" : "#fff"}">${texte}</span>`;
};
// barre du score : part fontaine (1 point) et part proximité (½ point), en % du score maximal (100)
// barre du score : une part par niveau d'eau (largeur = stations × points du niveau), sur 100
let POINTS = {};
const barre = (l) =>
  `<div class="barre">${NIVEAUX.filter((n) => POINTS[n])
    .map((n) => `<span style="background:${COULEURS_EAU[n]};width:${(l[n] / l.stations) * POINTS[n] * 100}%"></span>`)
    .join("")}</div>`;

map.on("load", async () => {
  // fond de carte sans aucun nom : couches de texte et d'icônes du style masquées
  for (const couche of map.getStyle().layers) if (couche.type === "symbol") map.setLayoutProperty(couche.id, "visibility", "none");
  const { lignes, niveaux, pointsEau } = await (await fetch(DONNEES)).json();
  POINTS = niveaux;
  // classement : meilleure en haut (à score égal, la ligne qui a le plus de stations d'abord)
  const classement = [...lignes].sort((a, b) => b.score - a.score || b.stations - a.stations);
  const parLigne = new globalThis.Map(classement.map((l) => [l.ligne, l]));

  // cadrage initial : Paris intra-muros (comme EMPRISE_PARIS de la carte principale), pour bien voir le métro ; tram,
  // RER et terminus de banlieue au-delà, accessibles en dézoomant
  const emprise = [
    [2.224, 48.815],
    [2.47, 48.902],
  ];
  // marges du cadrage selon l'écran (mobile : cartouche et crédits en bas)
  const marges = () => {
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const ferme = document.body.classList.contains("entete-ferme");
    // mobile : hauteur du cartouche affiché en bas (titre ou ligne) + crédits
    return { top: 30, bottom: mobile ? (ferme ? 70 : $("#panneau").offsetHeight + 56) : 30, left: mobile ? 20 : 30, right: mobile ? 20 : 30 };
  };
  const cadrer = (duree) => map.fitBounds(emprise, { padding: marges(), bearing: 0, pitch: 0, duration: duree });
  cadrer(0);
  const zoomInitial = map.getZoom();
  const zoomStations = zoomInitial + ZOOM_AVANT; // seuil d'affichage de toutes les stations

  // --- sources et couches (lignes les mieux notées dessinées par-dessus)
  // portions de ligne colorées par le niveau d'eau de la station la plus proche (étape 21, segments)
  const traces = [...classement].reverse().flatMap((l) => l.segments.map((g) => ({ type: "Feature", geometry: { type: "LineString", coordinates: g.coords }, properties: { ligne: l.ligne, eau: g.eau } })));
  const arrets = classement.flatMap((l) => l.arrets.map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { ligne: l.ligne, eau: a.eau, nom: a.nom, distance: a.distance ?? null } })));
  map.addSource("traces", { type: "geojson", data: { type: "FeatureCollection", features: traces } });
  map.addSource("arrets", { type: "geojson", data: { type: "FeatureCollection", features: arrets } });
  // points d'eau potable OpenStreetMap : petits points sous les lignes et les stations
  map.addSource("points-eau", {
    type: "geojson",
    data: { type: "FeatureCollection", features: pointsEau.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} })) },
  });
  map.addLayer({
    id: "points-eau",
    type: "circle",
    source: "points-eau",
    paint: {
      // bien visibles à tous les zooms : contour blanc pour les détacher des lignes et du fond
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1, 12, 1.9, 15, 5], // discrets au cadrage initial, nets en zoomant
      "circle-color": "#1597c9",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.2, 12, 0.5, 15, 1],
    },
  });
  const epaisseur = (k) => ["interpolate", ["linear"], ["zoom"], 8, 1.4 * k, 13, 3.8 * k];
  map.addLayer({
    id: "lignes",
    type: "line",
    source: "traces",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["match", ["get", "eau"], ...NIVEAUX.slice(0, -1).flatMap((n) => [n, COULEURS_EAU[n]]), COULEURS_EAU.aucun], "line-width": epaisseur(1) },
  });
  map.addLayer({
    id: "arrets",
    type: "circle",
    source: "arrets",
    minzoom: zoomStations, // cadrage initial : portions de ligne seules ; toutes les stations dès le premier zoom avant
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 3.5, 15, 7],
      "circle-color": ["match", ["get", "eau"], ...NIVEAUX.slice(0, -1).flatMap((n) => [n, COULEURS_EAU[n]]), COULEURS_EAU.aucun],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.2, 15, 2],
    },
  });
  map.addLayer({
    id: "arrets-ligne", // stations de la ligne sélectionnée (clic carte ou classement), visibles à tout zoom
    type: "circle",
    source: "arrets",
    filter: ["==", ["get", "ligne"], ""],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 3.5, 15, 7],
      "circle-color": ["match", ["get", "eau"], ...NIVEAUX.slice(0, -1).flatMap((n) => [n, COULEURS_EAU[n]]), COULEURS_EAU.aucun],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.2, 15, 2],
    },
  });

  // --- cartouches
  function carteLigne(l) {
    if (!l) {
      $("#courante-contenu").innerHTML = `<div class="mode">Survolez une ligne sur la carte ou dans le classement pour voir le détail de son score.</div>`;
      return;
    }
    $("#courante-contenu").innerHTML =
      `<div class="tete">${badge(l)}<span class="mode-titre">${MODES[l.mode]} <span class="nb-stations">· ${l.stations} stations</span></span><span class="score">${l.score}<small> / 100</small></span></div>` +
      barre(l) +
      `<div class="detail">` +
      NIVEAUX.map((n) => `<span><i class="rond" style="background:${COULEURS_EAU[n]}"></i>${compte(n, l[n])}</span>`).join("") +
      `</div>`;
  }
  // mobile : ligne affichée dans le cartouche du bas (un toucher sur le cartouche la montre en entier)
  let affichee = null;
  const enteteMobile = (l) => {
    affichee = l ?? affichee;
    $("#entete-courante").innerHTML = l ? `${badge(l)}<span>${MODES[l.mode]} · score eau <strong>${l.score}</strong> / 100</span>` : "";
  };

  $("#classement ol").innerHTML = classement
    .map(
      (l, i) =>
        `<li data-ligne="${l.ligne}" title="${l.ligne} : ${NIVEAUX.map((n) => compte(n, l[n])).join(", ")}, sur ${l.stations} stations">` +
        `<span class="rang">${i + 1}</span>${badge(l)}${barre(l)}<span class="valeur">${l.score}</span></li>`,
    )
    .join("");
  // cartouche de détail : la meilleure ligne au départ, puis la dernière ligne survolée (gardée après le survol)
  carteLigne(classement[0]);
  enteteMobile(classement[0]);

  // --- survol d'une ligne (carte ou classement) : ligne mise en avant, autres estompées, détail dans le cartouche
  let survol = null;
  let figee = null; // ligne sélectionnée par un clic (carte ou classement)
  const COUCHES_STATIONS = ["arrets", "arrets-ligne"];
  // mobile : « mode ligne » (cartouche du bas = détail de la ligne) dès qu'une ligne est sélectionnée ou que la carte est
  // zoomée au-delà du cadrage initial ; sinon cartouche du titre
  const majModeLigne = () => document.body.classList.toggle("mode-ligne", Boolean(figee) || map.getZoom() > zoomInitial + 0.2);
  map.on("zoomend", () => majModeLigne());
  function styler() {
    const vedette = ["==", ["get", "ligne"], survol ?? ""];
    map.setPaintProperty("lignes", "line-opacity", survol ? ["case", vedette, 1, 0.12] : 1);
    map.setPaintProperty("lignes", "line-width", survol ? ["case", vedette, epaisseur(1.8), epaisseur(1)] : epaisseur(1));
    for (const couche of COUCHES_STATIONS)
      for (const p of ["circle-opacity", "circle-stroke-opacity"]) map.setPaintProperty(couche, p, survol ? ["case", vedette, 1, 0.12] : 1);
    map.setFilter("arrets-ligne", ["==", ["get", "ligne"], figee ?? ""]);
    majModeLigne();
  }
  // aide posée sur la carte : gardée tant qu'il n'y a pas de clic (survols sans effet) ; fermée par ×, au premier clic sur
  // la carte ou dans le classement
  const aide = $("#aide-carte");
  let aideMasquee = false;
  const masquerAide = () => {
    if (aideMasquee || !aide) return;
    aideMasquee = true;
    aide.classList.add("disparait");
    setTimeout(() => aide.remove(), 600);
  };
  aide?.querySelector(".fermer-aide").addEventListener("click", masquerAide);
  map.once("click", masquerAide);
  $("#classement ol").addEventListener("click", masquerAide, { once: true });

  // déroulé du classement jusqu'à la ligne : défilement doux, ligne centrée dans la liste
  const derouler = (li) => {
    const liste = $("#classement");
    liste.scrollTo({ top: li.offsetTop - liste.clientHeight / 2 + li.offsetHeight / 2, behavior: "smooth" });
  };
  // depuisListe : survol venant du classement lui-même -> pas de défilement (la liste ne bouge pas sous la souris)
  const survolerLigne = (ligne, depuisListe = false) => {
    if (survol === ligne) return;
    survol = ligne;
    const l = parLigne.get(ligne);
    carteLigne(l);
    enteteMobile(l);
    for (const li of $("#classement ol").children) li.classList.toggle("actif", li.dataset.ligne === ligne);
    $("#classement ol").classList.add("survol");
    const actif = $("#classement ol li.actif");
    if (actif && !depuisListe) derouler(actif);
    styler();
  };
  const quitterLigne = () => {
    survol = null; // la carte et le classement reviennent à la normale ; le cartouche garde la dernière ligne survolée
    if (figee) return survolerLigne(figee); // ligne figée par un clic : elle reste mise en avant
    for (const li of $("#classement ol").children) li.classList.remove("actif");
    $("#classement ol").classList.remove("survol");
    styler();
  };
  // clic sur une ligne (carte ou classement) : mise en avant figée, comme au survol, et cadrage sur toute la ligne adapté
  // à l'écran ; clic sur le fond de carte : ligne libérée
  const figerLigne = (ligne, cadrerLigne = true) => {
    figee = ligne;
    survol = null;
    survolerLigne(ligne);
    if (!cadrerLigne) return;
    const c = parLigne.get(ligne).segments.flatMap((g) => g.coords);
    map.fitBounds(
      [
        [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1]))],
        [Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))],
      ],
      { padding: marges(), bearing: 0, pitch: 0, duration: 900 },
    );
  };
  const libererLigne = () => {
    figee = null;
    quitterLigne();
  };
  $("#classement ol").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-ligne]");
    if (li) figerLigne(li.dataset.ligne);
  });
  map.on("mousemove", "lignes", (e) => {
    map.getCanvas().style.cursor = "pointer";
    survolerLigne(e.features[0].properties.ligne);
  });
  map.on("mouseleave", "lignes", () => {
    map.getCanvas().style.cursor = "";
    quitterLigne();
  });
  $("#classement ol").addEventListener("mouseover", (e) => {
    const li = e.target.closest("li[data-ligne]");
    if (li) survolerLigne(li.dataset.ligne, true);
  });
  $("#classement ol").addEventListener("mouseleave", quitterLigne);
  // la souris quitte la carte (sans ligne sélectionnée par un clic) : cartouches à l'état initial — classement remonté en
  // haut (ordre décroissant, meilleure ligne en tête), aucune ligne mise en avant, détail de la meilleure ligne
  map.getContainer().addEventListener("mouseleave", () => {
    if (figee) return;
    quitterLigne();
    $("#classement").scrollTo({ top: 0, behavior: "smooth" });
    carteLigne(classement[0]);
    enteteMobile(classement[0]);
  });

  // survol d'une station : bulle avec son nom et l'eau disponible
  const bulle = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  for (const couche of COUCHES_STATIONS) {
  map.on("mousemove", couche, (e) => {
    const p = e.features[0].properties;
    map.getCanvas().style.cursor = "pointer";
    bulle
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${p.nom}</strong> · ${p.ligne}<br><i class="rond" style="display:inline-block;vertical-align:-1px;background:${COULEURS_EAU[p.eau]}"></i> ${LIBELLES_EAU[p.eau]}${p.distance ? ` (${p.distance} m)` : ""}`)
      .addTo(map);
  });
  map.on("mouseleave", couche, () => bulle.remove());
  }

  // --- clic sur une station : zoom sur elle (cercle de 300 m dans le cadre) et cercles de 100, 200 et 300 m autour d'elle
  // (les points d'eau gardent leur apparence)  ; clic sur le fond de carte : cercles effacés, cadrage initial
  const RAYONS = [
    [100, "p100"],
    [200, "p200"],
    [300, "p300"],
  ];
  const vide = { type: "FeatureCollection", features: [] };
  const cercle = ([lon, lat], r) => {
    const [dLat, dLon] = [r / 111320, r / (111320 * Math.cos((lat * Math.PI) / 180))];
    return Array.from({ length: 65 }, (_, i) => {
      const a = (i / 64) * 2 * Math.PI;
      return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
    });
  };
  map.addSource("cercles", { type: "geojson", data: vide });
  map.addLayer({ id: "cercles", type: "line", source: "cercles", paint: { "line-color": "#0b5a7a", "line-width": 1.2, "line-dasharray": [3, 2] } }, "lignes");
  // traits station → points d'eau à moins de 300 m : plein (< 100 m), tirets (100-200 m), pointillés (200-300 m)
  // (line-dasharray non piloté par les données en MapLibre 2 -> une couche par rayon)
  map.addSource("liens-eau", { type: "geojson", data: vide });
  const TIRETS = { p100: null, p200: [4, 2], p300: [1, 2] };
  for (const [n, tirets] of Object.entries(TIRETS))
    map.addLayer(
      {
        id: `liens-eau-${n}`,
        type: "line",
        source: "liens-eau",
        filter: ["==", ["get", "niveau"], n],
        layout: { "line-cap": tirets ? "butt" : "round" },
        paint: { "line-color": "#0b5a7a", "line-width": 1.4, "line-opacity": 0.85, ...(tirets ? { "line-dasharray": tirets } : {}) },
      },
      "points-eau", // sous les points d'eau (qui restent visibles au bout des traits), les lignes et les stations
    );
  // distance en mètres entre deux points (approximation locale, suffisante à 300 m)
  const metres = ([x1, y1], [x2, y2]) => {
    const k = Math.PI / 180;
    return 6371000 * Math.hypot((x2 - x1) * k * Math.cos(((y1 + y2) / 2) * k), (y2 - y1) * k);
  };
  // étiquettes « 100 m », « 200 m », « 300 m » en haut de chaque cercle (marqueurs HTML : pas de police du style requise)
  let etiquettesCercles = [];
  const effacerCercles = () => {
    map.getSource("cercles").setData(vide);
    map.getSource("liens-eau").setData(vide);
    etiquettesCercles.forEach((m) => m.remove());
    etiquettesCercles = [];
  };
  map.on("click", (e) => {
    // mobile : toucher approximatif -> recherche dans un carré de 28 px autour du doigt (stations d'abord, puis lignes)
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const { x, y } = e.point;
    const zone = mobile ? [[x - 14, y - 14], [x + 14, y + 14]] : e.point;
    // progression en deux temps : au zoom initial (ou plus loin), le premier clic / toucher focalise sur la LIGNE (cadrée
    // en entier, ses stations apparaissent) ; la STATION n'est accessible qu'une fois zoomé plus près ou la ligne focalisée
    const auZoomInitial = map.getZoom() <= zoomInitial + 0.2;
    let station = map.queryRenderedFeatures(zone, { layers: COUCHES_STATIONS })[0];
    if (station && auZoomInitial && station.properties.ligne !== figee) station = null; // station d'une autre ligne : la ligne d'abord
    if (!station) {
      effacerCercles();
      const ligne = map.queryRenderedFeatures(zone, { layers: ["lignes"] })[0];
      // ligne : figée et cadrée en entier, quel que soit le zoom
      if (ligne) return figerLigne(ligne.properties.ligne); // clic sur une ligne, à tout zoom : cadrage sur toute la ligne
      // fond de carte (ni station, ni point d'eau, ni ligne) : ligne libérée, retour au cadrage initial (Paris)
      libererLigne();
      cadrer(800);
      return;
    }
    const centre = station.geometry.coordinates;
    // la ligne de la station est retenue (cartouche, mobile : cartouche du bas), sans cadrage : le zoom est sur la station
    figerLigne(station.properties.ligne, false);
    // zoom sur la station : le cercle de 300 m remplit le cadre
    const bord = cercle(centre, 320);
    map.fitBounds(
      [
        [Math.min(...bord.map((c) => c[0])), Math.min(...bord.map((c) => c[1]))],
        [Math.max(...bord.map((c) => c[0])), Math.max(...bord.map((c) => c[1]))],
      ],
      { padding: 40, duration: 900 },
    );
    map.getSource("cercles").setData({
      type: "FeatureCollection",
      features: [...RAYONS].reverse().map(([r]) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [cercle(centre, r)] }, properties: { rayon: r } })),
    });
    etiquettesCercles.forEach((m) => m.remove());
    // traits vers les points d'eau des trois rayons
    const liens = pointsEau
      .map((c) => [c, metres(centre, c)])
      .filter(([, d]) => d < 300)
      .map(([c, d]) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [centre, c] }, properties: { niveau: RAYONS.find(([r]) => d < r)[1] } }));
    map.getSource("liens-eau").setData({ type: "FeatureCollection", features: liens });
    etiquettesCercles = RAYONS.map(([r]) => {
      const el = document.createElement("div");
      el.className = "etiquette-cercle";
      el.textContent = `${r} m`;
      return new Marker({ element: el, anchor: "center" }).setLngLat([centre[0], centre[1] + r / 111320]).addTo(map);
    });
    // nom de la station à droite du point, suivi de la goutte (fontaine dans la station) ou de la goutte barrée (comme
    // la page ligne 7)
    const p = station.properties;
    const nom = document.createElement("div");
    nom.className = "nom-station";
    nom.innerHTML = `<span>${p.nom}</span>${p.eau === "fontaine" ? '<span class="goutte" title="fontaine dans la station">💧</span>' : '<span class="goutte barree" title="pas de fontaine dans la station"><span class="icone">💧</span></span>'}`;
    etiquettesCercles.push(new Marker({ element: nom, anchor: "left", offset: [16, 0] }).setLngLat(centre).addTo(map));
  });

  // mobile : fermer / rouvrir le cartouche (la carte se recadre)
  const basculerEntete = (ferme) => {
    document.body.classList.toggle("entete-ferme", ferme);
    cadrer(400);
  };
  // fermer le cartouche : retour à la carte complète (ligne libérée, cercles effacés, cadrage initial)
  $("#fermer-entete").addEventListener("click", () => {
    effacerCercles();
    libererLigne();
    basculerEntete(true);
  });
  // mobile : cartouche de la ligne -> × : retour à la carte complète ; toucher (hors boutons) : toute la ligne
  $("#fermer-courante").addEventListener("click", () => {
    effacerCercles();
    libererLigne();
    cadrer(600);
  });
  $("#courante").addEventListener("click", (e) => {
    if (e.target.closest("button") || !window.matchMedia("(max-width: 700px)").matches) return;
    const l = figee ? parLigne.get(figee) : affichee;
    if (!l) return;
    effacerCercles();
    figerLigne(l.ligne);
  });
  // mobile : toucher le cartouche du bas (hors boutons) -> toute la ligne affichée
  $("#entete").addEventListener("click", (e) => {
    if (e.target.closest("button") || !window.matchMedia("(max-width: 700px)").matches || !affichee) return;
    effacerCercles();
    figerLigne(affichee.ligne);
  });
  $("#ouvrir-entete").addEventListener("click", () => basculerEntete(false));
});
