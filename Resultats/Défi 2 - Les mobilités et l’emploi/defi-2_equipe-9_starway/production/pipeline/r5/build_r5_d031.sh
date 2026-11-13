#!/usr/bin/env bash
# Construit un jar R5 « marche limitée + règles de correspondance D-031 » : r5py/r5 au tag v7.5.1-r5py (commit
# 2255a29e), modification D-024 (TransitLayer.WALK_DISTANCE_LIMIT_METERS = <limite>, comme build_r5_walk.sh), puis le
# patch r5-d031-transfer-rules.patch :
#   - McRaptorSuboptimalPathProfileRouter.doTransfers applique TransitLayer.gtfsTransfers (transfers.txt), comme
#     FastRaptorWorker.doTransfers (option a1 : les itinéraires détaillés 04h suivent la même règle que les matrices) ;
#   - FastRaptorWorker et McRAPTOR : minimum de correspondance au même arrêt après une arrivée en TC, par arrêt, chargé
#     par le pipeline (classe StarwayTransferRules, option a2 ; un arrêt sans durée garde la règle d'origine de R5).
# Usage : bash build_r5_d031.sh <limite_m> <patch> [dossier_de_travail]
#   ex. bash build_r5_d031.sh 3000 ~/d031/r5-d031-transfer-rules.patch ~/r5build
# Prérequis : git, curl, python3, JDK 21, Gradle déjà téléchargé par build_r5_walk.sh dans le dossier de travail.
# Licence de R5 : MIT (fichier LICENSE du dépôt, Copyright (c) 2020-2025 Conveyal LLC).
set -euo pipefail
LIMIT="$1"
PATCH="$(readlink -f "$2")"
WORK="${3:-$HOME/r5build}"
GRADLE_VERSION=8.14.3
TAG_SRC=v7.5.1-r5py
COMMIT_SRC=2255a29e9a196dd5079853bfdbb6ba1dacdb56b3
FILE=src/main/java/com/conveyal/r5/transit/TransitLayer.java
cd "$WORK"
test -x "gradle-${GRADLE_VERSION}/bin/gradle"

DIR="r5-walk${LIMIT}-d031"
rm -rf "$DIR"
git clone --quiet https://github.com/r5py/r5.git "$DIR"
cd "$DIR"
git checkout --quiet "$TAG_SRC"
test "$(git rev-parse HEAD)" = "$COMMIT_SRC"
# 2000 = valeur d'origine de R5 (jar r5py utilisé par 04b vélo + TC et 04d Vélib') : pas de commit D-024
if [ "$LIMIT" != 2000 ]; then
  sed -i "s/public static final int WALK_DISTANCE_LIMIT_METERS = 2000;/public static final int WALK_DISTANCE_LIMIT_METERS = ${LIMIT};/" "$FILE"
  test "$(git diff --numstat | awk '{print $1, $2, $3}')" = "1 1 $FILE"   # exactement une ligne changée
  git -c user.name="STARWAY data" -c user.email="starway@invalid" commit --quiet -am \
    "STARWAY: WALK_DISTANCE_LIMIT_METERS = ${LIMIT} (D-024, choix de l'équipe)"
fi
git -c user.name="STARWAY data" -c user.email="starway@invalid" am --quiet "$PATCH"
git tag "${TAG_SRC}-walk${LIMIT}-d031"   # version écrite dans le jar (version.properties) par le plugin git-version
# -x test : les tests de R5 demandent une base MongoDB (workflow GitHub d'origine) ; aucun code n'est changé hors patchs
nice -n 10 "../gradle-${GRADLE_VERSION}/bin/gradle" --no-daemon -q shadowJar -x test
cp "build/libs/r5-${TAG_SRC}-walk${LIMIT}-d031-all.jar" "$WORK/"
git rev-parse HEAD
sha256sum "$WORK/r5-${TAG_SRC}-walk${LIMIT}-d031-all.jar"
