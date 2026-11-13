---
title: Trouver un emploi
---

```js
// Données chargées en entier (voir components/duckdb.js) : évite les erreurs de lecture sur GitHub Pages.
import {tablesCompletes} from "./components/duckdb.js";
const sql = DuckDBClient.sql(tablesCompletes({
  fact_mobilite: FileAttachment("./data/fact_mobilite.parquet"),
  dim_geo: FileAttachment("./data/dim_geo.parquet"),
  fact_bmo: FileAttachment("./data/fact_bmo.parquet")
}));
```

```js
import {fmtInt, fmtPct, toFeatureCollection, indexBy} from "./components/format.js";
import {IDFM, carte, echelleCarte, barresClassees, etiquettesCarte} from "./components/graphiques.js";
import {selecteurTerritoires, territoireEmploi, valeursDe, nomMaille} from "./components/territoires.js";
import {kpi, rangeeKpi, tableauComparaison, aSavoir, source} from "./components/blocs.js";
import {lexique} from "./components/lexique.js";
import {piedSources} from "./components/sources.js";
```

# Où recrute-t-on, et peut-on y aller sans voiture ?

Combien d'embauches les employeurs prévoient en 2026, dans quels métiers, et où le chômage est le plus fort.
Choisissez un territoire dans les filtres, ou **cliquez sur un bassin d'emploi** de la carte.

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

```js
// Les embauches prévues sont publiées par bassin d'emploi, département et région :
// pour un autre type de territoire, on affiche le territoire publié qui le contient.
const refT = territoireEmploi(geoLignes, T.maille, T.codegeo);
const refC = territoireEmploi(geoLignes, T.mailleComp, T.codegeoComp);
```

```sql id=profil
SELECT maille, codegeo, code_indicateur, nombre, periode FROM fact_mobilite
WHERE (maille = ${T.maille} AND codegeo = ${T.codegeo})
   OR (maille = ${T.mailleComp} AND codegeo = ${T.codegeoComp})
   OR (maille = ${refT.maille} AND codegeo = ${refT.codegeo})
   OR (maille = ${refC.maille} AND codegeo = ${refC.codegeo})
```

```sql id=metiers
SELECT metier, SUM(nb_projets) AS projets, SUM(nb_projets_difficiles) AS difficiles,
       100.0 * SUM(nb_projets_difficiles) / NULLIF(SUM(nb_projets), 0) AS part_difficiles
FROM fact_bmo
WHERE (${refT.maille} = 'Bassin d''emploi' AND code_be = ${refT.codegeo})
   OR (${refT.maille} = 'Département' AND departement = ${refT.codegeo})
   OR ${refT.maille} = 'Région'
GROUP BY metier
ORDER BY projets DESC NULLS LAST
LIMIT 10
```

```js
const lignesProfil = profil.toArray();
const P = valeursDe(lignesProfil, T.maille, T.codegeo);
const EP = valeursDe(lignesProfil, refT.maille, refT.codegeo);
const EC = valeursDe(lignesProfil, refC.maille, refC.codegeo);
const periodeChomage = lignesProfil.find((d) => d.code_indicateur === "taux_chomage")?.periode;
const nb = (v) => (v == null ? "–" : fmtInt(v));
const memeTerritoire = refT.maille === T.maille && refT.codegeo === T.codegeo;
```

## Les embauches prévues en 2026

```js
display(memeTerritoire ? html`<span></span>` : html`<p class="indisponible">Les embauches prévues ne sont pas publiées pour ${nomMaille(T.maille)}. Les chiffres ci-dessous sont ceux de <b>${refT.libgeo}</b>, qui contient ${T.libgeo}.</p>`);
```

