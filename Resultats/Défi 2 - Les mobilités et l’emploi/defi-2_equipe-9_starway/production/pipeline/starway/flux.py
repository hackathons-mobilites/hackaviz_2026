"""Flux GTFS : une seule source de vérité (le manifeste), la méthode des réseaux, l'ancien flux gardé pour les calculs sans TC.

Pourquoi (décision de Nicolas du 06/11/2026) : le flux du premier calcul (02/11, TRA01) avait, pour le mardi 17/11, un
calendrier arrêté au 05/11 pour 31 lignes de bus d'un exploitant. Les calculs TC sont relancés sur le flux figé du 06/11
(`F06_TRA01_SHA256`). Ce module garde TOUT ce qui dépend du flux en un seul endroit, pour que les empreintes ne soient
jamais recopiées dans le code :

  * les empreintes et les fichiers des trois GTFS (TRA01 jour, TRA01B nuit, TRA01C soir) sont LUS dans le manifeste
    (`data/sources_manifest.csv`, colonnes `sha256` et `fichier_local`) ; aucune empreinte n'est écrite dans le code, sauf
    l'empreinte COMPLÈTE du flux figé et les DÉBUTS des deux fichiers dérivés, qui ne servent qu'à contrôler la mise à jour
    du manifeste (`f06_problems`, scripts/04o_update_flux_manifest.py) ;
  * l'empreinte du flux précédent est gardée dans `data/flux_gtfs_precedents.csv` (jamais supprimée) : elle reste
    acceptée pour les calculs qui n'utilisent pas les transports (marche, vélo, voiture, Vélib'), non relancés ;
  * la méthode : à partir du flux figé, le vélo + TC et le récit sont calculés sur le réseau de nuit (TRA01B) pour les
    trois journées-types (`bike_transit_source`).

Rien n'est écrit ici ; aucun calcul n'est lancé.
"""

from __future__ import annotations

import csv
import re
from collections.abc import Mapping
from pathlib import Path

from starway.config import DATA_DIR, MANIFEST_PATH, RAW_DIR

GTFS_SOURCES = ("TRA01", "TRA01B", "TRA01C")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

# Flux figé du 06/11/2026 à 16h11 (Paris), décision de Nicolas : empreinte COMPLÈTE.
F06_TRA01_SHA256 = "e990debabf77bec57569468486e7a73129de91678edb07ee6d8f448ebb4e6eb0"
# Débuts annoncés des deux fichiers dérivés (l'empreinte complète viendra de la VM avec les fichiers). Servent seulement à
# vérifier le manifeste : jamais écrits comme empreinte.
F06_DERIVED_PREFIXES = {"TRA01B": "3e38b797", "TRA01C": "bf02daf3"}

PREVIOUS_PATH = DATA_DIR / "flux_gtfs_precedents.csv"
PREVIOUS_COLUMNS = ["source_id", "sha256", "date_extraction", "fichier_local", "remplace_le", "motif"]


# --------------------------------------------------------------------------- manifeste
def _manifest_rows(path: Path = MANIFEST_PATH) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def gtfs_manifest(path: Path = MANIFEST_PATH) -> dict[str, dict[str, str]]:
    """Lignes du manifeste des trois GTFS (une ligne par source)."""
    return {r["source_id"]: r for r in _manifest_rows(path) if r["source_id"] in GTFS_SOURCES}


def manifest_sha(path: Path = MANIFEST_PATH) -> dict[str, str]:
    """Empreintes des trois GTFS, lues dans le manifeste."""
    return {sid: r["sha256"] for sid, r in gtfs_manifest(path).items()}


def gtfs_path(source_id: str, path: Path = MANIFEST_PATH, raw_dir: Path = RAW_DIR) -> Path:
    """Fichier d'un GTFS, tel que le manifeste le dit (`fichier_local`, `data/raw/<source>/<fichier>`), sous
    `STARWAY_DATA_ROOT` quand la variable est posée (la même règle que `config.RAW_DIR`)."""
    rows = gtfs_manifest(path)
    if source_id not in rows:
        raise KeyError(f"{source_id} absent du manifeste")
    parts = Path(rows[source_id]["fichier_local"]).parts
    if parts[:2] != ("data", "raw"):
        raise ValueError(f"{source_id} : fichier_local doit être sous data/raw (reçu {rows[source_id]['fichier_local']})")
    return raw_dir.joinpath(*parts[2:])


def is_complete_sha(value: str | None) -> bool:
    return bool(value) and SHA256_RE.fullmatch(value) is not None


