---
title: Revenus et transports
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
import {fmtInt, fmtPct, fmtEur} from "./components/format.js";
import {IDFM, barresClassees, barresModes, courbes, nuage} from "./components/graphiques.js";
import {recherche} from "./components/filtres.js";
import {selecteurTerritoires, valeursDe} from "./components/territoires.js";
import {kpi, rangeeKpi, tableauComparaison, aSavoir, source} from "./components/blocs.js";
import {lexique} from "./components/lexique.js";
import {piedSources} from "./components/sources.js";
```

# Les communes modestes et les communes aisées se déplacent-elles pareil ?

On compare les revenus des habitants et leur façon d'aller travailler : transports en commun ou voiture.

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
const ratio = (v) => (v == null ? "–" : v.toFixed(1).replace(".", ","));
const revenusAbsents = P.get("mediane_niveau_vie") == null;
```

## Les revenus du territoire

```js
display(revenusAbsents
  ? html`<p class="indisponible">Les revenus ne sont pas publiés pour ${T.libgeo} (bassins d'emploi, et communes trop petites pour le secret statistique). Choisissez une commune plus grande, une intercommunalité ou un département.</p>`
  : html`<span></span>`);
```

```js
display(rangeeKpi([
  kpi("Niveau de vie médian", fmtEur(P.get("mediane_niveau_vie")), `par an et par personne, ${T.libgeo}`, {accent: "bleu"}),
  kpi("Taux de pauvreté", fmtPct(P.get("taux_pauvrete")), "des habitants sous le seuil de pauvreté", {accent: "alerte"}),
  kpi("Écart entre riches et modestes", ratio(P.get("rapport_interdecile")), "fois : revenu des 10 % les plus aisés comparé aux 10 % les plus modestes"),
  kpi("N'ont pas de voiture", fmtPct(P.get("part_menages_sans_voiture")), "des habitants ayant un emploi")
]));
```

<div class="grid grid-cols-3">
<div class="card grid-colspan-2">

## Transports en commun ou voiture ?

```js
const lignesModes = [
  {nom: T.libgeo, tc: P.get("part_tc"), voiture: P.get("part_voiture")},
  {nom: T.libgeoComp, tc: C.get("part_tc"), voiture: C.get("part_voiture")},
  {nom: "Île-de-France", tc: R.get("part_tc"), voiture: R.get("part_voiture")}
].filter((d, i, tous) => d.tc != null && tous.findIndex((x) => x.nom === d.nom) === i);
```

```js
resize((width) => barresModes(lignesModes, {width, margeGauche: Math.min(190, width * 0.32)}))
```

<div class="note"><b>Comment lire ce graphique.</b> Une ligne par territoire : le territoire principal, le territoire de comparaison et l'Île-de-France. Chaque barre représente 100 habitants qui se déplacent pour aller travailler : en bleu ceux qui prennent les transports en commun, en foncé ceux qui prennent la voiture.</div>

</div>
<div class="card">

<div class="fiche-titre">Comparaison</div>

```js
display(tableauComparaison(T.libgeo, T.libgeoComp, [
  {libelle: "Niveau de vie médian par an", a: P.get("mediane_niveau_vie"), b: C.get("mediane_niveau_vie"), format: fmtEur},
  {libelle: "Taux de pauvreté", a: P.get("taux_pauvrete"), b: C.get("taux_pauvrete"), format: fmtPct},
  {libelle: "Écart entre riches et modestes", a: P.get("rapport_interdecile"), b: C.get("rapport_interdecile"), format: ratio},
  {libelle: "Vont travailler en voiture", a: P.get("part_voiture"), b: C.get("part_voiture"), format: fmtPct},
  {libelle: "N'ont pas de voiture", a: P.get("part_menages_sans_voiture"), b: C.get("part_menages_sans_voiture"), format: fmtPct}
]));
```

</div>
</div>

```js
display(aSavoir(
  "Le « niveau de vie » est le revenu dont dispose un ménage après impôts et aides, rapporté au nombre de personnes qui le composent. « Médian » signifie que la moitié des habitants a moins, l'autre moitié a plus.",
  "Le taux de pauvreté est la part des habitants dont le niveau de vie est inférieur à 60 % du niveau de vie médian en France. Il n'est publié que pour les communes d'une certaine taille."
));
display(source("INSEE, Filosofi 2021 et recensement de la population 2022."));
```

## Cinq groupes de communes, de la plus modeste à la plus aisée

```sql id=groupes
WITH c AS (
  SELECT g.codegeo,
    MAX(CASE WHEN code_indicateur = 'nb_actifs_occupes' THEN nombre END) AS actifs,
    MAX(CASE WHEN code_indicateur = 'part_tc' THEN nombre END) AS part_tc,
    MAX(CASE WHEN code_indicateur = 'part_voiture' THEN nombre END) AS part_voiture,
    MAX(CASE WHEN code_indicateur = 'mediane_niveau_vie' THEN nombre END) AS mediane
  FROM fact_mobilite f
  JOIN dim_geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
  WHERE f.maille = 'Commune'
  GROUP BY g.codegeo
),
q AS (
  SELECT *, NTILE(5) OVER (ORDER BY mediane) AS groupe
  FROM c
  WHERE mediane IS NOT NULL AND actifs >= 200 AND part_tc IS NOT NULL AND part_voiture IS NOT NULL
)
SELECT CAST(groupe AS INTEGER) AS groupe,
       CAST(COUNT(*) AS INTEGER) AS nb_communes,
       MIN(mediane) AS mediane_min,
       MAX(mediane) AS mediane_max,
       SUM(part_tc * actifs) / SUM(actifs) AS tc,
       SUM(part_voiture * actifs) / SUM(actifs) AS voiture
