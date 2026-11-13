---
title: Se déplacer
---

```js
// Données chargées en entier (voir components/duckdb.js) : évite les erreurs de lecture sur GitHub Pages.
import {tablesCompletes} from "./components/duckdb.js";
const sql = DuckDBClient.sql(tablesCompletes({
  fact_mobilite: FileAttachment("./data/fact_mobilite.parquet"),
  dim_geo: FileAttachment("./data/dim_geo.parquet")
}));
```

```js
import {fmtInt, fmtPct, fmtEur, toFeatureCollection, indexBy} from "./components/format.js";
import {IDFM, carte, echelleCarte, barresClassees, barresModes, anneau} from "./components/graphiques.js";
import {selecteurTerritoires, communesDe, communesDuZoom, valeursDe, extraire, nomMaille} from "./components/territoires.js";
import {kpi, rangeeKpi, tableauComparaison, aSavoir, source} from "./components/blocs.js";
import {recherche} from "./components/filtres.js";
import {lexique} from "./components/lexique.js";
import {piedSources} from "./components/sources.js";
```

# Comment va-t-on travailler ?

Choisissez un territoire dans les filtres : les chiffres, les graphiques et la carte se mettent à jour.
Vous pouvez aussi **cliquer sur la carte** pour choisir un territoire.

```sql id=listeGeo
SELECT maille, codegeo, libgeo, departement, epci, zone_emploi, bassin_emploi, region FROM dim_geo
```

```js
const geoLignes = listeGeo.toArray();
const selecteur = selecteurTerritoires(geoLignes);
```

```js
const T = view(selecteur);
```

```sql id=profil
SELECT maille, codegeo, code_indicateur, nombre FROM fact_mobilite
WHERE (maille = ${T.maille} AND codegeo = ${T.codegeo})
   OR (maille = ${T.mailleComp} AND codegeo = ${T.codegeoComp})
   OR maille = 'Région'
```

```js
const lignesProfil = profil.toArray();
const P = valeursDe(lignesProfil, T.maille, T.codegeo);
const C = valeursDe(lignesProfil, T.mailleComp, T.codegeoComp);
const R = valeursDe(lignesProfil, "Région", "11");
const nb = (v) => (v == null ? "–" : fmtInt(v));
```

## Les habitants et leurs trajets

```js
display(rangeeKpi([
  kpi("Habitants ayant un emploi", nb(P.get("nb_actifs_occupes")), `${T.libgeo}, recensement 2022`),
  kpi("En transports en commun", fmtPct(P.get("part_tc")), "des trajets vers le travail", {accent: "bleu"}),
  kpi("En voiture", fmtPct(P.get("part_voiture")), "des trajets vers le travail"),
  kpi("Travaillent hors de leur commune", fmtPct(P.get("part_hors_commune")), "des habitants ayant un emploi")
]));
```

<div class="grid grid-cols-3">
<div class="card grid-colspan-2">

## Les moyens de transport : ${T.libgeo}

```js
const modesTerritoire = [
  {mode: "Transports en commun", part: P.get("part_tc")},
  {mode: "Voiture", part: P.get("part_voiture")},
  {mode: "Marche à pied", part: P.get("part_marche")},
  {mode: "Vélo", part: P.get("part_velo")},
  {mode: "Deux-roues motorisé", part: P.get("part_2rm")}
];
```

```js
resize((width) => anneau(modesTerritoire, {
  valeur: "part", nom: "mode", width,
  etiquette: (d) => fmtPct(d.part),
  centre: fmtPct(P.get("part_tc")),
  sousCentre: ["en transports", "en commun"]
}))
```

<div class="note"><b>Comment lire ce graphique.</b> L'anneau représente toutes les personnes du territoire qui se déplacent pour aller travailler. Chaque part de couleur est un moyen de transport ; la liste donne le nombre de personnes sur 100 qui l'utilisent. Les transports en commun sont en bleu.</div>

</div>
<div class="card">

<div class="fiche-titre">Comparaison</div>

```js
display(tableauComparaison(T.libgeo, T.libgeoComp, [
  {libelle: "Transports en commun", a: P.get("part_tc"), b: C.get("part_tc"), format: fmtPct},
  {libelle: "Voiture", a: P.get("part_voiture"), b: C.get("part_voiture"), format: fmtPct},
  {libelle: "Marche à pied", a: P.get("part_marche"), b: C.get("part_marche"), format: fmtPct},
  {libelle: "Vélo", a: P.get("part_velo"), b: C.get("part_velo"), format: fmtPct},
  {libelle: "Travaillent hors de leur commune", a: P.get("part_hors_commune"), b: C.get("part_hors_commune"), format: fmtPct},
  {libelle: "N'ont pas de voiture", a: P.get("part_menages_sans_voiture"), b: C.get("part_menages_sans_voiture"), format: fmtPct}
]));
```

</div>
</div>

