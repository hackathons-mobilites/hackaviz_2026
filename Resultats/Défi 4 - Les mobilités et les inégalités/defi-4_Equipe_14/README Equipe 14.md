# Équipe 14 – Métro, RER, tramway : violences, eau, air et accessibilité

A bord d’une rame en pleine canicule, dans une station où l’on cherche une fontaine, devant un escalier sans ascenseur, Franciliennes et Franciliens ne voyagent pas à égalité. Ces écarts sont mesurés dans les données ouvertes.

Avec le projet Correspondances, nous portons les données là où elles se vivent : en station. L’affiche fait comprendre en un regard : un titre, un dessin fait main et une chiffre rendent visible ce que les tableaux cachent. Le carte, elle, apporte toute l’information : un QR code ou un lien ouvre sur téléphone ou sur ordinateur une carte interactive pour retrouver sa ligne, sa gare, et explorer les données station par station.

Comme une correspondance relie des lignes, chaque affiche croise plusieurs jeux de données pour révéler des inégalités qu’un seul ne montre pas. Le dessin rend les données lisibles et la carte les rend complètes. Elles sont mises au service de l’intérêt général, pour aider chacune et chacun à meux comprendre son territoire.

Une affiche en station interpelle les usagers sur un thème. Un lien ou un QR code ouvre ensuite une carte interactive sur leur téléphone ou leur ordinateur, pour explorer les données ligne par ligne et station par station.

Le projet couvre quatre thèmes issus des défis 4 et 1:

- **Violences :** qui subit le plus de violences sur le réseau ?
- **Eau :** peut-on boire de l'eau en station ?
- **Air :** quel air respire-t-on sur les quais ? Quelle ligne est la plus éttoufante ?
- **Accessibilité :** à quelles stations peut-on accéder en fauteuil roulant ?

**Lien vers la publication :** https://www.visualdataflow.com/IDFM/

## Présentation du projet

Ce projet a été développé dans le cadre du Hackaviz Mobilités 2026 spécial dataviz, organisé par Île-de-France Mobilités du 2 au 13 novembre 2026. Pour en savoir plus, voici le [Guide des participants et participantes](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/README.md).

**Équipe :** Noa Tendero Jovaní et Daniel Breton (Equipe 14).

### Le problème et la proposition de valeur

Chaque jour, des millions de Franciliens et Franciliennes empruntent le réseau ferré, sans pouvoir savoir ce qui compte pour leur confort et leur santé :

La rame sera-t-elle climatisée ?
L’air du quai est-il pollué ?
Où trouver de l’eau ?
Pourra-t-on accéder ou sortir de la station en fauteuil ?

Les réponses existent dans les données ouvertes, mais elles osnt dispersées entre pluseurs producteurs, techniques et rarement présentées à l’échelle d’une ligne.

Le réseau est aussi un lieu d’insecurité. Les violences sexistes et sexuelles y touchent d’abord les jeunes femmes (et enfants) d’entre 13 et 29 ans. Une affiche dédiée rend cette réalité visible auprès de toutes et tous, là où elle se produit.

**Usagers cibles :**

- **Voyageurs du quotidien :** ils découvrent l'affiche en station et la carte sur leur mobile.
- **Jeunes femmes de 13 à 29 ans, premières concernées par les violences sexistes et sexuelles, et l'ensemble des voyageurs, témoins potentiels.**
- **Personnes à mobilité réduite et leurs accompagnants.**
- **Associations, élus et grand public :** ils et elles peuvent comparer les lignes entre elles.

### La solution

La solution associe **un jeu d'affiches** et **un jeu de cartes interactives ou animées** pour chaque thème. Une page sommaire rassemble l'ensemble : https://www.visualdataflow.com/IDFM/

|                                  |                                                                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Violences**                    | Seule une affiche est disponible pour ce thème, car peu de données géolocalisées sur ce sujet semblent disponibles.                                                                                                        |
| **Accès à l'eau**                | Les stations sont classées selon la proximité d'un point d'eau : fontaine dans la station (1 point), toilettes dans la gare (½ point, eau probable), point d'eau à moins de 100 m, 200 m ou 300 m (0,5, 0,3 ou 0,2 point). |
| **Qualité de l'air**             | Le score dépend de la pollution aux particules sur chaque quai : station aérienne (1 point), pollution faible (0,9), moyenne (0,5) ou élevée (0).                                                                          |
| **Accessibilité en fauteuil**    | La station est accessible (1 point), accessible avec assistance (0,5) ou non accessible (0).                                                                                                                               |
| **Ligne 7, station par station** | Une animation fait parcourir la ligne 7 à une rame. À chaque station, elle affiche la qualité de l'air sur le quai et la présence d'une fontaine.                                                                          |

