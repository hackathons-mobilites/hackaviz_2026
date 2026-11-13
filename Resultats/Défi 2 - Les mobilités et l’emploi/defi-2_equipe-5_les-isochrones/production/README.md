# Travailler sans voiture en Île-de-France : où, pour qui, à quelle heure ?

**Équipe :** Les Isochrones (Sokheng DIN, Veasna RA, Hok Seng, Menghor Thuo)  

**Mail de contact :** din.sokheng08@gmail.com, raveasna15@gmail.com, senghok789@gmail.com, thuomenghor@gmail.com

**Défi :** Défi 2, "Les mobilités et l'emploi"

Une dataviz interactive, en français et en anglais, qui mesure commune par commune combien d'emplois sont accessibles
en transports en commun en Île-de-France, à plusieurs heures de la journée, et où des solutions complémentaires
(vélo, transport à la demande) élargiraient l'accès à l'emploi sans voiture.

**Dataviz en ligne : https://dataviz.sokhengdin.dev/**

## Présentation du projet

Ce projet a été développé dans le cadre du Hackaviz Mobilités 2026 spécial dataviz, organisé par Île-de-France
Mobilités du 2 au 26 novembre 2026. Pour en savoir plus, voici le
[Guide des participants et participantes](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/README.md).

Nous avons calculé les temps de trajet en transports en commun entre les 1 285 communes et arrondissements
franciliens, à partir des horaires GTFS d'Île-de-France Mobilités, puis répondu à trois questions avec une même
mesure, le nombre d'emplois accessibles.

## Le problème et la proposition de valeur

**Notre question :** les pôles d'emploi franciliens sont-ils réellement accessibles en transports en commun
depuis les zones résidentielles, pour tout le monde et à toute heure ?

