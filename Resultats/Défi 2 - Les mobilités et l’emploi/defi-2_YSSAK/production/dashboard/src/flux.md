---
title: D'où viennent les travailleurs
---

```js
// Données chargées en entier (voir components/duckdb.js) : évite les erreurs de lecture sur GitHub Pages.
import {tablesCompletes} from "./components/duckdb.js";
const sql = DuckDBClient.sql(tablesCompletes({
  fact_flux: FileAttachment("./data/fact_flux.parquet"),
  dim_geo: FileAttachment("./data/dim_geo.parquet"),
  modes_transport: FileAttachment("./data/modes_transport.parquet")
}));
```

```js
import {fmtInt, fmtPct, fmtCompact, toFeatureCollection, indexBy} from "./components/format.js";
import {IDFM, carte, echelleCarte, barresClassees, anneau} from "./components/graphiques.js";
import {selecteurTerritoires} from "./components/territoires.js";
import {kpi, rangeeKpi, tableauComparaison, aSavoir, source} from "./components/blocs.js";
import {lexique} from "./components/lexique.js";
import {piedSources} from "./components/sources.js";
```

# D'où viennent les personnes qui travaillent ici ?

Choisissez un territoire dans les filtres. La carte montre dans quelles communes habitent les personnes qui viennent
y travailler, ou, dans l'autre sens, où vont travailler ses habitants. **Cliquez sur une commune de la carte** pour la choisir à son tour.

```sql id=listeGeo
SELECT maille, codegeo, libgeo, departement, epci, zone_emploi, bassin_emploi, region, lon, lat FROM dim_geo
```

```js
const geoLignes = listeGeo.toArray();
const selecteur = selecteurTerritoires(geoLignes);
```

```js
const T = view(selecteur);
```

<div class="filtres filtres-carte">

```js
const sens = view(Inputs.radio(new Map([["Qui vient y travailler ?", "entrant"], ["Où vont travailler ses habitants ?", "sortant"]]), {label: "Question", value: "entrant"}));
```

</div>

```js
const mailleChoisie = T.maille;
const codeChoisi = T.codegeo;
const terr = geoLignes.find((d) => d.maille === mailleChoisie && d.codegeo === codeChoisi);
// Colonne de dim_geo (maille Commune) qui rattache une commune au territoire choisi
const colonne = {"EPCI": "epci", "Département": "departement", "Bassin d'emploi": "bassin_emploi", "Zone d'emploi": "zone_emploi", "Région": "region"}[mailleChoisie] ?? "codegeo";
```

```sql id=flux
WITH cibles AS (
  SELECT codegeo FROM dim_geo WHERE maille = 'Commune'
    AND ((${mailleChoisie} = 'EPCI' AND epci = ${codeChoisi})
      OR (${mailleChoisie} = 'Département' AND departement = ${codeChoisi})
      OR (${mailleChoisie} = 'Bassin d''emploi' AND bassin_emploi = ${codeChoisi})
      OR (${mailleChoisie} = 'Zone d''emploi' AND zone_emploi = ${codeChoisi})
      OR (${mailleChoisie} = 'Région' AND region = ${codeChoisi})
      OR (${mailleChoisie} = 'Commune' AND codegeo = ${codeChoisi}))
),
f AS (
  SELECT
    CASE WHEN ${sens} = 'entrant' THEN commune_residence ELSE commune_travail END AS commune,
    code_trans, nb_actifs
  FROM fact_flux
  WHERE (${sens} = 'entrant' AND commune_travail IN (SELECT codegeo FROM cibles)
         AND commune_residence NOT IN (SELECT codegeo FROM cibles))
     OR (${sens} = 'sortant' AND commune_residence IN (SELECT codegeo FROM cibles)
         AND commune_travail NOT IN (SELECT codegeo FROM cibles))
)
SELECT f.commune, g.libgeo, g.departement, g.lon, g.lat,
       SUM(nb_actifs) AS nb_actifs,
       100.0 * SUM(CASE WHEN code_trans = '6' THEN nb_actifs END) / NULLIF(SUM(CASE WHEN code_trans <> '1' THEN nb_actifs END), 0) AS part_tc,
       100.0 * SUM(CASE WHEN code_trans = '5' THEN nb_actifs END) / NULLIF(SUM(CASE WHEN code_trans <> '1' THEN nb_actifs END), 0) AS part_voiture
FROM f
LEFT JOIN dim_geo g ON g.maille = 'Commune' AND g.codegeo = f.commune
GROUP BY f.commune, g.libgeo, g.departement, g.lon, g.lat
ORDER BY nb_actifs DESC
```

