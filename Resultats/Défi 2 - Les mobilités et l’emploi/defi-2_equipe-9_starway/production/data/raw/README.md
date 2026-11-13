# data/raw - données brutes (non versionnées)

Les fichiers bruts ne sont pas commités (taille, licences). On les récupère avec :

```bash
cd pipeline && python scripts/01_download.py
```

Chaque fichier téléchargé est tracé dans [`../sources_manifest.csv`](../sources_manifest.csv) (URL, millésime, licence, date, empreinte sha256). Le référentiel exhaustif des sources (une fiche par code) est [`docs/sources.md`](../../docs/sources.md), généré par `pipeline/scripts/06r_sources_registry.py` ; `07_quality_checks.py` vérifie (P0) que chaque dossier de `data/raw/` a au moins une ligne de manifeste.

Téléchargés à la main le 03/11/2026 pour la proposition du panneau de preuve (pas dans `01_download.py`, adresses exactes dans le manifeste) : `EMP03/` (BMO 2026, France Travail), `QS01/` (régularité Transilien, SNCF), `TRA03/` (référentiel des lignes IDFM), `TRA04/` (accessibilité en gare IDFM).

## Péages (TOLL01 à TOLL06, téléchargés ou déposés à la main les 03 et 05/11/2026)
Ces dossiers ne sont pas remplis par `01_download.py` : chaque fichier a été téléchargé une fois (curl, sans en-tête particulier) ou déposé par l'équipe, et tracé dans le manifeste (URL exacte, date, sha256, licence). `04j_toll_tariffs.py` et `04k_toll_crosscheck.py` refusent un fichier dont l'empreinte diffère du manifeste.
- `TOLL01/` : data.gouv.fr « Autoroutes et péages en flux libre » (portiques du 03/11/2026).
- `TOLL02/` : APRR, `TARIFS_APRR-2026-02.pdf` et `aprr-systemes-ouverts-2026.pdf` (https://voyage.aprr.fr/tarifs-de-peage), copie CSV data.gouv.fr « Tarifs autoroutes APRR » (2026-02).
- `TOLL03/` : archive JORF du 30/01/2026 (https://echanges.dila.gouv.fr/OPENDATA/JORF/JORF_20260130-002723.tar.gz) et extraits XML de l'arrêté NOR TRAT2600882A ; **déposés à la main par l'équipe le 05/11/2026** : `2026_02-Grille-Sanef.pdf`, `2026_02-Grille-SAPN.pdf`, `grille-modulee-01022026.pdf` (grilles Sanef et SAPN du 01/02/2026, page https://www.autoroutes.sanef.com/fr/grilles-tarifs-de-peage, refusée aux téléchargements automatiques : HTTP 403).
- `TOLL04/` : VINCI Autoroutes, `Tarifs_A86.txt`, `Tarifs_Cofiroute_Arcour.txt`, guides PDF Duplex A86 et Cofiroute 2026, communiqué du 31/12/2025, page Ulys A86.
- `TOLL05/` : data.gouv.fr « Gares de péage du réseau routier national concédé » (2025).
- `TOLL06/` : recoupement de l'A5 (04k), retéléchargé le 05/11/2026 : `aprr-tarifs-2026-02.csv` (https://static.data.gouv.fr/resources/tarifs-autoroutes-aprr/20260802-131933/2026-02.csv, Licence Ouverte 2.0), `TARIFS_APRR-2026-02.pdf` (https://voyage.aprr.fr/sites/default/files/2026-02/TARIFS_APRR.pdf), `dataset-metadata.json` (https://www.data.gouv.fr/api/1/datasets/tarifs-autoroutes-aprr/). Octets identiques à ceux de `TOLL02/`.

## Bassins d'emploi France Travail 2026 (GEO04, téléchargé à la main le 03/11/2026)
Pas rempli par `01_download.py`. Fichier `Bassins_d'emploi_2026.xlsx` (lien « fichier des bassins d'emploi » de la page méthode BMO 2026, https://statistiques.francetravail.org/bmo/static/methode_2026), copie datée `GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx` (sha256 dans le manifeste) et en-têtes HTTP de la lecture (`http_headers_2026-11-03.txt`, sans cookie) :
```bash
curl -sSL -o "data/raw/GEO04/Bassins_d_emploi_2026_lu_$(date +%F).xlsx" "https://statistiques.francetravail.org/bmo/Handlers/HTFile.ashx?MEDIAID=188096"
```
Licence non écrite par France Travail (voir le manifeste) : ne pas redistribuer le fichier tant qu'un humain ne l'a pas confirmée. Lu par `pipeline/scripts/03b_sky_groups.py` (construction des 44 astres à partir des bassins d'emploi).

## Abonnements (SUB01 à SUB05, 04/11/2026, coût du trajet selon ce que la personne possède déjà)
Remplis par `01_download.py` (registre `pipeline/starway/subscription_sources.py`), **sauf `SUB04/` (Vélib')** : le site de Vélib' Métropole répond HTTP 403 au client de `01_download.py` ; les quatre fichiers ont été téléchargés une fois avec curl (en-tête User-Agent d'un navigateur, comme pour les pages IDFM) puis tracés au manifeste (URL exacte, date, sha256) :
```bash
curl -sS -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" -o data/raw/SUB04/velib-offers.html "https://www.velib-metropole.fr/fr/offers"
```
(même commande pour la grille tarifaire et les deux CGAU, URL dans le manifeste). Les citations tirées des PDF sont liées à leur empreinte : `06i` et `07` refusent un fichier différent. Refusés au robot le 04/11 (non contournés, à télécharger à la main si besoin) : pages IDFM imagine R Scolaire, Solidarité Gratuité, Parkings Vélos, PDF des CGVU Navigo Mois et Semaine.
