// Accessibilité en fauteuil roulant des lignes de métro, RER et tram (index-fauteuils.html), données IDFM (étape 23) :
// même principe que les cartes eau et air, mais les lignes gardent leur couleur officielle et l'accessibilité se lit à
// l'intensité du trait : pleine = stations accessibles (y compris avec assistance, nuance visible au zoom sur le symbole
// de la station), très atténuée = stations inaccessibles (marquées d'une croix gris foncé, trait renforcé en zoomant),
// pâle = non renseigné.
// Clic / toucher en deux temps (ligne puis station), classement par score (la plus accessible en haut), version mobile.
// Page légère : MapLibre seul, données pipeline/23-fauteuil-lignes.json.
import { Map, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Credits } from "./creditsCarte.js";

const DONNEES = "./idf-mobilites/pipeline/23-fauteuil-lignes.json";
const STYLE = "https://openmaptiles.data.gouv.fr/styles/positron/style.json";
const NIVEAUX = ["oui", "partiel", "non", "inconnu"];
// libellés accordés au nombre de stations (bloc de détail, classement) : [singulier, pluriel]
const COMPTES = {
  oui: ["station accessible", "stations accessibles"],
  partiel: ["station accessible avec assistance", "stations accessibles avec assistance"],
  non: ["station non accessible", "stations non accessibles"],
  inconnu: ["station non renseignée", "stations non renseignées"],
};
const compte = (n, k) => `${k} ${COMPTES[n][k > 1 ? 1 : 0]}`;
// mêmes symboles sur la carte et dans le cartouche : rond vert = accessible, rond orange = avec assistance, croix gris
// foncé = non accessible (COULEURS : barres, ronds ; la croix est dessinée, cf. symbole() et icone())
const COULEURS = { oui: "#2e8b3e", partiel: "#f0a030", non: "#444444", inconnu: "#cfcfcf" };
const CROIX_SVG =
  '<svg class="symbole" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" stroke="#444" stroke-width="2.6" stroke-linecap="round"/></svg>';
const symbole = (n) => (n === "non" ? CROIX_SVG : `<i class="rond symbole" style="background:${COULEURS[n]}"></i>`);
const LIBELLES = { oui: "accessible", partiel: "accessible avec assistance", non: "non accessible", inconnu: "non renseigné" };
// intensité du trait par niveau : au niveau de la ligne, « avec assistance » compte comme accessible (même trait plein) ;
// la nuance n'apparaît qu'en se rapprochant, sur le symbole de la station (cerclé d'orange)
// opacité au cadrage initial (OPACITES) et en zoomant (OPACITES_ZOOM, atteinte ZOOM_OPACITE crans plus près) : les portions
// non accessibles, très pâles en vue d'ensemble, se renforcent de près pour qu'on suive bien la ligne
const OPACITES = { oui: 1, partiel: 1, non: 0.45, inconnu: 0.45 }; // dès le cadrage initial (plus d'effet de zoom)
const OPACITES_ZOOM = { oui: 1, partiel: 1, non: 0.45, inconnu: 0.45 };
const ZOOM_OPACITE = 2.5;
const MODES = { métro: "Métro", RER: "RER", tram: "Tramway" };
const ZOOM_AVANT = 0.4;

const $ = (s) => document.querySelector(s);
const map = new Map({ container: "mapContainer", style: STYLE, center: [2.35, 48.86], zoom: 10, attributionControl: false });
map.addControl(new Credits(), "bottom-right");

