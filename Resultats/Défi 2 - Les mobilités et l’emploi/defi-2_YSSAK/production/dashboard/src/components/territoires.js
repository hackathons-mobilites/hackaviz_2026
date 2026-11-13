// Les 4 filtres communs à toutes les pages :
//   Maille géographique · Territoire principal · Maille de comparaison · Territoire de comparaison
//
// - Les deux premiers s'appliquent à la majorité des graphiques de la page.
// - Les deux derniers ne servent qu'aux blocs « Comparaison ».
// - Les listes sont en cascade : la maille choisie détermine la liste des territoires.
// - Le choix est mémorisé dans le navigateur : il est conservé quand on change de page.
import {html} from "npm:htl";

// [valeur dans dim_geo, libellé affiché]
export const MAILLES = [
  ["Région", "Région"],
  ["Département", "Département"],
  ["EPCI", "Intercommunalité"],
  ["Bassin d'emploi", "Bassin d'emploi"],
  ["Zone d'emploi", "Zone d'emploi"],
  ["Commune", "Commune"]
];

// Colonne de dim_geo (lignes de maille Commune) qui rattache une commune à un territoire de chaque maille.
const COLONNE = {
  "Commune": "codegeo",
  "EPCI": "epci",
  "Zone d'emploi": "zone_emploi",
  "Bassin d'emploi": "bassin_emploi",
  "Département": "departement",
  "Région": "region"
};

const CLE = "mobilite-idf-territoires";
const DEFAUT = {maille: "Département", codegeo: "75", mailleComp: "Région", codegeoComp: "11"};

function lire() {
  try {
    return {...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) ?? "{}")};
  } catch {
    return {...DEFAUT};
  }
}

function ecrire(etat) {
  try {
    localStorage.setItem(CLE, JSON.stringify(etat));
  } catch {
    // stockage indisponible (navigation privée stricte) : le choix vaut pour la page seulement
  }
}

// Mémorise un territoire principal sans afficher les filtres (utilisé par la recherche de l'accueil).
export function memoriserTerritoire(maille, codegeo) {
  ecrire({...lire(), maille, codegeo});
}

// Construit la barre des 4 filtres.
//   lignes : toutes les lignes de dim_geo (maille, codegeo, libgeo, et les colonnes de rattachement)
// La valeur de l'élément (utilisable avec view()) est :
//   {maille, codegeo, libgeo, mailleComp, codegeoComp, libgeoComp}
// L'élément expose aussi choisir(maille, codegeo) pour changer le territoire principal depuis une carte.
export function selecteurTerritoires(lignes) {
  const parMaille = new Map(MAILLES.map(([m]) => [m, lignes.filter((d) => d.maille === m).sort((a, b) => a.libgeo.localeCompare(b.libgeo, "fr"))]));
  const existe = (maille, codegeo) => (parMaille.get(maille) ?? []).some((d) => d.codegeo === codegeo);

  const etat = lire();
  if (!existe(etat.maille, etat.codegeo)) Object.assign(etat, {maille: DEFAUT.maille, codegeo: DEFAUT.codegeo});
  if (!existe(etat.mailleComp, etat.codegeoComp)) Object.assign(etat, {mailleComp: DEFAUT.mailleComp, codegeoComp: DEFAUT.codegeoComp});

  const optionsMaille = (choisie) => MAILLES.map(([m, lib]) => html`<option value=${m} selected=${m === choisie}>${lib}</option>`);
  const optionsTerritoire = (maille, choisi) => (parMaille.get(maille) ?? []).map((d) => html`<option value=${d.codegeo} selected=${d.codegeo === choisi}>${d.libgeo}</option>`);

  const sMaille = html`<select aria-label="Maille géographique">${optionsMaille(etat.maille)}</select>`;
  const sTerr = html`<select aria-label="Territoire principal">${optionsTerritoire(etat.maille, etat.codegeo)}</select>`;
  const sMailleComp = html`<select aria-label="Maille de comparaison">${optionsMaille(etat.mailleComp)}</select>`;
  const sTerrComp = html`<select aria-label="Territoire de comparaison">${optionsTerritoire(etat.mailleComp, etat.codegeoComp)}</select>`;

  const barre = html`<form class="filtres filtres-territoires" onsubmit=${(e) => e.preventDefault()}>
    <label class="filtre-principal"><span>Maille géographique</span>${sMaille}</label>
    <label class="filtre-principal"><span>Territoire principal</span>${sTerr}</label>
    <label class="filtre-comparaison"><span>Maille de comparaison</span>${sMailleComp}</label>
    <label class="filtre-comparaison"><span>Territoire de comparaison</span>${sTerrComp}</label>
  </form>`;

  const nom = (maille, codegeo) => (parMaille.get(maille) ?? []).find((d) => d.codegeo === codegeo)?.libgeo ?? "";
  const valeur = () => ({
    maille: etat.maille, codegeo: etat.codegeo, libgeo: nom(etat.maille, etat.codegeo),
    mailleComp: etat.mailleComp, codegeoComp: etat.codegeoComp, libgeoComp: nom(etat.mailleComp, etat.codegeoComp)
  });
  const publier = () => {
    ecrire(etat);
    barre.value = valeur();
    barre.dispatchEvent(new Event("input", {bubbles: true}));
  };
  const remplir = (select, maille, choisi) => {
    select.replaceChildren(...optionsTerritoire(maille, choisi));
    select.value = choisi;
  };

  sMaille.addEventListener("input", (e) => {
    e.stopPropagation();
    etat.maille = sMaille.value;
    etat.codegeo = parMaille.get(etat.maille)[0]?.codegeo;
    remplir(sTerr, etat.maille, etat.codegeo);
    publier();
  });
  sTerr.addEventListener("input", (e) => {
    e.stopPropagation();
    etat.codegeo = sTerr.value;
    publier();
  });
  sMailleComp.addEventListener("input", (e) => {
    e.stopPropagation();
    etat.mailleComp = sMailleComp.value;
    etat.codegeoComp = parMaille.get(etat.mailleComp)[0]?.codegeo;
    remplir(sTerrComp, etat.mailleComp, etat.codegeoComp);
    publier();
  });
  sTerrComp.addEventListener("input", (e) => {
    e.stopPropagation();
    etat.codegeoComp = sTerrComp.value;
    publier();
  });

  // Changement du territoire principal depuis l'extérieur (clic sur une carte, recherche...).
  barre.choisir = (maille, codegeo) => {
    if (!existe(maille, codegeo) || (maille === etat.maille && codegeo === etat.codegeo)) return;
    etat.maille = maille;
    etat.codegeo = codegeo;
    sMaille.value = maille;
    remplir(sTerr, maille, codegeo);
    publier();
  };

  barre.value = valeur();
  return barre;
}

