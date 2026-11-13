// Blocs de mise en page communs à toutes les pages. Chaque thème suit le même motif :
//   1. une rangée de chiffres clés (kpi) pour le territoire principal ;
//   2. un graphique (2/3 de la largeur) et un tableau « Comparaison » (1/3) ;
//   3. un encadré « À savoir » qui explique les mots et la méthode ;
//   4. la mention de la source.
import {html} from "npm:htl";

// Un chiffre clé : petit titre, grand chiffre, sous-titre qui donne le contexte.
//   accent : "bleu" (chiffre en bleu IDFM) ou "alerte" (liseré rouge)
export function kpi(titre, valeur, sousTitre, {accent} = {}) {
  const classe = accent === "bleu" ? " kpi--tc" : accent === "alerte" ? " kpi--alerte" : "";
  return html`<div class=${"card kpi" + classe}><h2>${titre}</h2><div class="big">${valeur ?? "–"}</div><div class="muted">${sousTitre ?? ""}</div></div>`;
}

// Une rangée de chiffres clés (4 par ligne sur grand écran, 2 puis 1 sur petit écran).
export function rangeeKpi(elements) {
  return html`<div class=${`grid grid-cols-${Math.min(4, elements.length)} rangee-kpi`}>${elements}</div>`;
}

// Tableau « Comparaison » : une ligne par indicateur, une colonne par territoire.
// Une petite barre sous chaque valeur permet de comparer d'un coup d'œil, sans défilement horizontal.
//   lignes : [{libelle, a, b, format}]  (a = territoire principal, b = territoire de comparaison)
export function tableauComparaison(nomA, nomB, lignes) {
  const barre = (v, max, classe) => {
    const largeur = v == null || !max ? 0 : Math.max(2, Math.round((100 * Math.abs(v)) / max));
    return html`<div class="comp-barre"><div class=${classe} style=${`width:${largeur}%`}></div></div>`;
  };
  const cellule = (v, max, format, classe) =>
    html`<td><span class="comp-valeur">${v == null ? "non disponible" : format(v)}</span>${barre(v, max, classe)}</td>`;
  return html`<table class="comparaison">
    <thead><tr><th></th><th>${nomA}</th><th>${nomB}</th></tr></thead>
    <tbody>${lignes.map((l) => {
      const max = Math.max(Math.abs(l.a ?? 0), Math.abs(l.b ?? 0));
      return html`<tr><th scope="row">${l.libelle}</th>${cellule(l.a, max, l.format, "comp-a")}${cellule(l.b, max, l.format, "comp-b")}</tr>`;
    })}</tbody>
  </table>`;
}

// Encadré « À savoir » : définitions et précisions de méthode, en pleine largeur.
export function aSavoir(...paragraphes) {
  return html`<aside class="a-savoir"><div class="a-savoir-titre">À savoir</div>${paragraphes.map((p) => html`<p>${p}</p>`)}</aside>`;
}

// Mention de source sous un bloc.
export function source(texte) {
  return html`<p class="source">Source : ${texte}</p>`;
}

// Petit texte affiché quand un indicateur n'existe pas à la maille choisie.
export function indisponible(texte) {
  return html`<p class="indisponible">${texte}</p>`;
}