```js
display(aSavoir(
  "Un « habitant ayant un emploi » est une personne de 15 ans ou plus qui travaille, comptée là où elle habite.",
  "Chaque personne indique le moyen de transport qu'elle utilise le plus souvent pour aller travailler. Les pourcentages sont calculés sur les personnes qui se déplacent : celles qui travaillent chez elles ne sont pas comptées."
));
display(source("INSEE, recensement de la population 2022 (fichier « mobilités professionnelles »)."));
```

## La carte

```sql id=listeCommunes
SELECT codegeo, libgeo, departement FROM dim_geo WHERE maille = 'Commune' ORDER BY libgeo
```

```js
const optionsCommunes = new Map(listeCommunes.toArray().map((d) => [`${d.libgeo} (${d.departement})`, d.codegeo]));
const indicOptions = new Map([
  ["Vont travailler en transports en commun (%)", "part_tc"],
  ["Vont travailler en voiture (%)", "part_voiture"],
  ["Vont travailler à vélo (%)", "part_velo"],
  ["Vont travailler à pied (%)", "part_marche"],
  ["N'ont pas de voiture (%)", "part_menages_sans_voiture"],
  ["Travaillent hors de leur commune (%)", "part_hors_commune"],
  ["Niveau de vie médian (€ par an)", "mediane_niveau_vie"]
]);
```

<div class="filtres filtres-carte">

```js
const indicateur = view(Inputs.select(indicOptions, {label: "Indicateur de la carte", value: "part_tc"}));
```

```js
const decoupage = view(Inputs.radio(["Commune", "Département"], {label: "Découpage", value: "Commune"}));
```

```js
const vue = view(Inputs.radio(new Map([["Zoom sur le territoire", "territoire"], ["Toute la région", "region"]]), {label: "Vue", value: "territoire"}));
```

```js
display(recherche(optionsCommunes, {
  label: "Rechercher une commune",
  placeholder: "Tapez un nom, par exemple Montreuil",
  surChoix: (code) => selecteur.choisir("Commune", code)
}));
```

</div>

```sql id=valeurs
SELECT f.codegeo, f.nombre, f.fiable, g.libgeo
FROM fact_mobilite f
JOIN dim_geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
WHERE f.maille = ${decoupage} AND f.code_indicateur = ${indicateur}
```

```sql id=geo
SELECT codegeo, libgeo, departement, epci, geojson FROM dim_geo WHERE maille = ${decoupage}
```

```sql id=departements
SELECT codegeo, libgeo, geojson FROM dim_geo WHERE maille = 'Département'
```

```js
const fc = toFeatureCollection(geo);
const fcDep = toFeatureCollection(departements);
const vals = indexBy(valeurs, "codegeo");
const libIndic = [...indicOptions].find(([, code]) => code === indicateur)[0];
const fmtVal = (v) => (v == null ? "non disponible" : indicateur === "mediane_niveau_vie" ? fmtEur(v) : fmtPct(v));
// Une valeur calculée sur trop peu de personnes n'est pas affichée (territoire en gris).
const valeurCarte = (f) => { const v = vals.get(f.properties.codegeo); return v && v.fiable ? v.nombre : null; };
const lignesClassement = valeurs.toArray().filter((d) => d.fiable && d.nombre != null);
```

```js
// Communes du territoire principal, et zone sur laquelle cadrer la carte.
const codesT = communesDe(geoLignes, T.maille, T.codegeo);
const codesZoom = communesDuZoom(geoLignes, T.maille, T.codegeo);
const depsZoom = new Set(geoLignes.filter((d) => d.maille === "Commune" && codesZoom?.has(d.codegeo)).map((d) => d.departement));
const depsT = new Set(geoLignes.filter((d) => d.maille === "Commune" && codesT.has(d.codegeo)).map((d) => d.departement));
const cadre = extraire(fc, decoupage === "Commune" ? codesZoom : depsZoom);
const zoomCarte = vue === "territoire" && cadre.features.length ? cadre : null;
// Le territoire principal est entouré en noir (quand il ne compte pas trop de communes, pour rester lisible).
const entoures = decoupage === "Commune" ? (codesT.size <= 40 ? codesT : null) : (T.maille === "Région" ? null : depsT);
// En vue zoomée, seuls les territoires de la zone sont colorés (les autres passent en gris) et l'échelle
// de couleurs est recalculée sur la zone : sinon tout apparaît de la même couleur.
const codesCadre = zoomCarte ? new Set(zoomCarte.features.map((f) => f.properties.codegeo)) : null;
const valeurAffichee = (f) => (codesCadre && !codesCadre.has(f.properties.codegeo) ? null : valeurCarte(f));
const etiquettes = zoomCarte && zoomCarte.features.length <= 45
  ? [Plot.text(zoomCarte.features, Plot.centroid({
      text: (f) => f.properties.libgeo, fontSize: 11, fontWeight: 600, lineWidth: 8,
      fill: IDFM.encre, stroke: "white", strokeWidth: 3, paintOrder: "stroke", pointerEvents: "none"
    }))]
  : [];
```