// Codes des communes qui composent un territoire.
export function communesDe(lignes, maille, codegeo) {
  const colonne = COLONNE[maille];
  return new Set(lignes.filter((d) => d.maille === "Commune" && d[colonne] === codegeo).map((d) => d.codegeo));
}

// Codes des communes à afficher quand on zoome sur un territoire.
// Pour une commune seule, on cadre sur ses voisines : son intercommunalité ou son bassin d'emploi,
// en prenant le plus petit des deux (en petite couronne, l'intercommunalité est toute la Métropole du Grand Paris).
export function communesDuZoom(lignes, maille, codegeo) {
  if (maille === "Région") return null;
  if (maille === "Commune") {
    const commune = lignes.find((d) => d.maille === "Commune" && d.codegeo === codegeo);
    if (!commune) return null;
    const groupes = [communesDe(lignes, "EPCI", commune.epci), communesDe(lignes, "Bassin d'emploi", commune.bassin_emploi)]
      .filter((g) => g.size > 1)
      .sort((x, y) => x.size - y.size);
    return groupes[0] ?? new Set([codegeo]);
  }
  const codes = communesDe(lignes, maille, codegeo);
  return codes.size ? codes : null;
}

// Les embauches prévues (enquête de France Travail) ne sont publiées que par bassin d'emploi,
// département et région. Pour un autre type de territoire, on prend le territoire publié qui le contient :
// le bassin d'emploi d'une commune, le département d'une intercommunalité ou d'une zone d'emploi.
export function territoireEmploi(lignes, maille, codegeo) {
  const trouve = (m, c) => lignes.find((d) => d.maille === m && d.codegeo === c);
  if (["Bassin d'emploi", "Département", "Région"].includes(maille)) return trouve(maille, codegeo);
  const ligne = trouve(maille, codegeo);
  if (maille === "Commune" && ligne?.bassin_emploi) return trouve("Bassin d'emploi", ligne.bassin_emploi);
  if (ligne?.departement) return trouve("Département", ligne.departement);
  return lignes.find((d) => d.maille === "Région");
}

// Libellé d'une maille pour une phrase : « le département », « la commune »...
export function nomMaille(maille) {
  return {
    "Région": "la région", "Département": "le département", "EPCI": "l'intercommunalité",
    "Bassin d'emploi": "le bassin d'emploi", "Zone d'emploi": "la zone d'emploi", "Commune": "la commune"
  }[maille] ?? "le territoire";
}

// Valeurs des indicateurs d'un territoire, à partir de lignes de fact_mobilite :
// renvoie une Map(code_indicateur -> nombre).
export function valeursDe(lignes, maille, codegeo) {
  return new Map(lignes.filter((d) => d.maille === maille && d.codegeo === codegeo).map((d) => [d.code_indicateur, d.nombre]));
}

// Sous-ensemble d'une FeatureCollection : les entités dont le code est dans `codes`.
export function extraire(fc, codes) {
  return {type: "FeatureCollection", features: codes ? fc.features.filter((f) => codes.has(f.properties.codegeo)) : []};
}