L'accès à l'emploi dépend fortement de l'offre de transport. Les pôles d'emploi périphériques (aéroports,
campus, zones d'activités) sont souvent difficiles à atteindre sans voiture, et les horaires décalés
aggravent le problème.

**Pour qui ?**
* **Île-de-France Mobilités et les collectivités** : repérer les communes et les pôles où l'offre ne permet
  pas d'accéder à l'emploi, et cibler des solutions complémentaires (vélo, transport à la demande).
* **Acteurs de l'emploi** (France Travail, missions locales) : savoir quels emplois sont réellement
  accessibles sans voiture depuis une commune, à l'heure où l'on travaille.
* **Le grand public** : chercher sa commune et voir combien d'emplois sont à sa portée.

## La solution

Une **dataviz interactive en récit guidé** (cinq chapitres), accompagnée d'un **explorateur** pour les pôles d'emploi,
en français et en anglais (bouton FR / EN).
Chaque chapitre propose des cartes et graphiques interactifs (boutons de temps de trajet et de créneau
horaire, recherche de commune, zoom, info-bulles, vue en tableau).

* Récit guidé : https://dataviz.sokhengdin.dev/web/story.html ([`app/static/story.html`](app/static/story.html), route `/`)
* Explorateur : https://dataviz.sokhengdin.dev/web/index.html ([`app/static/explorer.html`](app/static/explorer.html), route `/explorer`)
* Version anglaise : ajouter `?lang=en` à l'adresse

**Ce que montrent les données :**
* **Où.** 28 pôles d'emploi concentrent 3,0 millions d'emplois (51 % de la région). Environ la moitié des
  actifs rejoignent les pôles parisiens ou La Défense en moins de 45 min ; moins de 5 % atteignent
  Roissy-CDG, Saint-Quentin-en-Yvelines, Paris-Saclay, Val d'Europe ou Melun. Un habitant de Paris atteint
  80 % des emplois des pôles en 45 min, un habitant de Seine-et-Marne 1 %.
* **Pour qui.** En 45 min, un actif atteint en moyenne 1,64 million d'emplois, mais les 10 % les moins bien
  desservis moins de 33 000, contre 1,34 million pour l'actif médian. Selon le revenu de la commune, l'écart
  forme un U : les communes de revenu intermédiaire, périurbaines, sont les moins bien servies. Accepter
  15 minutes de plus (45 → 60 min) multiplie les emplois accessibles par 3,7 en grande couronne, contre 1,3 à Paris.
* **À quelle heure.** Part des emplois des pôles accessible en une heure : 60 % à l'heure de pointe, 47 % en
  partant entre 4 h 30 et 6 h, 50 % le dimanche matin, 41 % pour rentrer entre 22 h et 0 h 30. Après un
  service tardif, le trajet médian d'un salarié de Roissy pour rentrer chez lui est de 101 min. L'offre elle-même
  suit les horaires de bureau : un mardi, 9 % seulement des passages ont lieu avant 6 h ou après 22 h (16 % autour
  de Roissy), et le dimanche l'offre tombe à 47 % de celle du mardi.
* **La voiture.** 664 000 actifs (12 %) vivent dans une commune "captive" (plus de 70 % de voiture,
  moins de 10 % des emplois des pôles en une heure). La part de la voiture passe de 74 % à 17 % des communes
  les moins aux mieux reliées aux pôles (corrélation, pas causalité).
* **Que faire.** Pistes cyclables vers un pôle proche pour 293 communes (1,6 million d'actifs) ; le vélo
  jusqu'à la gare fait passer l'accès aux pôles en 45 min de 7,6 % à 12,8 % en grande couronne ; transport à
  la demande ou bus express pour 218 communes captives. 70 % des communes où nous proposons le vélo ont moins
  d'aménagements cyclables que la médiane régionale. Le Grand Paris Express (lignes 15 à 18, horaires
  simulés) aide surtout la petite couronne (+9 % d'emplois accessibles en 45 min, contre +5 % en grande couronne).

### Les données utilisées

| Source | Jeu de données | Lien |
| --- | --- | --- |
| Île-de-France Mobilités | Horaires prévus sur les lignes de transport en commun (GTFS) | https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/ |
| INSEE | Base flux de mobilité domicile - lieu de travail 2022 | https://www.insee.fr/fr/statistiques/8582949 |
| INSEE (API Melodi) | Déplacements domicile-travail selon le moyen de transport (NAV2, RP 2023) | https://www.data.gouv.fr/datasets/deplacements-domicile-travail-selon-le-sexe-le-lieu-de-travail-et-le-moyen-de-transport-donnees-detaillees-nav2a-et-nav2b |
| INSEE via data.gouv.fr | Revenu des Français à la commune (Filosofi 2021) | https://www.data.gouv.fr/datasets/revenu-des-francais-a-la-commune |
| IGN via geo.api.gouv.fr | Contours et mairies des communes et arrondissements | https://geo.api.gouv.fr/decoupage-administratif |
| Société des grands projets | Localisation des gares du Grand Paris Express | https://www.data.gouv.fr/datasets/point-de-localisation-des-gares-du-grand-paris-express |
| Île-de-France Mobilités (PRIM) | Offre de transport hebdomadaire moyenne par arrêt et par heure | https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/offre_hebdomadaire_moyenne_hors_vacances |
| OpenStreetMap via PRIM | Aménagements cyclables en Île-de-France | https://prim.iledefrance-mobilites.fr/ |

Détail et licences : [`docs/data_sources.md`](docs/data_sources.md), [`DATA_LICENSES.md`](DATA_LICENSES.md).

### Les outils employés

Python (pandas, GeoPandas, DuckDB, NumPy, Numba, SciPy, pyproj, Matplotlib) ; calculateur d'itinéraires développé
par l'équipe (algorithme Connection Scan) ; D3.js v7 pour la dataviz web ; icônes Lucide ; Playwright pour les
captures d'écran ; Docker et nginx pour la mise en ligne.

**Méthode :** calculateur d'itinéraires développé par l'équipe (algorithme Connection Scan, `isochrones/csa.py`) ;
un point par commune (la mairie, ou un point manuel pour 11 grands sites d'emploi) ; marche jusqu'à 1,6 km
vers un arrêt ; médiane des départs toutes les 5 min sur chaque créneau (mardi 17 et dimanche 22 novembre 2026).

**Accessibilité :** vue en tableau sous chaque graphique, recherche de commune avec réponse textuelle,
navigation au clavier (Tab) avec valeurs affichées au focus, motifs en plus des couleurs, titres et légendes partout.

## Les problèmes surmontés et les enjeux en matière de données

* **Pas de calculateur d'accessibilité prêt à l'emploi** : nous avons écrit notre propre calculateur
  (Connection Scan, accéléré avec numba). Une matrice 1 285 × 1 285 pour 25 départs se calcule en 90 s environ.
* **Le fichier détail MOBPRO 2022 (66 Mo) n'a pas pu être téléchargé** depuis notre environnement (coupures
  répétées, pas de reprise possible). Nous avons utilisé la base flux 2022 et les modes par commune via l'API Melodi.
* **Les futures lignes ne sont pas dans les données ouvertes de l'offre** : ni dans le GTFS ni dans le
  référentiel des arrêts. Nous avons dû simuler les horaires du Grand Paris Express à partir d'un fichier de
  gares de 2016.
* **Les trajets après minuit** classés sur le jour de service suivant ne sont pas pris en compte : les temps de
  retour tardif sont donc légèrement pessimistes.

**Recommandations à Île-de-France Mobilités :**
1. Publier les **arrêts et tracés des lignes à venir** (15, 16, 17, 18…) dans le référentiel des arrêts, avec
   des horaires prévisionnels même indicatifs, pour permettre des études d'impact.
2. Publier une **matrice de temps de parcours de référence** (communes ou IRIS, plusieurs créneaux) : chaque
   équipe la recalcule aujourd'hui avec ses propres hypothèses.
3. Offrir des **liens de téléchargement stables avec reprise** (en-tête HTTP Range) pour les gros fichiers,
   et des archives des GTFS passés pour étudier l'évolution du réseau.

## Et la suite ?

* Valider les temps de parcours avec le calculateur d'itinéraires IDFM et calibrer la marche.
* Passer d'un point par commune à une grille fine (carreaux INSEE de 200 m) et à la marche sur le réseau de rues.
* Intégrer le fichier détail MOBPRO pour relier le mode de chaque trajet réel à son temps en transports en commun.
* Ajouter les perturbations temps réel (API PRIM) pour mesurer la fiabilité, pas seulement le temps prévu.
* Faire de l'explorateur un outil pour les conseillers emploi : "depuis cette commune, à cette heure, quels emplois ?".

## La licence

Le code et la documentation de ce projet sont sous licence [MIT](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/Docs/License.md) ([`LICENSE`](LICENSE)). Les données dérivées des horaires GTFS
d'Île-de-France Mobilités (matrices de temps de parcours, tables) restent sous **ODbL 1.0** :
"Contient des données d'Île-de-France Mobilités, ODbL". Les données INSEE, IGN, de la Société des grands
projets et l'offre PRIM sont sous Licence Ouverte 2.0 ; les aménagements cyclables (OpenStreetMap) sous ODbL. Voir [`DATA_LICENSES.md`](DATA_LICENSES.md).
