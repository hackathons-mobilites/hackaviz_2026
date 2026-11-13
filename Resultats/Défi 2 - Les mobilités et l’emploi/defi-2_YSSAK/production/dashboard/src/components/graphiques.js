// Graphiques communs à toutes les pages : mêmes formes, mêmes couleurs, mêmes étiquettes.
// Règles de lisibilité :
//   - une seule idée par graphique ;
//   - la valeur est écrite à côté de chaque barre (pas besoin de lire un axe) ;
//   - la couleur ne porte jamais l'information à elle seule (étiquettes, légende, infobulle) ;
//   - uniquement la palette d'Île-de-France Mobilités.
import * as Plot from "npm:@observablehq/plot";
import * as d3 from "npm:d3";
import {fmtInt, nomCourt} from "./format.js";

// Taille de police commune à tous les graphiques (lisible sur un vidéoprojecteur).
const POLICE = 13;

// Palette Île-de-France Mobilités (relevée sur iledefrance-mobilites.fr).
export const IDFM = {
  bleu: "#0268d5",       // couleur principale
  encre: "#25303b",      // texte, éléments forts
  gris: "#4e5864",       // texte secondaire
  grisClair: "#a9b4c2",  // éléments de comparaison
  grisPale: "#eef1f5",   // fond de carte, absence de donnée
  bordure: "#e0e5ec",
  bleuPale: "#cfe1f7",
  rouge: "#c52625"       // alerte uniquement
};

// Dégradé de cartes : du bleu IDFM très clair au bleu IDFM foncé (5 classes).
export const degradeBleu = ["#e6f0fb", "#b3d2f3", "#67a4e6", "#0268d5", "#01458d"];

const nombreFr = (v) => v.toLocaleString("fr-FR");
const raccourcir = (n) => (s) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

// Coupe un libellé en 2 lignes au plus (sur un espace), pour qu'il tienne dans la marge d'un graphique.
// Le "\n" est compris par les étiquettes d'axe de Plot (rendu sur deux lignes).
export function couperLignes(texte, maxChars) {
  const s = String(texte ?? "");
  if (s.length <= maxChars) return s;
  const mots = s.split(" ");
  const lignes = [""];
  for (const mot of mots) {
    const courante = lignes[lignes.length - 1];
    if (courante && (courante + " " + mot).length > maxChars) lignes.push(mot);
    else lignes[lignes.length - 1] = courante ? courante + " " + mot : mot;
  }
  if (lignes.length > 2) {
    const reste = lignes.slice(1).join(" ");
    return lignes[0] + "\n" + raccourcir(maxChars)(reste);
  }
  return lignes.join("\n");
}

// Seuils « ronds » pour une carte : on coupe les valeurs en 5 groupes de même taille,
// puis on arrondit chaque limite à 2 chiffres significatifs (23 %, 31 %, 21 000 €...).
export function seuilsRonds(valeurs, n = 5) {
  const v = Array.from(valeurs).filter((x) => x != null && Number.isFinite(x)).sort(d3.ascending);
  if (!v.length) return [1];
  const s = d3.range(1, n).map((i) => Number(d3.quantileSorted(v, i / n).toPrecision(2)));
  const uniques = [...new Set(s)].sort(d3.ascending);
  return uniques.length ? uniques : [1];
}

// Échelle de couleur d'une carte : 5 classes de bleu, légende avec les limites de classes.
export function echelleCarte(valeurs, {label, tickFormat = nombreFr} = {}) {
  const domain = seuilsRonds(valeurs);
  return {type: "threshold", domain, range: degradeBleu.slice(0, domain.length + 1), legend: true, label, tickFormat};
}

