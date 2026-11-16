import { Map, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { generateMapStyleUrl } from "@visual-data-flow/shared/modules/maplibreTools";
import { installerRechercheLignes } from "./rechercheLignes.js";
import { installerRames } from "./rames.js";
import { creerGraphiquesVelo } from "./graphiquesVelo.js";
import { creerGraphiquesTemperatures } from "./graphiquesTemperatures.js";
import { creerGraphiquesValidations, LIBELLES_TYPES } from "./graphiquesValidations.js";

// Données produites par le pipeline (scripts/data/, voir MOBILITES.md)
const DONNEES = "./idf-mobilites/pipeline";

// Frise : du premier tronçon en service (1837) à la dernière mise en service estimée des projets
const MS_PAR_ANNEE = 120; // durée d'une année pendant la lecture (et dans la vidéo)
const PAS_RAPIDE = 10; // reculer / avancer rapide, en années
const IPS_VIDEO = 30; // images par seconde de la vidéo
const CLE_ANCRES = "idf-mobilites-ancres"; // ancres caméra conservées dans le navigateur
const EMPRISE_PARIS = [
  [2.224, 48.815],
  [2.47, 48.902],
]; // [ouest, sud], [est, nord]

// Style natif, sans retouche des couches : réseau et projets sont ajoutés par-dessus
const mapStyleUrl = generateMapStyleUrl(project);

const VUE_INITIALE = {
  center: [project.projectMapLon, project.projectMapLat],
  zoom: project.projectMapZoom,
  bearing: project.projectMapBearing || 0,
  pitch: project.projectMapPitch || 0,
};

const map = new Map({
  container: "mapContainer",
  style: mapStyleUrl,
  ...VUE_INITIALE,
  preserveDrawingBuffer: true, // capture et vidéo : lecture du canvas
});

map.addControl(new NavigationControl(), "top-right");

window.map = map;

// --- Menu des couches (contrôle MapLibre, en haut à droite) ---
// Une case à cocher par entrée, chaque entrée pilotant la visibilité d'un groupe de couches
class MenuCouches {
  constructor(entrees) {
    this.entrees = entrees;
  }

  // Bouton « couches » (sous + / − / boussole) : un clic ouvre ou ferme le panneau des couches, à gauche du bouton
  onAdd(map) {
    this.conteneur = document.createElement("div");
    this.conteneur.className = "maplibregl-ctrl maplibregl-ctrl-group menu-couches";
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.title = "Couches";
    bouton.setAttribute("aria-label", "Couches");
    bouton.setAttribute("aria-expanded", "false");
    // trois couches superposées (Bootstrap n'en dessine que deux)
    bouton.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M8 1.5 14.5 4.75 8 8 1.5 4.75Z"/><path d="M3.6 6.8 1.5 7.85 8 11.1l6.5-3.25-2.1-1.05"/>' +
      '<path d="M3.6 9.9 1.5 10.95 8 14.2l6.5-3.25-2.1-1.05"/></svg>';
    this.panneau = document.createElement("div");
    this.panneau.className = "menu-couches-panneau";
    this.panneau.hidden = true;
    const basculer = (ouvert = this.panneau.hidden) => {
      this.panneau.hidden = !ouvert;
      bouton.classList.toggle("actif", ouvert);
      bouton.setAttribute("aria-expanded", String(ouvert));
    };
    bouton.addEventListener("click", () => basculer());
    // fermeture : clic ailleurs (carte comprise) ou Échap
    this.fermer = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !this.conteneur.contains(e.target)) basculer(false);
    };
    document.addEventListener("click", this.fermer);
    document.addEventListener("keydown", this.fermer);
    this.conteneur.append(bouton, this.panneau);
    for (const { libelle, couches } of this.entrees) {
      const ligne = document.createElement("label");
      const caseACocher = document.createElement("input");
      caseACocher.type = "checkbox";
      caseACocher.checked = couches.every((c) => map.getLayoutProperty(c, "visibility") !== "none");
      caseACocher.addEventListener("change", () => {
        for (const c of couches) map.setLayoutProperty(c, "visibility", caseACocher.checked ? "visible" : "none");
        map.fire("visibilitecouches");
      });
      ligne.append(caseACocher, ` ${libelle}`);
      this.panneau.append(ligne);
    }
    return this.conteneur;
  }

  onRemove() {
    document.removeEventListener("click", this.fermer);
    document.removeEventListener("keydown", this.fermer);
    this.conteneur.remove();
  }
}

// Services de la ligne (référentiel des lignes IDFM, étapes 04 et 05) : ligne d'infobulle, vide si tout est inconnu
const SERVICES = [
  ["accessible", { oui: "accessible UFR", partiel: "partiellement accessible UFR", non: "non accessible UFR" }],
  ["climatisation", { oui: "climatisée", partiel: "partiellement climatisée", non: "non climatisée" }],
  ["annonceSonore", { oui: "annonces sonores", partiel: "annonces sonores partielles" }],
  ["annonceVisuelle", { oui: "annonces visuelles", partiel: "annonces visuelles partielles" }],
];
// Score de pollution aux particules de la ligne (étape 14), rempli au chargement
let scoresPollution = new globalThis.Map(); // Map seul = carte MapLibre (import)
const scorePollution = (ligne) => {
  const l = scoresPollution.get(ligne);
  return l
    ? `<br><span style="color:#666">pollution aux particules : <strong>${l.score}</strong>/100 (${l.evalues} quai${l.evalues > 1 ? "s" : ""} souterrain${l.evalues > 1 ? "s" : ""} : ${l.eleve} élevé, ${l.moyen} moyen, ${l.faible} faible)</span>`
    : "";
};
const servicesLigne = (p) => {
  const t = SERVICES.map(([cle, libelles]) => libelles[p[cle]]).filter(Boolean);
  return t.length ? `<br><span style="color:#666">ligne ${t.join(" · ")}</span>` : "";
};

// --- Notifications (hors canvas : n'apparaissent ni dans les captures ni dans la vidéo) ---
function notifier(message, erreur = false) {
  const note = document.createElement("div");
  note.className = `notification${erreur ? " erreur" : ""}`;
  note.textContent = message;
  document.body.append(note);
  setTimeout(() => note.remove(), 4000);
}

// --- Frise ---
// Filtres de base de chaque couche (hors frise) ; la frise y ajoute la condition sur l'année
const FILTRES = {
  reseau: ["all"],
  "lignes-travaux": ["all", [">=", ["get", "rangStatut"], 9], ["!", ["get", "doublonReseau"]]],
  "lignes-etudes": ["all", ["<", ["get", "rangStatut"], 9], ["!", ["get", "doublonReseau"]]],
  stations: ["all"],
  "gares-projet": ["all", ["!", ["get", "enService"]]],
  rames: ["all"],
  "velo-compteurs": ["all"],
};

const frise = {
  t: 0, // position continue (année fractionnaire) : l'année affichée en est la partie entière, la caméra suit t
  anneeMin: 0,
  anneeMax: 0,
  anneeAffichee: null,
  enLecture: false,
  raf: null,
  reseau: null,
  lignes: null,
  stations: null,
  garesProjet: null,
};

let rames = null; // installerRames (src/rames.js), après chargement des données

