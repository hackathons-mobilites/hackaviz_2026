# Canopée — Mobilités douces, ville plus chaude

- **Équipe** — Maxime Pimpaud et Adrien Bourdin
- **Mails de contact** — max.pimpaud@gmail.com, ad.bourdin@pm.me
- **Défi 1** — Les mobilités et l’adaptation climatique

## Notre question

Comment la chaleur modifie-t-elle le confort des déplacements à pied, à vélo et vers les transports en commun à Paris ? Où l’ombre et l’accès à l’eau peuvent-ils aider, et quels besoins persistent ?

## Notre visualisation

[Mobilités douces, ville plus chaude](https://canopee-delta.vercel.app/dataviz) est un récit interactif sur les journées très chaudes, l’exposition des rues autour des stations, l’accès aux fontaines et les compromis entre temps de marche et exposition au soleil. Il présente aussi un scénario de croissance des arbres à l’horizon 2036.

La [carte Canopée](https://canopee-delta.vercel.app/) permet d’explorer l’ombre selon l’heure et la saison et de calculer un trajet à pied, à vélo personnel ou en Vélib. La carte couvre Paris. L’ombre est modélisée à partir des rues, des bâtiments et des arbres. Les durées sont des estimations. Les chiffres de fréquentation correspondent à des validations agrégées, et le rapprochement avec les stations couvre une partie du réseau.

## Les données utilisées

| Source | Jeu de données et usage | Lien |
| --- | --- | --- |
| Île-de-France Mobilités | Gares et stations du réseau ferré, positions généralisées | [Catalogue IDFM](https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf-data-generalisee/) |
| Île-de-France Mobilités | Validations ferroviaires 2025, agrégées à partir des quatre fichiers trimestriels officiels et rapprochées par identifiant ID_ZdC | [Source PRIM](https://prim.iledefrance-mobilites.fr/jeux-de-donnees/histo-validations-reseau-ferre) |
| Île-de-France Mobilités | Lignes de transport en projet | [Catalogue IDFM](https://data.iledefrance-mobilites.fr/explore/dataset/projets_lignes_idf/) |
| IGN | BD TOPO. Axes de rues, emprises et hauteurs de bâtiments. | [BD TOPO](https://geoservices.ign.fr/bdtopo) |
| API Géo et IGN | Contour de Paris et recherche d’adresses | [API Géo](https://geo.api.gouv.fr/communes/75056?fields=contour&format=geojson&geometry=contour), [Géocodage](https://adresse.data.gouv.fr/outils/api-doc/adresse) |
| Eau de Paris et Ville de Paris | Fontaines, arbres et îlots de fraîcheur | [Fontaines](https://opendata.paris.fr/explore/dataset/fontaines-a-boire/), [arbres](https://opendata.paris.fr/explore/dataset/les-arbres/), [équipements frais](https://opendata.paris.fr/explore/dataset/ilots-de-fraicheur-equipements-activites/), [espaces verts frais](https://opendata.paris.fr/explore/dataset/ilots-de-fraicheur-espaces-verts-frais/) |
| Smovengo et Syndicat Autolib’ Vélib’ Métropole | Localisation et capacité des 996 stations dans le contour étudié. Export filtré le 13 novembre 2026. | [Open Data Paris](https://opendata.paris.fr/explore/dataset/velib-emplacement-des-stations/) |
| Météo-France | Températures horaires du 25 juin 2026 et projections TRACC des jours très chauds à Paris | [Données horaires](https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-horaires), [Le climat de la France, p. 7](https://meteofrance.com/sites/default/files/files/editorial/le_climat_de_la_france_v1%20%281%29.pdf) |
| Open-Meteo | Température et couverture nuageuse en mode Direct | [Open-Meteo](https://open-meteo.com/en/license) |
| OpenStreetMap et OpenFreeMap | Fond de carte | [OpenStreetMap](https://www.openstreetmap.org/copyright), [OpenFreeMap](https://openfreemap.org/) |

Les méthodes de calcul, les attributions et les fichiers de données du récit sont accessibles dans [Sources et méthode](https://canopee-delta.vercel.app/dataviz#sources). Les validations sont comptées au niveau du pôle, tous titres confondus. Les totaux restent approximatifs en raison des petits effectifs masqués par IDFM.

## Les outils employés

JavaScript, Vite, MapLibre GL JS et Motion. La préparation des données utilise Node.js et Python. Le site est hébergé sur Vercel.

## Licence

Le code et la documentation originale de Canopée sont sous licence MIT. Les données réutilisées conservent leurs licences d’origine, notamment la Licence Ouverte pour les jeux concernés et l’ODbL pour les jeux de Paris Data, Vélib, OpenStreetMap et la source IDFM des validations. Les données de l’API Open-Meteo sont sous CC BY 4.0. Les crédits et liens de provenance sont conservés dans le récit et le dépôt.