// Carte interactive.
//   - fond gris clair = pas de donnée ; territoires colorés selon `valeur` ; limites des départements ;
//   - survol : le territoire est entouré et une infobulle s'affiche (`titre`) ;
//   - clic : `surClic(properties)` est appelé avec le territoire cliqué ;
//   - `selection` : code(s) du ou des territoires à entourer en noir ;
//   - `zoom` : objet GeoJSON sur lequel cadrer la carte (par défaut, toute la région) ;
//   - `echelles` : autres échelles Plot (par exemple la taille des ronds : {r: {range: [1, 18]}}).
export function carte({fc, fcDep, width, valeur, couleur, titre, contour = 0.3, marques = [], surClic, selection, zoom, hauteur, echelles = {}}) {
  const codes = selection == null ? null : new Set(selection instanceof Set ? selection : [].concat(selection));
  const choisis = codes ? fc.features.filter((f) => codes.has(f.properties.codegeo)) : [];
  const interactif = Boolean(titre || surClic);
  const plot = Plot.plot({
    width,
    height: hauteur ?? Math.min(600, Math.max(320, width * 0.8)),
    projection: {type: "mercator", domain: zoom ?? fcDep, inset: 6},
    color: couleur,
    ...echelles,
    style: {fontSize: `${POLICE}px`},
    marks: [
      Plot.geo(fc, {fill: IDFM.grisPale, stroke: "white", strokeWidth: contour}),
      ...(valeur ? [Plot.geo(fc, {fill: valeur, stroke: "white", strokeWidth: contour})] : []),
      Plot.geo(fcDep, {stroke: IDFM.gris, strokeWidth: 0.8, fill: "none"}),
      ...marques,
      ...(choisis.length ? [Plot.geo(choisis, {fill: "none", stroke: IDFM.encre, strokeWidth: 2.2})] : []),
      ...(interactif ? [Plot.geo(fc, {fill: "white", fillOpacity: 0, stroke: "none", ...(titre ? {tip: true, title: titre} : {})})] : [])
    ]
  });
  if (interactif) {
    // Le calque transparent posé au-dessus de la carte : le dernier calque qui contient tous les territoires.
    const calques = [...plot.querySelectorAll('g[aria-label="geo"]')].filter((g) => g.children.length === fc.features.length);
    const calque = calques[calques.length - 1];
    if (calque) {
      calque.classList.add("zones");
      if (surClic) {
        [...calque.children].forEach((zone, i) => zone.addEventListener("click", () => surClic(fc.features[i].properties)));
        plot.classList.add("carte-cliquable");
      }
    }
  }
  return plot;
}

// Étiquettes de territoires posées sur une carte (nom court, halo blanc pour rester lisible sur le fond coloré).
//   lignes : [{lon, lat, libgeo}] ; `texte` : fonction (ligne) => texte (par défaut, le nom court)
export function etiquettesCarte(lignes, {texte, taille = 11} = {}) {
  // Dans la zone dense (Paris et petite couronne), seul le numéro du territoire tient :
  // "Paris Ouest La Défense (EPT 4)" -> "T4", "Paris (T1)" -> "T1". Le nom complet reste dans l'infobulle.
  texte ??= (d) => {
    const m = /\((?:EPT\s?|T)(\d+)\)/i.exec(String(d.libgeo ?? ""));
    return m ? `T${m[1]}` : couperLignes(nomCourt(d.libgeo), 14);
  };
  return Plot.text(lignes, {x: "lon", y: "lat", text: texte, fontSize: taille, fontWeight: 600,
    fill: IDFM.encre, stroke: "white", strokeWidth: 3, paintOrder: "stroke", lineWidth: 9, textAnchor: "middle", pointerEvents: "none"});
}

