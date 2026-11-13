// Lexique : les mots du dashboard expliqués simplement. Affiché en bas de chaque page.
import {html} from "npm:htl";

const DEFINITIONS = {
  "Actif occupé": "Une personne qui a un emploi. Sur ce site : les habitants d'Île-de-France qui travaillent.",
  "Trajet domicile-travail": "Le déplacement entre le logement et le lieu de travail.",
  "Part d'un mode de transport": "Sur 100 personnes qui se déplacent pour aller travailler, le nombre de celles qui utilisent surtout ce mode. Exemple : « 45 % en transports en commun » = 45 personnes sur 100.",
  "Transports en commun": "Métro, RER, train, tramway et bus.",
  "Commune": "Une ville ou un village. Paris compte pour une seule commune.",
  "Département": "L'Île-de-France en compte 8 : Paris, Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne, Seine-et-Marne, Yvelines, Essonne, Val-d'Oise.",
  "Intercommunalité (EPCI)": "Un groupe de communes voisines qui gèrent ensemble certains services (transports, déchets, logement...).",
  "Bassin d'emploi": "L'un des 25 territoires découpés par la Région Île-de-France pour suivre l'emploi et la formation.",
  "Zone d'emploi": "Un territoire défini par l'INSEE, à l'intérieur duquel la plupart des habitants vivent et travaillent.",
  "Niveau de vie médian": "Le revenu annuel dont dispose une personne après impôts et aides. « Médian » : la moitié des habitants a moins, l'autre moitié a plus.",
  "Taux de pauvreté": "La part des habitants dont le niveau de vie est inférieur au seuil de pauvreté (60 % du niveau de vie médian en France).",
  "Taux de chômage": "Sur 100 personnes qui travaillent ou cherchent un emploi, le nombre de celles qui n'ont pas d'emploi.",
  "Demandeur d'emploi (catégorie A)": "Une personne inscrite à France Travail, sans aucune activité, qui cherche un emploi.",
  "Projet de recrutement": "Une embauche qu'un employeur prévoit de faire dans l'année. Ces intentions sont recueillies chaque année par France Travail (enquête « Besoins en main-d'œuvre »).",
  "Recrutement difficile": "Un projet de recrutement pour lequel l'employeur pense avoir du mal à trouver un candidat.",
  "Gare ou station (pôle ferré)": "Un arrêt de métro, RER, train ou tramway. Plusieurs stations reliées par une correspondance comptent pour un seul pôle.",
  "Validation": "Un passage de carte ou de ticket devant une borne. Une personne qui valide deux fois dans la journée compte pour deux validations.",
  "Entrants": "Les personnes qui habitent ailleurs et viennent travailler dans le territoire choisi.",
  "Sortants": "Les personnes qui habitent dans le territoire choisi et travaillent ailleurs.",
  "Ménage sans voiture": "Un logement dont les habitants ne possèdent aucune voiture.",
  "Donnée peu fiable": "Une valeur calculée sur moins de 200 personnes. Elle est trop incertaine : le territoire apparaît en gris sur les cartes."
};

// Affiche les définitions demandées, dans l'ordre donné.
export function lexique(termes) {
  return html`<dl class="lexique">${termes.map((t) => html`<div><dt>${t}</dt><dd>${DEFINITIONS[t] ?? ""}</dd></div>`)}</dl>`;
}

export const tousLesTermes = Object.keys(DEFINITIONS);
