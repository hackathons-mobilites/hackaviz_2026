# Canopée — rejoindre les transports à l’ombre pendant une canicule

Datavisualisation interactive pour le défi « mobilités et adaptation climatique » du Hackaviz Mobilités 2026, organisé par Île-de-France Mobilités. Paris est notre terrain pilote. La carte aide à lire l'ombre des rues, à repérer les stations de transport, l'eau et les lieux frais, puis à préparer un trajet à pied entre deux adresses.

## Présentation du projet

### Dataviz · Mobilités douces, ville plus chaude

La page autonome **[Dataviz](https://canopee-delta.vercel.app/dataviz)** complète l’outil cartographique. Sa question : **les mobilités douces encouragées sont-elles confortables dans une ville qui se réchauffe ?** Elle relie six étapes : projections de jours très chauds, fréquentation et ombre des abords des stations, accès aux fontaines, disponibilité de l’ombre et du soleil selon la saison et l’heure, compromis d’itinéraire, puis croissance conditionnelle des arbres vers 2036.

Elle contient une animation des 601 secteurs hexagonaux de Paris, un graphique climatique à points et intervalles, un nuage de points interactif sur 241 stations reliées au référentiel IDFM, une distribution des distances aux fontaines (223 à 250 m ou moins, 66 entre 251 et 500 m, 3 au-delà), une courbe horaire été/hiver, une matrice de 180 valeurs d’ombre, 24 comparaisons de trajets et un graphique avant/après du scénario arboré. La matrice présente douze stations choisies pour illustrer différents quartiers, sans prétendre représenter tout le réseau. Les sources, tableaux et données téléchargeables accompagnent les graphiques. L’outil reste dans `index.html`, et les liens du récit ouvrent directement une station ou un trajet avec son heure, sa saison et sa préférence d’exposition. Le récit règle `accept=50` pour le plus court, `accept=0` pour chercher l’ombre et `accept=100` pour chercher le soleil, selon la nouvelle signature du routeur. Les petits plans emploient les vrais contours bâtis et les couleurs des rues du modèle.

L’animation d’ouverture reprend directement `router.overviewCollection` pour chaque heure de 7 h à 21 h, en été, dans la vue actuelle. Les hexagones ont un rayon de 260 m et exigent au moins huit tronçons connus, exactement comme la carte. Le pourcentage du bandeau concerne les secteurs sous 40 % d’ombre, et non les stations. Les données sont dans `public/data/story-hex.json`, régénérées par `npm run prepare-story-hex` et vérifiées contre le modèle par `node --test tests/story-hex.test.mjs`. La vidéo autonome `public/media/paris-ombre-journee.mp4` montre les mêmes valeurs avec une interpolation visuelle ; elle se régénère par `python3 scripts/render-story-hex-video.py` avec Pillow et ffmpeg installés. Les plaques bleu nuit des stations sont inspirées de la signalétique du métro parisien.

Les graphiques se construisent à leur entrée dans l’écran. Le premier trajet se dessine à son apparition, puis chaque choix de parcours, saison ou heure relance une animation autonome. Les trois exemples partagent la même échelle métrique dans chaque saison, avec une barre de 200 m. Le cadrage reste stable quand on change l’heure. Les bâtiments et les rues couvrent tout le cadre, même lorsque le trajet est court. Les compteurs et tracés utilisent Motion ; la préférence système de réduction des animations reste respectée. La matrice et la recherche de station se parcourent aussi au clavier. La courbe horaire se lit directement au pointeur ou au toucher, avec le chiffre et le curseur synchronisés. Cette interaction reprend le principe de [Chart scrub, Stageshow de Benji Taylor](https://github.com/benjitaylor/skills/tree/main/stageshow/examples/chart-scrub), testé dans son playground local ; le kit React n’est pas ajouté au site. La présentation s’inspire de la narration cartographique de [Walkachusetts, The Pudding](https://pudding.cool/2025/10/walk/).

La projection climatique utilise [Météo-France, Le climat de la France (2026), p. 7](https://meteofrance.com/sites/default/files/files/editorial/le_climat_de_la_france_v1%20%281%29.pdf), TRACC : 1 jour/an au-dessus de 35 °C sur 1976–2005, puis une médiane de 4 (enveloppe 2–6) à l’horizon 2050 et de 8 (5–12) en 2100. Elle est distincte de notre scénario de canopée 2036, qui ne prédit aucune température.

Les validations ferroviaires 2025 sont recalculées directement depuis les quatre fichiers trimestriels de l’[historique officiel IDFM](https://data.iledefrance-mobilites.fr/explore/dataset/histo-validations-reseau-ferre/). `public/data/idfm-validations-2025.json` conserve les totaux, les bornes basses prudentes des effectifs masqués, les périodes et les empreintes SHA-256 des fichiers. Le rapprochement utilise l’identifiant officiel ID_ZdC. Cet identifiant peut couvrir plusieurs stations d’un même pôle ; le trafic porte alors sur le pôle, et l’ombre reste calculée autour du point généralisé de notre couche IDFM. Il exige les quatre trimestres, conserve les absences et ne répartit pas un total entre plusieurs stations. Les validations ne mesurent ni les personnes distinctes ni les marcheurs exposés.

Pour ouvrir le récit : http://localhost:5173/dataviz. Pour régénérer ses calculs depuis les données préparées : `npm run prepare-story`. Pour recalculer les validations, télécharger l’archive 2025 depuis le portail IDFM, puis lancer `python3 scripts/import-idfm-traffic.py /chemin/data-rf-2025.zip`. Le script lit les classeurs sans les modifier, vérifie les périodes, recense les clés répétées et agrège chaque ligne publiée une seule fois, tous titres confondus, par identifiant. Certaines clés officielles se répètent avec des nombres différents : leurs lignes sont additionnées, sans dédoublonnage arbitraire. Les petits effectifs sont conservés à leur borne publiée, avec une borne basse documentée. Les invariants se vérifient avec `node --test tests/story.test.mjs tests/story-geometry.test.mjs tests/story-hex.test.mjs`. `npm run build` produit les deux pages.

La conclusion présente une scène MapLibre 3D tournante du quartier République–Arts et Métiers, avec hauteurs réelles IGN, ombres portées selon la même enveloppe convexe que l’outil, et un trajet calculé. Les données `story-preview.json` sont régénérées avec le récit. La rotation est automatique, s’arrête hors écran ou en arrière-plan, et respecte la réduction des animations du système. Les abris-bus et pistes cyclables sont des pistes d’analyse, pas des résultats mesurés dans ce récit.

#### Fusion des branches

Le récit est servi publiquement à `/dataviz`. Son fichier source reste `recit.html`. Conserver les deux entrées dans `vite.config.js`, la réécriture de `/dataviz` dans `vercel.json` et le lien de navigation dans `index.html`. Dans `src/main.js`, `openStorySelection()` ouvre les liens de stations et de trajets depuis le récit avec leurs paramètres d’heure, de saison et de soleil. Les modifications du récit se font dans `recit.html` et `src/story*.js`. Les comparaisons du récit conservent leur hypothèse de 4,5 km/h à pied. La carte estime la marche à 5 km/h. Vérifier la fusion avec `node --test tests/*.test.mjs` et `npm run build`.

### Le problème et la proposition de valeur

Pendant une forte chaleur, les dernières minutes à pied vers une station peuvent être pénibles. Une station proche sur un plan peut être entourée de rues exposées, sans eau ni lieu frais à proximité. Canopée rend ces écarts visibles pour les voyageurs et les acteurs de la mobilité. Ce prototype ne remplace pas un service de navigation ou une consigne sanitaire.

### La solution

#### Deux vues

- **Aujourd'hui** : réseau des rues et bâtiments actuels, ombre des bâtiments calculée heure par heure pour le 25 juin 2026 par ciel dégagé, couverture des arbres recensés estimée, fontaines disponibles et lieux frais recensés par la Ville de Paris.
- **Vers 2036** : scénario conditionnel dans lequel les arbres déjà classés « Jeune » gagnent 2 m de rayon de canopée. Les liserés verts montrent les rues où ce modèle donne plus d'ombre. La carte montre aussi les manques qui persisteraient si l'offre actuelle d'eau et de refuges ne changeait pas. Les tracés violets sont des projets de transport dont la mise en service est estimée entre 2027 et 2036.

La vue future **n'est pas une prévision à l'adresse près**. Elle modélise uniquement la croissance possible d'arbres déjà recensés, en été. Leur couronne actuelle est approximée par un disque de rayon égal à 30 % de la hauteur déclarée, limité entre 1,5 et 6 m ; le rayon des jeunes arbres augmente de 2 m, jusqu'à 8 m. Les portions de rue couvertes sont additionnées et plafonnées à 100 %. Ce n'est pas une projection directionnelle de l'ombre des arbres, ni une mesure de leur couronne. Les plantations à venir ne sont pas placées sur la carte faute de localisation et de calendrier vérifiables. Les rues et bâtiments restent ceux du modèle actuel. Aucune température future n'est extrapolée pour 2036.

#### Les abords des stations

Le prototype croise 292 points représentatifs de gares et stations ferrées d'Île-de-France Mobilités situés dans Paris avec les rues calculées, les fontaines et les lieux frais. Pour chaque station, la carte et une liste textuelle indiquent la part d'ombre des rues dans un rayon de 250 m et les distances à vol d'oiseau de l'eau et d'un lieu frais.

À 16 h, **selon notre modèle et nos seuils exploratoires**, 175 stations ont moins de 40 % d'ombre sur les rues proches ; 39 cumulent au moins deux points d'attention parmi ombre faible, fontaine à plus de 350 m et lieu frais à plus de 300 m. Ces chiffres ne mesurent ni la température ressentie ni un risque sanitaire.

#### Itinéraire canicule

Entrer une adresse de départ et une destination, puis choisir les résultats du géocodeur. On peut aussi cliquer deux points sur la carte. Le cran Normal minimise la distance et sert de référence aux crans de soleil. Le résultat indique les fontaines, lieux frais et parcs à moins de 80 m du tracé. Cliquer une fontaine ou un lieu frais gratuit permet de l'ajouter comme étape.

À pied et à vélo personnel, Canopée estime la durée d’après le tracé entre le départ et l’arrivée, à 5 km/h à pied et à 15 km/h à vélo. En Vélib, Canopée sélectionne les stations de prise et de dépôt les plus proches à vol d’oiseau des extrémités parmi celles reliées au trajet. La durée totale additionne les deux portions à pied et le trajet entre les stations, hors temps de prise et de dépôt. Le cran de soleil s’applique à la portion à vélo. Le graphe de rues est commun aux deux modes. Les restrictions cyclables, les sens de circulation et la disponibilité en station restent à vérifier.

Les horaires, l'accessibilité réelle des entrées et la disponibilité d'un équipement doivent être vérifiés avant le déplacement. La canopée est estimée par un modèle simple ; le trajet ne garantit pas l'ombre réelle et ne mesure pas la température ressentie.

### Les problèmes surmontés et les limites

Certaines emprises de bâtiment n'ont pas de hauteur : elles sont figurées en pointillés et ne projettent pas d'ombre. Les points des stations sont généralisés et ne représentent pas leurs entrées exactes. Les distances aux équipements sont à vol d'oiseau, pas par le réseau piéton. Les plantations futures ne sont pas placées faute de localisation et de calendrier vérifiables. Les projets de transport affichés ne sont pas supposés créer de l'ombre. Les seuils du classement sont des choix de visualisation, sans valeur réglementaire ou médicale.

### Et la suite ?

Relier les stations à leurs entrées réelles, calculer les distances par le chemin piéton, intégrer les horaires et l'accessibilité des lieux frais, documenter les projets de végétalisation localisés et étendre l'analyse au reste de l'Île-de-France.

## Installation et utilisation

Node.js récent et un navigateur compatible avec `DecompressionStream` sont nécessaires. Les données préparées et compressées sont incluses dans `public/data/` : la démo démarre sans recalculer toutes les rues.

```bash
npm ci
npm run dev
```

Ouvrir http://localhost:5173/. Choisir deux adresses pour le trajet, puis basculer entre Aujourd'hui et Vers 2036. Les pictogrammes indiquent les fontaines (eau animée), les lieux frais, les espaces verts (arbre) et les stations. Une alerte sur une station signale au moins deux points d'attention ; sa fiche et « Explorer les stations en texte » donnent les valeurs exactes.

`npm run build` produit le site statique dans `dist/`, données comprises. Le chemin des ressources est relatif pour permettre un hébergement dans un sous-dossier. Pour régénérer les données depuis les sources ouvertes, lancer `npm run prepare-data` avec une connexion réseau et environ 8 Go de mémoire disponibles ; les téléchargements WFS déjà écrits dans `data/raw/` sont repris au prochain lancement.

`npm run prepare-velib` actualise le GeoJSON Vélib indépendamment du reste. L’export officiel est filtré selon le contour parisien de `scene.json`. Le relevé du 13 novembre 2026 contient 996 stations dans ce périmètre.

## Données et méthode

| Élément | Source | Licence |
| --- | --- | --- |
| Bâtiments, hauteurs et axes | [IGN BD TOPO, Géoplateforme WFS](https://data.geopf.fr/wfs/ows) | Licence Ouverte |
| Contour de Paris | [API Géo](https://geo.api.gouv.fr/communes/75056?fields=contour&format=geojson&geometry=contour) | Licence Ouverte |
| Température du 25 juin 2026 | [Météo-France, données horaires](https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-horaires) | Licence Ouverte |
| Météo en mode Direct | [Open-Meteo](https://open-meteo.com/en/license) | CC BY 4.0 pour les données de l’API |
| Fontaines | [Eau de Paris / Paris Data](https://opendata.paris.fr/explore/dataset/fontaines-a-boire/) | ODbL |
| Équipements frais | [Ville de Paris / Paris Data](https://opendata.paris.fr/explore/dataset/ilots-de-fraicheur-equipements-activites/) | ODbL |
| Espaces verts frais | [Ville de Paris / Paris Data](https://opendata.paris.fr/explore/dataset/ilots-de-fraicheur-espaces-verts-frais/) | ODbL |
| Arbres, hauteur et stade de développement | [Ville de Paris / Paris Data](https://opendata.paris.fr/explore/dataset/les-arbres/) | ODbL |
| Gares et stations du réseau ferré, points généralisés | [Île-de-France Mobilités](https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf-data-generalisee/) | Licence Ouverte v2 |
| Validations ferroviaires 2025 | [IDFM / PRIM](https://prim.iledefrance-mobilites.fr/jeux-de-donnees/histo-validations-reseau-ferre), agrégats calculés à partir des quatre trimestres officiels | ODbL |
| Localisation et capacité des stations Vélib | [Smovengo / Syndicat Autolib’ Vélib’ Métropole, via Open Data Paris](https://opendata.paris.fr/explore/dataset/velib-emplacement-des-stations/) | ODbL 1.0 |
| Projets de transport | [Île-de-France Mobilités](https://data.iledefrance-mobilites.fr/explore/dataset/projets_lignes_idf/) | Licence Ouverte |
| Adresses | [Base Adresse Nationale, service de géocodage Géoplateforme](https://adresse.data.gouv.fr/outils/api-doc/adresse) | Service public |
| Fond de carte | [OpenFreeMap](https://openfreemap.org/) / OpenStreetMap | ODbL |

Une maille « manque » mesure 350 m de côté. Son centre est à plus de 350 m à vol d'oiseau d'une fontaine disponible et/ou à plus de 600 m d'un équipement frais gratuit ou d'un espace vert avec au moins 25 % de végétation haute. Ces seuils sont des choix de visualisation, pas des normes sanitaires. La distance à vol d'oiseau ne représente pas un parcours accessible. Les données de lieux frais sont des points représentatifs, pas les entrées exactes.

Le calcul de l'ombre et du chemin est détaillé dans l'interface, sous **Sources et méthode**. Le code est sous licence MIT. Les données dérivées gardent les obligations de leurs licences sources.

À l'échelle de Paris, la carte affiche une mosaïque d'hexagones de rayon 260 m. Chaque couleur résume la moyenne des tronçons de rue calculés dans ce secteur, pondérée par leur nombre. En zoomant, les rues individuelles apparaissent. Cette vue d'ensemble ne mesure pas la température du secteur.

Les sources ouvertes sont téléchargées lors de la préparation et les fichiers prêts à servir sont inclus dans `public/data/`. Leur date de génération figure dans les JSON concernés. Les données exclusives du hackathon ne sont pas utilisées.

## Accessibilité

Les formulaires ont des libellés, le trajet et les stations ont des résumés textuels, la liste des stations est utilisable au clavier, et les stations à examiner sont distinguées par un symbole d'alerte en plus de la couleur. L'animation de l'eau s'arrête quand la réduction des animations est demandée par le système. Les contrôles ont un focus visible. Cette version n'a pas encore fait l'objet d'un audit RGAA complet.

## Licence

Le code et la documentation originale sont sous [licence MIT](LICENSE). Les données intégrées conservent les obligations de leurs sources, notamment la Licence Ouverte et l'ODbL ; le contenu de `public/data/` ne devient pas MIT. Les producteurs sont crédités dans le tableau ci-dessus et dans l'interface.

L'interface s'inspire des principes de lisibilité, de hiérarchie et de focus du [Système de Design de l'État](https://www.systeme-de-design.gouv.fr/version-courante/fr/premiers-pas). Elle utilise la police libre Source Sans 3 et conserve une identité propre à Canopée.