// Classement en barres horizontales : du plus grand au plus petit, valeur écrite au bout de la barre.
//   valeur    : nom de la colonne numérique
//   nom       : nom de la colonne de libellé
//   etiquette : fonction (ligne) => texte affiché au bout de la barre
//   couleur   : couleur unique, ou fonction (ligne) => couleur
//   surClic   : fonction (ligne) appelée quand on clique sur une barre
//   partie    : {valeur, libelle, libelleReste} pour montrer une partie du total dans la barre
//               (ex. les embauches jugées difficiles parmi toutes les embauches prévues) :
//               la partie est en rouge, le reste en bleu clair, avec une légende au-dessus.
//   forme     : "barre" (par défaut) ou "sucette" (une tige fine terminée par un rond)
export function barresClassees(donnees, {valeur, nom, etiquette, width, couleur = IDFM.bleu, max = 10, margeGauche = 180, margeDroite = 90, longueurNom = 60, infobulle, surClic, partie, forme = "barre"} = {}) {
  const sucette = forme === "sucette" && !partie;
  const lignes = Array.from(donnees)
    .filter((d) => d[valeur] != null && Number.isFinite(d[valeur]))
    .sort((a, b) => d3.descending(a[valeur], b[valeur]))
    .slice(0, max);
  const texte = etiquette ?? ((d) => fmtInt(d[valeur]));
  // Dans une carte étroite (2 colonnes sur un portable), les marges fixes ne laisseraient aucune place
  // aux barres : on les plafonne pour garder au moins un tiers de la largeur pour les barres.
  margeGauche = Math.min(margeGauche, Math.round(width * 0.36));
  margeDroite = Math.min(margeDroite, Math.round(width * 0.3));
  // Les libellés longs sont abrégés (CA, CC...) puis passés à la ligne dans la marge, jamais coupés.
  const maxChars = Math.max(10, Math.floor((margeGauche - 14) / (POLICE * 0.52)));
  const libelle = (s) => couperLignes(raccourcir(longueurNom)(nomCourt(s)), maxChars);
  const largeurTexte = maxChars;
  const deuxLignes = lignes.some((d) => libelle(d[nom]).includes("\n"));
  const hauteurBarre = deuxLignes ? 44 : 34;
  const plot = Plot.plot({
    width,
    height: lignes.length * hauteurBarre + 30,
    marginLeft: margeGauche,
    marginRight: margeDroite,
    marginTop: 10,
    marginBottom: 10,
    style: {fontSize: `${POLICE}px`},
    x: {axis: null},
    y: {label: null, domain: lignes.map((d) => d[nom]), axis: null},
    ...(partie ? {color: {domain: [partie.libelleReste, partie.libelle], range: ["#b3d2f3", IDFM.rouge], legend: true}} : {}),
    marks: [
      // L'axe est un calque à part : c'est lui qui sait passer les libellés longs à la ligne (lineWidth en em).
      Plot.axisY({label: null, tickSize: 0, tickFormat: libelle, lineHeight: 1.15, fontSize: POLICE}),
      ...(sucette
        ? [
            Plot.ruleY(lignes, {y: nom, x1: 0, x2: valeur, stroke: couleur, strokeWidth: 2.5, strokeOpacity: 0.55}),
            Plot.dot(lignes, {x: valeur, y: nom, r: 8, fill: couleur, stroke: "white", strokeWidth: 2, title: infobulle ?? ((d) => `${d[nom]}\n${texte(d)}`), tip: true})
          ]
        : [Plot.barX(lignes, {x: valeur, y: nom, fill: partie ? () => partie.libelleReste : couleur, insetTop: 6, insetBottom: 6, title: infobulle ?? ((d) => `${d[nom]}\n${texte(d)}`), tip: true})]),
      ...(partie ? [Plot.barX(lignes, {x: (d) => d[partie.valeur] ?? 0, y: nom, fill: () => partie.libelle, insetTop: 6, insetBottom: 6, pointerEvents: "none"})] : []),
      Plot.text(lignes, {x: valeur, y: nom, text: texte, dx: sucette ? 14 : 6, textAnchor: "start", fill: IDFM.encre, fontWeight: 600})
    ]
  });
  if (surClic) {
    const barres = sucette
      ? plot.querySelector('g[aria-label="dot"]')?.querySelectorAll("circle") ?? []
      : plot.querySelector('g[aria-label="bar"]')?.querySelectorAll("rect") ?? [];
    if (barres.length === lignes.length) {
      barres.forEach((barre, i) => barre.addEventListener("click", () => surClic(lignes[i])));
      plot.classList.add("barres-cliquables");
    }
  }
  return plot;
}

