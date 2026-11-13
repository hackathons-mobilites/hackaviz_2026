# Hackathon mobilité Paris — mobilité domicile-travail en Île-de-France

**Équipe :** Taha Yassine TOURBI, Kris LOKOUN, Mohamed-sami MECHAIAKH, Arsene TOGNIFODE, Soriba TOURE  
**Défi :** Défi 2 — Les mobilités et l'emploi  
**Site :** https://tourbiriad26-hub.github.io/hakathon_mobilite/

Pipeline de données ouvertes et dashboard pour le défi « emploi » : comment les Franciliens vont-ils
travailler, d'où viennent les actifs d'un territoire, et quel lien avec les revenus, le chômage et
l'offre ferrée ?

**Tout est open source et reproductible** : les données sont téléchargées automatiquement, transformées
par dbt, testées, puis publiées sous forme de site statique sur GitHub Pages. Aucun serveur à maintenir.

```
INSEE / IDFM / Etalab  ──►  scripts/ingest.py  ──►  data/parquet/*.parquet
                                                        │
                                                        ▼
                                              dbt build (DuckDB ou PostgreSQL)
                                     staging ─► intermediate ─► marts (étoile) + 50 tests
                                                        │
                                                        ▼
                                          scripts/export_dashboard.py
                                                        │
                                                        ▼
                                dashboard/ (Observable Framework + DuckDB-wasm)
                                                        │
                                                        ▼
                                     GitHub Actions ─► GitHub Pages (chaque lundi)
```

## Démarrage rapide (5 minutes, sans base de données)

```bash
python -m venv .venv && source .venv/bin/activate     # Windows : .venv\Scripts\activate
pip install -r requirements.txt
python scripts/ingest.py                              # ~90 Mo téléchargés, 2-3 min
dbt build --profiles-dir .                            # modèles + tests, ~10 s (DuckDB)
python scripts/export_dashboard.py
cd dashboard && npm install && npm run dev            # http://127.0.0.1:3000
```

## Sources de données (toutes ouvertes)

