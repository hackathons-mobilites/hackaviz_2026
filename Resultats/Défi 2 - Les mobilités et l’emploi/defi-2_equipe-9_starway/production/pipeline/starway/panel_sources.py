"""Sources candidates du panneau de preuve (proposition, docs/proposition-panneau-preuve.md) : jointures et mesures.

Lecture seule : rien n'est exporté vers le front. Les fichiers lus sont ceux de data/raw/TRA03 (référentiel des
lignes IDFM), TRA04 (accessibilité en gare IDFM), ENV01 (CO2e par voyageur.km IDFM) et QS01 (ponctualité
mensuelle Transilien, SNCF Voyageurs), en plus du GTFS TRA01.
"""

from __future__ import annotations

import pandas as pd

GTFS_ROUTE_PREFIX = "IDFM:"
# Codes de route_type du GTFS (spécification GTFS, routes.txt)
ROUTE_TYPE_LABEL = {"0": "tram", "1": "metro", "2": "train", "3": "bus", "6": "telepherique", "7": "funiculaire"}


def gtfs_route_to_id_line(route_id: str) -> str | None:
    """`IDFM:C01742` -> `C01742` (ID_Line du référentiel des lignes IDFM). Autre forme -> None."""
    if not isinstance(route_id, str) or not route_id.startswith(GTFS_ROUTE_PREFIX):
        return None
    rest = route_id[len(GTFS_ROUTE_PREFIX):]
    return rest if rest.startswith("C") and rest[1:].isdigit() else None


def gtfs_stop_point_id(stop_point_id: str) -> str | None:
    """`stop_point:IDFM:monomodalStopPlace:47915` (jeu « accessibilité en gare ») -> `IDFM:monomodalStopPlace:47915`
    (stop_id du GTFS). Autre forme -> None."""
    prefix = "stop_point:IDFM:"
    if not isinstance(stop_point_id, str) or not stop_point_id.startswith(prefix):
        return None
    return "IDFM:" + stop_point_id[len(prefix):]


def value_shares(values: pd.Series, known: set[str]) -> dict[str, float | int]:
    """Comptes par valeur et part des valeurs « renseignées » (dans `known`) ; vide ou NaN = non renseigné."""
    v = values.fillna("").astype(str).str.strip()
    n = len(v)
    filled = int(v.isin(known).sum())
    out: dict[str, float | int] = {"n": n, "filled": filled, "share_filled": (filled / n) if n else float("nan")}
    for k, c in v.value_counts().sort_index().items():
        out[f"value_{k or 'empty'}"] = int(c)
    return out
