// Qualité de l'air des lignes de métro et de RER (index-air.html) : même principe que la carte eau (main-eau.js), avec
// l'indicateur de la page ligne 7 — pollution aux particules sur le quai (IDFM × Airparif 2024). Carte complète d'emblée :
// chaque portion de ligne prend la couleur de la station la plus proche (faible, moyenne, élevée, station aérienne, pas
// de données) ; classement des lignes par score de qualité de l'air (100 = meilleur, la meilleure en haut) à droite.
// Clic / toucher en deux temps : au zoom initial, focalisation sur la ligne ; zoomé ou ligne focalisée, zoom sur la
// station. Page légère : MapLibre seul, données de l'étape 22 (pipeline/22-air-lignes.json).
import { Map, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Credits } from "./creditsCarte.js";

const DONNEES = "./idf-mobilites/pipeline/22-air-lignes.json";
const STYLE = "https://openmaptiles.data.gouv.fr/styles/positron/style.json";
// niveaux de la page ligne 7 ; stations aériennes (à l'air libre) en bleu turquoise, sans données en gris clair
const COULEURS_AIR = { faible: "#3a9a4a", moyenne: "#f0a030", elevee: "#c62828", aerienne: "#1fb5c1", inconnu: "#d0d0d0" };
const LIBELLES_AIR = {
  faible: "pollution aux particules faible",
  moyenne: "pollution aux particules moyenne",
  elevee: "pollution aux particules élevée",
  aerienne: "station aérienne, proche de l'air extérieur",
  inconnu: "pas de données",
};
// ordre d'affichage (barres, détail, infobulles) : station aérienne (air extérieur) d'abord, puis faible → élevée
const NIVEAUX = ["aerienne", "faible", "moyenne", "elevee", "inconnu"];
// libellés accordés au nombre de stations (bloc de détail, classement) : [singulier, pluriel]
const COMPTES_AIR = {
  faible: ["station en pollution faible", "stations en pollution faible"],
  moyenne: ["station en pollution moyenne", "stations en pollution moyenne"],
  elevee: ["station en pollution élevée", "stations en pollution élevée"],
  aerienne: ["station aérienne", "stations aériennes"],
  inconnu: ["station sans données", "stations sans données"],
};
const compte = (n, k) => `${k} ${COMPTES_AIR[n][k > 1 ? 1 : 0]}`;
const MODES = { métro: "Métro", RER: "RER", tram: "Tramway" };
const ZOOM_AVANT = 0.4; // stations visibles dès ce zoom avant au-delà du cadrage initial

const $ = (s) => document.querySelector(s);
const map = new Map({ container: "mapContainer", style: STYLE, center: [2.35, 48.86], zoom: 10, attributionControl: false });
map.addControl(new Credits(), "bottom-right");