def incomplete_problems(sha: Mapping[str, str]) -> list[str]:
    """Une empreinte de GTFS doit être complète (64 caractères hexadécimaux, minuscules) : jamais un début."""
    return [f"{sid} : empreinte absente ou incomplète au manifeste ({len(sha.get(sid) or '')} caractères)"
            for sid in GTFS_SOURCES if not is_complete_sha(sha.get(sid))]


def f06_active(sha: Mapping[str, str]) -> bool:
    """Le manifeste décrit-il le flux figé du 06/11 ? C'est ce qui active la méthode des réseaux (vélo + TC sur TRA01B)."""
    return sha.get("TRA01") == F06_TRA01_SHA256


def f06_problems(sha: Mapping[str, str]) -> list[str]:
    """Quand le manifeste décrit le flux du 06/11 : TRA01B et TRA01C doivent commencer par les débuts annoncés, être
    complets et trois empreintes distinctes. Liste vide si le manifeste ne décrit pas ce flux."""
    if not f06_active(sha):
        return []
    errs = incomplete_problems(sha)
    for sid, prefix in F06_DERIVED_PREFIXES.items():
        value = sha.get(sid) or ""
        if not value.startswith(prefix):
            errs.append(f"{sid} : l'empreinte ne commence pas par {prefix} (début annoncé par Claude Code)")
    if len({sha.get(s) for s in GTFS_SOURCES}) < len(GTFS_SOURCES):
        errs.append("TRA01, TRA01B et TRA01C n'ont pas trois empreintes distinctes")
    return errs


# --------------------------------------------------------------------------- flux précédents (gardés)
def previous_shas(source_id: str = "TRA01", path: Path | None = None) -> set[str]:
    """Empreintes complètes des flux remplacés (jamais supprimées : traçabilité, comparaison, repli)."""
    return {r["sha256"] for r in previous_rows(path) if r["source_id"] == source_id and is_complete_sha(r["sha256"])}


def previous_rows(path: Path | None = None) -> list[dict[str, str]]:
    path = path or PREVIOUS_PATH
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


PREVIOUS_FLAG = "(flux précédent)"  # ajouté au fichier_local d'une empreinte du flux remplacé, dans l'index de traçabilité


def previous_manifest_rows(path: Path | None = None) -> list[dict[str, str]]:
    """Les flux remplacés, au format d'une ligne du manifeste (pour la traçabilité : un dossier de calcul sans transport
    qui porte l'empreinte du flux précédent doit se rapprocher d'un fichier connu, jamais rester sans origine)."""
    return [{"source_id": r["source_id"], "fichier_local": f"{r['fichier_local']} {PREVIOUS_FLAG}", "sha256": r["sha256"]}
            for r in previous_rows(path) if is_complete_sha(r["sha256"])]


# --------------------------------------------------------------------------- méthode : quel réseau pour quel dossier
BIKE_TRANSIT_MARKS = ("matrix_story", "matrix_bike_transit")
NON_TRANSIT_MARKS = ("matrix_modes", "matrix_velib", "car_dist")


def is_bike_transit_dir(name: str) -> bool:
    """Vélo + TC : le récit (`matrix_story*`) et toutes les communes (`matrix_bike_transit_all_*`)."""
    return name.startswith(BIKE_TRANSIT_MARKS)


def is_non_transit_dir(name: str) -> bool:
    """Calculs qui n'utilisent aucun transport en commun (marche, vélo, voiture, Vélib') : `matrix_modes*`, `matrix_velib*`,
    `car_dist*`, et la table commune x commune `od` d'origine. Ils ne sont pas relancés avec le flux ; leur empreinte de GTFS
    est celle du flux avec lequel r5py a construit le réseau, sans effet sur ces modes."""
    return name.startswith(NON_TRANSIT_MARKS) or name == "od"


def bike_transit_source(sha: Mapping[str, str]) -> str:
    """Réseau du vélo + TC. Avant le flux du 06/11 : TRA01 (les 3 journées sur le GTFS d'origine). À partir du flux du
    06/11 : TRA01B (réseau de nuit) pour les trois journées-types, car les courses ajoutées ne roulent qu'avant 7h et que
    le 6h-14h doit les voir comme le reste du TC (décision de Nicolas, 06/11)."""
    return "TRA01B" if f06_active(sha) else "TRA01"


def accepted_gtfs_shas(source_id: str, sha: Mapping[str, str], *, non_transit: bool = False) -> set[str]:
    """Empreintes de GTFS acceptées dans les `run_params.json` d'un dossier qui attend `source_id`. Le manifeste d'abord ;
    pour un calcul sans transport, aussi les flux précédents de TRA01 (non relancés)."""
    out = {sha[source_id]} if sha.get(source_id) else set()
    if non_transit and source_id == "TRA01":
        out |= previous_shas("TRA01")
    return out
