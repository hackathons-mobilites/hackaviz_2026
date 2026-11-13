"""Ombre des arbres sur les trajets à pied (Paris, jeu « Les arbres » de la Ville de Paris, ≈ 220 000 arbres)."""
from __future__ import annotations

import csv
import io
import json
import math
from functools import lru_cache
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parents[2] / "data"
URL = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/exports/csv"
DLAT, DLON = 0.00027, 0.0004     # ≈ 30 m × 30 m
FULL_SHADE_M2 = 150              # ombre moyenne (m² par case de ~900 m², voisines comprises) d'une rue bien ombragée
STEP_M = 20


def cell(lat: float, lon: float) -> str:
    return f"{math.floor(lat / DLAT)},{math.floor(lon / DLON)}"


def build() -> dict:
    raw = DATA / "raw" / "arbres.csv"
    if not raw.exists():
        raw.parent.mkdir(parents=True, exist_ok=True)
        r = httpx.get(URL, params={"select": "geo_point_2d,circonferenceencm,hauteurenm", "delimiter": ";"}, timeout=600)
        r.raise_for_status()
        raw.write_bytes(r.content)
    grid: dict[str, float] = {}
    n = 0
    for row in csv.DictReader(io.StringIO(raw.read_text(encoding="utf-8-sig")), delimiter=";"):
        try:
            lat, lon = (float(x) for x in row["geo_point_2d"].split(","))
        except (ValueError, KeyError):
            continue
        circ = float(row.get("circonferenceencm") or 0) or 60
        # Diamètre du houppier ≈ 22 fois le diamètre du tronc (≈ 0,07 × circonférence en cm), entre 3 et 14 m
        crown = min(14.0, max(3.0, 0.07 * circ))
        k = cell(lat, lon)
        grid[k] = round(grid.get(k, 0) + math.pi * (crown / 2) ** 2, 1)
        n += 1
    (DATA / "shade.json").write_text(json.dumps({"dlat": DLAT, "dlon": DLON, "cells": grid}, separators=(",", ":")), encoding="utf-8")
    return {"trees": n, "cells": len(grid)}


@lru_cache(maxsize=1)
def _grid() -> dict | None:
    p = DATA / "shade.json"
    return json.loads(p.read_text(encoding="utf-8"))["cells"] if p.exists() else None


def score_path(coords: list[list[float]]) -> float | None:
    """Note d'ombre le long d'un chemin réel [[lon, lat], …] (moyenne pondérée par la longueur des segments)."""
    if not coords or len(coords) < 2:
        return None
    total = acc = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        v = score((y1, x1), (y2, x2))
        if v is None:
            return None
        length = math.hypot((y2 - y1) * 111_000, (x2 - x1) * 73_000)
        total += length
        acc += v * length
    return round(acc / total, 2) if total else None


def score(a: tuple[float, float], b: tuple[float, float]) -> float | None:
    """Note d'ombre (0 à 1) d'un trajet à pied en ligne droite de a à b ; None hors de la zone couverte (Paris)."""
    g = _grid()
    if g is None or not all(48.81 <= p[0] <= 48.91 and 2.22 <= p[1] <= 2.47 for p in (a, b)):
        return None
    dist = math.hypot((b[0] - a[0]) * 111_000, (b[1] - a[1]) * 73_000)
    n = max(1, int(dist // STEP_M))
    vals = []
    for i in range(n + 1):
        lat, lon = a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n
        ci, cj = math.floor(lat / DLAT), math.floor(lon / DLON)
        # La case et ses voisines : l'ombre d'un arbre déborde sur le trottoir d'en face
        around = sum(g.get(f"{ci + di},{cj + dj}", 0) for di in (-1, 0, 1) for dj in (-1, 0, 1)) / 9
        vals.append(min(1.0, around / FULL_SHADE_M2))
    return round(sum(vals) / len(vals), 2)


if __name__ == "__main__":
    print(build())