```js
display(rangeeKpi([
  kpi("Embauches prévues", nb(EP.get("nb_projets_recrutement")), `${refT.libgeo}, en 2026`),
  kpi("Jugées difficiles", fmtPct(EP.get("part_recrutements_difficiles")), "l'employeur craint de ne pas trouver", {accent: "alerte"}),
  kpi("Emplois saisonniers", fmtPct(EP.get("part_recrutements_saisonniers")), "des embauches prévues"),
  // Le taux de chômage n'existe que par département et zone d'emploi : à défaut, celui du département.
  kpi("Taux de chômage", fmtPct(P.get("taux_chomage") ?? ligneDep?.taux_chomage),
    P.get("taux_chomage") != null ? `${T.libgeo}, ${periodeChomage ?? ""}` : ligneDep ? `département : ${ligneDep.libgeo}, ${ligneDep.periode}` : "publié par département et zone d'emploi")
]));
```

<div class="grid grid-cols-3">
<div class="card grid-colspan-2">

## Les 10 métiers les plus recherchés : ${refT.libgeo}

```js
resize((width) => barresClassees(metiers, {
  valeur: "projets", nom: "metier", width,
  etiquette: (d) => `${fmtInt(d.projets)} embauches prévues`,
  infobulle: (d) => `${d.metier}\n${fmtInt(d.projets)} embauches prévues en 2026\ndont ${fmtInt(d.difficiles ?? 0)} que l'employeur juge difficiles à pourvoir (${d.part_difficiles == null ? "–" : Math.round(d.part_difficiles) + " %"})`,
  partie: {valeur: "difficiles", libelle: "Difficiles à pourvoir selon l'employeur", libelleReste: "Autres embauches prévues"},
  max: 10, margeGauche: Math.min(320, width * 0.4), margeDroite: 170
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Chaque barre est un métier : sa longueur est le nombre d'embauches que les employeurs prévoient en 2026. La partie <b>rouge</b> correspond aux embauches pour lesquelles l'employeur pense avoir du mal à trouver quelqu'un (manque de candidats, horaires, trajet…). Plus la partie rouge est grande, plus le métier peine à recruter. Passez la souris sur une barre pour lire les chiffres exacts.</div>

</div>
<div class="card">

<div class="fiche-titre">Comparaison</div>

```js
display(tableauComparaison(refT.libgeo, refC.libgeo, [
  {libelle: "Embauches prévues en 2026", a: EP.get("nb_projets_recrutement"), b: EC.get("nb_projets_recrutement"), format: fmtInt},
  {libelle: "Jugées difficiles", a: EP.get("part_recrutements_difficiles"), b: EC.get("part_recrutements_difficiles"), format: fmtPct},
  {libelle: "Emplois saisonniers", a: EP.get("part_recrutements_saisonniers"), b: EC.get("part_recrutements_saisonniers"), format: fmtPct},
  {libelle: "Habitants allant travailler en transports en commun", a: EP.get("part_tc"), b: EC.get("part_tc"), format: fmtPct},
  {libelle: "Habitants allant travailler en voiture", a: EP.get("part_voiture"), b: EC.get("part_voiture"), format: fmtPct},
  {libelle: "Habitants sans voiture", a: EP.get("part_menages_sans_voiture"), b: EC.get("part_menages_sans_voiture"), format: fmtPct}
]));
```

</div>
</div>

```js
display(aSavoir(
  "Une « embauche prévue » est une intention déclarée par un employeur pour l'année, recueillie par France Travail dans son enquête annuelle « Besoins en main-d'œuvre ». Ce n'est pas une offre d'emploi publiée.",
  "Une embauche est « jugée difficile » quand l'employeur pense avoir du mal à trouver un candidat : manque de candidats, horaires, éloignement, conditions de travail."
));
display(source("France Travail, enquête Besoins en main-d'œuvre 2026 ; INSEE, recensement de la population 2022."));
```

## La carte des 25 bassins d'emploi