```sql id=interne
WITH cibles AS (
  SELECT codegeo FROM dim_geo WHERE maille = 'Commune'
    AND ((${mailleChoisie} = 'EPCI' AND epci = ${codeChoisi})
      OR (${mailleChoisie} = 'Département' AND departement = ${codeChoisi})
      OR (${mailleChoisie} = 'Bassin d''emploi' AND bassin_emploi = ${codeChoisi})
      OR (${mailleChoisie} = 'Zone d''emploi' AND zone_emploi = ${codeChoisi})
      OR (${mailleChoisie} = 'Région' AND region = ${codeChoisi})
      OR (${mailleChoisie} = 'Commune' AND codegeo = ${codeChoisi}))
)
SELECT
  SUM(CASE WHEN commune_residence IN (SELECT codegeo FROM cibles) AND commune_travail IN (SELECT codegeo FROM cibles) THEN nb_actifs END) AS internes,
  SUM(CASE WHEN commune_travail IN (SELECT codegeo FROM cibles) AND commune_residence NOT IN (SELECT codegeo FROM cibles) THEN nb_actifs END) AS entrants,
  SUM(CASE WHEN commune_residence IN (SELECT codegeo FROM cibles) AND commune_travail NOT IN (SELECT codegeo FROM cibles) THEN nb_actifs END) AS sortants
FROM fact_flux
```

```sql id=interneComp
WITH cibles AS (
  SELECT codegeo FROM dim_geo WHERE maille = 'Commune'
    AND ((${T.mailleComp} = 'EPCI' AND epci = ${T.codegeoComp})
      OR (${T.mailleComp} = 'Département' AND departement = ${T.codegeoComp})
      OR (${T.mailleComp} = 'Bassin d''emploi' AND bassin_emploi = ${T.codegeoComp})
      OR (${T.mailleComp} = 'Zone d''emploi' AND zone_emploi = ${T.codegeoComp})
      OR (${T.mailleComp} = 'Région' AND region = ${T.codegeoComp})
      OR (${T.mailleComp} = 'Commune' AND codegeo = ${T.codegeoComp}))
)
SELECT
  SUM(CASE WHEN commune_residence IN (SELECT codegeo FROM cibles) AND commune_travail IN (SELECT codegeo FROM cibles) THEN nb_actifs END) AS internes,
  SUM(CASE WHEN commune_travail IN (SELECT codegeo FROM cibles) AND commune_residence NOT IN (SELECT codegeo FROM cibles) THEN nb_actifs END) AS entrants,
  SUM(CASE WHEN commune_residence IN (SELECT codegeo FROM cibles) AND commune_travail NOT IN (SELECT codegeo FROM cibles) THEN nb_actifs END) AS sortants
FROM fact_flux
```

