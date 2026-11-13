---
title: Catalogue des données
---

```js
// Données chargées en entier (voir components/duckdb.js) : évite les erreurs de lecture sur GitHub Pages.
import {tablesCompletes} from "./components/duckdb.js";
const sql = DuckDBClient.sql(tablesCompletes({
  dim_indicateurs: FileAttachment("./data/dim_indicateurs.parquet"),
  fact_mobilite: FileAttachment("./data/fact_mobilite.parquet")
}));
```

```js
import {MAILLES} from "./components/territoires.js";
import {piedSources} from "./components/sources.js";
```

<div class="surtitre">Catalogue des indicateurs</div>

# Définitions, sources et territoires disponibles

Cette page recense tous les indicateurs utilisés sur le site. Elle permet de chercher une définition,
de connaître la source d'un chiffre et de savoir à quelle échelle géographique il existe.

```sql id=indicateurs
SELECT i.code_indicateur, i.nom_indicateur, i.description, i.famille_indicateur, i.unite, i.source, i.ordre,
       (SELECT string_agg(DISTINCT f.maille, '|') FROM fact_mobilite f WHERE f.code_indicateur = i.code_indicateur) AS mailles
FROM dim_indicateurs i
ORDER BY i.ordre
```

```js
const tous = indicateurs.toArray();
const themes = [...new Set(tous.map((d) => d.famille_indicateur))];
const numeroTheme = new Map(themes.map((t, i) => [t, i + 1]));
const sansAccent = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const libelleMaille = new Map(MAILLES);
// Les échelles géographiques d'un indicateur, dans l'ordre du plus grand au plus petit territoire.
const echelles = (d) => MAILLES.map(([m]) => m).filter((m) => String(d.mailles ?? "").split("|").includes(m)).map((m) => libelleMaille.get(m));
```

<div class="filtres">

```js
const theme = view(Inputs.select(new Map([["Tous les thèmes", ""], ...themes.map((t) => [`${numeroTheme.get(t)}. ${t}`, t])]), {label: "Thème", value: ""}));
```

```js
const texteCherche = view(Inputs.text({label: "Recherche", placeholder: "Par exemple : chômage, voiture, gares…", autocomplete: "off"}));
```

```js
const echelle = view(Inputs.select(new Map([["Toutes les échelles", ""], ...MAILLES.map(([m, lib]) => [lib, m])]), {label: "Disponible à l'échelle", value: ""}));
```

</div>

```js
const resultats = tous.filter((d) =>
  (!theme || d.famille_indicateur === theme) &&
  (!echelle || String(d.mailles ?? "").split("|").includes(echelle)) &&
  sansAccent(`${d.nom_indicateur} ${d.description} ${d.source} ${d.famille_indicateur}`).includes(sansAccent(texteCherche))
);
```

<div class="resultats-entete"><h2>Résultats</h2><span class="pastille-nombre">${resultats.length} indicateur${resultats.length > 1 ? "s" : ""}</span></div>

```js
display(resultats.length
  ? html`<div class="card catalogue-carte"><table class="catalogue">
      <thead><tr><th>Thème</th><th>Indicateur</th><th>Définition</th><th>Unité</th><th>Échelles disponibles</th><th>Source</th></tr></thead>
      <tbody>${resultats.map((d) => html`<tr>
        <td class="cat-theme">${numeroTheme.get(d.famille_indicateur)}. ${d.famille_indicateur}</td>
        <td class="cat-nom">${d.nom_indicateur}</td>
        <td>${d.description}</td>
        <td class="cat-unite">${d.unite}</td>
        <td>${echelles(d).map((e) => html`<span class="etiquette">${e}</span>`)}</td>
        <td class="cat-source">${d.source}</td>
      </tr>`)}</tbody>
    </table></div>`
  : html`<p class="indisponible">Aucun indicateur ne correspond à ces filtres. Effacez la recherche ou choisissez « Tous les thèmes ».</p>`);
```

<div class="note"><b>Comment lire ce tableau.</b> Une ligne par indicateur. La colonne « Échelles disponibles » indique pour quels types de territoire le chiffre existe : par exemple, le taux de chômage n'est publié que par département et par zone d'emploi, pas par commune. Sur les autres pages, un indicateur absent à l'échelle choisie s'affiche « non disponible ».</div>

## Sources des données

```js
display(piedSources(["INSEE", "Île-de-France Mobilités", "France Travail", "DARES"], [
  "Le détail de chaque jeu de données (lien, licence, usage) est sur la page « Sources et méthode »."
]))
```