<div class="grid grid-cols-3">
<div class="card grid-colspan-2">

## ${libIndic}

```js
resize((width) => carte({
  fc, fcDep, width,
  zoom: zoomCarte,
  valeur: valeurAffichee,
  couleur: echelleCarte(fc.features.map(valeurAffichee), {label: libIndic}),
  marques: etiquettes,
  titre: (f) => `${f.properties.libgeo}\n${fmtVal(vals.get(f.properties.codegeo)?.nombre)}\nCliquez pour choisir ce territoire`,
  contour: decoupage === "Commune" ? 0.3 : 1,
  selection: entoures,
  surClic: (p) => selecteur.choisir(decoupage, p.codegeo)
}))
```

<div class="note"><b>Comment lire cette carte.</b> Plus le bleu est foncé, plus la valeur est élevée ; la légende donne les limites de chaque couleur. En gris : territoire hors de la zone affichée, pas de donnée, ou trop peu d'habitants pour un chiffre fiable. En vue zoomée, les couleurs comparent les territoires de la zone entre eux. <b>Cliquez sur un territoire</b> : il devient le territoire principal, la carte zoome dessus et sa fiche s'affiche à droite.</div>

</div>
<div class="card fiche">

<div class="fiche-titre">Fiche du territoire</div>

## ${T.libgeo}

<div class="fiche-ligne"><span>Habitants ayant un emploi</span><b>${nb(P.get("nb_actifs_occupes"))}</b></div>
<div class="fiche-ligne"><span>Emplois situés dans le territoire</span><b>${nb(P.get("nb_emplois"))}</b></div>
<div class="fiche-ligne"><span>Vont travailler en transports en commun</span><b>${fmtPct(P.get("part_tc"))}</b></div>
<div class="fiche-ligne"><span>Vont travailler en voiture</span><b>${fmtPct(P.get("part_voiture"))}</b></div>
<div class="fiche-ligne"><span>Vont travailler à vélo</span><b>${fmtPct(P.get("part_velo"))}</b></div>
<div class="fiche-ligne"><span>Vont travailler à pied</span><b>${fmtPct(P.get("part_marche"))}</b></div>
<div class="fiche-ligne"><span>N'ont pas de voiture</span><b>${fmtPct(P.get("part_menages_sans_voiture"))}</b></div>
<div class="fiche-ligne"><span>Niveau de vie médian (par an)</span><b>${fmtEur(P.get("mediane_niveau_vie"))}</b></div>
<div class="fiche-ligne"><span>Gares et stations</span><b>${nb(P.get("nb_gares") ?? 0)}</b></div>

<div class="fiche-titre">Comparé à ${T.libgeoComp}</div>

```js
resize((width) => barresModes([
  {nom: T.libgeo, tc: P.get("part_tc"), voiture: P.get("part_voiture")},
  ...(T.libgeoComp !== T.libgeo ? [{nom: T.libgeoComp, tc: C.get("part_tc"), voiture: C.get("part_voiture")}] : [])
], {width, margeGauche: Math.min(120, width * 0.34)}))
```

<div class="muted">Sur 100 personnes qui se déplacent pour aller travailler.</div>

</div>
</div>

```js
display(source("INSEE, recensement de la population 2022 et Filosofi 2021 ; contours des communes : Etalab, IGN."));
```

## Le classement : ${libIndic}

<div class="card">

```js
resize((width) => barresClassees(lignesClassement, {
  valeur: "nombre", nom: "libgeo", width,
  etiquette: (d) => fmtVal(d.nombre),
  couleur: (d) => (decoupage === T.maille && d.codegeo === T.codegeo ? IDFM.encre : IDFM.bleu),
  max: 10, margeGauche: 200, margeDroite: 80, forme: "sucette",
  surClic: (d) => selecteur.choisir(decoupage, d.codegeo)
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Les 10 territoires où la valeur est la plus élevée, pour l'indicateur et le découpage choisis au-dessus de la carte. Plus le rond est à droite, plus la valeur est forte. Cliquez sur un rond : le territoire devient le territoire principal.</div>

</div>

## Lexique

```js
display(lexique(["Actif occupé", "Part d'un mode de transport", "Transports en commun", "Commune", "Département", "Intercommunalité (EPCI)", "Niveau de vie médian", "Donnée peu fiable"]))
```

## Sources des données

```js
display(piedSources(["INSEE", "Île-de-France Mobilités", "Etalab", "IGN"], [
  "Recensement de la population 2022, fichier « mobilités professionnelles » (INSEE) : mode de transport, lieu de travail, voiture du ménage.",
  "Filosofi 2021 (INSEE) : niveau de vie médian.",
  "Emplacement des gares (Île-de-France Mobilités) : nombre de gares et stations par territoire.",
  "Contours des communes (Etalab, IGN) : fonds de carte."
]))
```
