# Moby d'Île 🐋

**Équipe TRABOULE** · Romain Azaïs, Florent Delomier, Adrien Marion, Florian Patout, Manuel Petit

Moby d'Île 🐋 est une carte interactive qui montre où se trouvent les actifs occupés franciliens tout au long d’une journée type de semaine : à domicile, au travail ou en déplacement. Elle s’appuie sur une **population synthétique** de 5,5 millions d’individus, simulée à partir de **données publiques agrégées** : aucune donnée individuelle de déplacement n’est utilisée. Chaque individu est fictif, mais l’ensemble reproduit les distributions statistiques des sources.

## Présentation du projet

La carte révèle l’empreinte territoriale de l’emploi à l’échelle communale, sur toute la journée, selon trois situations : à domicile, au travail, en déplacement.

Elle permet de suivre l’évolution de chaque commune au cours de la journée et de filtrer la population selon ses caractéristiques sociodémographiques et professionnelles : genre, âge, catégorie socioprofessionnelle, secteur d’activité, mode de transport et télétravail le jour considéré.

Un outil de projection simule l’effet d’une hausse du télétravail, par catégorie socioprofessionnelle ou par secteur, sur la répartition des actifs dans le territoire.

Moby d'Île 🐋 a été développé dans le cadre du Hackaviz Mobilités 2026 spécial dataviz, organisé par Île-de-France Mobilités du 2 au 26 novembre 2026.

### Le problème et la proposition de valeur

Les trajets domicile-travail dépendent étroitement de l’offre de mobilité dont disposent les actifs. Les analyser finement permet d’explorer l’effet de la géographie, mais aussi des facteurs sociaux. Un défaut d’offre de transport explique-t-il des difficultés d’accès à l’emploi, ou de recrutement ? Des territoires comparables à première vue présentent-ils des destinations et des choix modaux différents ? Ces écarts tiennent-ils à la composition sociale de leur population ?

Aucune source ne répond seule à ces questions. Le recensement dit qui sont les actifs et où ils travaillent, mais pas quand ils partent ni par où ils passent ; les enquêtes de mobilité décrivent les horaires, mais sur de petits échantillons. Moby d'Île 🐋 assemble ces informations dans une seule population synthétique cohérente, puis la rend explorable.

**Usagers cibles**
- les autorités organisatrices de la mobilité et les collectivités, pour comprendre les rythmes de présence et de déplacement d’un territoire ;
- les aménageurs et les acteurs de l’emploi, pour repérer les décalages entre lieux de résidence et lieux de travail ;
- les chercheurs, les journalistes et les citoyens curieux de la géographie quotidienne de l’Île-de-France.

### La solution

Le projet s’articule en deux temps.

**1. Simuler une population synthétique à partir de données agrégées**

Cinq familles de sources publiques sont croisées, chacune apportant une partie du portrait des actifs :

| Source | Producteur | Ce qu’elle apporte |
| --- | --- | --- |
| INDCVI 2022 | Insee, recensement | profil des actifs et commune de résidence |
| MOBPRO 2022 | Insee, recensement | commune de travail |
| EMP 2019 | SDES, enquête Mobilité des personnes | horaires de travail |
| Insee Flash ÎdF n° 109 | Insee, enquête Emploi 2024 | télétravail |
| GTFS IDFM, OpenStreetMap | Île-de-France Mobilités, OpenStreetMap | réseaux de transport |

Ces sources ne partagent aucun identifiant. Elles sont donc reliées statistiquement, étape par étape :

1. **Individus.** Les actifs occupés de 15 à 99 ans qui résident et travaillent en Île-de-France sont reconstitués à partir du recensement, en respectant les effectifs de chaque territoire.
2. **Lieu de travail.** Chaque actif reçoit une commune de travail empruntée à un actif de profil identique dans MOBPRO.
3. **Horaires et télétravail.** Les heures de début et de fin du travail et le nombre de jours télétravaillés sont tirés selon le profil, de façon à reproduire les distributions publiées.
4. **Trajets.** Pour chaque mode et chaque couple domicile-travail, un algorithme de chemin de coût minimal est lancé sur le graphe de transport du mode considéré (réseau de transport en commun issu du GTFS, réseau routier issu d’OpenStreetMap). Il fournit la trace du trajet et sa durée.
5. **Journée type.** La journée de chaque individu est simulée au pas de 5 minutes : à chaque pas, il est placé dans une commune avec un statut (à domicile, au travail ou en déplacement). Le télétravail du jour est tiré au hasard selon le nombre de jours télétravaillés par cet individu.

