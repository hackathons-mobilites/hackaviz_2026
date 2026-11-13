#!/usr/bin/env bash
# Construit un jar R5 « marche limitée » (D-024) : r5py/r5 au tag v7.5.1-r5py (commit 2255a29e), seule modification
# TransitLayer.WALK_DISTANCE_LIMIT_METERS = <limite> (au lieu de 2000). Patch enregistré dans r5-walk<limite>.patch.
# Usage : bash build_r5_walk.sh <limite_m> [dossier_de_travail]     ex. bash build_r5_walk.sh 3000 ~/r5build
# Prérequis : git, curl, python3, JDK 21. À lancer sur la VM de calcul (pas sur le poste).
# Licence de R5 : MIT (fichier LICENSE du dépôt, Copyright (c) 2020-2025 Conveyal LLC).
set -euo pipefail
LIMIT="$1"
WORK="${2:-$HOME/r5build}"
GRADLE_VERSION=8.14.3
TAG_SRC=v7.5.1-r5py
COMMIT_SRC=2255a29e9a196dd5079853bfdbb6ba1dacdb56b3
FILE=src/main/java/com/conveyal/r5/transit/TransitLayer.java
mkdir -p "$WORK" && cd "$WORK"

if [ ! -x "gradle-${GRADLE_VERSION}/bin/gradle" ]; then
  # Gradle (Apache-2.0) : le dépôt n'a pas de wrapper ; empreinte vérifiée avec le .sha256 publié par Gradle
  curl -fsSLO "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"
  echo "$(curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip.sha256")  gradle-${GRADLE_VERSION}-bin.zip" | sha256sum -c -
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall('.')" "gradle-${GRADLE_VERSION}-bin.zip"
  chmod +x "gradle-${GRADLE_VERSION}/bin/gradle"
fi

DIR="r5-walk${LIMIT}"
rm -rf "$DIR"
git clone --quiet https://github.com/r5py/r5.git "$DIR"
cd "$DIR"
git checkout --quiet "$TAG_SRC"
test "$(git rev-parse HEAD)" = "$COMMIT_SRC"
sed -i "s/public static final int WALK_DISTANCE_LIMIT_METERS = 2000;/public static final int WALK_DISTANCE_LIMIT_METERS = ${LIMIT};/" "$FILE"
test "$(git diff --numstat | awk '{print $1, $2, $3}')" = "1 1 $FILE"   # exactement une ligne changée
git -c user.name="STARWAY data" -c user.email="starway@invalid" commit --quiet -am \
  "STARWAY: WALK_DISTANCE_LIMIT_METERS = ${LIMIT} (D-024, choix de l'équipe)"
git tag "${TAG_SRC}-walk${LIMIT}"   # version écrite dans le jar (version.properties) par le plugin git-version
git format-patch -1 --stdout HEAD > "$WORK/r5-walk${LIMIT}.patch"
# -x test : les tests de R5 demandent une base MongoDB (workflow GitHub d'origine) ; aucun code n'est changé hors patch
nice -n 10 "../gradle-${GRADLE_VERSION}/bin/gradle" --no-daemon -q shadowJar -x test
cp "build/libs/r5-${TAG_SRC}-walk${LIMIT}-all.jar" "$WORK/"
git rev-parse HEAD
sha256sum "$WORK/r5-${TAG_SRC}-walk${LIMIT}-all.jar"
