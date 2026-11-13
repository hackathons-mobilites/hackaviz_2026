# Sources, versions et licences

Tous les éléments réutilisés par AtouVent, avec leur producteur, leur version ou date, et leur licence
(règlement du Hackathon Mobilités 2026, article 4.3). Licences vérifiées le 3 novembre 2026 sur la page de chaque jeu.

## Licences des productions d'AtouVent

| Production | Licence |
|---|---|
| Code source (backend, frontend, analyse, scripts) | MIT (`licence.MIT`) |
| Analyse publiée `backend/data/chaleur.json` | ODbL 1.0 : elle dérive de bases sous ODbL (validations, référentiel des lignes, données Ville de Paris), licence à réciprocité retenue comme le permet le règlement (art. 4.2) |
| Pictogrammes, logo AtouVent (`frontend/src/components/Icon.jsx`, `frontend/src/assets/img/`) | MIT, créations du projet |

Aucune donnée exclusive au hackathon (répertoire réservé aux participant·e·s) n'est utilisée, copiée ni publiée.

## Défi 1 « canicules » : correspondance avec la liste officielle des données

| Jeu de la liste du défi 1 | Utilisation dans AtouVent |
|---|---|
| Référentiel des lignes (IDFM) | lignes, couleurs, champ `air_conditioning` (climatisation, aussi « Climatisation sur les lignes ») |
| Perturbations en temps réel (PRIM) | info trafic, suivi en direct du trajet, historique décideurs |
| Qualité de l'air dans le réseau de transport francilien (IDFM, Airparif) | niveau de pollution du quai à chaque montée et descente, et dans « Autour de moi » (665 quais) |
| Fontaines à boire (Paris), fontaines aux arrêts (IDFM) | onglet Fontaines, tuile d'accueil, équipements d'arrêts |
| Îlots de fraîcheur, espaces verts et équipements (Paris) | lieux frais à Paris (ouvertures en canicule, nocturnes) |
| Espaces verts et boisés surfaciques ouverts au public 2024 (Institut Paris Region) | lieux frais hors de Paris (6 754 parcs, squares, bois), distance à la lisière la plus proche |
| Îlots de chaleur urbains (Institut Paris Region) | vulnérabilité à la chaleur de jour et de nuit autour de chaque gare (analyse) |
| Données climatiques prospectives +2,7 °C et +4 °C, vague de chaleur (TRACC, ADEME, Météo-France) | « Chaleur à venir » : jours chauds par an et effet gare par gare (écran Prévision) |
| Météo-France, données climatologiques | analyse de l'année 2025-2026 (Paris-Montsouris, Trappes) ; nous lisons les fichiers publics complets, qui couvrent la canicule de juin 2026 |
| Comptages vélo (Paris) | report modal vélo par chaleur et par pluie |
| Référentiel des arrêts : accès | entrées de gare reprises du GTFS (pathways.txt), même référentiel IDFM |

Non retenus : indicateurs de qualité de service SNCF/RATP (dernière donnée au 1er trimestre 2025), Plan Vélo (2022),
projets de lignes, ceinture verte, baromètre routier (hors sujet de l'application) ; marche à l'ombre de Saint-Quentin-en-Yvelines
(réservé au hackathon).

## Données utilisées

### En direct (serveur)

| Donnée | Producteur | Licence | Fréquence |
|---|---|---|---|
| Horaires théoriques GTFS (métro, RER, Transilien, tram, bus) | Île-de-France Mobilités | Licence Mobilités | vérifiés chaque nuit |
| Prochains passages, info trafic, retards (PRIM : stop-monitoring, disruptions, estimated-timetable) | Île-de-France Mobilités | Licence Mobilités | 60 s à 5 min |
| État des ascenseurs | Île-de-France Mobilités | Licence Mobilités | 5 min |
| Vélib' Métropole (GBFS) | Vélib' Métropole | ODbL | 1 min |
| Prévisions météo horaires et quotidiennes | Open-Meteo (modèles Météo-France AROME/ARPEGE, ECMWF) | CC BY 4.0 | 30 min |
| Qualité de l'air, UV, pollens | Open-Meteo, Copernicus CAMS | CC BY 4.0 | 1 h |
| Vigilance météorologique (API DPVigilance) | Météo-France | Licence Ouverte 2.0 | 10 min |
| Vigilance crues | Vigicrues (SCHAPI) | Licence Ouverte 2.0 | 15 min |
| Hauteur des rivières (7 stations) | Hub'Eau hydrométrie (OFB, SCHAPI) | Licence Ouverte 2.0 | 15 min |
| Géocodage, itinéraires piétons, fond de carte Plan IGN | IGN Géoplateforme | Licence Ouverte 2.0 | à la demande |
| Qualité de l'air sur les quais (665 quais) | IDFM, données Airparif | ODbL | 1 jour |
| Espaces verts ouverts au public 2024 | Institut Paris Region | Licence Ouverte 2.0 | 1 jour |
| Fontaines à boire | Eau de Paris | ODbL | 1 jour |
| Îlots de fraîcheur (espaces verts, équipements) | Ville de Paris | ODbL | 1 jour |
| Sanisettes, chantiers perturbants | Ville de Paris | ODbL | 1 jour |
| Fontaines aux arrêts, parkings vélos, parcs relais, accessibilité en gare | Île-de-France Mobilités | Licence Ouverte 2.0 | 1 jour |
| Toilettes du réseau RATP | RATP | ODbL | 1 jour |
| Facteurs d'émission CO2 par mode | ADEME, API Impact CO2 | conditions d'utilisation d'Impact CO2 (source citée à l'écran) | 30 jours |

