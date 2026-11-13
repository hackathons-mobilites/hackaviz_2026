// Configuration Observable Framework — https://observablehq.com/framework/config

// Menu principal (barre latérale de gauche, seul menu du site).
const MENU = [
  {name: "Accueil", path: "/"},
  {name: "Se déplacer", path: "/deplacements"},
  {name: "Trouver un emploi", path: "/emploi"},
  {name: "D'où viennent les travailleurs", path: "/flux"},
  {name: "Revenus et transports", path: "/inegalites"},
  {name: "Gares et stations", path: "/transport"},
  {name: "Catalogue des données", path: "/catalogue"},
  {name: "Sources et méthode", path: "/sources"}
];

// Membres de l'équipe et liens LinkedIn : voir src/components/equipe.js.
import {equipeHtml} from "./src/components/equipe.js";

// Police Raleway, celle du site d'Île-de-France Mobilités.
const POLICE =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800;900&display=swap">';

// Bouton « Exporter en PDF », ajouté en haut à droite de chaque page.
// Il ouvre la fenêtre d'impression du navigateur, où l'on choisit « Enregistrer au format PDF » ;
// la mise en page imprimée (sans menu, en paysage) est définie dans style.css (@media print).
const BOUTON_PDF =
  "<script>document.addEventListener('DOMContentLoaded',function(){" +
  "var b=document.createElement('button');b.type='button';b.className='bouton-pdf';" +
  "b.title='Enregistrer cette page en PDF';" +
  "b.innerHTML='<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M12 3a1 1 0 0 1 1 1v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4l2.3 2.3V4a1 1 0 0 1 1-1zM5 18a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z\"/></svg>Exporter en PDF';" +
  "b.addEventListener('click',function(){window.print();});document.body.appendChild(b);});</script>";

export default {
  title: "Mobilité Île-de-France",
  root: "src",
  output: "dist",
  pages: [
    {name: "Accueil", path: "/"},
    {
      name: "Explorer",
      pages: MENU.slice(1, 6)
    },
    {
      name: "Comprendre",
      pages: MENU.slice(6)
    }
  ],
  head: POLICE + BOUTON_PDF + '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%230268d5%22/><text x=%2250%22 y=%2268%22 font-size=%2252%22 font-family=%22Arial%22 font-weight=%22700%22 text-anchor=%22middle%22 fill=%22white%22>M</text></svg>">',
  toc: false,
  sidebar: true,
  search: true,
  pager: true,
  footer: () =>
    `Projet réalisé pour le Hackathon Mobilités 2026, défi 2 « mobilités et emploi ». Ce n'est pas un site officiel d'Île-de-France Mobilités. Données ouvertes : INSEE · Île-de-France Mobilités · Région Île-de-France · France Travail · DARES · Etalab / IGN (Licence Ouverte 2.0 et ODbL).<br>` +
    `Équipe : <span class="equipe-pied">${equipeHtml({logo: false}).join(", ")}</span>.`,
  style: "style.css"
};