| Source | Producteur | Usage |
|---|---|---|
| [Fichier détail MOBPRO, RP 2022](https://www.insee.fr/fr/statistiques/8589904) | INSEE | Mode de transport, lieu de travail, voiture du ménage, par actif pondéré |
| [Table d'appartenance géographique 2025](https://www.insee.fr/fr/information/7671844) | INSEE | Communes → EPCI, zones d'emploi, départements |
| [Filosofi 2021](https://www.insee.fr/fr/statistiques/7756729) | INSEE | Niveau de vie médian, taux de pauvreté, rapport interdécile |
| [Taux de chômage localisés](https://www.insee.fr/fr/statistiques/1893230) | INSEE | Chômage par zone d'emploi, trimestriel |
| [Emplacement des gares](https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/) | Île-de-France Mobilités | Pôles ferrés, modes, lignes |
| [Validations réseau ferré](https://data.iledefrance-mobilites.fr/explore/?q=validations+reseau+ferre) (4 trimestres glissants) | Île-de-France Mobilités | Fréquentation par pôle et par jour |
| [Contours des communes](https://geo.api.gouv.fr/decoupage-administratif/communes) | Etalab / IGN | Fonds de carte, rattachement des gares et des bassins |
| [Bassins d'emploi Île-de-France 2021](https://www.data.gouv.fr/datasets/bassins-demploi-ile-de-france-2021-1) | Région Île-de-France | Maille « Bassin d'emploi » (25) |
| [Enquête Besoins en Main-d'Œuvre 2026](https://www.data.gouv.fr/datasets/enquete-besoins-en-main-doeuvre-bmo) | France Travail | Projets de recrutement, part difficile, par bassin et métier |
| [Inscrits à France Travail par zone d'emploi](https://www.data.gouv.fr/datasets/inscrits-a-france-travail-par-zone-demploi-mensuelles-brutes) | DARES | Demandeurs d'emploi (cat. A, ABC), mensuel |
| [Taux de chômage localisés, comparaisons départementales](https://www.insee.fr/fr/statistiques/2012804) | INSEE | Chômage par département, trimestriel |
| [Référentiel des lignes](https://data.iledefrance-mobilites.fr/explore/dataset/referentiel-des-lignes/information/) | Île-de-France Mobilités | Lignes actives par mode |
| [Polarités SDRIF-E](https://www.data.gouv.fr/datasets/polarites-constituees-dune-ou-plusieurs-communes-sdrif-e) | Région Île-de-France | Communes structurantes (attribut de `dim_geo`) |

Le catalogue complet des jeux de données du défi 2 (liste officielle du Hackathon) est dans
[seeds/catalogue_sources.csv](seeds/catalogue_sources.csv) et sur la page « Sources & méthode » du dashboard,
avec pour chacun son statut : intégré, couvert par une autre source, disponible (piste documentée) ou non retenu.

## Structure du projet

```
scripts/ingest.py             télécharge et normalise chaque source en Parquet (cache local)
scripts/export_dashboard.py   copie les tables finales vers dashboard/src/data/
models/staging/               1 modèle par source : renommage, typage, nettoyage
models/intermediate/          MOBPRO enrichi des territoires de résidence et de travail
models/marts/dims/            dim_geo, dim_indicateurs, dim_gares
models/marts/facts/           fact_mobilite (long), fact_flux (OD x mode), fact_validations(_jour)
seeds/                        indicateurs.csv (dictionnaire), modes_transport.csv, fusions_communes.csv
tests/                        tests métier (unicité, parts entre 0 et 100, somme des parts = 100...)
macros/                       boucle sur les mailles, arrondi portable, schémas lisibles
dashboard/                    site Observable Framework (pages Markdown + SQL + Plot)
.github/workflows/            build hebdomadaire + déploiement GitHub Pages ; CI sur les PR
```

## Le modèle en étoile

- **`dim_geo`** — 1 342 territoires sur 5 mailles (Commune, EPCI, Zone d'emploi, Département, Région). Clé composite `(maille, codegeo)`. Contours GeoJSON simplifiés pour les communes et départements.
- **`dim_indicateurs`** — dictionnaire des 19 indicateurs (`code_indicateur` est la clé stable utilisée par le dashboard).
- **`dim_gares`** — 999 pôles ferrés avec commune de rattachement et validations 12 mois.
- **`fact_mobilite`** — format long : `maille, codegeo, code_indicateur, nombre, effectif_base, fiable, annee, periode`. Les parts sont recalculées à chaque maille à partir des effectifs ; `fiable = false` sous 200 actifs pondérés.
- **`fact_flux`** — commune de résidence × commune de travail × mode (235 000 lignes), flux entrants et sortants de la région inclus.
- **`fact_validations`**, **`fact_validations_jour`** — fréquentation ferrée par pôle et trimestre, et par jour.

Paramètres (millésimes, région, seuil de fiabilité) : bloc `vars` de `dbt_project.yml`.

## Déploiement

1. Dans GitHub : *Settings → Pages → Source : GitHub Actions* (une seule fois).
2. Chaque push sur `main` et chaque lundi 06h UTC, le workflow `Build & deploy` reconstruit tout et publie le site à `https://<organisation>.github.io/hakathon_mobilite/`. La documentation dbt est servie sous `/dbt/`.
3. Les pull requests déclenchent `CI` (compilation dbt).

## Cible PostgreSQL (optionnelle)

Le même projet dbt tourne sur la base de l'équipe : charger les fichiers de `data/parquet/` dans le schéma
`sources_hakathon` (tables de même nom), puis

```bash
pip install dbt-postgres
export DBT_PG_PASSWORD=...   # Windows : $env:DBT_PG_PASSWORD = "..."
dbt build --profiles-dir . --target postgres
```

Le dashboard, lui, lit uniquement les Parquet exportés : il n'a jamais besoin d'accéder à la base.
