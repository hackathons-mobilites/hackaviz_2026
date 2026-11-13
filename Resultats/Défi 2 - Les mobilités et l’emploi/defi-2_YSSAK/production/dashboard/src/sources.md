---
title: Sources et méthode
---

```js
// Données chargées en entier (voir components/duckdb.js) : évite les erreurs de lecture sur GitHub Pages.
import {tablesCompletes} from "./components/duckdb.js";
const sql = DuckDBClient.sql(tablesCompletes({
  catalogue_sources: FileAttachment("./data/catalogue_sources.parquet")
}));
```

# D'où viennent les chiffres ?

Tous les chiffres de ce site viennent de données publiques, gratuites et vérifiables par tous,
publiées par des organismes officiels (Licence Ouverte 2.0 ou ODbL).

## Les producteurs

```js
import {logosProducteur, producteurs, tousLesProducteurs} from "./components/sources.js";
// Seuls les jeux de données réellement utilisés sur le site sont présentés,
// avec une description simple de ce qu'ils apportent (la colonne « usage » du catalogue est technique).
const USAGES = [
  [/MOBPRO/i, "Comment les habitants vont travailler et dans quelle commune ils travaillent (recensement 2022)."],
  [/appartenance g[ée]ographique/i, "À quelle intercommunalité, zone d'emploi et département appartient chaque commune."],
  [/Filosofi/i, "Revenus des habitants et taux de pauvreté."],
  [/ch[ôo]mage par zone/i, "Taux de chômage de chaque zone d'emploi."],
  [/ch[ôo]mage localis/i, "Taux de chômage de chaque département."],
  [/Bassins d'emploi/i, "Découpage de la région en 25 bassins d'emploi."],
  [/Main-d/i, "Embauches prévues par les employeurs, par métier et par territoire."],
  [/Inscrits/i, "Nombre de demandeurs d'emploi dans chaque zone d'emploi."],
  [/lignes de transport/i, "Nombre de lignes de bus, métro, tramway, train et RER en Île-de-France."],
  [/Polarit/i, "Les grands pôles d'activité de la région."],
  [/zones d'emploi/i, "Les communes qui composent chaque zone d'emploi."],
  [/Emplacement des gares/i, "Position de chaque gare et station sur la carte."],
  [/Validations/i, "Fréquentation des gares et stations, jour après jour."],
  [/Contours/i, "Fonds de carte des communes."]
];
const usageSimple = (d) => USAGES.find(([motif]) => motif.test(d.titre))?.[1] ?? d.usage;
const utilises = catalogue.toArray().filter((d) => d.statut === "intégré").map((d) => ({...d, usage: usageSimple(d)}));
const parProducteur = new Map(tousLesProducteurs.map((p) => [p, utilises.filter((d) => producteurs(d.producteur).includes(p))]));
```

<div class="grille-producteurs">
${[...parProducteur].filter(([, l]) => l.length).map(([p, l]) => html`<div class="card">${logosProducteur(p, 40)}<div><b>${p}</b></div><div class="n">${l.length} jeu${l.length > 1 ? "x" : ""} de données utilisé${l.length > 1 ? "s" : ""}</div></div>`)}
</div>

## Les données utilisées

```sql id=catalogue
SELECT ordre, titre, producteur, statut, usage, url FROM catalogue_sources ORDER BY ordre
```

<div class="filtres">

```js
const texteCherche = view(Inputs.text({label: "Rechercher une source", placeholder: "Tapez un mot, par exemple gares", autocomplete: "off"}));
```

</div>

```js
const sansAccent = (t) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const cat = utilises.filter((d) => sansAccent(`${d.titre} ${d.producteur} ${d.usage}`).includes(sansAccent(texteCherche)));
```

```js
Inputs.table(cat.map((d) => ({Source: d.titre, Producteur: d.producteur, "À quoi elle sert sur le site": d.usage, Lien: d.url})), {
  select: false,
  rows: 40,
  width: {Source: 280, Producteur: 150, "À quoi elle sert sur le site": 420, Lien: 110},
  format: {Producteur: (p) => logosProducteur(p, 18), Lien: (u) => htl.html`<a href=${u} target="_blank" rel="noopener">voir ↗</a>`}
})
```

## Lexique complet

Tous les mots utilisés sur le site, expliqués simplement.

```js
import {lexique, tousLesTermes} from "./components/lexique.js";
display(lexique(tousLesTermes));
```

## Comment les chiffres sont calculés

- **Des pourcentages toujours recalculés.** Pour un département ou une intercommunalité, on ne fait jamais la moyenne des pourcentages de ses communes : on recompte les personnes concernées sur tout le territoire, puis on calcule le pourcentage.
- **Les trajets vers le travail.** Les pourcentages de transports en commun, voiture, vélo, etc. sont calculés sur les personnes qui se déplacent pour aller travailler. Celles qui travaillent chez elles ne sont pas comptées.
- **Des chiffres fiables.** Le recensement interroge un habitant sur cinq environ. Quand un chiffre repose sur trop peu de personnes (moins de 200), il n'est pas affiché : le territoire apparaît en gris sur les cartes.
- **Le secret statistique.** Certains chiffres ne sont pas publiés pour protéger la vie privée, par exemple les revenus des très petites communes. Ils sont laissés vides, jamais inventés.
- **Les embauches prévues.** Les pourcentages d'embauches « difficiles » sont recalculés à partir du nombre d'embauches, pour chaque territoire.
- **Les gares.** Chaque gare est rattachée à la commune où elle se trouve. La fréquentation n'est pas publiée pour environ une gare sur quatre, surtout des stations de tramway.
- **Les communes.** Les arrondissements de Paris sont regroupés en une seule commune, et les communes qui ont fusionné récemment sont comptées ensemble.
