// Logos des producteurs de données, affichés en tête de chaque page et sur la page « Sources ».
// Les fichiers viennent des sites officiels des producteurs (ou de Wikimedia Commons) ;
// la DARES et l'APUR n'ont pas de logo seul téléchargeable : on affiche leur sigle.
import {FileAttachment} from "observablehq:stdlib";
import {html} from "npm:htl";

const LOGOS = {
  "INSEE": {nom: "INSEE", site: "https://www.insee.fr", src: FileAttachment("../logos/insee.svg")},
  "Île-de-France Mobilités": {nom: "Île-de-France Mobilités", site: "https://data.iledefrance-mobilites.fr", src: FileAttachment("../logos/idfm.svg")},
  "Région Île-de-France": {nom: "Région Île-de-France", site: "https://data.iledefrance.fr", src: FileAttachment("../logos/region-idf.svg")},
  "France Travail": {nom: "France Travail", site: "https://www.francetravail.org/opendata", src: FileAttachment("../logos/france-travail.svg")},
  "DARES": {nom: "DARES", site: "https://dares.travail-emploi.gouv.fr", sigle: "Dares", couleur: "#000091"},
  "Etalab": {nom: "Etalab (data.gouv.fr)", site: "https://www.data.gouv.fr", src: FileAttachment("../logos/datagouv.svg")},
  "IGN": {nom: "IGN", site: "https://www.ign.fr", src: FileAttachment("../logos/ign.svg")},
  "APUR": {nom: "APUR", site: "https://www.apur.org", sigle: "Apur", couleur: "#e2001a"}
};

// "Île-de-France Mobilités (PRIM)" -> "Île-de-France Mobilités" ; "Etalab / IGN" -> ["Etalab", "IGN"].
export function producteurs(texte) {
  return String(texte ?? "")
    .split("/")
    .map((s) => s.replace(/\(.*\)/, "").trim())
    .filter((s) => LOGOS[s]);
}

function logo(cle, hauteur) {
  const l = LOGOS[cle];
  const contenu = l.src
    ? html`<img src=${l.src.href} alt=${l.nom} style=${`height:${hauteur}px`}>`
    : html`<span class="sigle" style=${`color:${l.couleur};border-color:${l.couleur};font-size:${Math.round(hauteur * 0.5)}px;height:${hauteur}px`}>${l.sigle}</span>`;
  return html`<a class="logo-source" href=${l.site} target="_blank" rel="noopener" title=${l.nom}>${contenu}</a>`;
}

// Bandeau « Données : [logos] » à placer sous le titre d'une page.
export function bandeauSources(cles, {hauteur = 30} = {}) {
  return html`<div class="bandeau-sources"><span class="muted">Données :</span>${cles.map((c) => logo(c, hauteur))}</div>`;
}

// Petits logos pour une cellule de tableau (producteur au format du catalogue).
export function logosProducteur(texte, hauteur = 20) {
  const cles = producteurs(texte);
  return cles.length ? html`<span class="logos-cellule">${cles.map((c) => logo(c, hauteur))}</span>` : html`<span>${texte}</span>`;
}

// Bloc « Sources des données » à placer tout en bas d'une page :
// la liste des jeux de données utilisés, les logos des producteurs, et un lien vers la page détaillée.
export function piedSources(cles, jeux = []) {
  return html`<div class="pied-sources">
    <ul>${jeux.map((j) => html`<li>${j}</li>`)}</ul>
    <div class="bandeau-sources">${cles.map((c) => logo(c, 28))}</div>
    <p class="muted">Toutes ces données sont publiques et gratuites (Licence Ouverte 2.0 ou ODbL). Détail, liens et méthode : <a href="./sources">page « Sources & méthode »</a>.</p>
  </div>`;
}

export const tousLesProducteurs = Object.keys(LOGOS);
