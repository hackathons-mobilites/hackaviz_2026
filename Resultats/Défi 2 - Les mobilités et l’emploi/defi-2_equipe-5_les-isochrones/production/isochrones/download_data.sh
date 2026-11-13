#!/usr/bin/env bash
# Downloads every raw input used by the "Access to job hubs" analysis into data/raw/.
set -euo pipefail
mkdir -p "$(dirname "$0")/data/raw"
cd "$(dirname "$0")/data/raw"

GEO="https://geo.api.gouv.fr"

# IDFM GTFS (ODbL 1.0) - planned timetables, next 30 days
curl -sSL -o gtfs_idfm.zip \
  "https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/files/a925e164271e4bca93433756d6a340d1/download/"
mkdir -p gtfs && unzip -oq gtfs_idfm.zip -d gtfs

# INSEE MOBPRO 2022 detail file (home commune x work commune x transport mode)
curl -sSL -o RP2022_mobpro.parquet  https://www.insee.fr/fr/statistiques/fichier/8589904/RP2022_mobpro.parquet
curl -sSL -o varmod_mobpro_2022.csv https://www.insee.fr/fr/statistiques/fichier/8589904/varmod_mobpro_2022.csv

# Commune and Paris arrondissement boundaries + town-hall points (IGN / geo.api.gouv.fr)
curl -sSL -o communes_idf.geojson \
  "$GEO/communes?codeRegion=11&fields=code,nom,codeDepartement,population&format=geojson&geometry=contour"
curl -sSL -o arrondissements.geojson \
  "$GEO/communes?type=arrondissement-municipal&codeDepartement=75&fields=code,nom,codeDepartement,population&format=geojson&geometry=contour"
curl -sSL -o communes_idf_points.json \
  "$GEO/communes?codeRegion=11&fields=code,nom,mairie,centre"
curl -sSL -o arrondissements_points.json \
  "$GEO/communes?type=arrondissement-municipal&codeDepartement=75&fields=code,nom,mairie,centre"

echo "done"