// Couleurs fixes des moyens de transport, pour qu'un mode ait la même couleur partout sur le site.
export const couleursModes = {
  "Transports en commun": IDFM.bleu,
  "Voiture": IDFM.encre,
  "Marche à pied": "#67a4e6",
  "Vélo": "#b3d2f3",
  "Deux-roues motorisé": IDFM.grisClair
};
const PALETTE = [IDFM.bleu, IDFM.encre, "#67a4e6", "#b3d2f3", IDFM.grisClair, "#01458d", "#7d8794"];

// Graphique en anneau : la part de chaque élément dans un total.
//   valeur, nom : colonnes numérique et libellé ; etiquette : (ligne) => texte de la légende
//   centre, sousCentre : grand chiffre et petite phrase écrits au milieu de l'anneau
// La légende (nom + pourcentage) est à droite, ou en dessous sur un petit écran.
export function anneau(donnees, {valeur, nom, width, etiquette, centre, sousCentre, couleur} = {}) {
  const lignes = Array.from(donnees)
    .filter((d) => d[valeur] != null && Number.isFinite(d[valeur]) && d[valeur] > 0)
    .sort((a, b) => d3.descending(a[valeur], b[valeur]));
  const total = d3.sum(lignes, (d) => d[valeur]);
  const texte = etiquette ?? ((d) => `${Math.round((100 * d[valeur]) / total)} %`);
  // Couleur de chaque part : celle du mode de transport si elle existe, sinon la suivante de la palette.
  const prises = new Set();
  const couleurs = lignes.map((d) => {
    const c = (typeof couleur === "function" ? couleur(d) : null) ?? couleursModes[d[nom]];
    if (c) { prises.add(c); return c; }
    return null;
  }).map((c) => c ?? PALETTE.find((p) => !prises.has(p) && prises.add(p)) ?? IDFM.grisClair);

  const empile = width < 480;
  const taille = Math.round(Math.min(empile ? width * 0.75 : width * 0.42, 250));
  const rayon = taille / 2;
  const hLigne = 32;
  const hLegende = lignes.length * hLigne;
  const xLegende = empile ? 0 : taille + 32;
  const largeurLegende = Math.min(380, width - xLegende);
  const hauteur = empile ? taille + 20 + hLegende : Math.max(taille, hLegende) + 4;

  const svg = d3.create("svg")
    .attr("class", "anneau")
    .attr("width", width).attr("height", hauteur)
    .attr("viewBox", [0, 0, width, hauteur])
    .style("max-width", "100%").style("height", "auto")
    .style("font-size", `${POLICE}px`).style("font-family", "inherit");

  const arc = d3.arc().innerRadius(rayon * 0.62).outerRadius(rayon - 2).padAngle(0.014).cornerRadius(3);
  const parts = d3.pie().value((d) => d[valeur]).sort(null)(lignes);
  const g = svg.append("g").attr("transform", `translate(${empile ? width / 2 : rayon},${empile ? rayon : hauteur / 2})`);
  g.selectAll("path").data(parts).join("path")
    .attr("d", arc)
    .attr("fill", (_, i) => couleurs[i])
    .append("title").text((p) => `${p.data[nom]} : ${texte(p.data)}`);
  if (centre != null) {
    const sous = [].concat(sousCentre ?? []);
    g.append("text").attr("text-anchor", "middle").attr("dy", sous.length ? "-0.15em" : "0.35em")
      .attr("font-size", Math.round(rayon * 0.3)).attr("font-weight", 800).attr("fill", IDFM.encre).text(centre);
    sous.forEach((ligne, i) => g.append("text").attr("text-anchor", "middle").attr("dy", `${1.5 + i * 1.2}em`)
      .attr("font-size", 12).attr("fill", IDFM.gris).text(ligne));
  }

  const legende = svg.append("g").attr("transform", `translate(${xLegende},${empile ? taille + 20 : (hauteur - hLegende) / 2})`);
  const item = legende.selectAll("g").data(lignes).join("g").attr("transform", (_, i) => `translate(0,${i * hLigne})`);
  item.append("rect").attr("y", 6).attr("width", 14).attr("height", 14).attr("rx", 3).attr("fill", (_, i) => couleurs[i]);
  item.append("text").attr("x", 24).attr("y", 18).attr("fill", IDFM.encre).text((d) => d[nom]);
  item.append("text").attr("x", largeurLegende).attr("y", 18).attr("text-anchor", "end")
    .attr("font-weight", 700).attr("fill", IDFM.encre).text(texte);
  item.append("line").attr("x1", 0).attr("x2", largeurLegende).attr("y1", hLigne - 2).attr("y2", hLigne - 2)
    .attr("stroke", IDFM.bordure);
  return svg.node();
}

