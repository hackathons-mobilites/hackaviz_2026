// Animation de la ligne 7 (index-l7.html) : une rame part de La Courneuve, la ligne se dessine derrière elle ; à chaque
// station, arrêt bref et indication de l'eau (fontaine RATP dans la station) et de la qualité de l'air sur le quai.
// Puis la branche de Mairie d'Ivry, depuis sa jonction. Page légère : MapLibre seul, données préparées par l'étape 20
// (pipeline/20-ligne7.json : tracés orientés, km cumulés, stations dans l'ordre avec eau et air).
import { Map, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Credits } from "./creditsCarte.js";

const DONNEES = "./idf-mobilites/pipeline/20-ligne7.json";
const STYLE = "https://openmaptiles.data.gouv.fr/styles/positron/style.json";
const KM_PAR_SECONDE = 0.55; // vitesse de la rame à × 1 (≈ 36 s pour le tronc)
const ARRET_MS = 1100; // arrêt en station
const PAUSE_BRANCHE_MS = 1500; // avant de repartir sur la branche
const COULEURS_AIR = { élevée: "#c62828", moyenne: "#f0a030", faible: "#3a9a4a", aérienne: "#c8c8c8", inconnu: "#ffffff" };
const LIBELLES_AIR = {
  élevée: "Pollution aux particules élevée",
  moyenne: "Pollution aux particules moyenne",
  faible: "Pollution aux particules faible",
  aérienne: "Station aérienne, proche de l’air extérieur",
  inconnu: "Qualité de l’air : pas de données",
};

const $ = (s) => document.querySelector(s);
// attribution native désactivée : crédits recodés (Credits, creditsCarte.js)
const map = new Map({ container: "mapContainer", style: STYLE, center: [2.36, 48.86], zoom: 11, attributionControl: false });

map.addControl(new Credits(), "bottom-right");

// point situé à km le long d'un tracé (coords + km cumulés) ; i : index du segment, pour reprendre la recherche
function pointA(branche, km, depuis = 0) {
  const { coords, km: cumul } = branche;
  let i = depuis;
  while (i < cumul.length - 2 && cumul[i + 1] < km) i++;
  const t = Math.min(1, Math.max(0, (km - cumul[i]) / (cumul[i + 1] - cumul[i] || 1)));
  const [a, b] = [coords[i], coords[i + 1]];
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], i };
}

