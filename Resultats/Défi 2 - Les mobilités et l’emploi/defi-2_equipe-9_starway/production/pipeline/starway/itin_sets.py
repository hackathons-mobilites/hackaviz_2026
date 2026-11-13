"""Jeux d'itinéraires publiés (D-028) par réglage de marche (D-024), et format des fichiers (04/11/2026).

Deux jeux : « normal » (réglage par défaut, `itineraries/`, annoncé par `meta.itineraries_communes`) et « confort »
(`itineraries_walk1000/`, annoncé par `meta.itineraries_variants.comfort`). Chaque fichier `{insee}.json.gz` est le
JSON minifié du contrat `itineraries-*` compressé en gzip (en-tête sans date : octets identiques d'un export à
l'autre). Le front le décompresse (`DecompressionStream`, comme les tables SWOD) : 74,8 Mo de JSON deviennent
environ 11 Mo, ce qui laisse la place au jeu « confort » sous la limite de 250 Mo du plan Free.

Tous les scripts qui lisent ou écrivent les fichiers publiés (06, 06h, 06t, 07, 07h) passent par ce module.
Logique sans Java, testée dans tests/test_itin_sets.py.
"""

from __future__ import annotations

import gzip
import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starway.config import (
    INTERIM_DIR,
    PROCESSED_DIR,
    SKY_DEFAULT,
    WALK_SETTING_DEFAULT,
    WALK_SETTINGS_M,
    sky_front_dir,
)

SUFFIX = ".json.gz"
ENCODING = "gzip"
GZIP_LEVEL = 9


@dataclass(frozen=True)
class ItinSet:
    """Un jeu d'itinéraires : lots de 04h, dossier publié, sorties du contrôle 07h, série TC de `access/`."""

    walk_setting: str
    leg_limit_m: int
    src: Path  # lots de 04h (data/interim/itineraries_walk{m})
    out_dir: Path  # dossier publié (frontend/public/data/...)
    summary: Path  # résumé de 07h (data/processed/transfer_check_walk{m}_summary.json)
    check_dir: Path  # sorties détaillées de 07h (non versionnées)

    @property
    def is_default(self) -> bool:
        return self.walk_setting == WALK_SETTING_DEFAULT

    @property
    def variant_key(self) -> str | None:
        """Clé de `access/{insee}.json` `variants` (None : `modes.transit`, réglage par défaut)."""
        return None if self.is_default else self.walk_setting

    @property
    def dir_name(self) -> str:
        return self.out_dir.name

    @property
    def short_csv(self) -> Path:
        return self.check_dir / f"transfer_check_walk{self.leg_limit_m}_short.csv.gz"

    @property
    def trips_csv(self) -> Path:
        return self.check_dir / "trips_all.csv.gz"

    @property
    def transfers_csv(self) -> Path:
        return self.check_dir / "transfers_all.csv.gz"


def itin_set(walk_setting: str, front_dir: Path | None = None, sky: str = SKY_DEFAULT) -> ItinSet:
    """Jeu d'itinéraires d'un réglage de marche : lots `itineraries_walk{m}_d031_b44` (04h `--poles`, règles de
    correspondance D-031) et dossier publié à la racine."""
    if walk_setting not in WALK_SETTINGS_M:
        raise ValueError(f"réglage de marche inconnu : {walk_setting}")
    m = WALK_SETTINGS_M[walk_setting]
    default = walk_setting == WALK_SETTING_DEFAULT
    front_dir = front_dir if front_dir is not None else sky_front_dir(sky)
    return ItinSet(
        walk_setting=walk_setting, leg_limit_m=m, src=INTERIM_DIR / f"itineraries_walk{m}_d031_b44",
        # le jeu par défaut garde son dossier historique (itineraries/) : chemins du front et de la visite inchangés
        out_dir=front_dir / ("itineraries" if default else f"itineraries_walk{m}"),
        summary=PROCESSED_DIR / f"transfer_check_walk{m}_b44_summary.json",
        check_dir=INTERIM_DIR / ("transfer_check_b44" if default else f"transfer_check_walk{m}_b44"))


def all_sets(front_dir: Path | None = None, sky: str = SKY_DEFAULT) -> list[ItinSet]:
    """Le réglage par défaut d'abord."""
    order = sorted(WALK_SETTINGS_M, key=lambda k: (k != WALK_SETTING_DEFAULT, k))
    return [itin_set(k, front_dir, sky) for k in order]


def doc_path(directory: Path, insee: str) -> Path:
    return directory / f"{insee}{SUFFIX}"


def encode_doc(doc: Mapping[str, Any]) -> bytes:
    """JSON minifié (UTF-8, sans échappement des accents) puis gzip sans date (octets reproductibles)."""
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return gzip.compress(text, compresslevel=GZIP_LEVEL, mtime=0)


def json_size(doc: Mapping[str, Any]) -> int:
    """Taille du JSON minifié (avant compression)."""
    return len(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def read_doc(path: Path) -> dict[str, Any]:
    return json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))


def write_doc(path: Path, doc: Mapping[str, Any]) -> int:
    """Écrit le fichier s'il change (idempotent) ; rend le nombre d'octets publiés."""
    data = encode_doc(doc)
    if not path.exists() or path.read_bytes() != data:
        path.write_bytes(data)
    return len(data)


def published_communes(directory: Path) -> list[str]:
    """Codes INSEE des fichiers `{insee}.json.gz` présents (annonces `meta.itineraries_communes` et variantes)."""
    if not directory.exists():
        return []
    return sorted(f.name[: -len(SUFFIX)] for f in directory.glob(f"*{SUFFIX}"))


def iter_docs(directory: Path) -> Iterator[tuple[str, dict[str, Any]]]:
    for insee in published_communes(directory):
        yield insee, read_doc(doc_path(directory, insee))


def stale_files(directory: Path, keep: set[str]) -> list[Path]:
    """Fichiers à retirer d'un dossier publié : ancien format (`*.json`) et communes non publiées."""
    if not directory.exists():
        return []
    old = list(directory.glob("*.json"))
    return old + [doc_path(directory, i) for i in published_communes(directory) if i not in keep]


def transit_series(access: Mapping[str, Any], s: ItinSet) -> Mapping[str, Any] | None:
    """Série TC de `access/{insee}.json` qui correspond au jeu (réglage par défaut : `modes.transit`)."""
    if s.variant_key is None:
        return (access.get("modes") or {}).get("transit")
    return ((access.get("variants") or {}).get(s.variant_key) or {}).get("transit")


def variant_entry(s: ItinSet, communes: list[str], transfer_check: Mapping[str, Any] | None) -> dict[str, Any]:
    """`meta.itineraries_variants.{réglage}` : dossier, communes publiées, marquage D-031 (absent s'il manque)."""
    out: dict[str, Any] = {"dir": s.dir_name, "walk_setting": s.walk_setting, "communes": communes}
    if transfer_check is not None:
        out["transfer_check"] = dict(transfer_check)
    return out
