# Aller travailler en Île-de-France

**Équipe :** YSSAK — Taha Yassine TOURBI, Kris LOKOUN, Mohamed-sami MECHAIAKH, Arsene TOGNIFODE, Soriba TOURE
**Mail(s) de contact:** samisami2659@gmail.com
**Défi :** Défi 2 — Les mobilités et l’emploi

## Notre question

Comment les habitants d'Île-de-France se rendent-ils au travail, et l'accès à l'emploi est-il le même partout ?
Où sont les emplois et les embauches prévues, où sont les gares, d'où viennent les travailleurs,
et les communes modestes et aisées se déplacent-elles de la même façon ?

## Notre visualisation

**Site interactif en ligne : https://tourbiriad26-hub.github.io/hakathon_mobilite/**

Code source : https://github.com/tourbiriad26-hub/hakathon_mobilite

Le site est un tableau de bord interactif en 6 pages. On choisit un territoire (commune, intercommunalité,
zone ou bassin d'emploi, département) et un territoire de comparaison ; tous les chiffres, cartes et graphiques
se mettent à jour, et le choix est conservé d'une page à l'autre.

| Page | Ce qu'elle montre |
|---|---|
| Se déplacer | Moyens de transport utilisés pour aller travailler, carte de toutes les communes, classements |
| Trouver un emploi | Embauches prévues en 2026 par métier et par bassin d'emploi, part jugée difficile, chômage |
| D'où viennent les travailleurs | Carte des trajets domicile-travail vers (ou depuis) le territoire choisi |
| Revenus et transports | Niveau de vie, pauvreté et usage de la voiture ou des transports en commun |
| Gares et stations | Carte des gares, fréquentation sur 12 mois, communes sans gare |
| Catalogue et sources | Définition de chaque indicateur, sources et méthode en langage simple |

Chaque page comporte un bouton **« Exporter en PDF »**. Le dossier [`production/pdf/`](production/pdf/)
contient l'export PDF de chaque page (territoire affiché par défaut : Paris comparé à l'Île-de-France).

Accessibilité : chaque graphique est accompagné d'un encadré « Comment lire ce graphique », les valeurs sont
écrites à côté des barres et dans les légendes (la couleur ne porte jamais l'information seule), et un lexique
explique chaque terme.

## Les données utilisées

| Source | Jeu de données | Lien |
|---|---|---|
| INSEE | Fichier détail MOBPRO — recensement 2022 (déplacements domicile-travail) | https://www.insee.fr/fr/statistiques/8589904 |
| INSEE | Table d'appartenance géographique des communes (COG 2025) | https://www.insee.fr/fr/information/7671844 |
| INSEE | Filosofi 2021 — revenus et pauvreté | https://www.insee.fr/fr/statistiques/7756729 |
| INSEE | Taux de chômage par zone d'emploi | https://www.insee.fr/fr/statistiques/1893230 |
| INSEE | Taux de chômage localisés (départements) | https://www.insee.fr/fr/statistiques/2012804 |
| Région Île-de-France | Bassins d'emploi Île-de-France 2021 | https://www.data.gouv.fr/datasets/bassins-demploi-ile-de-france-2021-1 |
| Région Île-de-France | Polarités SDRIF-E | https://www.data.gouv.fr/datasets/polarites-constituees-dune-ou-plusieurs-communes-sdrif-e |
| Région Île-de-France / INSEE | Base des zones d'emploi | https://data.iledefrance.fr/explore/dataset/base-des-zones-demploi/information/ |
| France Travail | Enquête Besoins en Main-d'Œuvre (BMO) 2026 | https://www.data.gouv.fr/datasets/enquete-besoins-en-main-doeuvre-bmo |
| DARES | Inscrits à France Travail par zone d'emploi | https://www.data.gouv.fr/datasets/inscrits-a-france-travail-par-zone-demploi-mensuelles-brutes |
| IDFM | Référentiel des lignes de transport en commun | https://data.iledefrance-mobilites.fr/explore/dataset/referentiel-des-lignes/information/ |
| IDFM | Emplacement des gares d'Île-de-France | https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/information/ |
| IDFM | Validations sur le réseau ferré (4 trimestres glissants) | https://data.iledefrance-mobilites.fr/explore/?q=validations+reseau+ferre |
| Etalab / IGN | Contours des communes | https://geo.api.gouv.fr/decoupage-administratif/communes |

## Les outils employés

- Python et DuckDB : téléchargement et préparation des données
- dbt : transformations et contrôles de qualité des données
- Observable Framework, Observable Plot, D3 et DuckDB-wasm : site interactif, cartes et graphiques (aucun serveur nécessaire)
- GitHub Actions et GitHub Pages : mise à jour et publication automatiques du site

## Licence

Ce projet est publié sous licence MIT pour le code source, Licence Ouverte 2.0 / ODbL pour les données
(selon leur producteur) et CC-BY 4.0 pour les contenus textuels et visuels.
