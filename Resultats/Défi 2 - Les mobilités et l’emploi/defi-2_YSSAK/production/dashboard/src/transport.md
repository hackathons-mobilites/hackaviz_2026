---
title: Gares et stations
---

```js
// Données chargées en entier (voir components/duckdb.js) : évite les erreurs de lecture sur GitHub Pages.
import {tablesCompletes} from "./components/duckdb.js";
const sql = DuckDBClient.sql(tablesCompletes({
  dim_gares: FileAttachment("./data/dim_gares.parquet"),
  dim_geo: FileAttachment("./data/dim_geo.parquet"),
  fact_mobilite: FileAttachment("./data/fact_mobilite.parquet"),
  fact_validations_jour: FileAttachment("./data/fact_validations_jour.parquet")
}));
```

```js
import {fmtInt, fmtPct, fmtCompact, toFeatureCollection, nomsDep} from "./components/format.js";
import {IDFM, carte, barresClassees} from "./components/graphiques.js";
import {recherche} from "./components/filtres.js";
import {selecteurTerritoires, communesDe, communesDuZoom, valeursDe, extraire} from "./components/territoires.js";
import {kpi, rangeeKpi, tableauComparaison, aSavoir, source} from "./components/blocs.js";
import {lexique} from "./components/lexique.js";
import {piedSources} from "./components/sources.js";
```

# Où sont les gares, et lesquelles sont les plus fréquentées ?

Les gares et stations de métro, RER, train et tramway du territoire choisi, avec leur fréquentation sur 12 mois.
**Cliquez sur une commune de la carte** pour la choisir, ou cherchez une gare par son nom.

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
```

```js
// Gare mise en avant sur la carte et dans la fiche (null = aucune).
const gareChoisie = Mutable(null);
const choisirGare = (id) => { gareChoisie.value = id; };
```

```sql id=chiffresReseau
SELECT COUNT(*) AS nb_poles,
       SUM(nb_validations_12m) AS validations,
       COUNT(DISTINCT codegeo_commune) AS communes_desservies,
       MIN(premier_trimestre) AS debut, MAX(dernier_trimestre) AS fin
FROM dim_gares WHERE codegeo_commune IS NOT NULL
```

```sql id=sansGare
SELECT COUNT(*) AS communes,
       SUM(CASE WHEN g.codegeo IS NULL THEN 1 ELSE 0 END) AS sans_gare,
       SUM(CASE WHEN g.codegeo IS NULL THEN a.nombre ELSE 0 END) AS actifs_sans_gare,
       SUM(a.nombre) AS actifs