```sql id=modes
WITH cibles AS (
  SELECT codegeo FROM dim_geo WHERE maille = 'Commune'
    AND ((${mailleChoisie} = 'EPCI' AND epci = ${codeChoisi})
      OR (${mailleChoisie} = 'Département' AND departement = ${codeChoisi})
      OR (${mailleChoisie} = 'Bassin d''emploi' AND bassin_emploi = ${codeChoisi})
      OR (${mailleChoisie} = 'Zone d''emploi' AND zone_emploi = ${codeChoisi})
      OR (${mailleChoisie} = 'Région' AND region = ${codeChoisi})
      OR (${mailleChoisie} = 'Commune' AND codegeo = ${codeChoisi}))
)
SELECT m.mode_court AS mode, SUM(f.nb_actifs) AS nb_actifs
FROM fact_flux f
JOIN modes_transport m ON m.code_trans = f.code_trans
WHERE f.code_trans <> '1'
  AND ((${sens} = 'entrant' AND f.commune_travail IN (SELECT codegeo FROM cibles) AND f.commune_residence NOT IN (SELECT codegeo FROM cibles))
    OR (${sens} = 'sortant' AND f.commune_residence IN (SELECT codegeo FROM cibles) AND f.commune_travail NOT IN (SELECT codegeo FROM cibles)))
GROUP BY m.mode_court
```

```sql id=communes
SELECT codegeo, libgeo, departement, epci, bassin_emploi, geojson FROM dim_geo WHERE maille = 'Commune'
```

```sql id=departements
SELECT codegeo, libgeo, geojson FROM dim_geo WHERE maille = 'Département'
```

```js
const I = interne.get(0);
const totalFlux = sens === "entrant" ? I.entrants : I.sortants;
const fc = toFeatureCollection(communes);
const fcDep = toFeatureCollection(departements);
const lignesFlux = flux.toArray().filter((d) => d.lon != null);
const parCommune = indexBy(lignesFlux, "commune");
const principaux = lignesFlux.slice(0, 10);
const codesCibles = new Set(communes.toArray().filter((d) => d[colonne] === codeChoisi).map((d) => d.codegeo));
const fcCibles = {type: "FeatureCollection", features: fc.features.filter((f) => codesCibles.has(f.properties.codegeo))};
const lignesModes = modes.toArray();
const totalModes = d3.sum(lignesModes, (d) => d.nb_actifs);
const phrase = sens === "entrant" ? `Personnes venant travailler dans : ${terr?.libgeo ?? ""}` : `Lieu de travail des habitants de : ${terr?.libgeo ?? ""}`;
```

## Les chiffres du territoire

```js
display(rangeeKpi([
  kpi("Habitent et travaillent ici", fmtCompact(I.internes), `personnes, dans ${T.libgeo}`),
  kpi("Entrants", fmtCompact(I.entrants), "habitent ailleurs, travaillent ici", {accent: "bleu"}),
  kpi("Sortants", fmtCompact(I.sortants), "habitent ici, travaillent ailleurs")
]));
```

## La carte des trajets

<div class="card">

## ${phrase}

```js
resize((width) => carte({
  fc, fcDep, width,
  valeur: (f) => (codesCibles.has(f.properties.codegeo) ? null : parCommune.get(f.properties.codegeo)?.nb_actifs ?? null),
  couleur: echelleCarte(lignesFlux.map((d) => d.nb_actifs), {label: "Nombre de personnes par commune"}),
  titre: (f) => {
    if (codesCibles.has(f.properties.codegeo)) return `${f.properties.libgeo}\n(territoire choisi)`;
    const v = parCommune.get(f.properties.codegeo);
    return (v ? `${f.properties.libgeo}\n${fmtInt(v.nb_actifs)} personnes\ndont ${fmtPct(v.part_tc)} en transports en commun` : `${f.properties.libgeo}\nmoins de quelques personnes`) + "\nCliquez pour choisir cette commune";
  },
  marques: [
    Plot.geo(fcCibles, mailleChoisie === "Région" ? {fill: IDFM.bleuPale, stroke: "white", strokeWidth: 0.3} : {fill: IDFM.encre, stroke: IDFM.encre, strokeWidth: 0.3}),
    Plot.arrow(principaux, {
      x1: (d) => (sens === "entrant" ? d.lon : terr.lon),
      y1: (d) => (sens === "entrant" ? d.lat : terr.lat),
      x2: (d) => (sens === "entrant" ? terr.lon : d.lon),
      y2: (d) => (sens === "entrant" ? terr.lat : d.lat),
      stroke: IDFM.rouge, strokeWidth: 2, strokeOpacity: 0.8, bend: 15, headLength: 8
    })
  ],
  surClic: (p) => selecteur.choisir("Commune", p.codegeo)
}))
```

