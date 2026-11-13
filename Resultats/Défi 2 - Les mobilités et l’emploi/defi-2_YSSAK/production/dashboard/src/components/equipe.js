// Membres de l'équipe, affichés sur la page d'accueil et en pied de page.
// Pour chaque membre, coller l'adresse complète de son profil LinkedIn
// (par exemple "https://www.linkedin.com/in/prenom-nom/"). Sans adresse, le nom s'affiche sans lien.
// Ce fichier n'importe rien : il est aussi lu par observablehq.config.js.
export const EQUIPE = [
  {nom: "Taha Yassine TOURBI", linkedin: "https://www.linkedin.com/in/taha-yassine-tourbi-49252a353/"},
  {nom: "Kris LOKOUN", linkedin: "https://www.linkedin.com/in/kris-lokoun-4a5714353/"},
  {nom: "Mohamed-sami MECHAIAKH", linkedin: "https://www.linkedin.com/in/mohamed-sami-mechaiakh/"},
  {nom: "Arsene TOGNIFODE", linkedin: "https://www.linkedin.com/in/arsene-tognifode/"},
  {nom: "Soriba TOURE", linkedin: "https://www.linkedin.com/in/soriba-toure-bb1b662a3/"}
];

const echapper = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// Petit logo LinkedIn (carré « in »), dessiné en SVG pour ne dépendre d'aucun fichier.
const LOGO_LINKEDIN =
  '<svg class="logo-linkedin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect width="24" height="24" rx="4" fill="#0a66c2"/>' +
  '<path fill="#fff" d="M7.1 9.4H4.6V19h2.5V9.4zM5.9 5a1.45 1.45 0 1 0 0 2.9 1.45 1.45 0 0 0 0-2.9zM19.4 13.6c0-2.6-1.4-4.4-3.8-4.4-1.2 0-2 .6-2.4 1.2V9.4h-2.4V19h2.5v-5c0-1.3.4-2.4 1.7-2.4s1.5 1.2 1.5 2.5V19h2.5l.4-5.4z"/></svg>';

// Un membre : lien vers son LinkedIn (nouvel onglet) s'il est renseigné, sinon son nom seul.
export function membreHtml({nom, linkedin}, {logo = true} = {}) {
  const n = echapper(nom);
  if (!linkedin) return `<span class="membre">${n}</span>`;
  return `<a class="membre" href="${echapper(linkedin)}" target="_blank" rel="noopener" title="Profil LinkedIn de ${n}">${logo ? LOGO_LINKEDIN : ""}${n}</a>`;
}

export const equipeHtml = (options) => EQUIPE.map((m) => membreHtml(m, options));