```sql id=bassins
SELECT g.codegeo, g.libgeo, g.departement, g.geojson, g.lon, g.lat,
       MAX(CASE WHEN code_indicateur = 'nb_projets_recrutement' THEN nombre END) AS projets,
       MAX(CASE WHEN code_indicateur = 'part_recrutements_difficiles' THEN nombre END) AS part_difficiles,
       MAX(CASE WHEN code_indicateur = 'part_tc' THEN nombre END) AS part_tc,
       MAX(CASE WHEN code_indicateur = 'part_voiture' THEN nombre END) AS part_voiture
FROM dim_geo g
LEFT JOIN fact_mobilite f ON f.maille = g.maille AND f.codegeo = g.codegeo
WHERE g.maille = 'Bassin d''emploi'
GROUP BY g.codegeo, g.libgeo, g.departement, g.geojson, g.lon, g.lat
ORDER BY projets DESC NULLS LAST
```

```sql id=departements
SELECT codegeo, libgeo, geojson FROM dim_geo WHERE maille = 'Département'
```

```js
const lignesBassins = bassins.toArray();
const fcBassins = toFeatureCollection(lignesBassins);
const fcDep = toFeatureCollection(departements);
const parCode = indexBy(lignesBassins, "codegeo");
const codeBassin = refT.maille === "Bassin d'emploi" ? refT.codegeo : null;
const mesures = new Map([
  ["Nombre d'embauches prévues en 2026", "projets"],
  ["Embauches jugées difficiles (%)", "part_difficiles"],
  ["Habitants allant travailler en transports en commun (%)", "part_tc"],
  ["Habitants allant travailler en voiture (%)", "part_voiture"]
]);
```

<div class="filtres filtres-carte">

```js
const mesure = view(Inputs.select(mesures, {label: "Indicateur de la carte", value: "projets"}));
```

</div>

```js
const libMesure = [...mesures].find(([, code]) => code === mesure)[0];
const fmtMesure = (v) => (v == null ? "non disponible" : mesure === "projets" ? `${fmtInt(v)} embauches` : fmtPct(v));
```

<div class="grid grid-cols-3">
<div class="card grid-colspan-2">

```js
resize((width) => carte({
  fc: fcBassins, fcDep, width,
  hauteur: Math.min(620, Math.max(420, width * 0.78)),
  valeur: (f) => parCode.get(f.properties.codegeo)?.[mesure] ?? null,
  couleur: echelleCarte(lignesBassins.map((d) => d[mesure]), {label: libMesure}),
  titre: (f) => `${f.properties.libgeo}\n${fmtMesure(parCode.get(f.properties.codegeo)?.[mesure])}\nCliquez pour choisir ce bassin`,
  contour: 1,
  // Le nom de chaque bassin est écrit sur la carte (nom court).
  marques: width >= 520 ? [etiquettesCarte(lignesBassins, {taille: width >= 800 ? 11 : 9})] : [],
  selection: codeBassin,
  surClic: (p) => selecteur.choisir("Bassin d'emploi", p.codegeo)
}))
```

<div class="note"><b>Comment lire cette carte.</b> Chaque zone est un bassin d'emploi, avec son nom. Plus le bleu est foncé, plus la valeur de l'indicateur choisi est élevée. Cliquez sur un bassin : il devient le territoire principal et tous les chiffres de la page se mettent à jour.</div>

</div>
<div class="card">

```js
resize((width) => barresClassees(lignesBassins, {
  valeur: mesure, nom: "libgeo", width,
  etiquette: (d) => fmtMesure(d[mesure]),
  couleur: (d) => (d.codegeo === codeBassin ? IDFM.encre : IDFM.bleu),
  max: 10, margeGauche: Math.min(170, width * 0.42), margeDroite: 115, forme: "sucette",
  surClic: (d) => selecteur.choisir("Bassin d'emploi", d.codegeo)
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Les 10 bassins où la valeur est la plus élevée : plus le rond est à droite, plus la valeur est forte. Le bassin choisi est en foncé. Cliquez sur un rond pour le choisir.</div>

</div>
</div>

```js
display(source("France Travail, enquête Besoins en main-d'œuvre 2026 ; Région Île-de-France, bassins d'emploi 2021."));
```

## Le chômage

```sql id=ze
SELECT g.libgeo, g.codegeo,
       MAX(CASE WHEN code_indicateur = 'nb_demandeurs_emploi_a' THEN nombre END) AS demandeurs_a,
       MAX(CASE WHEN code_indicateur = 'nb_demandeurs_emploi_a' THEN periode END) AS periode