### Préparées (analyse et calculateur)

| Donnée | Producteur | Licence |
|---|---|---|
| Validations par jour et par gare, réseau ferré, 3ᵉ trimestre 2025 au 2ᵉ trimestre 2026 | Île-de-France Mobilités | ODbL |
| Référentiel des lignes ; arrêts-lignes | Île-de-France Mobilités | ODbL |
| Arrêts ; zones d'arrêts | Île-de-France Mobilités | Licence Ouverte 2.0 |
| Données climatologiques quotidiennes et horaires (Paris-Montsouris, Trappes) | Météo-France | Licence Ouverte 2.0 |
| Données climatiques prospectives +2,7 °C et +4 °C, vague de chaleur (TRACC, 2025) | ADEME, Météo-France, CSTB, DHUP | Licence Ouverte 2.0 |
| Îlots de chaleur urbains, vulnérabilité à la chaleur 2022 | Institut Paris Region | Licence Ouverte 2.0 |
| Revenus carroyés 200 m, Filosofi 2021 | INSEE | Licence Ouverte 2.0 |
| Accidents corporels de la circulation 2021-2024 (BAAC) | ONISR, ministère de l'Intérieur | Licence Ouverte 2.0 |
| Arbres de Paris | Ville de Paris | ODbL |
| Comptages vélo ; comptages routiers permanents | Ville de Paris | ODbL |
| Qualité de l'air mesurée en station (Châtelet, Auber, Nation…) | RATP | Licence Ouverte |
| Historique de disponibilité des ascenseurs 2013-2023 | Dispotrains (projet bénévole, données publiques) | données publiques, citées |
| Assistance PMR en gare | SNCF Gares & Connexions | ODbL |
| Abris, bancs, éclairage des arrêts | contributeurs OpenStreetMap | ODbL |
| Jours fériés ; calendrier scolaire | api.gouv.fr ; Éducation nationale | Licence Ouverte 2.0 |

## Logiciels tiers

Versions installées au 3 novembre 2026 (les versions exactes sont figées dans `frontend/package-lock.json`).

### Application (frontend)

| Bibliothèque | Version | Licence |
|---|---|---|
| React, React DOM | 19.3.1 | MIT |
| React Router | 7.18.4 | MIT |
| MapLibre GL JS | 6.14.0 | BSD-3-Clause |
| idb (IndexedDB) | 8.0.4 | ISC |
| Capacitor (core, android, app, geolocation, cli) | 7.6.9 / 7.1.2 / 7.1.8 | MIT |
| Vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| vite-plugin-pwa | 2.0.0 | MIT |
| Sass | 1.83.4 | MIT |
| Vitest | 5.0.5 | MIT |

Polices auto-hébergées : IBM Plex Sans et IBM Plex Mono (IBM), Archivo (Omnibus-Type), Noto Sans SC (Google) — SIL Open Font License 1.1.

### API et analyse (backend, analyse)

| Bibliothèque | Version | Licence |
|---|---|---|
| FastAPI | 0.143.2 | MIT |
| Uvicorn | 0.54.0 | BSD-3-Clause |
| PyMongo | 4.19.0 | Apache-2.0 |
| HTTPX | 0.28.1 | BSD-3-Clause |
| APScheduler | 3.11.3 | MIT |
| PyJWT | 2.15.1 | MIT |
| cryptography | 50.0.2 | Apache-2.0 ou BSD-3-Clause |
| email-validator | 2.3.0 | Unlicense |
| NumPy | 2.4.6 | BSD-3-Clause |
| DuckDB | 2.0.0 | MIT |
| MongoDB Community Server (base de données) | 8 | SSPL (service local, non redistribué) |

### Images Docker (GitHub Packages)

| Image de base | Version | Licence |
|---|---|---|
| python (API et collecteur) | 3.12-slim | Python Software Foundation License |
| node (construction du site) | 22-alpine | MIT |
| nginx (service du site) | 1.27-alpine | BSD-2-Clause |
| mongo (base, `docker-compose.yml`) | 8 | SSPL (non redistribuée, tirée depuis Docker Hub) |