FROM dim_geo d
LEFT JOIN (SELECT DISTINCT codegeo_commune AS codegeo FROM dim_gares) g ON g.codegeo = d.codegeo
LEFT JOIN fact_mobilite a ON a.maille = 'Commune' AND a.codegeo = d.codegeo AND a.code_indicateur = 'nb_actifs_occupes'
WHERE d.maille = 'Commune'
```

```sql id=gares
SELECT CAST(id_zdc AS VARCHAR) AS id, nom_pole, commune, codegeo_commune, departement, lon, lat, modes, nb_lignes, nb_validations_12m
FROM dim_gares WHERE lon IS NOT NULL
ORDER BY nb_validations_12m DESC NULLS LAST
```

```sql id=communes
SELECT codegeo, libgeo, departement, epci, geojson FROM dim_geo WHERE maille = 'Commune'
```

```sql id=departements
SELECT codegeo, libgeo, geojson FROM dim_geo WHERE maille = 'Département'
```

```js
const K = chiffresReseau.get(0);
const S = sansGare.get(0);
const fc = toFeatureCollection(communes);
const fcDep = toFeatureCollection(departements);
const toutesGares = gares.toArray();
const optionsGares = new Map(toutesGares.map((d) => [`${d.nom_pole} (${d.commune ?? "hors Île-de-France"})`, d.id]));
const nomsModes = new Map([["Métro", "METRO"], ["RER", "RER"], ["Train", "TRAIN"], ["Tramway", "TRAMWAY"]]);
```

```js
const lignesProfil = profil.toArray();
const P = valeursDe(lignesProfil, T.maille, T.codegeo);
const C = valeursDe(lignesProfil, T.mailleComp, T.codegeoComp);
// Communes et gares du territoire principal.
const codesT = communesDe(geoLignes, T.maille, T.codegeo);
const garesT = toutesGares.filter((d) => codesT.has(d.codegeo_commune));
const communesAvecGare = new Set(garesT.map((d) => d.codegeo_commune));
const validationsT = d3.sum(garesT, (d) => d.nb_validations_12m ?? 0);
const parActif = (v, actifs) => (v == null || !actifs ? null : v / actifs);
```

## Les gares du territoire

```js
display(rangeeKpi([
  kpi("Gares et stations", fmtInt(garesT.length), `${T.libgeo} · ${fmtInt(K.nb_poles)} en Île-de-France`, {accent: "bleu"}),
  kpi("Validations en 12 mois", validationsT ? fmtCompact(validationsT) : "–", "passages de carte ou de ticket dans ces gares"),
  kpi("Communes sans gare", `${fmtInt(codesT.size - communesAvecGare.size)} sur ${fmtInt(codesT.size)}`, `dans ${T.libgeo}`, {accent: "alerte"}),
  kpi("Vont travailler en transports en commun", fmtPct(P.get("part_tc")), "des habitants ayant un emploi")
]));
```

## La carte des gares

<div class="filtres filtres-carte">

```js
const modesChoisis = view(Inputs.checkbox(nomsModes, {label: "Type de transport", value: [...nomsModes.values()]}));
```

```js
const vue = view(Inputs.radio(new Map([["Zoom sur le territoire", "territoire"], ["Toute la région", "region"]]), {label: "Vue", value: "territoire"}));
```

```js
display(recherche(optionsGares, {
  label: "Rechercher une gare",
  placeholder: "Tapez un nom, par exemple Châtelet",
  surChoix: choisirGare
}));
```

</div>

```js
const garesVisibles = toutesGares.filter((d) => modesChoisis.some((m) => (d.modes ?? "").includes(m)));
// Zone sur laquelle cadrer la carte, et gares du territoire parmi celles affichées.
const cadre = extraire(fc, communesDuZoom(geoLignes, T.maille, T.codegeo));
const zoomCarte = vue === "territoire" && cadre.features.length ? cadre : null;
const garesClassement = garesVisibles.filter((d) => d.nb_validations_12m && (T.maille === "Région" || codesT.has(d.codegeo_commune)));
const codesDesservis = new Set(garesVisibles.map((d) => d.codegeo_commune).filter(Boolean));
const fcDesservies = {type: "FeatureCollection", features: fc.features.filter((f) => codesDesservis.has(f.properties.codegeo))};
const G = toutesGares.find((d) => d.id === gareChoisie);
const rang = G ? toutesGares.indexOf(G) + 1 : null;
```

<div class="grid grid-cols-3">
<div class="card grid-colspan-2">

```js
resize((width) => carte({
  fc, fcDep, width,
  zoom: zoomCarte,
  selection: codesT.size <= 40 ? codesT : null,
  surClic: (p) => selecteur.choisir("Commune", p.codegeo),
  echelles: {r: {range: zoomCarte ? [3, 26] : [1.5, 18]}},
  marques: [
    Plot.geo(fcDesservies, {fill: IDFM.bleuPale, stroke: "white", strokeWidth: 0.3}),
    Plot.geo(fcDep, {stroke: IDFM.gris, strokeWidth: 0.8, fill: "none"}),
    Plot.dot(garesVisibles, {
      x: "lon", y: "lat", r: (d) => d.nb_validations_12m ?? 0,
      fill: IDFM.bleu, fillOpacity: 0.55, stroke: "white", strokeWidth: 0.5, tip: true,
      title: (d) => `${d.nom_pole}\n${d.commune ?? "hors Île-de-France"}\n${d.nb_validations_12m ? fmtInt(d.nb_validations_12m) + " validations en 12 mois" : "fréquentation non publiée"}`
    }),
    // En vue zoomée, le nom des gares les plus fréquentées du territoire est écrit sur la carte.
    ...(zoomCarte ? [Plot.text(garesClassement.slice(0, 14), {
      x: "lon", y: "lat", text: "nom_pole", dy: -12, fontSize: 11, fontWeight: 600, lineWidth: 10,
      fill: IDFM.encre, stroke: "white", strokeWidth: 3, paintOrder: "stroke", pointerEvents: "none"
    })] : []),
    ...(G ? [
      Plot.dot([G], {x: "lon", y: "lat", r: 9, fill: "none", stroke: IDFM.rouge, strokeWidth: 3}),
      Plot.text([G], {x: "lon", y: "lat", text: "nom_pole", dy: -16, fill: IDFM.encre, stroke: "white", strokeWidth: 4, fontWeight: 700, fontSize: 13})
    ] : [])
  ]
}))
```

<div class="note"><b>Comment lire cette carte.</b> Chaque rond bleu est une gare ou une station : plus le rond est grand, plus elle est fréquentée. Les communes en bleu clair ont au moins une gare, celles en gris n'en ont pas. La gare recherchée est entourée en rouge. Passez la souris sur un rond pour lire son nom.</div>

</div>
<div class="card fiche">

<div class="fiche-titre">Fiche de la gare</div>

## ${G ? G.nom_pole : "Aucune gare choisie"}

```js
display(G
  ? html`<div>
      <div class="fiche-ligne"><span>Commune</span><b>${G.commune ?? "hors Île-de-France"}</b></div>
      <div class="fiche-ligne"><span>Type de transport</span><b>${String(G.modes ?? "–").toLowerCase()}</b></div>
      <div class="fiche-ligne"><span>Nombre de lignes</span><b>${G.nb_lignes ?? "–"}</b></div>
      <div class="fiche-ligne"><span>Validations en 12 mois</span><b>${G.nb_validations_12m ? fmtInt(G.nb_validations_12m) : "non publié"}</b></div>
      <div class="fiche-ligne"><span>Rang de fréquentation</span><b>${G.nb_validations_12m ? `${rang}ᵉ sur ${toutesGares.length}` : "–"}</b></div>
    </div>`
  : html`<p class="muted">Tapez le nom d'une gare dans le champ « Rechercher une gare », ou cliquez sur une barre du classement ci-dessous.</p>`);