FROM fact_mobilite f JOIN dim_geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
WHERE f.maille = 'Zone d''emploi'
GROUP BY g.libgeo, g.codegeo ORDER BY demandeurs_a DESC
```

```sql id=dep
SELECT g.libgeo, g.codegeo, f.nombre AS taux_chomage, f.periode
FROM fact_mobilite f JOIN dim_geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
WHERE f.maille = 'Département' AND f.code_indicateur = 'taux_chomage'
ORDER BY f.nombre DESC
```

```js
// Département et zone d'emploi du territoire principal, mis en avant dans les deux classements.
const ligneT = geoLignes.find((d) => d.maille === T.maille && d.codegeo === T.codegeo);
const depT = T.maille === "Département" ? T.codegeo : ligneT?.departement;
const zeT = T.maille === "Zone d'emploi" ? T.codegeo : ligneT?.zone_emploi;
const ligneDep = dep.toArray().find((d) => d.codegeo === depT);
```

<div class="grid grid-cols-2">
<div class="card">

## Taux de chômage par département (${dep.get(0)?.periode ?? ""})

```js
resize((width) => barresClassees(dep, {
  valeur: "taux_chomage", nom: "libgeo", width,
  etiquette: (d) => fmtPct(d.taux_chomage),
  couleur: (d) => (d.codegeo === depT ? IDFM.encre : IDFM.bleu),
  max: 8, margeGauche: 150, margeDroite: 70, forme: "sucette",
  surClic: (d) => selecteur.choisir("Département", d.codegeo)
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Sur 100 personnes qui travaillent ou cherchent un emploi, le nombre de celles qui sont au chômage. Le département du territoire principal est en foncé. Cliquez sur un rond pour le choisir.</div>

</div>
<div class="card">

## Demandeurs d'emploi par zone (fin ${ze.get(0)?.periode ?? ""})

```js
resize((width) => barresClassees(ze, {
  valeur: "demandeurs_a", nom: "libgeo", width,
  etiquette: (d) => fmtInt(d.demandeurs_a),
  couleur: (d) => (d.codegeo === zeT ? IDFM.encre : IDFM.bleu),
  max: 10, margeGauche: 170, margeDroite: 80,
  surClic: (d) => selecteur.choisir("Zone d'emploi", d.codegeo)
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Le nombre de personnes inscrites à France Travail et sans aucune activité, dans les 10 zones d'emploi qui en comptent le plus. La zone du territoire principal est en foncé.</div>

</div>
</div>

```js
display(aSavoir(
  "Le taux de chômage est publié par l'INSEE pour les départements et les zones d'emploi seulement : il n'existe pas par commune.",
  "Un demandeur d'emploi de « catégorie A » est inscrit à France Travail, n'a exercé aucune activité dans le mois et doit chercher un emploi."
));
display(source("INSEE, taux de chômage localisés ; DARES, demandeurs d'emploi inscrits à France Travail."));
```

## Lexique

```js
display(lexique(["Bassin d'emploi", "Projet de recrutement", "Recrutement difficile", "Demandeur d'emploi (catégorie A)", "Taux de chômage", "Zone d'emploi", "Part d'un mode de transport"]))
```

## Sources des données

```js
display(piedSources(["France Travail", "DARES", "INSEE", "Région Île-de-France", "Île-de-France Mobilités"], [
  "Enquête « Besoins en main-d'œuvre » 2026 (France Travail) : embauches prévues par bassin et par métier.",
  "Demandeurs d'emploi inscrits à France Travail (DARES) : nombre par zone d'emploi.",
  "Taux de chômage localisés (INSEE) : taux par département et par zone d'emploi.",
  "Recensement de la population 2022 (INSEE) : mode de transport des habitants.",
  "Bassins d'emploi 2021 (Région Île-de-France) : découpage des 25 bassins."
]))
```