Le résultat : 5 549 528 journées individuelles simulées, cohérentes avec les données agrégées.

**2. Proposer un outil interactif de visualisation**

La carte agrège ces journées par commune :
- un curseur de temps fait glisser une fenêtre de 15 minutes à 2 heures sur la journée, et une lecture animée la fait défiler ;
- les statuts (à domicile, au travail, en déplacement) et un filtre par caractéristique se combinent librement ;
- au survol ou au clic, chaque commune affiche l’évolution de ses actifs au cours de la journée, décomposée selon le filtre choisi ;
- le réseau de transport en commun de la région peut être superposé à la carte.

Un **outil de projection** simule une hausse du télétravail : on choisit de raisonner par catégorie socioprofessionnelle ou par secteur d’activité, puis on relève, palier par palier, la part de salariés qui télétravaillent dans chaque groupe. La carte montre aussitôt où se redistribuent les actifs : plus nombreux à domicile, moins nombreux en déplacement et dans les pôles d’emploi.

Un **système de scénarios** propose des situations prêtes à explorer : en un clic, il règle la période, les statuts, le filtre et, le cas échéant, la projection, puis lance la lecture. Chaque scénario raconte une facette de la journée francilienne et sert aussi de visite guidée : il montre comment combiner les réglages pour ensuite poser ses propres questions.

### Les problèmes surmontés et les enjeux en matière de données

**Relier des sources qui ne se parlent pas.** Aucune base ne fournit à la fois le profil des actifs, leur lieu de travail, leurs horaires et leurs trajets, à une échelle fine dans l’espace et dans le temps. Les sources sont donc appariées par profil, en respectant les lois marginales, c'est-à-dire en respectant les statistiques agrégées disponibles dans les données.

**Données manquantes.** Même croisées, les sources laissent des trous. Connaître le domicile, le lieu et les horaires de travail ne dit pas à quelle heure on quitte son domicile : c’est la simulation des trajets qui le fournit.

**Rendre le résultat explorable.** La carte est un simple fichier HTML, consultable localement sans calcul lourd. Tout est donc précalculé et agrégé par commune : les trajets sont calculés sur les réseaux, mais restitués commune par commune.

**Limites.** Les résultats décrivent une journée type de semaine simulée, pas un suivi en temps réel : ils sont fiables en moyenne et à l’échelle de la commune, pas pour un individu. Ils héritent des hypothèses du modèle et des sources : seuls les actifs occupés qui résident et travaillent en Île-de-France sont représentés, et seul leur trajet domicile-travail est simulé, sans déplacements secondaires ; les temps de parcours ignorent la congestion et les horaires réels des transports ; les horaires de travail proviennent d’une enquête nationale de 2019 et le télétravail d’une enquête de 2024. Enfin, les filtres de la carte ne se croisent pas entre eux (l’âge et le mode de transport, par exemple) : le nombre de combinaisons ferait exploser le volume du fichier.

### Et la suite ?

**Passer à l’échelle des IRIS.** Découper l’Île-de-France en plus de 5 000 zones au lieu de 1 300 communes révélerait les contrastes à l’intérieur des villes : quartiers d’affaires, zones résidentielles, gares. Cela demande une autre architecture, avec un serveur qui calcule les agrégats à la demande et une interface qui ne charge que ce qui est affiché.

**Visualiser les flux.** La carte montre où sont les actifs ; les trajets simulés disent aussi par où ils passent. Les animer ferait apparaître les grands mouvements pendulaires de la journée, la fréquentation des principaux corridors heure après heure et les liaisons où l’offre de transport manque.

## Installation et utilisation

La carte tient dans un seul fichier, `mobydile.html`, qui s’ouvre dans n’importe quel navigateur. Une connexion internet est nécessaire pour afficher le fond de carte et charger la bibliothèque Leaflet.

## La licence

Le code et la documentation de ce projet sont sous licence [MIT](https://github.com/hackathons-mobilites/hackaviz_2026/blob/main/Docs/License.md).