// Année affichée : tronçons mis en service jusqu'à cette année ; en fin de frise, tout est montré (tronçons sans date compris)
function filtrerAnnee(annee) {
  const condition =
    annee >= frise.anneeMax ? true : ["all", ["has", "annee"], ["!=", ["get", "annee"], null], ["<=", ["get", "annee"], annee]];
  for (const [couche, filtre] of Object.entries(FILTRES)) map.setFilter(couche, [...filtre, condition]);
}

// km cumulés en service à une année donnée (superpositions et doublons comptés une fois)
function kmJusqua(annee) {
  const somme = (features, exclus) =>
    features.reduce((s, { properties: p }) => s + (p.annee && p.annee <= annee && !exclus(p) ? p.km : 0), 0);
  return {
    reseau: somme(frise.reseau.features, (p) => p.partage),
    projets: somme(frise.lignes.features, (p) => p.troncCommun || p.doublonReseau),
    // gares ouvertes (une gare desservie par plusieurs lignes comptée une fois)
    gares: new Set(frise.stations.features.filter(({ properties: p }) => p.annee && p.annee <= annee).map(({ properties: p }) => p.idGare)).size,
    // nouvelles gares des projets (hors dessertes nouvelles de gares existantes et arrêts déjà en service)
    garesProjet: frise.garesProjet.features.filter(({ properties: p }) => p.annee && p.annee <= annee && p.nouvelle && !p.enService).length,
  };
}

const formatKm = (km) => Math.round(km).toLocaleString("fr-FR");
const texteKm = (km) =>
  `${formatKm(km.reseau)} km en service · ${formatKm(km.gares)} gares` + (km.projets ? ` · + ${formatKm(km.projets)} km et ${formatKm(km.garesProjet)} gares en projet` : "");
const estFutur = (annee) => annee > new Date().getFullYear();

// Position t -> carte (filtre de l'année, cartouche, curseur) ; la caméra ne suit les ancres que pendant le tournage
// (lecture et boutons de déplacement ne modifient jamais le cadrage)
function afficher(t, { camera = false } = {}) {
  frise.t = Math.min(Math.max(t, frise.anneeMin), frise.anneeMax);
  const annee = Math.floor(frise.t);
  if (annee !== frise.anneeAffichee) {
    frise.anneeAffichee = annee;
    filtrerAnnee(annee);
    const libelle = document.getElementById("cartouche-annee");
    libelle.textContent = annee;
    libelle.classList.toggle("futur", estFutur(annee));
    document.getElementById("cartouche-km").textContent = texteKm(kmJusqua(annee));
    document.getElementById("frise-curseur").value = annee;
  }
  if (camera) appliquerAncres(frise.t);
}

function mettreAJourBoutonLecture() {
  const icone = document.getElementById("play-icon");
  icone.className = `bi ${frise.enLecture ? "bi-pause-fill" : "bi-play-fill"} control-button`;
  icone.title = frise.enLecture ? "Mettre en pause" : "Lancer la construction du réseau";
}

function pause() {
  frise.enLecture = false;
  cancelAnimationFrame(frise.raf);
  mettreAJourBoutonLecture();
}

function animation() {
  if (frise.enLecture) return pause();
  if (frise.t >= frise.anneeMax) afficher(frise.anneeMin);
  frise.enLecture = true;
  mettreAJourBoutonLecture();
  let precedent = performance.now();
  const pas = (maintenant) => {
    afficher(frise.t + (maintenant - precedent) / MS_PAR_ANNEE);
    precedent = maintenant;
    if (frise.t >= frise.anneeMax) return pause();
    frise.raf = requestAnimationFrame(pas);
  };
  frise.raf = requestAnimationFrame(pas);
}

// Déplacements : arrêtent la lecture et se calent sur une année entière
const allerA = (annee) => {
  pause();
  afficher(annee);
};
const reinitialiserAnimation = () => {
  // Rembobiner : état initial (pas encore d'introduction) = vue initiale et première année
  pause();
  afficher(frise.anneeMin);
  map.jumpTo(VUE_INITIALE);
};
const allerAuDebut = () => allerA(frise.anneeMin);
const skipBackward = () => allerA(Math.floor(frise.t) - PAS_RAPIDE);
const anneePrecedente = () => allerA(Math.floor(frise.t) - 1);
const anneeSuivante = () => allerA(Math.floor(frise.t) + 1);
const skipForward = () => allerA(Math.floor(frise.t) + PAS_RAPIDE);
const allerALaFin = () => allerA(frise.anneeMax);

// --- Ancres caméra ---
// Une ancre fixe la vue (centre, zoom, orientation, inclinaison) à une année ; dans la vidéo seulement,
// la caméra passe d'une ancre à l'autre (interpolation linéaire sur t). Sans ancre, la vidéo garde la vue actuelle.
let ancres = chargerAncres();

function chargerAncres() {
  try {
    return JSON.parse(localStorage.getItem(CLE_ANCRES)) ?? [];
  } catch {
    return [];
  }
}

function enregistrerAncres() {
  try {
    localStorage.setItem(CLE_ANCRES, JSON.stringify(ancres));
  } catch {
    // stockage indisponible (navigation privée) : ancres gardées pour la session seulement
  }
}

const interpoler = (a, b, k) => a + (b - a) * k;

function appliquerAncres(t) {
  if (!ancres.length) return;
  // Avant la première ancre / après la dernière : vue de cette ancre ; entre deux : interpolation
  const suivante = ancres.findIndex((a) => a.annee > t);
  const a = ancres[suivante === -1 ? ancres.length - 1 : Math.max(suivante - 1, 0)];
  const b = suivante <= 0 ? a : ancres[suivante];
  const k = b === a ? 0 : (t - a.annee) / (b.annee - a.annee);
  map.jumpTo({
    center: [interpoler(a.centre[0], b.centre[0], k), interpoler(a.centre[1], b.centre[1], k)],
    zoom: interpoler(a.zoom, b.zoom, k),
    bearing: interpoler(a.bearing, b.bearing, k),
    pitch: interpoler(a.pitch, b.pitch, k),
  });
}