FROM q
GROUP BY groupe
ORDER BY groupe
```

```js
const nomsGroupes = ["Les plus modestes", "Modestes", "Intermédiaires", "Aisées", "Les plus aisées"];
const lignesGroupes = groupes.toArray().map((d) => ({
  nom: nomsGroupes[d.groupe - 1],
  tc: d.tc, voiture: d.voiture, nb_communes: d.nb_communes, mediane_min: d.mediane_min, mediane_max: d.mediane_max
}));
```

<div class="grid grid-cols-3">
<div class="card grid-colspan-2">

```js
resize((width) => courbes(lignesGroupes, {
  x: "nom", width, format: fmtPct,
  series: [
    {cle: "tc", libelle: "Transports en commun", couleur: IDFM.bleu},
    {cle: "voiture", libelle: "Voiture", couleur: IDFM.encre}
  ]
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Les communes sont rangées selon le niveau de vie de leurs habitants, de la plus modeste (à gauche) à la plus aisée (à droite), puis coupées en 5 groupes de même taille. Les deux courbes donnent, sur 100 habitants qui vont travailler, combien prennent les transports en commun (bleu) et combien prennent la voiture (foncé). Paris, très bien desservie, fait partie du groupe « Aisées » : c'est pourquoi ce groupe utilise peu la voiture.</div>

</div>
<div class="card">

## Les revenus de chaque groupe

```js
display(html`<table class="tableau-simple">
  <thead><tr><th>Groupe</th><th>Niveau de vie médian par an</th></tr></thead>
  <tbody>${lignesGroupes.map((d) => html`<tr><td>${d.nom}</td><td>${fmtEur(d.mediane_min)} à ${fmtEur(d.mediane_max)}</td></tr>`)}</tbody>
</table>`);
```

<div class="muted">${lignesGroupes[0]?.nb_communes ?? ""} communes environ par groupe. Seules les communes de plus de 200 habitants ayant un emploi sont comptées.</div>

</div>
</div>

## Les intercommunalités : le classement

```sql id=epci
SELECT g.libgeo, g.codegeo,
       MAX(CASE WHEN code_indicateur = 'nb_actifs_occupes' THEN nombre END) AS nb_actifs,
       MAX(CASE WHEN code_indicateur = 'part_voiture' THEN nombre END) AS part_voiture,
       MAX(CASE WHEN code_indicateur = 'part_tc' THEN nombre END) AS part_tc,
       MAX(CASE WHEN code_indicateur = 'taux_pauvrete' THEN nombre END) AS taux_pauvrete,
       MAX(CASE WHEN code_indicateur = 'mediane_niveau_vie' THEN nombre END) AS mediane
FROM fact_mobilite f
JOIN dim_geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
WHERE f.maille = 'EPCI'
GROUP BY g.libgeo, g.codegeo
```

```js
// Intercommunalité mise en avant dans le classement et le tableau (null = aucune).
const epciChoisi = Mutable(null);
const choisirEpci = (code) => { epciChoisi.value = code; };
```

```js
const lignesEpci = epci.toArray();
const optionsEpci = new Map(lignesEpci.map((d) => [d.libgeo, d.codegeo]));
const criteres = new Map([
  ["Taux de pauvreté (%)", "taux_pauvrete"],
  ["Habitants allant travailler en voiture (%)", "part_voiture"],
  ["Habitants allant travailler en transports en commun (%)", "part_tc"],
  ["Niveau de vie médian (€ par an)", "mediane"]
]);
```

<div class="filtres">

```js
const critere = view(Inputs.select(criteres, {label: "Classer selon", value: "taux_pauvrete"}));
```

```js
const nbBarres = view(Inputs.radio(new Map([["Les 10 premières", 10], ["Les 20 premières", 20]]), {label: "Afficher", value: 10}));
```

```js
display(recherche(optionsEpci, {
  label: "Rechercher une intercommunalité",
  placeholder: "Tapez un nom, par exemple Plaine Commune",
  surChoix: choisirEpci
}));
```

</div>

```js
const libCritere = [...criteres].find(([, code]) => code === critere)[0];
const fmtCritere = (v) => (v == null ? "–" : critere === "mediane" ? fmtEur(v) : fmtPct(v));
const E = lignesEpci.find((d) => d.codegeo === epciChoisi);
// L'intercommunalité recherchée est toujours affichée, même si elle n'est pas dans les premières.
const classement = [...lignesEpci].filter((d) => d[critere] != null).sort((a, b) => b[critere] - a[critere]);
const visibles = classement.slice(0, nbBarres);
if (E && E[critere] != null && !visibles.includes(E)) visibles.push(E);
```

<div class="card">

## ${libCritere}

```js
resize((width) => barresClassees(visibles, {
  valeur: critere, nom: "libgeo", width,
  etiquette: (d) => `${fmtCritere(d[critere])}${d === E ? `  (rang ${classement.indexOf(d) + 1} sur ${classement.length})` : ""}`,
  couleur: (d) => (d === E ? IDFM.encre : IDFM.bleu),
  max: nbBarres + 1, margeGauche: Math.min(280, width * 0.38), margeDroite: 170,
  surClic: (d) => { choisirEpci(d.codegeo); selecteur.choisir("EPCI", d.codegeo); }
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Les intercommunalités où la valeur est la plus élevée, pour le critère choisi dans les filtres. Cherchez une intercommunalité par son nom, ou cliquez sur une barre : elle passe en foncé et son rang s'affiche.</div>

</div>

## Revenus et voiture : chaque intercommunalité sur un même graphique

<div class="card">

```js
resize((width) => nuage(lignesEpci, {
  x: "mediane", y: "part_voiture", r: "nb_actifs", nom: "libgeo", width,
  labelX: "Niveau de vie médian des habitants (€ par an)",
  labelY: "Vont travailler en voiture (%)",
  formatX: (v) => `${Math.round(v / 1000)} 000 €`,
  formatY: (v) => `${v} %`,
  infobulle: (d) => `${d.libgeo}\nNiveau de vie médian : ${fmtEur(d.mediane)}\nEn voiture : ${fmtPct(d.part_voiture)}\nEn transports en commun : ${fmtPct(d.part_tc)}\nCliquez pour la choisir`,
  choisi: E,
  surClic: (d) => { choisirEpci(d.codegeo); selecteur.choisir("EPCI", d.codegeo); }
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Chaque rond est une intercommunalité : plus il est à droite, plus ses habitants sont aisés ; plus il est haut, plus ils vont travailler en voiture. La taille du rond dépend du nombre d'habitants ayant un emploi. La ligne rouge en pointillés montre la tendance générale. Passez la souris sur un rond pour lire le nom et les chiffres de l'intercommunalité. L'intercommunalité recherchée est en foncé. Cliquez sur un rond pour la choisir.</div>

</div>

## Où le chômage est-il le plus fort ?

```sql id=chomage
SELECT g.libgeo, f.nombre AS taux_chomage, f.periode
FROM fact_mobilite f
JOIN dim_geo g ON g.maille = f.maille AND g.codegeo = f.codegeo
WHERE f.maille = 'Zone d''emploi' AND f.code_indicateur = 'taux_chomage'
ORDER BY f.nombre DESC
```

<div class="card">

## Taux de chômage par zone d'emploi (${chomage.get(0)?.periode ?? ""})

```js
resize((width) => barresClassees(chomage, {
  valeur: "taux_chomage", nom: "libgeo", width,
  etiquette: (d) => fmtPct(d.taux_chomage),
  max: 15, margeGauche: 190, margeDroite: 70, forme: "sucette"
}))
```

<div class="note"><b>Comment lire ce graphique.</b> Sur 100 personnes qui travaillent ou cherchent un emploi, le nombre de celles qui sont au chômage, dans chaque zone d'emploi. Plus le rond est à droite, plus le chômage est fort. La zone la plus touchée est en haut.</div>

</div>

## Toutes les intercommunalités

```js
const filtreTableau = view(Inputs.search(lignesEpci, {placeholder: "Filtrer le tableau : tapez un nom…", label: "Filtrer"}));
```

<div class="card">

```js
Inputs.table(filtreTableau.map((d) => ({"Intercommunalité": d.libgeo, "Habitants ayant un emploi": d.nb_actifs, "Taux de pauvreté": d.taux_pauvrete, "Niveau de vie médian": d.mediane, "En voiture": d.part_voiture, "En transports en commun": d.part_tc})), {
  format: {"Habitants ayant un emploi": fmtInt, "Taux de pauvreté": fmtPct, "Niveau de vie médian": fmtEur, "En voiture": fmtPct, "En transports en commun": fmtPct},
  sort: "Taux de pauvreté", reverse: true,
  select: false, rows: 12
})
```

<div class="note"><b>Comment lire ce tableau.</b> Une ligne par intercommunalité. Cliquez sur le titre d'une colonne pour trier. Le champ « Filtrer » réduit le tableau aux noms qui contiennent le texte tapé.</div>

</div>

## Lexique

```js
display(lexique(["Niveau de vie médian", "Taux de pauvreté", "Taux de chômage", "Intercommunalité (EPCI)", "Zone d'emploi", "Part d'un mode de transport", "Actif occupé"]))
```

## Sources des données

```js
display(piedSources(["INSEE"], [
  "Recensement de la population 2022, fichier « mobilités professionnelles » (INSEE) : mode de transport des habitants.",
  "Filosofi 2021 (INSEE) : niveau de vie médian et taux de pauvreté.",
  "Taux de chômage localisés (INSEE) : taux par zone d'emploi, dernier trimestre publié."
]))
```
