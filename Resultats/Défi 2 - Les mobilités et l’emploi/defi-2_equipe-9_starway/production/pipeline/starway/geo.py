"""Communes d'Île-de-France (géographie 2026), arrondissements de Paris, harmonisation, projection du ciel."""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Mapping
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import shape

from starway.config import IDF_DEPS, PARIS_ARRONDISSEMENTS, PARIS_COMMUNE, RAW_DIR

GEO_DIR = RAW_DIR / "GEO01"

# --- Projection schématique du ciel ---------------------------------------------------------
# Centre : point zéro des routes de France (parvis de Notre-Dame), en Lambert-93.
SKY_CENTER_LONLAT = (2.34880, 48.85341)
SKY_R0_KM = 6.0  # échelle de la compression logarithmique (dilate Paris et la petite couronne)
SKY_RMAX_KM = 95.0  # au-delà de la commune IDF la plus éloignée du centre (contrôlé dans 07)
SKY_RADIUS = 0.46  # rayon utile dans le carré [0,1]² (marge 0,04)
SKY_MIN_POLE_GAP = 0.07  # écart minimal entre deux pôles après relaxation

_TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


def _load_json(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_communes_2026(geo_dir: Path = GEO_DIR) -> gpd.GeoDataFrame:
    """Toutes les communes IDF (1 266 dont 75056) + 20 arrondissements de Paris, avec `kind`."""
    rows = []
    for fname, kind in (("communes_idf.json", "commune"), ("arrondissements_paris.json", "arrondissement")):
        for c in _load_json(geo_dir / fname):
            if c["codeDepartement"] not in IDF_DEPS:
                continue
            lon, lat = c["centre"]["coordinates"]
            rows.append({
                "insee": c["code"], "name": c["nom"], "dep": c["codeDepartement"], "kind": kind,
                "population": c.get("population"), "surface_ha": c.get("surface"),
                "lon": float(lon), "lat": float(lat), "geometry": shape(c["contour"]),
            })
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    gdf["population"] = gdf["population"].astype("Int64")
    return gdf


def origins_from(communes: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Origines = communes IDF, Paris 75056 remplacé par ses 20 arrondissements."""
    o = communes[communes["insee"] != PARIS_COMMUNE].copy()
    return o.sort_values("insee").reset_index(drop=True)


def load_passage_table(geo_dir: Path = GEO_DIR) -> dict[str, str]:
    """Ancien code (commune associée / déléguée) -> code de la commune 2026 (chef-lieu)."""
    out: dict[str, str] = {}
    for c in _load_json(geo_dir / "communes_associees_deleguees_idf.json"):
        if c["code"] != c["chefLieu"]:
            out[c["code"]] = c["chefLieu"]
    return out


def harmonize(codes: Iterable[str], passage: Mapping[str, str], valid: set[str]) -> tuple[dict[str, str], list[str]]:
    """Mappe chaque code source vers la géographie 2026. Renvoie (mapping, orphelins)."""
    mapping: dict[str, str] = {}
    orphans: list[str] = []
    for code in codes:
        if code in valid:
            mapping[code] = code
        elif code in passage and passage[code] in valid:
            mapping[code] = passage[code]
        else:
            orphans.append(code)
    return mapping, sorted(orphans)


def paris_arrondissement_codes() -> tuple[str, ...]:
    return PARIS_ARRONDISSEMENTS


# --- Ciel -------------------------------------------------------------------------------------
def sky_project(lon: np.ndarray | float, lat: np.ndarray | float,
                r0_km: float = SKY_R0_KM) -> tuple[np.ndarray, np.ndarray]:
    """Projection schématique stable : Lambert-93 → polaire autour du point zéro → compression
    logarithmique du rayon → carré [0,1]² (x vers l'est, y vers le BAS = sud, convention écran).
    `r0_km` : échelle de la compression (défaut SKY_R0_KM, la valeur publiée ; autre valeur = essai seulement)."""
    x, y = _TO_L93.transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
    cx, cy = _TO_L93.transform(*SKY_CENTER_LONLAT)
    dx, dy = (np.asarray(x) - cx) / 1000.0, (np.asarray(y) - cy) / 1000.0
    r = np.hypot(dx, dy)
    theta = np.arctan2(dy, dx)
    rr = np.log1p(r / r0_km) / math.log1p(SKY_RMAX_KM / r0_km)
    sx = 0.5 + SKY_RADIUS * rr * np.cos(theta)
    sy = 0.5 - SKY_RADIUS * rr * np.sin(theta)
    return sx, sy


def relax_min_gap(xy: np.ndarray, gap: float = SKY_MIN_POLE_GAP, iterations: int = 500) -> np.ndarray:
    """Écarte de façon déterministe les points plus proches que `gap` (déplacement minimal, symétrique)."""
    p = np.array(xy, dtype=float).copy()
    n = len(p)
    for _ in range(iterations):
        moved = False
        for i in range(n):
            for j in range(i + 1, n):
                d = p[j] - p[i]
                dist = float(np.hypot(*d))
                if dist < gap - 1e-9:
                    u = d / dist if dist > 0 else np.array([1.0, 0.0])
                    push = (gap - dist) / 2 + 1e-6
                    p[i] -= u * push
                    p[j] += u * push
                    moved = True
        if not moved:
            break
    return np.clip(p, 0.0, 1.0)


def round_sky(v: float) -> float:
    return round(float(v), 4)


def as_frame(gdf: gpd.GeoDataFrame) -> pd.DataFrame:
    return pd.DataFrame(gdf.drop(columns="geometry"))


def adjacency(origins: gpd.GeoDataFrame) -> pd.DataFrame:
    """Couples d'origines contiguës : contours qui se touchent (prédicat `touches`, Lambert-93, sans tampon).
    Colonnes : insee_a < insee_b."""
    g = origins[["insee", "geometry"]].to_crs("EPSG:2154")
    j = gpd.sjoin(g, g, predicate="touches")
    j = j[j["insee_left"] < j["insee_right"]]
    return (j.rename(columns={"insee_left": "insee_a", "insee_right": "insee_b"})[["insee_a", "insee_b"]]
            .sort_values(["insee_a", "insee_b"]).reset_index(drop=True))