// Clic : ancre à l'année affichée (remplacée si elle existe) ; Maj + clic : supprime l'ancre de l'année affichée
function poserAncre(evenement) {
  if (frise.enLecture) return notifier("Ancre : mettre la lecture en pause, cadrer la carte, puis 📌.", true);
  const annee = Math.floor(frise.t);
  ancres = ancres.filter((a) => a.annee !== annee);
  if (evenement?.shiftKey) {
    enregistrerAncres();
    return notifier(`Ancre ${annee} supprimée (${ancres.length} ancre(s)).`);
  }
  const { lng, lat } = map.getCenter();
  ancres.push({ annee, centre: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
  ancres.sort((a, b) => a.annee - b.annee);
  enregistrerAncres();
  notifier(`📌 Ancre ${annee} — zoom ${map.getZoom().toFixed(2)} (${ancres.length} ancre(s) : ${ancres.map((a) => a.annee).join(", ")}), utilisées par la vidéo. Maj + clic pour supprimer.`);
}

// --- Habillage incrusté dans les captures et la vidéo : cartouche année + km (comme à l'écran) ---
function composerImage() {
  const canvas = map.getCanvas();
  const image = document.createElement("canvas");
  image.width = canvas.width;
  image.height = canvas.height;
  const ctx = image.getContext("2d");
  ctx.drawImage(canvas, 0, 0);

  const r = canvas.width / canvas.clientWidth; // densité de pixels
  const annee = frise.anneeAffichee;
  const km = texteKm(kmJusqua(annee));
  ctx.font = `700 ${28 * r}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const largeurAnnee = ctx.measureText(String(annee)).width;
  ctx.font = `${13 * r}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const largeur = Math.max(largeurAnnee, ctx.measureText(km).width) + 28 * r;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.beginPath();
  ctx.roundRect(15 * r, 15 * r, largeur, 62 * r, 8 * r); // cartouche à 15 px des bords (comme #cartouche)
  ctx.fill();
  ctx.fillStyle = "#333";
  ctx.font = `700 ${28 * r}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(String(annee), 29 * r, 47 * r);
  ctx.fillStyle = "#666";
  ctx.font = `${13 * r}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(km, 29 * r, 67 * r);
  return image;
}

async function carteComplete() {
  const idle = new Promise((resolve) => map.once("idle", resolve));
  map.triggerRepaint();
  await idle;
}

const enPng = (image) => new Promise((resolve) => image.toBlob(resolve, "image/png"));

async function capturerImage() {
  await carteComplete();
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(await enPng(composerImage()));
  lien.download = `idf-mobilites_${frise.anneeAffichee}_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  lien.click();
  URL.revokeObjectURL(lien.href);
}

// Tournage image par image de toute la frise : chaque image attend que la carte soit complète, puis est enregistrée
// en PNG dans un dossier choisi (Chrome / Edge : File System Access API). Échap pour interrompre.
async function tournerVideo(ips = IPS_VIDEO) {
  if (!window.showDirectoryPicker) return alert("Tournage : nécessite Chrome ou Edge (enregistrement dans un dossier).");
  let dossier;
  try {
    dossier = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return; // choix du dossier annulé
  }
  pause();

  let interrompu = false;
  const surEchap = (e) => {
    if (e.key === "Escape") interrompu = true;
  };
  document.addEventListener("keydown", surEchap);
  const statut = document.createElement("div");
  statut.className = "statut-tournage";
  document.body.append(statut);

  const total = Math.round(((frise.anneeMax - frise.anneeMin) * MS_PAR_ANNEE * ips) / 1000) + 1;
  const debut = performance.now();
  rames.suspendre(true);
  for (let i = 0; i < total && !interrompu; i++) {
    afficher(frise.anneeMin + (i * 1000) / (ips * MS_PAR_ANNEE), { camera: true });
    rames.placerA((i * 1000) / ips); // temps de l'image : rames fluides dans la vidéo quel que soit le temps de rendu
    await carteComplete();
    const fichier = await dossier.getFileHandle(`image_${String(i + 1).padStart(5, "0")}.png`, { create: true });
    const flux = await fichier.createWritable();
    await flux.write(await enPng(composerImage()));
    await flux.close();
    statut.textContent = `🎬 ${i + 1} / ${total} — ${frise.anneeAffichee} — ${Math.round((performance.now() - debut) / 1000)} s (Échap pour interrompre)`;
  }

  rames.suspendre(false);
  document.removeEventListener("keydown", surEchap);
  statut.remove();
  const commande = `ffmpeg -framerate ${ips} -i image_%05d.png -c:v libx264 -pix_fmt yuv420p idf-mobilites.mp4`;
  console.log(`🎬 Assemblage : ${commande}`);
  notifier(interrompu ? "Tournage interrompu." : `🎬 ${total} images enregistrées. Assemblage : ${commande}`);
}

// --- Recherche d'une ligne : cadrage sur ses tronçons, les autres lignes estompées ---
function cadrer(features) {
  let [ouest, sud, est, nord] = [Infinity, Infinity, -Infinity, -Infinity];
  const parcourir = (c) => {
    if (typeof c[0] === "number") {
      ouest = Math.min(ouest, c[0]);
      est = Math.max(est, c[0]);
      sud = Math.min(sud, c[1]);
      nord = Math.max(nord, c[1]);
    } else c.forEach(parcourir);
  };
  features.forEach((f) => parcourir(f.geometry.coordinates));
  map.fitBounds(
    [
      [ouest, sud],
      [est, nord],
    ],
    { padding: 80, maxZoom: 14 },
  );
}

// Cadrages (barre d'outils) : ne touchent ni à l'année ni aux couches
// Tous les tracés des couches affichées (menu), toutes années confondues
function cadrerTout() {
  const sources = [
    ["reseau", frise.reseau],
    ["lignes-travaux", frise.lignes],
  ].filter(([couche]) => map.getLayoutProperty(couche, "visibility") !== "none");
  const features = sources.flatMap(([, donnees]) => donnees.features);
  if (!features.length) return notifier("Cadrage : aucune couche affichée.", true);
  cadrer(features);
}
const cadrerParis = () => map.fitBounds(EMPRISE_PARIS, { padding: 20 });
const vueInitiale = () => map.flyTo(VUE_INITIALE);

function mettreEnAvant(ligne) {
  const opacite = ligne ? ["case", ["==", ["get", "ligne"], ligne], 1, 0.12] : 1;
  for (const couche of Object.keys(FILTRES)) {
    if (couche === "velo-compteurs") continue; // pas de ligne : non concernée (et garde son opacité propre)
    if (map.getLayer(couche).type === "circle") {
      map.setPaintProperty(couche, "circle-opacity", opacite);
      map.setPaintProperty(couche, "circle-stroke-opacity", opacite);
    } else map.setPaintProperty(couche, "line-opacity", opacite);
  }
}

function choisirLigne({ ligne, features }) {
  pause();
  // Ligne pas encore visible à l'année affichée (projet, ou tronçons plus récents) : fin de frise
  if (!features.some((f) => f.properties.annee && f.properties.annee <= frise.anneeAffichee)) afficher(frise.anneeMax);
  mettreEnAvant(ligne);
  cadrer(features);
}

// --- Graphiques du compteur vélo survolé ou épinglé par un clic (canvas en bas à gauche, src/graphiquesVelo.js) ---
let graphiquesVelo = null;
const afficherGraphiquesVelo = (p) => graphiquesVelo?.afficher(p);

// --- Survol ---
// prioritaires : couches dont le survol l'emporte (une gare posée sur une ligne : seule la bulle de la gare s'affiche)
function installerSurvol(couches, contenu, prioritaires = []) {
  const popup = new Popup({ closeButton: false, closeOnClick: false });
  for (const couche of couches) {
    map.on("mousemove", couche, (e) => {
      const visibles = prioritaires.filter((c) => map.getLayoutProperty(c, "visibility") !== "none");
      if (visibles.length && map.queryRenderedFeatures(e.point, { layers: visibles }).length) return popup.remove();
      map.getCanvas().style.cursor = "pointer";
      popup.setLngLat(e.lngLat).setHTML(contenu(e.features[0].properties)).addTo(map);
    });
    map.on("mouseleave", couche, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
  }
}

// Boutons de la barre d'outils (attributs onclick de index.html)
Object.assign(window, {
  reinitialiserAnimation,
  allerAuDebut,
  skipBackward,
  anneePrecedente,
  animation,
  anneeSuivante,
  skipForward,
  allerALaFin,
  poserAncre,
  tournerVideo,
  capturerImage,
  cadrerTout,
  cadrerParis,
  vueInitiale,
});

map.on("load", async () => {
  const [reseau, lignes, garesProjet, stations, parcours, frequentation, schema, schemaGares, veloCompteurs, multimodal, temperatures, validations, qualiteAir, pollutionLignes, fontaines, scoreEau, accessibiliteGares, ascenseurs, accessibiliteMetro, pointsEau] = await Promise.all(
    [
      "04-reseau.geojson",
      "02-lignes.geojson",
      "03-gares.geojson",
      "05-stations.geojson",
      "06-parcours.geojson",
      "07-frequentation.geojson",
      "08-schema.geojson",
      "08-schema-gares.geojson",
      "10-velo-comptages.geojson", // sites de comptage (09) + comptages des 12 derniers mois
      "11-multimodal-sites.geojson", // sites de comptage multimodal (caméras thermiques)
      "12-temperatures.geojson", // stations Météo-France + séries de températures quotidiennes (membre "series")
      "13-validations.geojson", // validations du réseau ferré, 2e trimestre (membres "debut", "types", "ensemble")
      "14-qualite-air.geojson", // qualité de l'air aux particules sur les quais (Airparif 2024)
      "14-qualite-air-lignes.json", // score de pollution par ligne (0–100)
      "15-fontaines.geojson", // fontaines à eau potable du réseau RATP
      "15-score-eau.geojson", // score eau par station RATP (0–100)
      "16-accessibilite-gares.geojson", // accessibilité des gares RER et Transilien
      "17-ascenseurs.geojson", // ascenseurs par gare (état au dernier relevé)
      "18-accessibilite-metro.geojson", // accessibilité des stations de métro (OSM × référentiel IDFM)
      "19-points-eau.geojson", // points d'eau potable d'Île-de-France (OSM)
    ].map(async (f) => (await fetch(`${DONNEES}/${f}`)).json()),
  );
  map.addSource("reseau", { type: "geojson", data: reseau });
  map.addSource("lignes", { type: "geojson", data: lignes });
  map.addSource("stations", { type: "geojson", data: stations });
  map.addSource("gares-projet", { type: "geojson", data: garesProjet });
  map.addSource("frequentation", { type: "geojson", data: frequentation });
  map.addSource("schema", { type: "geojson", data: schema });
  map.addSource("schema-gares", { type: "geojson", data: schemaGares });
  map.addSource("velo-compteurs", { type: "geojson", data: veloCompteurs });
  map.addSource("multimodal", { type: "geojson", data: multimodal });
  map.addSource("temperatures", { type: "geojson", data: temperatures });
  map.addSource("validations", { type: "geojson", data: validations });
  map.addSource("qualite-air", { type: "geojson", data: qualiteAir });
  map.addSource("fontaines", { type: "geojson", data: fontaines });
  map.addSource("score-eau", { type: "geojson", data: scoreEau });
  map.addSource("accessibilite-gares", { type: "geojson", data: accessibiliteGares });
  map.addSource("ascenseurs", { type: "geojson", data: ascenseurs });
  // attribution OSM affichée quand la couche est visible (licence ODbL)
  map.addSource("accessibilite-metro", { type: "geojson", data: accessibiliteMetro, attribution: "© les contributeurs d'OpenStreetMap" });
  map.addSource("points-eau", { type: "geojson", data: pointsEau, attribution: "© les contributeurs d'OpenStreetMap" });
  map.addSource("rames", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  const layout = { "line-cap": "round", "line-join": "round" };

  // Réseau en service : couleurs officielles IDFM (gris neutre pour les tronçons sans couleur, TER surtout)
  map.addLayer({
    id: "reseau",
    type: "line",
    source: "reseau",
    layout,
    paint: {
      "line-color": ["get", "couleur"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.2, 13, 3.5],
    },
  });

  // Climatisation du métro (référentiel des lignes IDFM, propriété climatisation de 04-reseau) : bleu climatisé,
  // bleu pâle partiellement, orange-rouge non climatisé, gris inconnu ; trait plus épais que le réseau, hors frise
  map.addLayer({
    id: "metro-climatisation",
    type: "line",
    source: "reseau",
    filter: ["==", ["get", "mode"], "métro"],
    layout: { ...layout, visibility: "none" },
    paint: {
      "line-color": ["match", ["get", "climatisation"], "oui", "#1f5fa8", "partiel", "#8fb8e8", "non", "#e8502a", "#9b9b9b"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 13, 5],
    },
  });

  // Projets : travaux (rang 9) en trait plein ; études, DUP, AVP en pointillés (line-dasharray non piloté par les données en v2 -> 2 couches)
  const trait = {
    "line-color": ["get", "couleur"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 13, 5],
  };
  map.addLayer({ id: "lignes-travaux", type: "line", source: "lignes", layout, paint: trait });
  map.addLayer({
    id: "lignes-etudes",
    type: "line",
    source: "lignes",
    layout: { "line-join": "round" },
    paint: { ...trait, "line-dasharray": [2, 1.5] },
  });

  // Gares et stations (un point par gare et par ligne) : cercle blanc cerclé de la couleur de la ligne,
  // plus grand pour les terminus et les gares principales
  // (MapLibre impose l'interpolation sur le zoom au premier niveau : le « case » terminus / principale est dans chaque palier)
  const grosse = ["any", ["get", "terminus"], ["get", "principale"]];
  const palier = (base) => ["case", grosse, base * 1.45, base];
  map.addLayer({
    id: "stations",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, palier(1.1), 12, palier(2.75), 15, palier(5.5)],
      "circle-color": "#ffffff",
      "circle-stroke-color": ["get", "couleur"],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 2],
    },
  });

  // Gares des projets : inverse des gares en service (pastille pleine de la couleur de la ligne, cerclée de blanc),
  // plus grande pour les terminus ; arrêts déjà desservis par la ligne en service masqués (filtre de base)
  const palierProjet = (base) => ["case", ["get", "terminus"], base * 1.45, base];
  map.addLayer({
    id: "gares-projet",
    type: "circle",
    source: "gares-projet",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, palierProjet(1.6), 12, palierProjet(3.2), 15, palierProjet(6)],
      "circle-color": ["get", "couleur"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 14, 1.5],
    },
  });

  // Plan schématique IDFM (recalé sur l'Île-de-France, sans valeur géographique ; hors frise) : masqué au chargement
  map.addLayer({
    id: "schema",
    type: "line",
    source: "schema",
    layout: { ...layout, visibility: "none" },
    paint: {
      "line-color": ["get", "couleur"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 13, 5],
    },
  });

  // Gares du plan schématique : même dessin que les gares en service (cercle blanc cerclé de la couleur de la ligne)
  map.addLayer({
    id: "schema-gares",
    type: "circle",
    source: "schema-gares",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["get", "terminus"], 1.8, 1.3], 12, ["case", ["get", "terminus"], 4.3, 3], 15, ["case", ["get", "terminus"], 8, 5.5]],
      "circle-color": "#ffffff",
      "circle-stroke-color": ["get", "couleur"],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 2],
    },
  });

  // Fréquentation des gares (données 2024 SNCF / 2021 RATP, hors frise) : cercles proportionnels (surface ∝ voyageurs),
  // masquée au chargement ; SNCF et RATP en deux bleus (mesures non comparables : montants + descendants / entrants)
  // rayon = facteur(zoom) × √voyageurs, au moins 1,5 px ; grosses gares dessinées en premier (ordre du fichier)
  const rayonFrequentation = (facteur) => ["max", 1.5, ["*", facteur, ["sqrt", ["get", "voyageurs"]]]];
  map.addLayer({
    id: "frequentation",
    type: "circle",
    source: "frequentation",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 9, rayonFrequentation(0.0016), 12, rayonFrequentation(0.0045), 15, rayonFrequentation(0.012)],
      "circle-color": ["match", ["get", "exploitant"], "RATP", "#3c91dc", "#0d264b"],
      "circle-opacity": 0.45,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 0.8,
    },
  });

  // Sites de comptage vélo (Ville de Paris) : cercles proportionnels au trafic quotidien moyen des 12 derniers mois
  // (surface ∝ passages / jour, deux sens), vert cerclé de blanc ; apparaissent dans la frise à leur installation
  const rayonVelo = (facteur) => ["max", 3, ["*", facteur, ["sqrt", ["get", "moyenneJour"]]]];
  map.addLayer({
    id: "velo-compteurs",
    type: "circle",
    source: "velo-compteurs",
    paint: {
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 9, rayonVelo(0.06), 12, rayonVelo(0.17), 15, rayonVelo(0.45)],
      "circle-color": "#1b8a3a",
      "circle-opacity": 0.6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });

  // Sites de comptage multimodal (Ville de Paris, caméras thermiques) : simple localisation, point violet cerclé de blanc
  map.addLayer({
    id: "multimodal",
    type: "circle",
    source: "multimodal",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 5, 15, 8],
      "circle-color": "#7b3fa0",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  // Stations de température Météo-France : disque orange (station de référence Montsouris un peu plus grande)
  map.addLayer({
    id: "temperatures",
    type: "circle",
    source: "temperatures",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 12, 7, 15, 10],
      "circle-color": "#e07b39",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["case", ["==", ["get", "nom"], "PARIS-MONTSOURIS"], 3, 1.5],
    },
  });

  // Validations du réseau ferré (IDFM) : cercles proportionnels aux validations d'un jour ouvré hors vacances
  // (surface ∝ validations / jour), bleu cerclé de blanc
  const rayonValidations = (facteur) => ["max", 2, ["*", facteur, ["sqrt", ["get", "moyenneJOHV"]]]];
  map.addLayer({
    id: "validations",
    type: "circle",
    source: "validations",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 9, rayonValidations(0.012), 12, rayonValidations(0.034), 15, rayonValidations(0.09)],
      "circle-color": "#1f5fa8",
      "circle-opacity": 0.6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });

  // Score de pollution aux particules par ligne (14-qualite-air-lignes.json, 0–100 : 0 tous les quais souterrains faibles,
  // 50 tous moyens, 100 tous élevés) : tronçons de métro et de RER colorés du vert au rouge, gris sans score
  // lignes à moins de 3 quais évalués (L, U : un seul quai sur toute la ligne) écartées : score non représentatif
  scoresPollution = new globalThis.Map(pollutionLignes.filter((l) => l.score != null && l.evalues >= 3).map((l) => [l.ligne, l]));
  map.addLayer({
    id: "pollution-lignes",
    type: "line",
    source: "reseau",
    filter: ["in", ["get", "ligne"], ["literal", [...scoresPollution.keys()]]],
    layout: { ...layout, visibility: "none" },
    paint: {
      "line-color": [
        "interpolate", ["linear"],
        ["match", ["get", "ligne"], ...[...scoresPollution].flatMap(([l, { score }]) => [l, score]), -1],
        -1, "#9b9b9b", 0, "#3a9a4a", 25, "#a8c43c", 40, "#f0a030", 50, "#e8502a", 60, "#b71c1c",
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 13, 5],
    },
  });

  // Qualité de l'air sur les quais (Airparif 2024) : rouge élevée, orange moyenne, vert faible, gris clair station aérienne,
  // blanc pas de données ; cerclé de noir si une surveillance est recommandée ; quais pollués dessinés au-dessus (rang)
  map.addLayer({
    id: "qualite-air",
    type: "circle",
    source: "qualite-air",
    layout: { visibility: "none", "circle-sort-key": ["get", "rang"] },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["match", ["get", "niveau"], "aérienne", 1.5, 3], 12, ["match", ["get", "niveau"], "aérienne", 3, 6], 15, ["match", ["get", "niveau"], "aérienne", 5, 10]],
      "circle-color": ["match", ["get", "niveau"], "élevée", "#c62828", "moyenne", "#f0a030", "faible", "#3a9a4a", "aérienne", "#c8c8c8", "#ffffff"],
      "circle-stroke-color": ["case", ["get", "surveillance"], "#000000", ["==", ["get", "niveau"], "inconnu"], "#777777", "#ffffff"],
      "circle-stroke-width": ["case", ["get", "surveillance"], 2, 1],
    },
  });

  // Score eau par station RATP (étape 15, binaire) : bleu foncé station équipée d'une fontaine (100), orange-rouge sans (0)
  map.addLayer({
    id: "score-eau",
    type: "circle",
    source: "score-eau",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 5.5, 15, 9],
      "circle-color": ["case", [">", ["get", "score"], 0], "#0d3f66", "#d9603b"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });

  // Accessibilité des gares RER et Transilien (IDFM) : vert autonomie, vert-jaune sur demande à un agent, orange sur
  // réservation préalable, rouge non accessible
  map.addLayer({
    id: "accessibilite-gares",
    type: "circle",
    source: "accessibilite-gares",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 5.5, 15, 9],
      "circle-color": ["match", ["get", "niveau"], 6, "#2e8b3e", 5, "#7cb342", 4, "#b5c335", 3, "#f0a030", 2, "#f0a030", 1, "#d9363e", "#9b9b9b"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });

  // Accessibilité en fauteuil des stations de métro (étape 18, OSM × référentiel IDFM) : vert accord « accessible »,
  // vert-jaune partiel, violet sources contradictoires, rouge accord « non accessible », teinte pâle si une seule source
  map.addLayer({
    id: "accessibilite-metro",
    type: "circle",
    source: "accessibilite-metro",
    layout: { visibility: "none", "circle-sort-key": ["match", ["get", "statut"], "non accessible", 0, "une source", 1, "inconnu", 1, 2] },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 5.5, 15, 9],
      "circle-color": [
        "match", ["get", "statut"],
        "accessible", "#2e8b3e",
        "partiel", "#b5c335",
        "à vérifier", "#8e44ad",
        "non accessible", "#d9363e",
        "une source", ["match", ["get", "valeurUnique"], "oui", "#9fd3a8", "partiel", "#dfe6a0", "#f2a6a9"],
        "#c8c8c8",
      ],
      "circle-stroke-color": ["case", [">", ["get", "ascenseursMetro"], 0], "#3d1a54", "#ffffff"],
      "circle-stroke-width": ["case", [">", ["get", "ascenseursMetro"], 0], 2, 1],
    },
  });

  // Ascenseurs par gare (IDFM) : violet, surface ∝ nombre d'ascenseurs ; l'état (instantané, date du relevé) est dans
  // l'infobulle, pas dans la couleur (export pris de nuit : ascenseurs RATP indisponibles, stations fermées)
  map.addLayer({
    id: "ascenseurs",
    type: "circle",
    source: "ascenseurs",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["*", 1.6, ["sqrt", ["get", "ascenseurs"]]], 12, ["*", 3.2, ["sqrt", ["get", "ascenseurs"]]], 15, ["*", 6, ["sqrt", ["get", "ascenseurs"]]]],
      "circle-color": "#7b3fa0",
      "circle-opacity": 0.75,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });

  // Points d'eau potable (OSM) : petit point turquoise, vert sombre pour les fontaines Wallace ; sous les fontaines RATP
  map.addLayer({
    id: "points-eau",
    type: "circle",
    source: "points-eau",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 12, 3, 15, 6],
      "circle-color": ["match", ["get", "type"], "wallace", "#1f5e4a", "robinet", "#4a90c2", "borne", "#00a3a3", "#17b3c9"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 14, 1],
    },
  });

  // Fontaines à eau du réseau RATP : goutte bleu clair cerclée de blanc, cerclée de bleu foncé en zone contrôlée
  map.addLayer({
    id: "fontaines",
    type: "circle",
    source: "fontaines",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 12, 4.5, 15, 8],
      "circle-color": "#29a3d6",
      "circle-stroke-color": ["case", ["==", ["get", "zoneControlee"], true], "#0d3f66", "#ffffff"],
      "circle-stroke-width": ["case", ["==", ["get", "zoneControlee"], true], 2.5, 1.5],
    },
  });

  // Rames de métro (au-dessus de tout) : pastille de la couleur de la ligne cerclée de blanc, plus grosse que les gares
  map.addLayer({
    id: "rames",
    type: "circle",
    source: "rames",
    layout: { visibility: "none" }, // décochée au chargement (l'animation ne tourne que si la couche est affichée)
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 5, 15, 8],
      "circle-color": ["get", "couleur"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 2],
    },
  });
  rames = installerRames(map, parcours);

  map.addControl(
    new MenuCouches([
      { libelle: "Réseau en service", couches: ["reseau"] },
      { libelle: "Gares et stations", couches: ["stations"] },
      { libelle: "Lignes en projet", couches: ["lignes-travaux", "lignes-etudes"] },
      { libelle: "Gares et stations en projet", couches: ["gares-projet"] },
      { libelle: "Rames de métro", couches: ["rames"] },
      { libelle: "Fréquentation des gares", couches: ["frequentation"] },
      { libelle: "Plan schématique", couches: ["schema", "schema-gares"] },
      { libelle: "Climatisation du métro", couches: ["metro-climatisation"] },
      { libelle: "Qualité de l'air (quais)", couches: ["qualite-air"] },
      { libelle: "Pollution par ligne (score)", couches: ["pollution-lignes"] },
      { libelle: "Fontaines à eau (RATP)", couches: ["fontaines"] },
      { libelle: "Points d'eau potable (OSM)", couches: ["points-eau"] },
      { libelle: "Score eau par station", couches: ["score-eau"] },
      { libelle: "Accessibilité des gares (RER, Transilien)", couches: ["accessibilite-gares"] },
      { libelle: "Ascenseurs", couches: ["ascenseurs"] },
      { libelle: "Accessibilité du métro (OSM × IDFM)", couches: ["accessibilite-metro"] },
      { libelle: "Compteurs vélo", couches: ["velo-compteurs"] },
      { libelle: "Comptage multimodal", couches: ["multimodal"] },
      { libelle: "Températures", couches: ["temperatures"] },
      { libelle: "Validations (2e trim. 2026)", couches: ["validations"] },
    ]),
    "top-right",
  );

  installerSurvol(
    ["lignes-travaux", "lignes-etudes"],
    (p) =>
      `<strong style="color:${p.couleur}">${p.ligne}</strong> · ${p.operation}<br>` +
      `${p.type} · ${p.statut}<br>Mise en service : ${p.dateOfficielle}${p.precision === "nc" && p.annee ? ` (estimée ${p.annee})` : ""}`,
    ["stations", "gares-projet"],
  );
  const NIVEAUX_AIR = {
    élevée: "pollution aux particules élevée",
    moyenne: "pollution aux particules moyenne",
    faible: "pollution aux particules faible",
    aérienne: "station aérienne, proche de l'air extérieur",
    inconnu: "pas de données",
  };
  const VALEUR_ACCES = { oui: "accessible", partiel: "partiellement accessible", non: "non accessible" };
  installerSurvol(
    ["accessibilite-metro"],
    (p) =>
      `<strong>${p.nom}</strong> · ${p.lignes}<br>` +
      `<strong>${p.statut === "une source" ? `${VALEUR_ACCES[p.valeurUnique]} (une seule source)` : p.statut}</strong> en fauteuil roulant<br>` +
      `<span style="color:#666">` +
      `OpenStreetMap : ${VALEUR_ACCES[p.osm] ?? "non renseigné"}${p.osmVerifie ? ` (vérifié le ${new Date(p.osmVerifie).toLocaleDateString("fr-FR")})` : ""}<br>` +
      `référentiel des arrêts IDFM : ${VALEUR_ACCES[p.idfm] ?? "non renseigné"}<br>` +
      `${p.ascenseursMetro ? `${p.ascenseursMetro} ascenseur${p.ascenseursMetro > 1 ? "s" : ""} côté métro (IDFM)` : "aucun ascenseur métro recensé"}` +
      `${p.bouches ? ` · ${p.bouchesAccessibles} bouche${p.bouchesAccessibles > 1 ? "s" : ""} accessible${p.bouchesAccessibles > 1 ? "s" : ""} sur ${p.bouches} (OSM)` : ""}</span>`,
    ["rames"],
  );
  installerSurvol(
    ["ascenseurs"],
    (p) => {
      const date = (d) => (d ? new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "?");
      const liste = p.liste.split("¶").slice(0, 6).map((a) => {
        const [mode, etat, quand, direction] = a.split("|");
        const couleur = { disponible: "#2e8b3e", indisponible: "#d9363e" }[etat] ?? "#888";
        return `<span style="color:${couleur}">●</span> ${mode} · ${direction || "—"} <span style="color:#888">(${etat}, ${date(quand)})</span>`;
      });
      return (
        `<strong>${p.nom}</strong>${p.lignes ? ` · ${p.lignes}` : ""}<br>` +
        `<strong>${p.ascenseurs}</strong> ascenseur${p.ascenseurs > 1 ? "s" : ""} (${p.modes}) · ${p.exploitants}<br>` +
        `<span style="color:#666">au dernier relevé : ${p.disponibles} disponible${p.disponibles > 1 ? "s" : ""}, ${p.indisponibles} indisponible${p.indisponibles > 1 ? "s" : ""}${p.inconnus ? `, ${p.inconnus} inconnu${p.inconnus > 1 ? "s" : ""}` : ""}</span><br>` +
        `<span style="font-size:11px">${liste.join("<br>")}${p.ascenseurs > 6 ? `<br>… et ${p.ascenseurs - 6} autres` : ""}</span>`
      );
    },
    ["rames"],
  );
  installerSurvol(
    ["accessibilite-gares"],
    (p) =>
      `<strong>${p.nom}</strong>${p.lignes ? ` · ${p.lignes}` : ""}<br>` +
      `${p.libelle}` +
      (p.commentaire ? `<br><span style="color:#666">${p.commentaire}</span>` : ""),
    ["rames"],
  );
  installerSurvol(
    ["score-eau"],
    (p) =>
      `<strong>${p.nom}</strong> · ${p.lignes}<br>` +
      `score eau : <strong>${p.score}</strong>/100<br>` +
      `<span style="color:#666">${
        p.fontaines
          ? `${p.fontaines} fontaine${p.fontaines > 1 ? "s" : ""} dans la station${p.zoneControlee ? ` (dont ${p.zoneControlee} en zone contrôlée)` : ""}`
          : "pas de fontaine dans la station"
      }</span>`,
    ["rames", "fontaines"],
  );
  const TYPES_EAU = { wallace: "Fontaine Wallace", fontaine: "Fontaine à boire", robinet: "Robinet d'eau potable", borne: "Borne de remplissage" };
  installerSurvol(
    ["points-eau"],
    (p) =>
      `<strong>${TYPES_EAU[p.type]}</strong>${p.nom ? ` · ${p.nom}` : ""}<br>` +
      `<span style="color:#666">${[
        p.operateur,
        p.saisonnier && "saisonnier (coupé l'hiver)",
        p.bouteille && "remplissage de bouteille",
        p.fauteuil === "yes" && "accessible en fauteuil",
        p.clients && "réservé aux clients",
        p.description,
      ].filter(Boolean).join(" · ") || "OpenStreetMap"}</span>`,
    ["rames", "fontaines"],
  );
  installerSurvol(
    ["fontaines"],
    (p) =>
      `<strong>Fontaine à eau</strong> · ${p.gare} · <span style="color:${p.couleur}">●</span> ${p.ligne}<br>` +
      `${p.zoneControlee ? "en zone contrôlée (après les valideurs)" : "zone contrôlée : non précisé"}${p.acces ? `<br>près de l'accès ${p.acces}` : ""}<br>` +
      `<span style="color:#666">${p.adresse} · position approximative (RATP)</span>`,
    ["rames"],
  );
  installerSurvol(
    ["pollution-lignes"],
    (p) => `<strong style="color:${p.couleur}">${p.ligne}</strong> · score de pollution par ligne` + scorePollution(p.ligne),
    ["stations", "gares-projet", "rames", "qualite-air"],
  );
  installerSurvol(
    ["qualite-air"],
    (p) =>
      `<strong>${p.nom}</strong> · <span style="color:${p.couleur}">●</span> ${p.ligne}<br>` +
      `${NIVEAUX_AIR[p.niveau]}${p.incertitude ? ` (incertitude ${p.incertitude})` : ""}<br>` +
      `<span style="color:#666">${[p.evaluation && `évaluation : ${p.evaluation}`, p.surveillance && "surveillance recommandée", p.actions && "actions d'amélioration en cours"].filter(Boolean).join("<br>")}</span>`,
    ["rames"],
  );
  const CLIMATISATION = { oui: "climatisée", partiel: "partiellement climatisée", non: "non climatisée" };
  installerSurvol(
    ["metro-climatisation"],
    (p) => `<strong style="color:${p.couleur}">${p.ligne}</strong> · ${CLIMATISATION[p.climatisation] ?? "climatisation inconnue"}<br><span style="color:#666">référentiel des lignes IDFM</span>` + scorePollution(p.ligne),
    ["stations", "gares-projet", "rames"],
  );
  installerSurvol(
    ["reseau"],
    (p) =>
      `<strong style="color:${p.couleur}">${p.ligne}</strong> · ${p.sousMode} · ${p.exploitant}<br>` +
      `Tronçon en service depuis ${p.date ? new Date(p.date).toLocaleDateString("fr-FR") : "date inconnue"}` +
      servicesLigne(p) +
      scorePollution(p.ligne),
    ["stations", "gares-projet", "metro-climatisation", "pollution-lignes"], // couche climatisation affichée : sa bulle l'emporte
  );

  installerSurvol(
    ["stations"],
    (p) =>
      `<strong>${p.nom}</strong>${p.terminus ? " · terminus " + p.ligne : ""}<br>` +
      `${p.lignesGare}<br>` +
      `<span style="color:${p.couleur}">●</span> ${p.ligne} depuis ${p.date ? new Date(p.date).toLocaleDateString("fr-FR") : "date inconnue"}` +
      servicesLigne(p),
    ["gares-projet"],
  );
  installerSurvol(
    ["schema"],
    (p) =>
      `<strong style="color:${p.couleur}">${p.ligne ?? "Ligne non identifiée"}</strong> · plan schématique IDFM<br>` +
      (p.identification === "position" ? "ligne identifiée par sa position (sans code dans le plan)<br>" : "") +
      (p.ecart != null ? `<span style="color:#666">décalage moyen avec le tracé réel : ${p.ecart.toLocaleString("fr-FR")} km</span>` : ""),
    ["stations", "gares-projet", "rames", "frequentation", "schema-gares"],
  );
  installerSurvol(
    ["schema-gares"],
    (p) =>
      `<strong>${p.nom}</strong>${p.terminus ? " · terminus" : ""}<br>` +
      `<span style="color:${p.couleur}">●</span> ${p.ligne} · plan schématique IDFM<br>` +
      (p.ecart != null ? `<span style="color:#666">à ${p.ecart.toLocaleString("fr-FR")} km de sa position réelle</span>` : ""),
    ["stations", "gares-projet", "rames"],
  );
  installerSurvol(
    ["velo-compteurs"],
    (p) =>
      `<strong>${p.nom}</strong><br>` +
      `<strong>${p.moyenneJour.toLocaleString("fr-FR")}</strong> vélos par jour en moyenne · ${p.compteurs > 1 ? "deux sens" : "un sens"} (${p.sens})<br>` +
      `<span style="color:#666">${p.periode}${p.couverture < 90 ? ` · données sur ${p.couverture} % des heures` : ""} · installé le ${p.date ? new Date(p.date).toLocaleDateString("fr-FR") : "?"}</span>` +
      (p.photo ? `<img src="${p.photo}" alt="" style="display:block;width:254px;margin-top:6px;border-radius:4px">` : ""),
    ["rames"],
  );
  // Survol : graphiques du site survolé ; clic : graphiques épinglés (persistants), site cerclé de bleu profond.
  // Re-clic sur le site épinglé ou clic ailleurs sur la carte : désépinglage.
  // Sans site survolé ni épinglé : graphiques de l'ensemble des sites (veloCompteurs.ensemble, étape 10), couche affichée
  let veloEpingle = null;
  const veloParDefaut = () =>
    veloEpingle ?? (map.getLayoutProperty("velo-compteurs", "visibility") !== "none" ? veloCompteurs.ensemble ?? null : null);
  graphiquesVelo = creerGraphiquesVelo(document.getElementById("graphiques-velo"), (idSite) => `${DONNEES}/10-velo-jours/${idSite}.json`);
  const marquerEpingle = () => {
    const id = veloEpingle?.idSite ?? -1;
    map.setPaintProperty("velo-compteurs", "circle-stroke-color", ["case", ["==", ["get", "idSite"], id], "#0d264b", "#ffffff"]);
    map.setPaintProperty("velo-compteurs", "circle-stroke-width", ["case", ["==", ["get", "idSite"], id], 3, 1]);
  };
  map.on("mousemove", "velo-compteurs", (e) => afficherGraphiquesVelo(e.features[0].properties));
  map.on("mouseleave", "velo-compteurs", () => afficherGraphiquesVelo(veloParDefaut()));
  map.on("visibilitecouches", () => {
    if (map.getLayoutProperty("velo-compteurs", "visibility") === "none" && veloEpingle) (veloEpingle = null), marquerEpingle();
    afficherGraphiquesVelo(veloParDefaut());
  });
  map.on("click", (e) => {
    const visible = map.getLayoutProperty("velo-compteurs", "visibility") !== "none";
    const site = visible ? map.queryRenderedFeatures(e.point, { layers: ["velo-compteurs"] })[0]?.properties : null;
    veloEpingle = site && site.idSite !== veloEpingle?.idSite ? site : null;
    marquerEpingle();
    afficherGraphiquesVelo(site ? veloEpingle ?? site : veloParDefaut());
  });
  afficherGraphiquesVelo(veloParDefaut());
  // Températures : encadré de la station survolée ; clic : station épinglée (cerclée de brun) ; par défaut Paris-Montsouris
  installerSurvol(
    ["temperatures"],
    (p) => `<strong>${p.libelle}</strong> · station Météo-France ${p.numero}<br>altitude ${p.altitude} m · moyenne ${p.moyenne.toLocaleString("fr-FR")} °C sur 12 mois`,
    ["rames"],
  );
  const graphiquesTemperatures = creerGraphiquesTemperatures(document.getElementById("graphiques-temperatures"), `${DONNEES}/12-temperatures-heures.json`);
  const stationsTemperature = temperatures.features.map((f) => f.properties);
  let temperatureEpinglee = null;
  const temperatureParDefaut = () =>
    map.getLayoutProperty("temperatures", "visibility") === "none"
      ? null
      : (temperatureEpinglee ?? stationsTemperature.find((p) => p.nom === "PARIS-MONTSOURIS"));
  const afficherTemperatures = (p) => graphiquesTemperatures.afficher(p, p && temperatures.series[p.nom]);
  map.on("mousemove", "temperatures", (e) => afficherTemperatures(e.features[0].properties));
  map.on("mouseleave", "temperatures", () => afficherTemperatures(temperatureParDefaut()));
  map.on("click", (e) => {
    const visible = map.getLayoutProperty("temperatures", "visibility") !== "none";
    const station = visible ? map.queryRenderedFeatures(e.point, { layers: ["temperatures"] })[0]?.properties : null;
    temperatureEpinglee = station && station.nom !== temperatureEpinglee?.nom ? station : null;
    map.setPaintProperty("temperatures", "circle-stroke-color", ["case", ["==", ["get", "nom"], temperatureEpinglee?.nom ?? ""], "#7a3a10", "#ffffff"]);
    afficherTemperatures(station ? (temperatureEpinglee ?? station) : temperatureParDefaut());
  });
  map.on("visibilitecouches", () => afficherTemperatures(temperatureParDefaut()));

  // Validations : encadré de la gare survolée ; clic : gare épinglée (cerclée de bleu nuit) ; par défaut l'ensemble des gares
  installerSurvol(
    ["validations"],
    (p) => {
      const titres = p.titres.split("|").map((t) => t.split(":")).map(([t, n]) => [t, Number(n)]);
      const total = titres.reduce((a, [, n]) => a + n, 0) || 1;
      return (
        `<strong>${p.nom}</strong>${p.lignes ? ` · ${p.lignes}` : ""}<br>` +
        `<strong>${p.moyenneJOHV.toLocaleString("fr-FR")}</strong> validations par ${LIBELLES_TYPES.JOHV} · pointe ${p.pointe} h – ${p.pointe + 1} h<br>` +
        `<span style="color:#666">${titres.slice(0, 3).map(([t, n]) => `${t} ${Math.round((n / total) * 100)} %`).join(" · ")}<br>entrées, ${p.periode}</span>`
      );
    },
    ["rames"],
  );
  const graphiquesValidations = creerGraphiquesValidations(document.getElementById("graphiques-validations"), validations);
  let validationEpinglee = null;
  const validationParDefaut = () =>
    map.getLayoutProperty("validations", "visibility") === "none" ? null : (validationEpinglee ?? validations.ensemble);
  map.on("mousemove", "validations", (e) => graphiquesValidations.afficher(e.features[0].properties));
  map.on("mouseleave", "validations", () => graphiquesValidations.afficher(validationParDefaut()));
  map.on("click", (e) => {
    const visible = map.getLayoutProperty("validations", "visibility") !== "none";
    const gare = visible ? map.queryRenderedFeatures(e.point, { layers: ["validations"] })[0]?.properties : null;
    validationEpinglee = gare && gare.id !== validationEpinglee?.id ? gare : null;
    const id = validationEpinglee?.id ?? "";
    map.setPaintProperty("validations", "circle-stroke-color", ["case", ["==", ["get", "id"], id], "#0d2f5c", "#ffffff"]);
    map.setPaintProperty("validations", "circle-stroke-width", ["case", ["==", ["get", "id"], id], 3, 1]);
    graphiquesValidations.afficher(gare ? (validationEpinglee ?? gare) : validationParDefaut());
  });
  map.on("visibilitecouches", () => {
    if (map.getLayoutProperty("validations", "visibility") === "none") validationEpinglee = null;
    graphiquesValidations.afficher(validationParDefaut());
  });

  installerSurvol(
    ["multimodal"],
    (p) =>
      `<strong>${p.nom}</strong>${p.code ? ` · ${p.code}` : ""}<br>` +
      `Comptage multimodal (caméra thermique)<br>` +
      `<span style="color:#666">${p.modes.split("|").slice(0, 4).map((m) => m.split(":")[0]).join(", ")}…</span>`,
    ["rames"],
  );
  installerSurvol(["frequentation"], (p) => {
    const millions = p.voyageurs >= 1e6;
    const nombre = millions
      ? `${(p.voyageurs / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} million${p.voyageurs >= 2e6 ? "s" : ""}`
      : p.voyageurs.toLocaleString("fr-FR");
    return (
      `<strong>${p.nom}</strong> · ${p.exploitant}<br>` +
      `${nombre}${millions ? " de" : ""} ${p.mesure} en ${p.anneeSource}<br>` +
      `<span style="color:#666">${p.interet}${p.lignesGare ? ` · ${p.lignesGare}` : ""}</span>`
    );
  }, ["stations", "gares-projet", "rames"]); // au centre du cercle, la bulle de la gare l'emporte
  installerSurvol(["gares-projet"], (p) => {
    const nature = [p.nouvelle ? "nouvelle gare" : "nouvelle desserte", p.terminus && "terminus", p.correspondance && "correspondance"];
    return (
      `<strong>${p.nom ?? "Arrêt"}</strong> · <span style="color:${p.couleur}">●</span> ${p.ligne}<br>` +
      `${nature.filter(Boolean).join(" · ")} · ${p.statut}<br>` +
      `${p.operation}<br>Mise en service : ${p.dateOfficielle ?? "non communiquée"}${p.precision === "nc" && p.annee ? ` (estimée ${p.annee})` : ""}`
    );
  });

  // Frise
  Object.assign(frise, { reseau, lignes, stations, garesProjet });
  const annees = [...reseau.features, ...lignes.features].map((f) => f.properties.annee).filter(Boolean);
  frise.anneeMin = Math.min(...annees);
  frise.anneeMax = Math.max(...annees);
  const curseur = document.getElementById("frise-curseur");
  curseur.min = frise.anneeMin;
  curseur.max = frise.anneeMax;
  document.getElementById("frise-debut").textContent = frise.anneeMin;
  document.getElementById("frise-fin").textContent = frise.anneeMax;
  curseur.addEventListener("input", () => allerA(Number(curseur.value)));
  afficher(frise.anneeMax); // carte statique complète au chargement

  installerRechercheLignes(
    document.getElementById("recherche-ligne"),
    reseau.features,
    lignes.features,
    choisirLigne,
    () => mettreEnAvant(null),
  );
});