// Courbes reliant des groupes rangés dans l'ordre (par exemple du plus modeste au plus aisé).
//   x : colonne du nom de groupe ; series : [{cle, libelle, couleur}] ; format : (valeur) => texte
export function courbes(donnees, {x, series, width, format = (v) => v, hauteur = 340} = {}) {
  const lignes = Array.from(donnees);
  const points = series.flatMap((s) => lignes.filter((d) => d[s.cle] != null).map((d) => ({x: d[x], v: d[s.cle], serie: s.libelle})));
  // Pour que les chiffres ne se chevauchent pas : au-dessus du point le plus haut, en dessous des autres.
  const maxParGroupe = d3.rollup(points, (g) => d3.max(g, (p) => p.v), (p) => p.x);
  const dessus = points.filter((p) => p.v === maxParGroupe.get(p.x));
  const dessous = points.filter((p) => p.v !== maxParGroupe.get(p.x));
  const etiquettes = (lignesTexte, dy) => Plot.text(lignesTexte, {x: "x", y: "v", text: (p) => format(p.v), dy, fill: IDFM.encre,
    fontWeight: 700, stroke: "white", strokeWidth: 4, paintOrder: "stroke"});
  return Plot.plot({
    width,
    height: hauteur,
    marginLeft: 24,
    marginRight: 24,
    marginTop: 34,
    marginBottom: 48,
    style: {fontSize: `${POLICE}px`},
    x: {type: "point", domain: lignes.map((d) => d[x]), label: null, padding: 0.35, tickSize: 0, tickPadding: 14,
      tickFormat: (s) => couperLignes(s, width < 600 ? 9 : 16)},
    y: {axis: null, domain: [0, (d3.max(points, (p) => p.v) ?? 1) * 1.18]},
    color: {domain: series.map((s) => s.libelle), range: series.map((s) => s.couleur), legend: true},
    marks: [
      Plot.ruleY([0], {stroke: IDFM.bordure}),
      Plot.ruleX(lignes, {x, stroke: IDFM.bordure, strokeDasharray: "2,4"}),
      Plot.line(points, {x: "x", y: "v", stroke: "serie", strokeWidth: 3.5, curve: "monotone-x"}),
      Plot.dot(points, {x: "x", y: "v", fill: "serie", r: 7, stroke: "white", strokeWidth: 2, tip: true,
        title: (p) => `${p.x}\n${p.serie} : ${format(p.v)}`}),
      etiquettes(dessus, -18),
      etiquettes(dessous, 20)
    ]
  });
}