```

</div>
</div>

<div class="grid grid-cols-2">
<div class="card">

## Les gares les plus fréquentées : ${T.libgeo}

```js
resize((width) => barresClassees(garesClassement, {
  valeur: "nb_validations_12m", nom: "nom_pole", width,
  etiquette: (d) => `${fmtCompact(d.nb_validations_12m)} validations`,
  couleur: (d) => (d.id === gareChoisie ? IDFM.encre : IDFM.bleu),
  max: 10, margeGauche: 170, margeDroite: 130,
  surClic: (d) => choisirGare(d.id)
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Les gares du territoire principal qui comptent le plus de validations en 12 mois (10 au plus), selon les types de transport cochés. « M » signifie million. Cliquez sur une barre pour repérer la gare sur la carte.</div>

</div>
<div class="card">

## La fréquentation jour après jour

```sql id=jours
SELECT jour, nb_validations FROM fact_validations_jour ORDER BY jour
```

```js
// Les dates arrivent de DuckDB sous forme de nombre (millisecondes) : on les convertit en vraies dates,
// sinon l'axe affiche des nombres bruts.
const lignesJours = jours.toArray().map((d) => ({jour: new Date(d.jour), nb_validations: d.nb_validations}));
const moisFr = d3.timeFormatLocale({dateTime: "%A %e %B %Y à %X", date: "%d/%m/%Y", time: "%H:%M:%S", periods: ["AM", "PM"],
  days: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"], shortDays: ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."],
  months: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  shortMonths: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]});
const formatMois = moisFr.format("%b %Y");
```

```js
resize((width) => Plot.plot({
  width,
  height: 350,
  marginLeft: 55,
  marginBottom: 36,
  style: {fontSize: "13px"},
  x: {label: null, type: "utc", tickFormat: formatMois, ticks: d3.utcMonth.every(width < 700 ? 3 : width < 1000 ? 2 : 1)},
  y: {label: "Validations par jour (moyenne sur 7 jours)", tickFormat: fmtCompact, grid: true},
  marks: [
    Plot.lineY(lignesJours, Plot.windowY({k: 7, anchor: "end", strict: true}, {x: "jour", y: "nb_validations", stroke: IDFM.bleu, strokeWidth: 2.5})),
    Plot.ruleY([0], {stroke: IDFM.grisClair}),
    Plot.ruleX(lignesJours, Plot.pointerX({x: "jour", stroke: IDFM.grisClair})),
    Plot.tip(lignesJours, Plot.pointerX({x: "jour", y: "nb_validations", title: (d) => `${d.jour.toLocaleDateString("fr-FR", {weekday: "long", day: "numeric", month: "long", year: "numeric"})}\n${fmtInt(d.nb_validations)} validations ce jour-là`}))
  ]
}))
```

<div class="note"><b>Comment lire ce graphique.</b> La courbe suit le nombre de validations sur tout le réseau ferré. Chaque point est la moyenne des 7 derniers jours, pour gommer l'effet du week-end. Les creux correspondent aux vacances scolaires et aux jours fériés. Passez la souris pour lire le chiffre d'un jour précis.</div>

</div>
</div>

## Comparaison avec ${T.libgeoComp}

<div class="card">

```js
display(tableauComparaison(T.libgeo, T.libgeoComp, [
  {libelle: "Gares et stations", a: P.get("nb_gares") ?? 0, b: C.get("nb_gares") ?? 0, format: fmtInt},
  {libelle: "Validations en 12 mois", a: P.get("nb_validations_12m"), b: C.get("nb_validations_12m"), format: fmtCompact},
  {libelle: "Validations par habitant ayant un emploi", a: parActif(P.get("nb_validations_12m"), P.get("nb_actifs_occupes")), b: parActif(C.get("nb_validations_12m"), C.get("nb_actifs_occupes")), format: (v) => fmtInt(v)},
  {libelle: "Vont travailler en transports en commun", a: P.get("part_tc"), b: C.get("part_tc"), format: fmtPct},
  {libelle: "Vont travailler en voiture", a: P.get("part_voiture"), b: C.get("part_voiture"), format: fmtPct}
]));
```

<div class="note"><b>Comment lire ce tableau.</b> Les mêmes chiffres pour le territoire principal et pour le territoire de comparaison choisis dans les filtres. La petite barre sous chaque chiffre montre lequel est le plus grand.</div>

</div>

```js
display(aSavoir(
  "Une « validation » est un passage de carte ou de ticket devant une borne. Une personne qui valide à l'aller et au retour compte pour deux validations.",
  "Les validations sont comptées dans la gare où elles ont lieu : un territoire qui accueille beaucoup d'emplois en compte beaucoup, même si ses habitants sont peu nombreux. La fréquentation n'est pas publiée pour environ une gare sur quatre, surtout des stations de tramway."
));
display(source("Île-de-France Mobilités, emplacement des gares et validations sur le réseau ferré ; INSEE, recensement de la population 2022."));
```

## Par département

```sql id=parDep
SELECT g.libgeo AS departement,
       MAX(CASE WHEN f.code_indicateur = 'nb_gares' THEN f.nombre END) AS gares,
       MAX(CASE WHEN f.code_indicateur = 'nb_validations_12m' THEN f.nombre END) AS validations,
       MAX(CASE WHEN f.code_indicateur = 'part_tc' THEN f.nombre END) AS part_tc
FROM fact_mobilite f
JOIN dim_geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
WHERE f.maille = 'Département'
GROUP BY g.libgeo
```

<div class="filtres">

```js
const critereDep = view(Inputs.radio(new Map([["Nombre de gares", "gares"], ["Validations en 12 mois", "validations"], ["Habitants allant travailler en transports en commun (%)", "part_tc"]]), {label: "Comparer", value: "gares"}));
```

</div>

<div class="card">

```js
resize((width) => barresClassees(parDep, {
  valeur: critereDep, nom: "departement", width,
  etiquette: (d) => (critereDep === "part_tc" ? fmtPct(d.part_tc) : critereDep === "validations" ? fmtCompact(d.validations) : fmtInt(d.gares)),
  max: 8, margeGauche: 150, margeDroite: 90, forme: "sucette"
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Les 8 départements classés selon le critère choisi juste au-dessus : plus le rond est à droite, plus la valeur est forte. Paris concentre les validations parce que beaucoup de voyageurs venus d'ailleurs y passent.</div>

</div>

## Lexique

```js
display(lexique(["Gare ou station (pôle ferré)", "Validation", "Transports en commun", "Part d'un mode de transport", "Commune", "Département"]))
```

## Sources des données

```js
display(piedSources(["Île-de-France Mobilités", "INSEE", "Etalab", "IGN"], [
  "Emplacement des gares et stations (Île-de-France Mobilités).",
  "Validations sur le réseau ferré, 4 derniers trimestres publiés (Île-de-France Mobilités). La fréquentation n'est pas publiée pour environ une gare sur quatre, surtout des stations de tramway.",
  "Recensement de la population 2022 (INSEE) : habitants ayant un emploi et mode de transport.",
  "Contours des communes (Etalab, IGN) : fonds de carte."
]))
```