**Fonctionnement commun aux cartes thématiques :**

- **Score d'une ligne :** chaque station reçoit des points ; le score de la ligne est la moyenne de ses stations, ramenée sur 100 (100 = meilleur).
- **Couleur des portions :** chaque station colore la portion de ligne qui l'entoure, jusqu'à mi-chemin des stations voisines. On repère ainsi d'un coup d'œil les tronçons bien ou mal servis.
- **Classement des lignes :** au survol ou au clic d'une ligne, une fiche détaille son score.
- **Exploration :** en zoomant, on peut cliquer sur chaque station.
- **Mobile :** une version adaptée permet de consulter les cartes depuis le quai.

#### Les données mobilisées

| #   | Jeu de données                                                                       | Producteur                         | Lien                                                                                                                                                                                | Utilisé dans                 |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Tracés du réseau ferré d'Île-de-France                                               | Île-de-France Mobilités            | [traces-du-reseau-ferre-idf](https://data.iledefrance-mobilites.fr/explore/dataset/traces-du-reseau-ferre-idf/information/)                                                         | eau, air, fauteuils, ligne 7 |
| 2   | Emplacement des gares d'Île-de-France                                                | Île-de-France Mobilités            | [emplacement-des-gares-idf](https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/information/)                                                           | eau, air, fauteuils, ligne 7 |
| 3   | Référentiel des lignes                                                               | Île-de-France Mobilités            | [referentiel-des-lignes](https://data.iledefrance-mobilites.fr/explore/dataset/referentiel-des-lignes/information/)                                                                 | eau, air, fauteuils, ligne 7 |
| 4   | Qualité de l'air dans le réseau de transport francilien                              | Île-de-France Mobilités × Airparif | [qualite-de-lair-dans-le-reseau-de-transport-francilien](https://data.iledefrance-mobilites.fr/explore/dataset/qualite-de-lair-dans-le-reseau-de-transport-francilien/information/) | air, ligne 7                 |
| 5   | Accessibilité en gare                                                                | Île-de-France Mobilités            | [accessibilite-en-gare](https://data.iledefrance-mobilites.fr/explore/dataset/accessibilite-en-gare/information/)                                                                   | fauteuils                    |
| 6   | Arrêts (référentiel des arrêts, métro et tram)                                       | Île-de-France Mobilités            | [arrets](https://data.iledefrance-mobilites.fr/explore/dataset/arrets/information/)                                                                                                 | fauteuils                    |
| 7   | Fontaines à eau dans le réseau RATP                                                  | RATP                               | [fontaines-a-eau-dans-le-reseau-ratp](https://data.ratp.fr/explore/assets/fontaines-a-eau-dans-le-reseau-ratp/)                                                                     | eau, ligne 7                 |
| 8   | Sanitaires du réseau RATP                                                            | RATP                               | [sanitaires-reseau-ratp](https://data.ratp.fr/explore/dataset/sanitaires-reseau-ratp/)                                                                                              | eau                          |
| 9   | Points d'eau potable (`amenity=drinking_water`, fontaines et robinets d'eau potable) | OpenStreetMap (ODbL), via Overpass | [Tag:amenity=drinking_water](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Ddrinking_water)                                                                                      | eau                          |
| 10  | Toilettes (`amenity=toilets`)                                                        | OpenStreetMap (ODbL), via Overpass | [Tag:amenity=toilets](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dtoilets)                                                                                                    | eau                          |

**Comment les données sont récupérées :**

- **Jeux IDFM :** téléchargés par l'API Explore v2.1 (`https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/<jeu>/exports/geojson`). Le jeu `arrets` est exporté en deux fois, avec les filtres `arrtype='metro'` et `arrtype='tram'`.
- **Jeux RATP :** téléchargés par l'API `https://data.ratp.fr/api/explore/v2.1/catalog/datasets/<jeu>/exports/geojson`.
- **Jeux OpenStreetMap :** requêtes Overpass limitées à la région Île-de-France.

#### Comment la solution répond au problème

- **De l'affiche à la station :** l'affiche crée l'interpellation en station, puis la carte permet d'aller jusqu'au détail de chaque station.
  Les usagers peuvent scanner en coup de vent et s’attarder sur l’observaiton des données pendant leur trajet en metro ou à un autre moment plus tard. Le partager facilement sur les réseaux sociaux.

- **Des données croisées :** les jeux IDFM, RATP et OpenStreetMap sont croisés pour obtenir une information que le voyageur ne trouve nulle part ailleurs en un seul endroit.

- **Une même grille pour les différents thèmes :** chaque thème donne un score sur 100 par ligne. Les lignes deviennent comparables et le sujet se comprend en un coup d'œil.

### Les problèmes surmontés et les enjeux en matière de données

| Problème                                                                                                                                                                                                                                                                  | Solution retenue                                                                                                              | Recommandation à IDFM                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Le jeu **État des ascenseurs** est en accès restreint : l'API renvoie une erreur 403.                                                                                                                                                                                     | Le fichier a été téléchargé à la main depuis le portail connecté. Il n'a finalement pas été utilisé dans les cartes publiées. | Ouvrir ce jeu, essentiel pour l'accessibilité réelle en temps réel.                  |
| Dans **Accessibilité en gare** et le **référentiel des arrêts**, une gare desservie par plusieurs lignes peut avoir à la fois des quais accessibles et des quais non accessibles, sans que l'on sache quelle ligne est concernée (ex. Châtelet : M14 accessible, M1 non). | Ces gares sont départagées grâce à la propriété `accessible` du référentiel des lignes.                                       | Indiquer la ligne sur chaque zone d'arrêt.                                           |
| Le jeu **qualité de l'air** ne couvre pas le tramway et certaines stations n'ont pas de mesure.                                                                                                                                                                           | Le tram est compté comme aérien (air extérieur). Les stations sans données sont exclues du score.                             | Étendre la couverture et préciser la date des mesures.                               |
| Il n'existe **aucun jeu IDFM sur l'eau potable** : seules la RATP (fontaines) et OpenStreetMap en fournissent.                                                                                                                                                            | Croisement de trois sources (RATP fontaines et sanitaires, OSM) avec des seuils de distance.                                  | Publier un inventaire des fontaines et sanitaires sur tout le réseau (SNCF compris). |

### Et la suite ?

- **Déployer les affiches en station :** imprimer les affiches avec un QR code vers la carte de la ligne. Une version adaptée pour la consultation sur mobile a été élaborée.

- **Ajouter des thèmes :** fréquentation (validations), climatisation des rames, annonces sonores et visuelles.

- **Affiner l'accessibilité :** compléter la carte fauteuils avec OpenStreetMap (`wheelchair=*`) et l'état des ascenseurs en temps réel.

- **Animer d'autres lignes :** décliner l'animation « station par station » sur les autres lignes.

- **Déclianaisons pour les réseaux sociaux :** les affiches, cartes ou animations peuvent également servir à des communications sur les réseaux sociaux√.

**Technologies :** Stylos, crayons de couleur, papier, MapLibre GL JS, Vite, Turf.js.

## La licence

© 2026 Noa Tendero Jovaní et Daniel Breton.

| Élément                                                                                               | Licence                                                                                | Condition principale                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Code** (scripts de traitement des données, pages et cartes interactives) et documentation technique | [MIT](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/Docs/License.md) | Conserver la mention de copyright et le texte de la licence dans toute copie du code.                                                            |
| **Éléments visuels** (affiches, captures d'écran, textes de présentation)                             | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fr)                       | Réutilisation libre, y compris commerciale, à condition de citer les auteurs de façon visible et d'indiquer si des modifications ont été faites. |

### Comment citer ce projet

> Noa Tendero Jovaní et Daniel Breton, _Métro, RER, tramway : violences, eau, air et accessibilité_, Hackaviz Mobilités 2026 – Île-de-France Mobilités, novembre 2026. Licence CC BY 4.0 (éléments visuels) et MIT (code).

### Licences des données

Les données conservent leur licence d'origine :

- **Île-de-France Mobilités et RATP :** licences des portails open data respectifs.
- **OpenStreetMap :** ODbL, © les contributeurs d'OpenStreetMap.
- **Fond de carte :** © DINUM, © OpenMapTiles, © contributeurs OpenStreetMap.
