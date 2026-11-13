# Thermo Réseau

**Nom de l’application :** Thermo Réseau  
**Nom de l’équipe :** Thermoviz  
**Membres :** Melvine MOUBEYI et Benoit MARTIN  
**Mails de contact :** franck.moubeyi-pango@sncf.fr, benoit.martin1998@protonmail.com  
**Défi :** Défi 1 : Les mobilités et l’adaptation climatique  

## Présentation du projet

Thermo Réseau est une application interactive de pilotage et d’aide à la décision développée par l’équipe Thermoviz dans le cadre du Hackathon Mobilités 2026 spécial Dataviz, organisé par Île-de-France Mobilités. Réalisée avec Microsoft Power BI, elle réunit des informations météorologiques et des données sur les mobilités franciliennes pour mieux comprendre les liens entre chaleur, fréquentation des transports et confort des voyageurs. Elle propose des analyses à l’échelle du réseau, des lignes et des gares, des comparaisons entre périodes ainsi qu’un espace de consultation de documents classés par année. Son objectif est de donner aux équipes d’Île-de-France Mobilités des repères opérationnels pour cibler leurs investigations, suivre les évolutions et préparer plus rapidement des mesures d’adaptation.

## Notre question

Comment analyser, gare par gare et ligne par ligne, les relations entre températures et fréquentation des transports, comparer ces situations d’une période à l’autre et aider les équipes à mieux anticiper les besoins de confort et d’adaptation climatique ?

## Le problème et la proposition de valeur

Les données de température, de fréquentation et d’équipements utiles au confort existent, mais elles proviennent de sources dispersées et sont difficiles à rapprocher dans une même lecture. Les équipes ne disposent pas toujours d’un outil unique pour observer la situation au plus près d’une gare ou d’une ligne, identifier des évolutions atypiques et comparer rapidement les résultats à ceux d’une période de référence. Ce manque de visibilité peut ralentir l’analyse et la préparation de décisions opérationnelles. Thermo Réseau rassemble ces éléments dans une interface commune afin de faciliter le suivi des épisodes de chaleur, l’identification de secteurs à examiner en priorité et le partage de constats entre les équipes d’Île-de-France Mobilités et leurs partenaires.

## Notre visualisation

Le projet est livré sous la forme d’un fichier Power BI au format `.pbix` ([`production/Power IDFM.pbix`](production/Power%20IDFM.pbix)), consultable dans Power BI Desktop. Le rapport regroupe des indicateurs, des graphiques interactifs, des filtres par période, gare et ligne ainsi qu’un espace documentaire permettant de consulter des ressources classées par année. Le fichier Power BI constitue la visualisation principale du projet et est accompagné de sa documentation dans le dossier [`docs/`](docs/).

## La solution

Thermo Réseau permet d’étudier les températures et l’évolution de la fréquentation à différentes échelles, notamment par gare et par ligne, selon la disponibilité et la granularité des données. L’utilisateur peut sélectionner une période, la comparer avec une autre année ou une période de référence et observer les écarts pour distinguer les tendances générales des situations locales. Les visualisations explorent les liens entre climat, niveau de chaleur et usages du réseau, sans présenter une simple corrélation comme une relation de cause à effet.

L’application intègre également des informations sur les fontaines à eau et le référentiel des lignes pour enrichir l’analyse des conditions de confort autour des gares. Une page documentaire donne accès à des ressources historiques et facilite la consultation des documents par année. Ces fonctionnalités soutiennent une démarche de pilotage opérationnel : repérer les zones sensibles, comparer leur évolution, prioriser les vérifications de terrain et éclairer les décisions d’adaptation. Thermo Réseau apporte une aide aux équipes, sans se substituer à leur expertise ni déclencher automatiquement des interventions.

## Les problèmes surmontés et les enjeux en matière de données

Le rapprochement de données météorologiques, de fréquentation et d’équipements nécessite de consolider des fichiers de formats différents, de relier les gares aux observations météo, d’harmoniser les dates et de vérifier la couverture des informations. Une table de correspondance entre gares et météo a été préparée pour faciliter ces croisements.

L’interprétation des résultats exige aussi de tenir compte d’autres facteurs possibles, tels que les vacances, les jours ouvrés, les incidents ou les changements d’offre. À terme, des données d’affluence plus fines, de perturbations et de confort réel pourraient renforcer la précision des analyses et l’utilité de l’outil pour les décisions opérationnelles.

## Les données utilisées

- **Données météo :** observations climatiques horaires rapprochées des gares. Fichier de travail : `meteo_gares_2022_2026.csv`. Source : <https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-horaires>.
- **Correspondance gares et météo :** fichier de correspondance préparé par l’équipe pour associer les gares aux observations météorologiques. Fichier de travail : `correspondance_gares_meteo.csv`.
- **Fontaines à eau :** informations sur les points d’eau présents dans le réseau RATP. Fichier de travail : `fontaines_proximite_gares.xlsx`. Source : <https://data.ratp.fr/explore/assets/fontaines-a-eau-dans-le-reseau-ratp/>.
- **Référentiel des lignes :** caractéristiques et identification des lignes du réseau. Fichier de travail : `referentiel-des-lignes.xlsx`. Source : <https://data.iledefrance-mobilites.fr/explore/dataset/referentiel-des-lignes/information/?disjunctive.transportsubmode&disjunctive.operatorname&disjunctive.networkname&disjunctive.transportmode&disjunctive.id_bus_contrat>.
- **Fréquentation quotidienne :** données de trafic journalier utilisées dans les analyses. Fichier de travail : `frequentation_jour.xlsx`. Source : <https://omnil.fr/trafic-annuel-et-journalier>.
- **Baromètre du trafic routier :** source complémentaire pour mettre en perspective les évolutions de circulation routière ; le lien fourni renvoie aux baromètres mensuels. Source : <https://www.dir.ile-de-france.developpement-durable.gouv.fr/barometre-mensuel-du-trafic-r102.html>.

## Les outils employés

Microsoft Power BI Desktop, Power Query pour la préparation et le rapprochement des données, ainsi que des fichiers CSV et Excel issus des sources citées. Le rapport utilise des indicateurs, des filtres interactifs et des comparaisons temporelles pour faciliter l’exploration et la restitution des résultats.

## Et la suite ?

Les prochaines évolutions pourraient intégrer des données actualisées plus fréquemment, enrichir les indicateurs de confort à bord et en gare et rapprocher les analyses de fréquentation des informations sur les perturbations ou l’offre de transport. L’objectif serait de renforcer progressivement l’usage de Thermo Réseau comme support partagé pour suivre les risques liés aux fortes chaleurs et préparer des actions adaptées aux secteurs prioritaires.

## Licence

La licence libre définitive du projet reste à confirmer par l’équipe. Le règlement recommande la licence MIT pour les productions et le code, et la Licence Ouverte 2.0 pour les jeux de données dérivés publiables. Les sources externes restent soumises à leurs conditions de réutilisation, et Power BI aux conditions de licence de Microsoft.