// Nuage de points : chaque rond est un territoire, placé selon deux indicateurs.
//   x, y : colonnes ; r : colonne qui fixe la taille du rond ; nom : colonne du libellé
//   choisi : ligne à mettre en avant (rond foncé, nom écrit) ; surClic : (ligne) => ...
export function nuage(donnees, {x, y, r, nom, width, labelX, labelY, formatX = nombreFr, formatY = nombreFr, infobulle, choisi, surClic} = {}) {
  const lignes = Array.from(donnees).filter((d) => d[x] != null && d[y] != null);
  const plot = Plot.plot({
    width,
    height: Math.min(520, Math.max(340, width * 0.55)),
    marginLeft: 52,
    marginBottom: 46,
    marginTop: 24,
    marginRight: 20,
    style: {fontSize: `${POLICE}px`},
    x: {label: labelX, labelAnchor: "center", labelArrow: "none", tickFormat: formatX, grid: true, nice: true, ticks: Math.max(3, Math.floor(width / 130))},
    y: {label: labelY, labelArrow: "none", tickFormat: formatY, grid: true, nice: true},
    r: {range: [3, 20]},
    marks: [
      Plot.dot(lignes, {x, y, r, fill: IDFM.bleu, fillOpacity: 0.45, stroke: IDFM.bleu, strokeWidth: 1,
        title: infobulle ?? ((d) => `${d[nom]}`), tip: true}),
      Plot.linearRegressionY(lignes, {x, y, stroke: IDFM.rouge, strokeWidth: 2, strokeDasharray: "6,4", ci: 0}),
      ...(choisi ? [
        Plot.dot([choisi], {x, y, r: 9, fill: IDFM.encre, stroke: "white", strokeWidth: 2}),
        Plot.text([choisi], {x, y, text: nom, dy: -18, fill: IDFM.encre, fontWeight: 700, stroke: "white", strokeWidth: 4, paintOrder: "stroke", lineWidth: 14})
      ] : [])
    ]
  });
  if (surClic) {
    // Plot range les ronds du plus grand au plus petit : on passe par la valeur pointée (plot.value).
    plot.addEventListener("click", () => { if (plot.value) surClic(plot.value); });
    plot.classList.add("nuage-cliquable");
  }
  return plot;
}

// Répartition des modes de transport : une barre de 100 % par ligne, découpée en 3 parts
// (transports en commun, voiture, autres), avec le pourcentage écrit dans chaque part.
//   lignes : [{nom, tc, voiture}] en pourcentage ; le reste jusqu'à 100 est « marche, vélo, deux-roues ».
const MODES3 = ["Transports en commun", "Voiture", "Marche, vélo, deux-roues"];
export function barresModes(donnees, {width, margeGauche = 150} = {}) {
  const lignes = Array.from(donnees);
  const parts = [];
  for (const d of lignes) {
    const valeurs = [d.tc ?? 0, d.voiture ?? 0, Math.max(0, 100 - (d.tc ?? 0) - (d.voiture ?? 0))];
    let x = 0;
    valeurs.forEach((v, i) => {
      parts.push({nom: d.nom, mode: MODES3[i], v, x1: x, x2: x + v, milieu: x + v / 2});
      x += v;
    });
  }
  const pct = (d) => `${Math.round(d.v)} %`;
  const lisibles = parts.filter((d) => d.v >= 7);
  return Plot.plot({
    width,
    height: lignes.length * 40 + 30,
    marginLeft: margeGauche,
    marginRight: 10,
    marginTop: 10,
    marginBottom: 10,
    style: {fontSize: `${POLICE}px`},
    x: {axis: null, domain: [0, 100]},
    y: {label: null, domain: lignes.map((d) => d.nom), axis: null},
    color: {domain: MODES3, range: [IDFM.bleu, IDFM.encre, IDFM.bleuPale], legend: true},
    marks: [
      Plot.axisY({label: null, tickSize: 0, tickFormat: (s) => couperLignes(nomCourt(s), Math.max(10, Math.floor((margeGauche - 14) / (POLICE * 0.52)))), lineHeight: 1.15, fontSize: POLICE}),
      Plot.barX(parts, {x1: "x1", x2: "x2", y: "nom", fill: "mode", insetTop: 5, insetBottom: 5, insetLeft: 1, tip: true,
        title: (d) => `${d.nom}\n${d.mode} : ${d.v.toFixed(1).replace(".", ",")} %`}),
      Plot.text(lisibles.filter((d) => d.mode !== MODES3[2]), {x: "milieu", y: "nom", text: pct, fill: "white", fontWeight: 600}),
      Plot.text(lisibles.filter((d) => d.mode === MODES3[2]), {x: "milieu", y: "nom", text: pct, fill: IDFM.encre, fontWeight: 600})
    ]
  });
}
