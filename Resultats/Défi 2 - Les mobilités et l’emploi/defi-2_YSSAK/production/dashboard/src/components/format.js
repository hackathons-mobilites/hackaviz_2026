// Formats français et petits utilitaires partagés par les pages.
import * as d3 from "npm:d3";

export const fr = d3.formatLocale({decimal: ",", thousands: " ", grouping: [3], currency: ["", " €"]});

export const fmtInt = fr.format(",.0f");
export const fmtPct = (v) => (v == null ? "–" : fr.format(".1f")(v) + " %");
export const fmtEur = (v) => (v == null ? "–" : fr.format(",.0f")(v) + " €");
export const fmtCompact = (v) => {
  if (v == null) return "–";
  if (Math.abs(v) >= 1e9) return fr.format(".2f")(v / 1e9) + " Md";
  if (Math.abs(v) >= 1e6) return fr.format(".1f")(v / 1e6) + " M";
  if (Math.abs(v) >= 1e3) return fr.format(",.0f")(v);
  return fr.format(".0f")(v);
};

// Formate selon l'unité déclarée dans dim_indicateurs.
export function fmtIndicateur(v, unite) {
  if (v == null) return "–";
  if (unite === "%") return fmtPct(v);
  if (unite && unite.startsWith("€")) return fmtEur(v);
  if (unite === "ratio") return fr.format(".1f")(v);
  if (unite === "emplois pour 100 actifs") return fr.format(".0f")(v);
  return fmtCompact(v);
}

// Transforme des lignes de dim_geo (avec geojson) en FeatureCollection.
export function toFeatureCollection(rows) {
  const features = [];
  for (const r of rows) {
    if (!r.geojson) continue;
    features.push({
      type: "Feature",
      properties: {codegeo: r.codegeo, libgeo: r.libgeo, departement: r.departement, epci: r.epci},
      geometry: JSON.parse(r.geojson)
    });
  }
  return {type: "FeatureCollection", features};
}

// Libellé court d'un territoire pour les axes de graphiques : les intitulés administratifs
// prennent toute la place ("Communauté d'agglomération Roissy Pays de France" -> "CA Roissy Pays de France").
export function nomCourt(libelle) {
  return String(libelle ?? "")
    .replace(/^Communauté d'agglomération (de |du |des |d')?/i, "CA ")
    .replace(/^Communauté de communes (de |du |des |d'|de la |de l')?/i, "CC ")
    .replace(/^Communauté urbaine (de |du |des |d')?/i, "CU ")
    .replace(/^Métropole du Grand Paris$/i, "Métropole du Grand Paris")
    .replace(/ \((EPT \d+|T\d+|CA[A-Z]+|CC[A-Z]+)\)$/i, "")
    .replace(/^(T\d+) /, "$1 · ")
    .trim();
}

// Carte (Map) codegeo -> valeur à partir d'un résultat SQL.
export function indexBy(rows, key, value) {
  const m = new Map();
  for (const r of rows) m.set(r[key], value ? r[value] : r);
  return m;
}

// Couleurs des modes, d'après le code couleur d'Île-de-France Mobilités : le bleu IDFM pour les
// transports en commun (le sujet du dashboard), des gris bleutés pour les autres modes.
export const couleursModes = new Map([
  ["Transports en commun", "#0268d5"], ["Voiture", "#25303b"], ["Vélo", "#7fb2ea"],
  ["Marche", "#a9b4c2"], ["Deux-roues motorisé", "#6b7785"], ["Sans déplacement", "#e0e5ec"]
]);

// Cartes choroplèthes : une seule gamme (bleus) pour tous les indicateurs, pour un rendu sobre.
// Le sens de lecture (favorable / défavorable) est donné par le libellé de la légende.
export function schemeIndicateur() {
  return "blues";
}

// Départements : nuances de bleu et de gris de la charte IDFM (pas d'arc-en-ciel).
export const couleursDep = new Map([
  ["75", "#0268d5"], ["92", "#5a9be6"], ["93", "#c52625"], ["94", "#25303b"],
  ["77", "#a9b4c2"], ["78", "#1b4f8a"], ["91", "#7fb2ea"], ["95", "#6b7785"]
]);

export const nomsDep = new Map([
  ["75", "Paris"], ["77", "Seine-et-Marne"], ["78", "Yvelines"], ["91", "Essonne"],
  ["92", "Hauts-de-Seine"], ["93", "Seine-Saint-Denis"], ["94", "Val-de-Marne"], ["95", "Val-d'Oise"]
]);