map.on("load", async () => {
  // fond de carte sans aucun nom (rues, quartiers, communes, stations…) : couches de texte et d'icônes du style masquées
  for (const couche of map.getStyle().layers) if (couche.type === "symbol") map.setLayoutProperty(couche.id, "visibility", "none");
  const ligne = await (await fetch(DONNEES)).json();
  const couleur = ligne.couleur;
  const toutes = ligne.branches.flatMap((b) => b.stations.map((s) => ({ ...s, branche: b.nom })));

  // emprise de la ligne
  const xs = ligne.branches.flatMap((b) => b.coords.map((c) => c[0]));
  const ys = ligne.branches.flatMap((b) => b.coords.map((c) => c[1]));
  // cadrage de toute la ligne, recalculé à chaque fois (taille de fenêtre et mode mobile du moment) : au chargement, puis
  // à chaque clic sur un bouton (ordinateur et mobile) pour annuler zoom, déplacement, rotation ou inclinaison
  // mobile : le cartouche du titre et les crédits recouvrent le bas de la carte -> marge basse agrandie
  const emprise = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  const cadrer = (duree) => {
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    const ferme = document.body.classList.contains("entete-ferme");
    const margeBas = mobile ? (ferme ? 70 : document.getElementById("entete").offsetHeight + 56) : 50; // fermé : pastille « 7 » et crédits
    map.fitBounds(emprise, { padding: { top: mobile ? 30 : 50, bottom: margeBas, left: mobile ? 20 : 50, right: mobile ? 20 : 50 }, bearing: 0, pitch: 0, duration: duree });
  };
  cadrer(0);
  const recadrer = () => cadrer(600);

  // mobile : fermer / rouvrir le cartouche (classe entete-ferme sur body) ; la carte se recadre sur la place disponible
  const basculerEntete = (ferme) => {
    document.body.classList.toggle("entete-ferme", ferme);
    cadrer(400);
  };
  $("#fermer-entete").addEventListener("click", () => basculerEntete(true));
  $("#ouvrir-entete").addEventListener("click", () => basculerEntete(false));

  const collection = (features) => ({ type: "FeatureCollection", features });
  const ligneGeo = (coords) => ({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} });
  map.addSource("fond", { type: "geojson", data: collection(ligne.branches.map((b) => ligneGeo(b.coords))) });
  map.addSource("trace", { type: "geojson", data: collection([]) });
  map.addSource("stations", { type: "geojson", data: collection([]) });
  map.addSource("rame", { type: "geojson", data: collection([]) });

  // tailles reprises de la carte principale (main.js : réseau, gares, rames)
  const epaisseur = ["interpolate", ["linear"], ["zoom"], 8, 1.2, 13, 3.5];
  map.addLayer({ id: "fond", type: "line", source: "fond", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": couleur, "line-opacity": 0.22, "line-width": epaisseur } });
  map.addLayer({ id: "trace", type: "line", source: "trace", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": couleur, "line-width": epaisseur } });
  // stations : cercle dessiné seulement au passage de la rame, rempli selon la qualité de l'air ; le nom (et la goutte
  // d'eau) s'affiche à côté au même moment (Marker HTML)
  map.addLayer({
    id: "stations",
    type: "circle",
    source: "stations",
    filter: ["get", "atteinte"],
    paint: {
      // stations en gras sur le plan RATP : × 1,45, comme les grosses gares de la carte principale
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["get", "gras"], 2.6, 1.8], 12, ["case", ["get", "gras"], 5.8, 4], 15, ["case", ["get", "gras"], 11, 7.5]],
      "circle-color": ["get", "couleurAir"],
      "circle-stroke-color": "#444444",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 2],
    },
  });
  map.addLayer({
    id: "rame",
    type: "circle",
    source: "rame",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 12, 5, 15, 8],
      "circle-color": couleur,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 2],
    },
  });

  // noms des stations, posés au passage de la rame. Côté préféré : à droite sur la partie haute (au nord de Châtelet) et
  // sur la branche d'Ivry, à gauche sur le bas du tronc. Anti-chevauchement : chaque nom essaie, dans l'ordre, côté préféré
  // (milieu, au-dessus, au-dessous) puis l'autre côté, et garde la première position qui ne recouvre aucun nom déjà posé
  // ; si aucune n'est libre, le nom est masqué — sauf pour les stations importantes (en gras sur le plan RATP), placées en
  // premier et toujours affichées ; placement recalculé après chaque zoom ou déplacement (un nom masqué peut réapparaître).
  // Marker = ancre vide centrée sur la station, le nom est positionné en absolu à l'intérieur.
  const LAT_HAUT = toutes.find((s) => s.nom === "Châtelet")?.lat ?? 48.8587;
  const ECART = 9; // px entre le point et le nom
  let noms = []; // { cle, marker, texte, prefereDroite, gras }
  function poserNom(s, iBranche) {
    const ancre = document.createElement("div");
    ancre.className = "ancre-nom";
    const texte = document.createElement("div");
    texte.className = `nom-station${s.gras ? " gras" : ""}`; // gras : comme sur le plan RATP (terminus, pôles d'échange)
    texte.innerHTML = `${s.nom}${s.eau.fontaines ? ' <span class="goutte" title="fontaine à eau">💧</span>' : ""}`;
    ancre.append(texte);
    const cle = `${ligne.branches[iBranche].nom}|${s.nom}`;
    texte.addEventListener("mouseenter", () => survoler(cle));
    texte.addEventListener("mouseleave", quitter);
    const marker = new Marker({ element: ancre, anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(map);
    noms.push({ cle, marker, texte, prefereDroite: iBranche > 0 || s.lat > LAT_HAUT, gras: s.gras });
    placerNoms();
  }
  // positions candidates (coin haut-gauche du nom, relatif au point) pour un nom de largeur l et hauteur h
  const candidats = (droite, l, h) => {
    const x = droite ? ECART : -ECART - l;
    const xDiag = droite ? ECART - 4 : -ECART - l + 4;
    return [[x, -h / 2], [xDiag, -h - 3], [xDiag, 3]];
  };
  const recouvrement = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  function placerNoms() {
    const poses = [];
    const { width: L, height: H } = map.getContainer().getBoundingClientRect();
    // stations importantes d'abord (ordre de passage conservé dans chaque groupe)
    for (const n of [...noms.filter((x) => x.gras), ...noms.filter((x) => !x.gras)]) {
      n.texte.style.visibility = "";
      const p = map.project(n.marker.getLngLat());
      const [l, h] = [n.texte.offsetWidth, n.texte.offsetHeight];
      let meilleur = null;
      for (const [dx, dy] of [...candidats(n.prefereDroite, l, h), ...candidats(!n.prefereDroite, l, h)]) {
        const r = { x1: p.x + dx, y1: p.y + dy, x2: p.x + dx + l, y2: p.y + dy + h };
        const horsCadre = r.x1 < 2 || r.x2 > L - 2 || r.y1 < 2 || r.y2 > H - 2 ? l * h : 0;
        const cout = poses.reduce((t, q) => t + recouvrement(r, q), 0) + horsCadre;
        if (!meilleur || cout < meilleur.cout) meilleur = { cout, dx, dy, r };
        if (cout === 0) break;
      }
      if (meilleur.cout > 0 && !n.gras) {
        n.texte.style.visibility = "hidden"; // pas de place : nom masqué (le point reste)
        continue;
      }
      n.texte.style.left = `${meilleur.dx}px`;
      n.texte.style.top = `${meilleur.dy}px`;
      poses.push(meilleur.r);
    }
  }
  map.on("moveend", placerNoms);

  // survol d'une station atteinte (son point ou son nom) : le cartouche de droite affiche cette station ; la carte ne
  // change pas. En quittant : retour à la station où se trouve la rame
  const parCle = new globalThis.Map(toutes.map((s) => [`${s.branche}|${s.nom}`, s]));
  // station survolée mise en évidence dans le journal (liste de droite)
  const marquerJournal = (cle) => {
    for (const li of document.querySelectorAll("#journal li.actif")) li.classList.remove("actif");
    const li = cle && [...document.querySelectorAll("#journal li[data-cle]")].find((x) => x.dataset.cle === cle);
    if (li) li.classList.add("actif"), li.scrollIntoView({ block: "nearest" });
  };
  // les autres stations sont estompées : points et noms sur la carte, lignes du journal
  const estomper = (cle) => {
    const opacite = cle ? ["case", ["==", ["get", "cle"], cle], 1, 0.2] : 1;
    map.setPaintProperty("stations", "circle-opacity", opacite);
    map.setPaintProperty("stations", "circle-stroke-opacity", opacite);
    for (const n of noms) n.texte.classList.toggle("estompe", Boolean(cle) && n.cle !== cle);
    $("#journal ol").classList.toggle("survol", Boolean(cle));
  };
  const survoler = (cle) => {
    const s = parCle.get(cle);
    if (s) majCourante(s), marquerJournal(cle), estomper(cle);
  };
  const quitter = () => {
    majCourante(etat.courante ?? null);
    marquerJournal(null);
    estomper(null);
  };
  // survol d'une ligne du journal (cartouche du trajet) : même effet que le survol de la station sur la carte
  let ligneSurvolee = null;
  $("#journal ol").addEventListener("mouseover", (e) => {
    const li = e.target.closest("li[data-cle]");
    if (!li || li.dataset.cle === ligneSurvolee) return;
    ligneSurvolee = li.dataset.cle;
    survoler(ligneSurvolee);
  });
  $("#journal ol").addEventListener("mouseleave", () => {
    ligneSurvolee = null;
    quitter();
  });
  map.on("mousemove", "stations", (e) => {
    map.getCanvas().style.cursor = "pointer";
    survoler(e.features[0].properties.cle);
  });
  map.on("mouseleave", "stations", () => {
    map.getCanvas().style.cursor = "";
    quitter();
  });

  // --- état de l'animation
  const etat = {};
  let vitesse = 2; // vitesse de départ (× 2)
  let enLecture = true;
  let precedent = null;

  function reinitialiser() {
    Object.assign(etat, { b: 0, km: 0, i: 0, prochaine: 0, attente: 0, traces: [], atteintes: new Set(), fini: false, courante: null });
    $("#journal ol").innerHTML = "";
    noms.forEach((n) => n.marker.remove()); // recommencer : tous les noms posés sont effacés
    noms = [];
    majStations();
    majCourante(null);
    ajouterBranche(ligne.branches[0].nom);
  }

  function majStations() {
    majCompteurs();
    map.getSource("stations").setData(
      collection(
        toutes.map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          properties: { atteinte: etat.atteintes.has(`${s.branche}|${s.nom}`), couleurAir: COULEURS_AIR[s.air?.niveau ?? "inconnu"], eau: s.eau.fontaines > 0, gras: s.gras, cle: `${s.branche}|${s.nom}` },
        })),
      ),
    );
  }

  const texteEau = (s) => (s.eau.fontaines ? "Fontaine à eau dans la station" : "Pas de fontaine à eau");
  // cartouche : goutte d'eau suivie du texte (en noir) ; goutte barrée s'il n'y a pas de fontaine
  const ligneEau = (s) => (s.eau.fontaines ? `<span>💧</span>${texteEau(s)}` : `<span class="goutte-barree">💧</span>${texteEau(s)}`);
  // station de la rame ou station survolée (même présentation : son nom, l'eau, l'air)
  function majCourante(s) {
    $("#courante .nom").textContent = s ? s.nom : "En route…";
    $("#courante-eau").innerHTML = s ? ligneEau(s) : "";
    $("#courante-air").innerHTML = s ? `<i class="rond" style="background:${COULEURS_AIR[s.air?.niveau ?? "inconnu"]}"></i>${LIBELLES_AIR[s.air?.niveau ?? "inconnu"]}` : "";
  }
  function ajouterBranche(nom) {
    const li = document.createElement("li");
    li.className = "branche";
    li.textContent = nom;
    $("#journal ol").append(li);
  }
  function ajouterJournal(s, cle) {
    const li = document.createElement("li");
    li.dataset.cle = cle;
    li.innerHTML = `<i class="rond" style="background:${COULEURS_AIR[s.air?.niveau ?? "inconnu"]}"></i><span>${s.nom}</span><span class="eau">${s.eau.fontaines ? "💧" : ""}</span>`;
    li.title = `${texteEau(s)} · ${LIBELLES_AIR[s.air?.niveau ?? "inconnu"]}`;
    $("#journal ol").append(li);
    li.scrollIntoView({ block: "nearest" });
  }
  // compteurs du premier cartouche : stations déjà atteintes par niveau d'air, et stations avec fontaine
  function majCompteurs() {
    const atteintes = toutes.filter((s) => etat.atteintes.has(`${s.branche}|${s.nom}`));
    const n = (niveau) => atteintes.filter((s) => s.air?.niveau === niveau).length;
    $("#n-faible").textContent = n("faible");
    $("#n-moyenne").textContent = n("moyenne");
    $("#n-elevee").textContent = n("élevée");
    // « x station(s) équipée(s) sur n station(s) », n = stations déjà atteintes
    const eau = atteintes.filter((s) => s.eau.fontaines).length;
    $("#n-eau").textContent = eau;
    $("#pl-eau").textContent = $("#pl-eau2").textContent = eau > 1 ? "s" : "";
    $("#n-stations").textContent = atteintes.length;
    $("#pl-st").textContent = atteintes.length > 1 ? "s" : "";
  }


  function majTrace(point) {
    const b = ligne.branches[etat.b];
    const courant = [...b.coords.slice(0, etat.i + 1), point];
    map.getSource("trace").setData(collection([...etat.traces, courant].map(ligneGeo)));
    map.getSource("rame").setData(collection([{ type: "Feature", geometry: { type: "Point", coordinates: point }, properties: {} }]));
  }

  function image(t) {
    const dt = precedent === null ? 0 : Math.min(100, t - precedent);
    precedent = t;
    if (enLecture && !etat.fini) avancer(dt * vitesse);
    requestAnimationFrame(image);
  }

  function avancer(dt) {
    if (etat.attente > 0) return void (etat.attente -= dt);
    const b = ligne.branches[etat.b];
    const s = b.stations[etat.prochaine];
    const cible = s ? s.km : b.km.at(-1);
    etat.km = Math.min(cible, etat.km + (KM_PAR_SECONDE * dt) / 1000);
    const { point, i } = pointA(b, etat.km, etat.i);
    etat.i = i;
    majTrace(point);
    if (s && etat.km >= s.km) {
      // arrivée en station
      etat.atteintes.add(`${b.nom}|${s.nom}`);
      majStations();
      etat.courante = s;
      majCourante(s);
      ajouterJournal(s, `${b.nom}|${s.nom}`);
      poserNom(s, etat.b);
      etat.prochaine++;
      etat.attente = ARRET_MS;
    } else if (!s && etat.km >= b.km.at(-1)) {
      // fin de branche
      etat.traces.push(b.coords);
      if (etat.b + 1 < ligne.branches.length) {
        etat.b++;
        Object.assign(etat, { km: 0, i: 0, prochaine: 0, attente: PAUSE_BRANCHE_MS, courante: null });
        ajouterBranche(`${ligne.branches[etat.b].nom} (depuis Maison Blanche)`);
        majCourante(null);
      } else {
        etat.fini = true;
        $("#lecture").textContent = "▶︎ Lecture";
      }
    }
  }

  // --- commandes (tout clic sur un bouton recadre la carte sur toute la ligne, sur ordinateur comme sur mobile)
  document.querySelector(".commandes").addEventListener("click", (e) => e.target.closest("button") && recadrer());
  $("#lecture").addEventListener("click", () => {
    if (etat.fini) reinitialiser(), (enLecture = true);
    else enLecture = !enLecture;
    $("#lecture").textContent = enLecture ? "⏸︎ Pause" : "▶︎ Lecture";
  });
  $("#recommencer").addEventListener("click", () => {
    reinitialiser();
    enLecture = true;
    $("#lecture").textContent = "⏸︎ Pause";
  });
  // ⏭︎ : la rame parcourt instantanément le reste du trajet (arrêts et pauses sautés) ; état final complet (tracé, points,
  // noms, journal, compteurs)
  $("#fin").addEventListener("click", () => {
    let garde = 1000;
    while (!etat.fini && garde--) {
      etat.attente = 0;
      avancer(1e9);
    }
  });
  $("#vitesse").addEventListener("click", () => {
    vitesse = vitesse === 1 ? 2 : vitesse === 2 ? 4 : 1;
    $("#vitesse").textContent = `× ${vitesse}`;
  });
  document.addEventListener("keydown", (e) => e.code === "Space" && (e.preventDefault(), $("#lecture").click()));

  reinitialiser();
  // ?fin dans l'adresse : fin de l'animation affichée directement (capture d'écran pour la page de présentation)
  if (new URLSearchParams(location.search).has("fin")) $("#fin").click();
  requestAnimationFrame(image);
});
