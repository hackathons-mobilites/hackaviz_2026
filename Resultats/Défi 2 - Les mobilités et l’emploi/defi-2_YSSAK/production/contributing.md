# Contribuer

Projet réalisé pour le **Hackathon Mobilités 2026 Spécial Dataviz'** (Île-de-France Mobilités), défi 2 « Les mobilités et l'emploi ».

## Contributrices et contributeurs

| Nom | Rôle | Contact |
|---|---|---|
| Taha Yassine TOURBI | Membre de l'équipe | |
| Kris LOKOUN | Membre de l'équipe | |
| Mohamed-sami MECHAIAKH | Membre de l'équipe | |
| Arsene TOGNIFODE | Membre de l'équipe | |
| Soriba TOURE | Membre de l'équipe | |

## Certificat d'authenticité de la contribution

En contribuant à ce dépôt, chaque personne certifie que :

1. sa contribution est son œuvre originale, ou qu'elle dispose du droit de la soumettre sous la licence du projet ;
2. les éléments réutilisés (bibliothèques, données, extraits de code) sont identifiés ci-dessous avec leur version et leur licence ;
3. elle accepte que sa contribution soit publiée sous **licence MIT** (code) et **Licence Ouverte 2.0** (données dérivées), conformément à l'article 4 du règlement du Hackathon.

## Comment contribuer

1. Ouvrir une issue ou en choisir une.
2. Créer une branche depuis `main` (`feat/ma-fonctionnalite`).
3. Vérifier en local : `dbt build --profiles-dir .` doit être vert (les tests font partie du build) et `cd dashboard && npm run build` doit réussir.
4. Ouvrir une pull request : le workflow `CI` compile le projet dbt.

Conventions :
- SQL : mots-clés en majuscules, une colonne par ligne, `CAST(... AS ...)` plutôt que `::` (portabilité DuckDB / PostgreSQL).
- Tout nouvel indicateur passe par `seeds/indicateurs.csv` (dictionnaire) puis par `fact_mobilite`.
- Toute nouvelle source passe par `scripts/ingest.py` (téléchargement reproductible) et un modèle `models/staging/stg_*.sql`.
- Les cartes et graphiques doivent rester lisibles sans la couleur seule (étiquettes, infobulles, légendes) : voir la notice accessibilité du Hackathon.

## Éléments réutilisés

| Élément | Version | Licence | Usage |
|---|---|---|---|
| dbt-core / dbt-duckdb | 1.12 / 1.11 | Apache 2.0 | Transformations et tests |
| DuckDB | 1.4 | MIT | Moteur SQL local et dans le navigateur (DuckDB-wasm) |
| Observable Framework | 1.13 | ISC | Génération du site statique |
| Observable Plot, D3 | 0.6 / 7 | ISC | Graphiques et cartes |
| pandas, shapely, python-calamine | 2.x / 2.x / 0.3 | BSD / BSD / MIT | Ingestion |
| Données INSEE (MOBPRO, COG, Filosofi, chômage localisé) | 2022 / 2025 / 2021 / 2026-T2 | Licence Ouverte 2.0 | Voir `dashboard/src/sources.md` |
| Données Île-de-France Mobilités (gares, validations) | 2025-2026 | Licence Ouverte 2.0 / ODbL | Voir `dashboard/src/sources.md` |
| Contours communaux (geo.api.gouv.fr, Admin Express IGN) | 2025 | Licence Ouverte 2.0 | Fonds de carte |

## Code de conduite

Ce projet suit le code de conduite de la communauté GitHub : respect, bienveillance, et aucune forme de harcèlement.