<div class="note"><b>Comment lire cette carte.</b> Le territoire choisi est en noir. Plus une commune est bleu foncé, plus elle compte de personnes concernées. Les 10 flèches rouges relient les 10 communes les plus importantes au territoire. En gris : presque personne.</div>

</div>

<div class="grid grid-cols-2">
<div class="card">

## Comment se déplacent ces ${fmtCompact(totalFlux)} personnes

```js
resize((width) => anneau(lignesModes, {
  valeur: "nb_actifs", nom: "mode", width,
  etiquette: (d) => `${fmtPct(100 * d.nb_actifs / totalModes)}`,
  centre: fmtCompact(totalModes),
  sousCentre: ["personnes"]
}))
```

<div class="note"><b>Comment lire ce graphique.</b> L'anneau représente toutes les personnes concernées. Chaque part de couleur est un moyen de transport ; la liste donne le nombre de personnes sur 100 qui l'utilisent. Les transports en commun sont en bleu.</div>

</div>
<div class="card">

## Les 10 communes ${sens === "entrant" ? "d'où elles viennent" : "où elles vont"}

```js
resize((width) => barresClassees(lignesFlux, {
  valeur: "nb_actifs", nom: "libgeo", width,
  etiquette: (d) => `${fmtInt(d.nb_actifs)}`,
  max: 10, margeGauche: 170, margeDroite: 80,
  surClic: (d) => selecteur.choisir("Commune", d.commune)
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Le nombre de personnes pour chacune des 10 communes les plus importantes. Cliquez sur une barre pour étudier cette commune à son tour.</div>

</div>
</div>

## Comparaison avec ${T.libgeoComp}

<div class="card">

```js
const IC = interneComp.get(0);
display(tableauComparaison(T.libgeo, T.libgeoComp, [
  {libelle: "Habitent et travaillent dans le territoire", a: I.internes, b: IC.internes, format: fmtInt},
  {libelle: "Entrants : habitent ailleurs, travaillent ici", a: I.entrants, b: IC.entrants, format: fmtInt},
  {libelle: "Sortants : habitent ici, travaillent ailleurs", a: I.sortants, b: IC.sortants, format: fmtInt},
  {libelle: "Entrants pour 100 sortants", a: I.sortants ? 100 * I.entrants / I.sortants : null, b: IC.sortants ? 100 * IC.entrants / IC.sortants : null, format: (v) => fmtInt(v)}
]));
```

<div class="note"><b>Comment lire ce tableau.</b> Les mêmes chiffres pour le territoire principal et pour le territoire de comparaison choisis dans les filtres. La petite barre sous chaque chiffre montre lequel est le plus grand. Au-dessus de 100 « entrants pour 100 sortants », le territoire attire plus de travailleurs qu'il n'en envoie ailleurs.</div>

</div>

```js
display(aSavoir(
  "Un « entrant » habite hors du territoire et vient y travailler. Un « sortant » habite dans le territoire et travaille ailleurs.",
  "Ces chiffres viennent d'un sondage du recensement auprès d'un habitant sur cinq : les petits nombres (quelques dizaines de personnes) sont approximatifs."
));
display(source("INSEE, recensement de la population 2022 (fichier « mobilités professionnelles ») ; contours : Etalab, IGN."));
```

## Lexique

```js
display(lexique(["Entrants", "Sortants", "Actif occupé", "Commune", "Intercommunalité (EPCI)", "Bassin d'emploi", "Part d'un mode de transport"]))
```

## Sources des données

```js
display(piedSources(["INSEE", "Etalab", "IGN"], [
  "Recensement de la population 2022, fichier « mobilités professionnelles » (INSEE) : commune d'habitation, commune de travail et mode de transport. Ce fichier est un sondage au 1/5 : les petits nombres sont approximatifs.",
  "Contours des communes (Etalab, IGN) : fonds de carte."
]))
```
