---
title: Accueil
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
import {fmtPct, fmtCompact, indexBy} from "./components/format.js";
import {anneau} from "./components/graphiques.js";
import {recherche} from "./components/filtres.js";
import {memoriserTerritoire} from "./components/territoires.js";
import {lexique} from "./components/lexique.js";
import {piedSources} from "./components/sources.js";
```

# Aller travailler en Île-de-France

Comment les habitants d'Île-de-France se rendent-ils au travail ? Où sont les emplois, les gares, les difficultés ?
Ce site répond avec des cartes et des graphiques simples, à partir de données publiques.

```sql id=region
SELECT code_indicateur, nombre FROM fact_mobilite WHERE maille = 'Région'
```

```sql id=listeCommunes
SELECT codegeo, libgeo, departement FROM dim_geo WHERE maille = 'Commune' ORDER BY libgeo
```

```js
const R = indexBy(region, "code_indicateur", "nombre");
const optionsCommunes = new Map(listeCommunes.toArray().map((d) => [`${d.libgeo} (${d.departement})`, d.codegeo]));
```

<div class="accueil-recherche card">
<h2>Commencez par votre commune</h2>

```js
display(recherche(optionsCommunes, {
  label: "Votre commune",
  placeholder: "Tapez un nom, par exemple Montreuil",
  // La commune devient le territoire principal du site, puis on ouvre la page « Se déplacer ».
  surChoix: (code) => { memoriserTerritoire("Commune", code); location.href = "./deplacements"; }
}));
```

<div class="muted">Choisissez un nom dans la liste : la commune devient le territoire principal de toutes les pages.</div>
</div>

## Les chiffres à retenir

<div class="grid grid-cols-4">
  <div class="card kpi"><h2>Habitants ayant un emploi</h2><div class="big">${fmtCompact(R.get("nb_actifs_occupes"))}</div><div class="muted">en Île-de-France (recensement 2022)</div></div>
  <div class="card kpi kpi--tc"><h2>Transports en commun</h2><div class="big">${fmtPct(R.get("part_tc"))}</div><div class="muted">des trajets vers le travail</div></div>
  <div class="card kpi"><h2>Voiture</h2><div class="big">${fmtPct(R.get("part_voiture"))}</div><div class="muted">des trajets vers le travail</div></div>
  <div class="card kpi"><h2>Travaillent hors de leur commune</h2><div class="big">${fmtPct(R.get("part_hors_commune"))}</div><div class="muted">des habitants ayant un emploi</div></div>
</div>

## Comment va-t-on travailler ?

<div class="card">

```js
const modesRegion = [
  {mode: "Transports en commun", part: R.get("part_tc")},
  {mode: "Voiture", part: R.get("part_voiture")},
  {mode: "Marche à pied", part: R.get("part_marche")},
  {mode: "Vélo", part: R.get("part_velo")},
  {mode: "Deux-roues motorisé", part: R.get("part_2rm")}
];
```

```js
resize((width) => anneau(modesRegion, {
  valeur: "part", nom: "mode", width,
  etiquette: (d) => fmtPct(d.part),
  centre: fmtPct(R.get("part_tc")),
  sousCentre: ["en transports", "en commun"]
}))
```

<div class="note"><b>Comment lire ce graphique.</b> L'anneau représente toutes les personnes qui se déplacent pour aller travailler. Chaque part de couleur est un moyen de transport : plus elle est grande, plus il est utilisé. La liste à droite donne le chiffre exact, sur 100 personnes.</div>

</div>

## Explorer le site

<div class="grid grid-cols-3 tuiles">
  <a class="card tuile" href="./deplacements"><h2>Se déplacer</h2><p>La carte de toutes les communes. Cliquez sur un territoire pour voir comment ses habitants vont travailler.</p><span>Ouvrir la carte →</span></a>
  <a class="card tuile" href="./emploi"><h2>Trouver un emploi</h2><p>Où les employeurs veulent recruter en 2026, dans quels métiers, et où le chômage est le plus fort.</p><span>Voir l'emploi →</span></a>
  <a class="card tuile" href="./flux"><h2>D'où viennent les travailleurs</h2><p>Choisissez un territoire : la carte montre d'où viennent les personnes qui y travaillent.</p><span>Voir les trajets →</span></a>
  <a class="card tuile" href="./inegalites"><h2>Revenus et transports</h2><p>Les communes modestes et les communes aisées n'utilisent pas les mêmes transports.</p><span>Comparer →</span></a>
  <a class="card tuile" href="./transport"><h2>Gares et stations</h2><p>Où sont les gares, lesquelles sont les plus fréquentées, quelles communes n'en ont pas.</p><span>Voir les gares →</span></a>
  <a class="card tuile" href="./catalogue"><h2>Catalogue des données</h2><p>Tous les indicateurs du site : leur définition, leur source et les territoires pour lesquels ils existent.</p><span>Consulter →</span></a>
  <a class="card tuile" href="./sources"><h2>Sources et méthode</h2><p>D'où viennent les chiffres et comment ils sont calculés. Tout est public et vérifiable.</p><span>Lire →</span></a>
</div>

## Comment utiliser le site

<div class="grid grid-cols-3">
  <div class="card etape"><div class="numero">1</div><h2>Choisissez</h2><p>En haut de chaque page, 4 filtres : le type de territoire, le territoire principal, et un territoire de comparaison. Votre choix est conservé d'une page à l'autre.</p></div>
  <div class="card etape"><div class="numero">2</div><h2>Cliquez</h2><p>Les cartes et les graphiques sont cliquables. Un clic sur un territoire le choisit : la carte zoome dessus et tous les chiffres de la page se mettent à jour.</p></div>
  <div class="card etape"><div class="numero">3</div><h2>Lisez</h2><p>Sous chaque graphique, « Comment lire » explique ce qu'il montre. Les encadrés « À savoir » et le catalogue des données définissent chaque indicateur.</p></div>
</div>

## L'équipe

Projet réalisé pour le Hackathon Mobilités 2026 d'Île-de-France Mobilités, défi 2 « Les mobilités et l'emploi ».

```js
import {equipeHtml} from "./components/equipe.js";
const blocEquipe = document.createElement("div");
blocEquipe.className = "equipe";
blocEquipe.innerHTML = equipeHtml().join("");
display(blocEquipe);
```

## Lexique

```js
display(lexique(["Actif occupé", "Trajet domicile-travail", "Part d'un mode de transport", "Transports en commun", "Commune"]))
```

## Sources des données

```js
display(piedSources(["INSEE"], [
  "Recensement de la population 2022, fichier « mobilités professionnelles » (INSEE) : mode de transport et lieu de travail des habitants ayant un emploi."
]))
```