// clarté d'une couleur "#rrggbb" (texte noir ou blanc par-dessus)
const clarte = (c) => {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
// pastille d'une ligne : couleur officielle, métro = numéro dans un cercle, RER = lettre dans un carré arrondi, tram =
// « T… » entre deux barres (plan RATP)
const badge = (l) => {
  if (l.mode === "tram") return `<span class="badge tram" style="border-color:${l.couleur}">${l.ligne}</span>`;
  const texte = l.mode === "métro" ? l.ligne.replace(/^M/, "") : l.ligne.replace(/^RER\s*/, "");
  return `<span class="badge ${l.mode === "métro" ? "metro" : "rer"}${texte.length > 2 ? " long" : ""}" style="background:${l.couleur};color:${clarte(l.couleur) > 150 ? "#000" : "#fff"}">${texte}</span>`;
};
// barre : part de chaque niveau dans les stations de la ligne
const barre = (l) =>
  `<div class="barre">${NIVEAUX.filter((n) => l[n] && n !== "inconnu")
    .map((n) => `<span style="background:${COULEURS_AIR[n]};width:${(l[n] / l.stations) * 100}%"></span>`)
    .join("")}</div>`;
const score = (l) => (l.score == null ? "—" : l.score);

map.on("load", async () => {
  for (const couche of map.getStyle().layers) if (couche.type === "symbol") map.setLayoutProperty(couche.id, "visibility", "none");
  const { lignes } = await (await fetch(DONNEES)).json();
  // classement : meilleur score (air le plus sain) en haut ; lignes sans station renseignée en bas
  const classement = [...lignes].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.evalues - a.evalues);
  const parLigne = new globalThis.Map(classement.map((l) => [l.ligne, l]));

  // cadrage initial : Paris intra-muros
  const emprise = [
    [2.224, 48.815],
    [2.47, 48.902],
  ];
  const marges = () => {
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const ferme = document.body.classList.contains("entete-ferme");
    return { top: 30, bottom: mobile ? (ferme ? 70 : $("#panneau").offsetHeight + 56) : 30, left: mobile ? 20 : 30, right: mobile ? 20 : 30 };
  };
  const cadrer = (duree) => map.fitBounds(emprise, { padding: marges(), bearing: 0, pitch: 0, duration: duree });
  cadrer(0);
  const zoomInitial = map.getZoom();

  // --- couches : portions de ligne colorées, stations (toutes au zoom avant ; celles de la ligne sélectionnée toujours)
  const traces = [...classement].reverse().flatMap((l) => l.segments.map((g) => ({ type: "Feature", geometry: { type: "LineString", coordinates: g.coords }, properties: { ligne: l.ligne, air: g.air } })));
  const arrets = classement.flatMap((l) => l.arrets.filter((a) => a.air !== "inconnu").map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { ligne: l.ligne, air: a.air, nom: a.nom } })));
  map.addSource("traces", { type: "geojson", data: { type: "FeatureCollection", features: traces } });
  map.addSource("arrets", { type: "geojson", data: { type: "FeatureCollection", features: arrets } });
  const couleur = ["match", ["get", "air"], ...NIVEAUX.slice(0, -1).flatMap((n) => [n, COULEURS_AIR[n]]), COULEURS_AIR.inconnu];
  const epaisseur = (k) => ["interpolate", ["linear"], ["zoom"], 8, 1.4 * k, 13, 3.8 * k];
  map.addLayer({ id: "lignes", type: "line", source: "traces", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": couleur, "line-width": epaisseur(1) } });
  const peintureStations = {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 3.5, 15, 7],
    "circle-color": couleur,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.2, 15, 2],
  };
  map.addLayer({ id: "arrets", type: "circle", source: "arrets", minzoom: zoomInitial + ZOOM_AVANT, paint: peintureStations });
  map.addLayer({ id: "arrets-ligne", type: "circle", source: "arrets", filter: ["==", ["get", "ligne"], ""], paint: peintureStations });
  const COUCHES_STATIONS = ["arrets", "arrets-ligne"];

  // --- cartouches
  function carteLigne(l) {
    $("#courante-contenu").innerHTML =
      `<div class="tete">${badge(l)}<span class="mode-titre">${MODES[l.mode]} <span class="nb-stations">· ${l.stations} stations</span></span><span class="score">${score(l)}<small> / 100</small></span></div>` +
      barre(l) +
      `<div class="detail">` +
      // les 4 types de stations toujours listés (même à 0) ; stations sans données non affichées
      NIVEAUX.filter((n) => n !== "inconnu").map((n) => `<span><i class="rond" style="background:${COULEURS_AIR[n]}"></i>${compte(n, l[n])}</span>`).join("") +
      `</div>`;
  }
  let affichee = null;
  const enteteMobile = (l) => {
    affichee = l ?? affichee;
    $("#entete-courante").innerHTML = l ? `${badge(l)}<span>${MODES[l.mode]} · qualité de l'air <strong>${score(l)}</strong> / 100</span>` : "";
  };
  $("#classement ol").innerHTML = classement
    .map(
      (l, i) =>
        `<li data-ligne="${l.ligne}" title="${l.ligne} : ${NIVEAUX.filter((n) => l[n] && n !== "inconnu").map((n) => compte(n, l[n])).join(", ")}">` +
        `<span class="rang">${i + 1}</span>${badge(l)}${barre(l)}<span class="valeur">${score(l)}</span></li>`,
    )
    .join("");
  carteLigne(classement[0]);
  enteteMobile(classement[0]);

  // --- survol / sélection d'une ligne (mêmes règles que la carte eau)
  let survol = null;
  let figee = null;
  const majModeLigne = () => document.body.classList.toggle("mode-ligne", Boolean(figee) || map.getZoom() > zoomInitial + 0.2);
  map.on("zoomend", majModeLigne);
  function styler() {
    const vedette = ["==", ["get", "ligne"], survol ?? ""];
    map.setPaintProperty("lignes", "line-opacity", survol ? ["case", vedette, 1, 0.12] : 1);
    map.setPaintProperty("lignes", "line-width", survol ? ["case", vedette, epaisseur(1.8), epaisseur(1)] : epaisseur(1));
    for (const c of COUCHES_STATIONS) for (const p of ["circle-opacity", "circle-stroke-opacity"]) map.setPaintProperty(c, p, survol ? ["case", vedette, 1, 0.12] : 1);
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
    survol = null;
    if (figee) return survolerLigne(figee);
    for (const li of $("#classement ol").children) li.classList.remove("actif");
    $("#classement ol").classList.remove("survol");
    styler();
  };
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
  $("#classement ol").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-ligne]");
    if (li) figerLigne(li.dataset.ligne);
  });

  // survol d'une station : bulle
  const bulle = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
  for (const couche of COUCHES_STATIONS) {
    map.on("mousemove", couche, (e) => {
      const p = e.features[0].properties;
      map.getCanvas().style.cursor = "pointer";
      bulle
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${p.nom}</strong> · ${p.ligne}<br><i class="rond" style="display:inline-block;vertical-align:-1px;background:${COULEURS_AIR[p.air]}"></i> ${LIBELLES_AIR[p.air]}`)
        .addTo(map);
    });
    map.on("mouseleave", couche, () => bulle.remove());
  }

  // --- clic / toucher en deux temps (ligne puis station) ; station : zoom et nom avec sa pastille de qualité de l'air
  let etiquette = null;
  const effacerStation = () => (etiquette?.remove(), (etiquette = null));
  map.on("click", (e) => {
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const { x, y } = e.point;
    const zone = mobile ? [[x - 14, y - 14], [x + 14, y + 14]] : e.point;
    const auZoomInitial = map.getZoom() <= zoomInitial + 0.2;
    let station = map.queryRenderedFeatures(zone, { layers: COUCHES_STATIONS })[0];
    if (station && auZoomInitial && station.properties.ligne !== figee) station = null;
    effacerStation();
    if (!station) {
      const ligne = map.queryRenderedFeatures(zone, { layers: ["lignes"] })[0];
      if (ligne) return figerLigne(ligne.properties.ligne); // clic sur une ligne, à tout zoom : cadrage sur toute la ligne
      libererLigne();
      cadrer(800);
      return;
    }
    const centre = station.geometry.coordinates;
    figerLigne(station.properties.ligne, false);
    map.flyTo({ center: centre, zoom: Math.max(map.getZoom(), 15.5), duration: 900 });
    const p = station.properties;
    const el = document.createElement("div");
    el.className = "nom-station";
    el.innerHTML = `<span>${p.nom}</span><i class="rond grand" style="background:${COULEURS_AIR[p.air]}" title="${LIBELLES_AIR[p.air]}"></i>`;
    etiquette = new Marker({ element: el, anchor: "left", offset: [16, 0] }).setLngLat(centre).addTo(map);
  });

  // --- mobile : cartouches du bas
  const basculerEntete = (ferme) => {
    document.body.classList.toggle("entete-ferme", ferme);
    cadrer(400);
  };
  $("#fermer-entete").addEventListener("click", () => {
    effacerStation();
    libererLigne();
    basculerEntete(true);
  });
  $("#ouvrir-entete").addEventListener("click", () => basculerEntete(false));
  $("#fermer-courante").addEventListener("click", () => {
    effacerStation();
    libererLigne();
    cadrer(600);
  });
  const ligneEntiere = (e) => {
    if (e.target.closest("button") || !window.matchMedia("(max-width: 700px)").matches) return;
    const l = figee ? parLigne.get(figee) : affichee;
    if (!l) return;
    effacerStation();
    figerLigne(l.ligne);
  };
  $("#courante").addEventListener("click", ligneEntiere);
  $("#entete").addEventListener("click", ligneEntiere);
});
