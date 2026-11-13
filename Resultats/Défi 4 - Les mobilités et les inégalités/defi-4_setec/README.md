# Noctambulle · Trajets de nuit en Île-de-France

**Équipe :** setec — Florian Dufour, Victoria Jacob, Simon Lavoine et Benoit Fontanel  
**Mail de contact :** florian.dufour@setec.com  
**Défi :** Défi 4 — Les mobilités et les inégalités

Conseil scientifique et idéation : Rémi Stamegna, Edouard Jourdan, Jérôme Palayer,
Alexandre Schoepp et Olivier Nau. Voir [À propos](https://setec-labs.github.io/hackaviz-2026/a-propos/).

## Notre question

Comment les temps de parcours, l'accessibilité et le contexte des trajets de nuit
révèlent-ils les inégalités de mobilité entre Paris, la proche banlieue et la grande couronne ?

## Notre visualisation

Noctambulle est une cartographie animée des trajets nocturnes en transports en commun
en Île-de-France. Pour un lieu et une heure de départ, elle met en regard les temps de
parcours vers les communes, les portions à pied et en attente, l'éclairage nocturne,
le contexte de densité de population et la fréquentation estimée à bord.

Il s'agit d'un prototype : les indicateurs ne constituent pas une mesure objective
du danger et la fréquentation estimée n'est pas une mesure de l'occupation des véhicules.

- [Code source et présentation sur GitHub](https://github.com/setec-labs/hackaviz-2026)
- [Version livrée 1.0.0](https://github.com/setec-labs/hackaviz-2026/releases/tag/1.0.0)
- [Documentation et captures de la visualisation](https://setec-labs.github.io/hackaviz-2026/)
- [Installation et lancement en local](https://setec-labs.github.io/hackaviz-2026/utilisateur/)
- [Accès à la production](production/README.md)

Le site en ligne présente la documentation ; l'application interactive se lance
localement en suivant le guide d'installation.

## Les données utilisées

| Source | Jeu de données | Lien |
|---|---|---|
| Île-de-France Mobilités | Horaires théoriques GTFS, validations et profils horaires des réseaux de surface et ferré | [Portail open data IDFM](https://data.iledefrance-mobilites.fr/) |
| OpenStreetMap | Réseau routier et piéton | [OpenStreetMap et crédits](https://www.openstreetmap.org/copyright) |
| data.gouv.fr | Cartographies départementales de la radiance nocturne du satellite LuoJia — 2018 | [Jeu de données](https://www.data.gouv.fr/datasets/cartographies-departementales-de-la-radiance-nocturne-du-satellite-luojia-2018) |
| INSEE | BPE 2025 et Filosofi 2021 carroyé, sources du raster de contexte de présence humaine | [BPE](https://www.insee.fr/fr/statistiques/8217525), [Filosofi](https://www.insee.fr/fr/statistiques/8735243) |
| IGN | BD TOPO, source du raster de contexte de présence humaine | [BD TOPO](https://geoservices.ign.fr/bdtopo) |
| API Découpage administratif | Population et positions des mairies des communes et arrondissements | [geo.api.gouv.fr](https://geo.api.gouv.fr/) |

Les transformations, hypothèses et limites sont détaillées dans la
[documentation des données](https://setec-labs.github.io/hackaviz-2026/architecture/donnees/)
et les [sources et crédits](https://setec-labs.github.io/hackaviz-2026/a-propos/).

## Les outils employés

- Python, uv, FastAPI et Pydantic pour les services et les contrats de données.
- GeoPandas, NumPy, pandas, SciPy, Shapely, Rasterio et pyproj pour les traitements.
- React, TypeScript, Vite, deck.gl et MapLibre GL pour la cartographie interactive.
- Git, Git LFS et Zensical pour le code, les fichiers volumineux et la documentation.

## Licence

Le code source est publié sous [licence MIT](https://github.com/setec-labs/hackaviz-2026/blob/1.0.0/LICENSE).
Les textes de ce dossier de présentation sont publiés sous
[licence CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/), avec attribution à l'équipe setec.
Les données tierces restent soumises aux licences et obligations d'attribution de leurs producteurs ;
elles ne sont pas redistribuées dans ce dossier.