const clarte = (c) => {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
// pastille d'une ligne (signalétique) : métro cercle, RER carré arrondi, tram « T… » entre deux barres
const badge = (l) => {
  if (l.mode === "tram") return `<span class="badge tram" style="border-color:${l.couleur}">${l.ligne}</span>`;
  const texte = l.mode === "métro" ? l.ligne.replace(/^M/, "") : l.ligne.replace(/^RER\s*/, "");
  return `<span class="badge ${l.mode === "métro" ? "metro" : "rer"}${texte.length > 2 ? " long" : ""}" style="background:${l.couleur};color:${clarte(l.couleur) > 150 ? "#000" : "#fff"}">${texte}</span>`;
};
const barre = (l) =>
  `<div class="barre">${NIVEAUX.filter((n) => l[n])
    .map((n) => `<span style="background:${COULEURS[n]};width:${(l[n] / l.stations) * 100}%"></span>`)
    .join("")}</div>`;
const score = (l) => (l.score == null ? "—" : l.score);

// icônes des stations dessinées sur canvas (pas de police du style requise) : accessible = rond vert cerclé de blanc ;
// avec assistance = rond orange cerclé de blanc ; non accessible = croix gris foncé (liseré blanc) ; non renseigné = petit rond gris
function icone(type) {
  const r = 2; // densité
  const t = 22 * r;
  const c = document.createElement("canvas");
  c.width = c.height = t;
  const x = c.getContext("2d");
  const centre = t / 2;
  const rayon = type === "inconnu" ? 5 * r : 7.5 * r;
  if (type === "non" || type === "croix-grise") {
    // croix gris foncé (« non » : taille normale au zoom ; « croix-grise » : vue d'ensemble), liseré blanc
    const b = 6.5 * r;
    for (const [l, couleur] of [[5.5 * r, "#ffffff"], [3.2 * r, "#444444"]])
      for (const [dx, dy] of [[1, 1], [1, -1]]) {
        x.beginPath();
        x.moveTo(centre - b * dx, centre - b * dy);
        x.lineTo(centre + b * dx, centre + b * dy);
        x.lineWidth = l;
        x.lineCap = "round";
        x.strokeStyle = couleur;
        x.stroke();
      }
    return { image: x.getImageData(0, 0, t, t), pixelRatio: r };
  }
  x.beginPath();
  x.arc(centre, centre, rayon, 0, 2 * Math.PI);
  x.fillStyle = { oui: "#2e8b3e", partiel: "#f0a030", inconnu: "#d6d6d6" }[type];
  x.fill();
  x.lineWidth = 2.2 * r;
  x.strokeStyle = "#ffffff";
  x.stroke();
  return { image: x.getImageData(0, 0, t, t), pixelRatio: r };
}

map.on("load", async () => {
  for (const couche of map.getStyle().layers) if (couche.type === "symbol") map.setLayoutProperty(couche.id, "visibility", "none");
  for (const n of [...NIVEAUX, "croix-grise"]) {
    const { image, pixelRatio } = icone(n);
    map.addImage(`station-${n}`, image, { pixelRatio });
  }
  const { lignes } = await (await fetch(DONNEES)).json();
  const classement = [...lignes].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.stations - a.stations);
  const parLigne = new globalThis.Map(classement.map((l) => [l.ligne, l]));

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

  // --- couches : une couche de trait par niveau (intensité propre à chaque niveau)
  const traces = [...classement].reverse().flatMap((l) => l.segments.map((g) => ({ type: "Feature", geometry: { type: "LineString", coordinates: g.coords }, properties: { ligne: l.ligne, acces: g.acces, couleur: l.couleur } })));
  const arrets = classement.flatMap((l) => l.arrets.map((a) => ({ type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { ligne: l.ligne, acces: a.acces, nom: a.nom, detail: a.detail ?? null } })));
  map.addSource("traces", { type: "geojson", data: { type: "FeatureCollection", features: traces } });
  map.addSource("arrets", { type: "geojson", data: { type: "FeatureCollection", features: arrets } });
  const epaisseur = (k) => ["interpolate", ["linear"], ["zoom"], 8, 1.6 * k, 13, 4 * k];
  const COUCHES_LIGNES = NIVEAUX.map((n) => `lignes-${n}`);
  for (const n of NIVEAUX)
    map.addLayer({
      id: `lignes-${n}`,
      type: "line",
      source: "traces",
      filter: ["==", ["get", "acces"], n],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "couleur"], "line-width": epaisseur(1), "line-opacity": OPACITES[n] },
    });
  const iconeStations = {
    "icon-image": ["concat", "station-", ["get", "acces"]],
    "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 13, 0.7, 15, 1],
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
  // avant le zoom : croix gris foncé sur les stations non accessibles (relayées au zoom par les symboles détaillés)
  map.addLayer({
    id: "croix",
    type: "symbol",
    source: "arrets",
    maxzoom: zoomInitial + ZOOM_AVANT,
    filter: ["==", ["get", "acces"], "non"],
    layout: { "icon-image": "station-croix-grise", "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.35, 12, 0.5, 14, 0.6], "icon-allow-overlap": true, "icon-ignore-placement": true },
  });
  map.addLayer({ id: "arrets", type: "symbol", source: "arrets", minzoom: zoomInitial + ZOOM_AVANT, layout: iconeStations });
  map.addLayer({ id: "arrets-ligne", type: "symbol", source: "arrets", filter: ["==", ["get", "ligne"], ""], layout: iconeStations });
  const COUCHES_STATIONS = ["arrets", "arrets-ligne"];

  // --- cartouches
  function carteLigne(l) {
    $("#courante-contenu").innerHTML =
      `<div class="tete">${badge(l)}<span class="mode-titre">${MODES[l.mode]} <span class="nb-stations">· ${l.stations} stations</span></span><span class="score">${score(l)}<small> / 100</small></span></div>` +
      barre(l) +
      `<div class="detail">` +
      // accessibles, avec assistance, non accessibles toujours listés (même à 0) ; non renseignées seulement s'il y en a
      NIVEAUX.filter((n) => n !== "inconnu" || l[n]).map((n) => `<span>${symbole(n)}${compte(n, l[n])}</span>`).join("") +
      `</div>`;
  }
  let affichee = null;
  const enteteMobile = (l) => {
    affichee = l ?? affichee;
    $("#entete-courante").innerHTML = l ? `${badge(l)}<span>${MODES[l.mode]} · accessibilité <strong>${score(l)}</strong> / 100</span>` : "";
  };
  $("#classement ol").innerHTML = classement
    .map(
      (l, i) =>
        `<li data-ligne="${l.ligne}" title="${l.ligne} : ${NIVEAUX.filter((n) => l[n]).map((n) => compte(n, l[n])).join(", ")}">` +
        `<span class="rang">${i + 1}</span>${badge(l)}${barre(l)}<span class="valeur">${score(l)}</span></li>`,
    )
    .join("");
  carteLigne(classement[0]);
  enteteMobile(classement[0]);

  // --- survol / sélection d'une ligne
  let survol = null;
  let figee = null;
  const majModeLigne = () => document.body.classList.toggle("mode-ligne", Boolean(figee) || map.getZoom() > zoomInitial + 0.2);
  map.on("zoomend", majModeLigne);
  function styler() {
    const vedette = ["==", ["get", "ligne"], survol ?? ""];
    for (const n of NIVEAUX) {
      const c = `lignes-${n}`;
      // intensité selon le zoom ; ligne survolée : ses portions gardent leur intensité (au moins 0,25), autres presque effacées
      const valeur = (o) => (survol ? ["case", vedette, Math.max(o, 0.25), 0.06] : o);
      map.setPaintProperty(c, "line-opacity", ["interpolate", ["linear"], ["zoom"], zoomInitial, valeur(OPACITES[n]), zoomInitial + ZOOM_OPACITE, valeur(OPACITES_ZOOM[n])]);
      map.setPaintProperty(c, "line-width", survol ? ["case", vedette, epaisseur(1.8), epaisseur(1)] : epaisseur(1));
    }
    for (const c of [...COUCHES_STATIONS, "croix"]) map.setPaintProperty(c, "icon-opacity", survol ? ["case", vedette, 1, 0.15] : 1);
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
  styler();
  for (const c of COUCHES_LIGNES) {
    map.on("mousemove", c, (e) => {
      map.getCanvas().style.cursor = "pointer";
      survolerLigne(e.features[0].properties.ligne);
    });
    map.on("mouseleave", c, () => {
      map.getCanvas().style.cursor = "";
      quitterLigne();
    });
  }
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

  const bulle = new Popup({ closeButton: false, closeOnClick: false, offset: 10 });
  for (const couche of COUCHES_STATIONS) {
    map.on("mousemove", couche, (e) => {
      const p = e.features[0].properties;
      map.getCanvas().style.cursor = "pointer";
      bulle
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${p.nom}</strong> · ${p.ligne}<br><span class="symbole-bulle">${symbole(p.acces)}</span> ${LIBELLES[p.acces]}${p.detail ? ` (${p.detail})` : ""}`)
        .addTo(map);
    });
    map.on("mouseleave", couche, () => bulle.remove());
  }

  // --- clic / toucher en deux temps ; station : zoom, nom et pictogramme ♿ (accessible) ou ♿ barré (non accessible)
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
      const ligne = map.queryRenderedFeatures(zone, { layers: COUCHES_LIGNES })[0];
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
    const picto = { oui: '<span class="fauteuil" title="accessible">♿</span>', partiel: '<span class="fauteuil assistance" title="accessible avec assistance">♿</span>', non: '<span class="fauteuil barre" title="non accessible"><span class="icone">♿</span></span>', inconnu: '<span class="fauteuil inconnu" title="non renseigné">?</span>' }[p.acces];
    el.innerHTML = `<span>${p.nom}</span>${picto}`;
    etiquette = new Marker({ element: el, anchor: "left", offset: [16, 0] }).setLngLat(centre).addTo(map);
  });

  // --- mobile
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
