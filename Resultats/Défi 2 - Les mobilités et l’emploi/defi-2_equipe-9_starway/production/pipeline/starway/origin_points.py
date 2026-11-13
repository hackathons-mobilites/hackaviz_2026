"""Points d'origine résidentiels : centre de gravité de la population (carreaux INSEE Filosofi 2021, 200 m).

Logique pure, testée dans tests/test_origin_points.py. Utilisée par scripts/02b_origin_points_analysis.py (analyse
seule : le calcul r5py n'utilise pas encore ces points).
"""

from __future__ import annotations

import re
import zipfile
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import pandas as pd

from starway.config import IDF_DEPS

# Identifiant Inspire : CRS3035RES200mN{nord}E{est}, coin sud-ouest du carreau en EPSG:3035 (mètres)
IDCAR_RE = re.compile(r"^CRS3035RES200mN(\d+)E(\d+)$")
CELL_M = 200


def parse_idcar(idcar: pd.Series) -> pd.DataFrame:
    """'CRS3035RES200mN2890200E3762400' -> colonnes e, n (coin sud-ouest, EPSG:3035). Échec si format inattendu."""
    m = idcar.str.extract(IDCAR_RE)
    if m.isna().any().any():
        bad = idcar[m.isna().any(axis=1)].head(3).tolist()
        raise ValueError(f"identifiant de carreau inattendu : {bad}")
    return pd.DataFrame({"n": m[0].astype(np.int64), "e": m[1].astype(np.int64)}, index=idcar.index)


def cell_of(e: np.ndarray, n: np.ndarray) -> list[str]:
    """Identifiant du carreau de 200 m qui contient chaque point (coordonnées EPSG:3035)."""
    ce = (np.floor(np.asarray(e) / CELL_M) * CELL_M).astype(np.int64)
    cn = (np.floor(np.asarray(n) / CELL_M) * CELL_M).astype(np.int64)
    return [f"CRS3035RES200mN{a}E{b}" for a, b in zip(cn, ce, strict=True)]


def touches_idf(lcog: pd.Series) -> pd.Series:
    """lcog_geo concatène les codes communaux (5 caractères) traversés par le carreau : vrai si l'un est en IDF."""
    deps = set(IDF_DEPS)
    return lcog.fillna("").map(lambda s: any(s[i:i + 2] in deps for i in range(0, len(s), 5)))


def read_idf_cells(zip_path: Path, chunksize: int = 400_000) -> pd.DataFrame:
    """Carreaux de France métropolitaine touchant l'IDF : idcar_200m, i_est_200, ind, e, n (centre du carreau).
    Lecture par morceaux de 4 colonnes (mémoire bornée)."""
    parts = []
    with zipfile.ZipFile(zip_path) as z:
        name = next(x for x in z.namelist() if x.endswith("_met.csv"))
        with z.open(name) as f:
            for ch in pd.read_csv(f, usecols=["idcar_200m", "i_est_200", "lcog_geo", "ind"],
                                  dtype={"idcar_200m": str, "lcog_geo": str}, chunksize=chunksize):
                parts.append(ch[touches_idf(ch["lcog_geo"])])
    df = pd.concat(parts, ignore_index=True)
    xy = parse_idcar(df["idcar_200m"])
    df["e"] = xy["e"] + CELL_M / 2
    df["n"] = xy["n"] + CELL_M / 2
    return df


def weighted_centroids(cells: pd.DataFrame, key: str = "insee", weight: str = "ind") -> pd.DataFrame:
    """Centre de gravité (moyenne pondérée des centres de carreaux) par `key`, en EPSG:3035 ; poids nul -> absent."""
    c = cells[cells[weight] > 0]
    w = c[weight]
    g = pd.DataFrame({"we": c["e"] * w, "wn": c["n"] * w, "w": w, key: c[key]}).groupby(key).sum()
    return pd.DataFrame({"e": g["we"] / g["w"], "n": g["wn"] / g["w"], "pop_carreaux": g["w"]})


def quantiles(values: Iterable[float]) -> dict[str, float]:
    v = pd.Series(list(values), dtype=float).dropna()
    return {"median": float(v.median()), "p90": float(v.quantile(0.9)), "max": float(v.max()), "n": int(len(v))}


METHOD_GRAVITY = "centre de gravité de la population (INSEE Filosofi 2021, carreaux de 200 m)"
METHOD_NEAREST = ("centre du carreau habité le plus proche du centre de gravité (celui-ci tombe dans un carreau "
                  "sans population ou rattaché à une autre commune)")


def assign_cells(cells: pd.DataFrame, origins) -> pd.DataFrame:  # origins : GeoDataFrame insee + geometry
    """Rattache chaque carreau à l'origine (contours GEO01 2026) qui contient son centre ; colonne `insee`."""
    import geopandas as gpd

    pts = gpd.GeoDataFrame(cells[["idcar_200m"]], geometry=gpd.points_from_xy(cells["e"], cells["n"]),
                           crs="EPSG:3035")
    joined = gpd.sjoin(pts, origins[["insee", "geometry"]].to_crs("EPSG:3035"), predicate="within", how="inner")
    return cells.loc[joined.index].assign(insee=joined["insee"].to_numpy())


def residential_points(cells: pd.DataFrame) -> pd.DataFrame:
    """Point d'origine résidentiel par origine (règle D-017, sans paramètre) : centre de gravité de la population ;
    s'il tombe dans un carreau sans population, ou dans un carreau d'une autre origine (commune concave), centre du
    carreau habité de la même origine le plus proche.
    Colonnes : g_e, g_n (gravité), e, n (point retenu), method, pop_carreaux ; EPSG:3035."""
    hab = cells[cells["ind"] > 0]
    g = weighted_centroids(hab)
    own = hab.groupby("insee")["idcar_200m"].agg(set).to_dict()  # carreaux habités rattachés à chaque origine
    rows = []
    for insee, r in g.iterrows():
        ge, gn = float(r["e"]), float(r["n"])
        if cell_of([ge], [gn])[0] in own[insee]:  # carreau habité ET rattaché à la même origine
            e, n, method = ge, gn, METHOD_GRAVITY
        else:
            c = hab[hab["insee"] == insee]
            j = int(np.argmin((c["e"].to_numpy() - ge) ** 2 + (c["n"].to_numpy() - gn) ** 2))
            e, n, method = float(c["e"].iloc[j]), float(c["n"].iloc[j]), METHOD_NEAREST
        rows.append({"insee": insee, "g_e": ge, "g_n": gn, "e": e, "n": n, "method": method,
                     "pop_carreaux": float(r["pop_carreaux"])})
    return pd.DataFrame(rows).set_index("insee")


def origin_points_wgs84(points: pd.DataFrame, decimals: int = 6) -> pd.DataFrame:
    """Point retenu en WGS84 : origin_lon, origin_lat (arrondis), origin_method."""
    from pyproj import Transformer

    lon, lat = Transformer.from_crs("EPSG:3035", "EPSG:4326", always_xy=True).transform(
        points["e"].to_numpy(), points["n"].to_numpy())
    return pd.DataFrame({"origin_lon": np.round(lon, decimals), "origin_lat": np.round(lat, decimals),
                         "origin_method": points["method"].to_numpy()}, index=points.index)


ORIGIN_LON, ORIGIN_LAT = "origin_lon", "origin_lat"  # colonnes de communes_idf_2026.csv (écrites par 02, D-017)


def origin_points_sha256(communes: pd.DataFrame) -> str:
    """Empreinte des points d'origine : code INSEE + coordonnées arrondies à 6 décimales, triés. Figée dans
    run_params.json par 04 ; 06 et 07 refusent des lots calculés avec d'autres points."""
    import hashlib

    rows = sorted(f"{i}:{x:.6f},{y:.6f}" for i, x, y in zip(communes["insee"], communes[ORIGIN_LON],
                                                              communes[ORIGIN_LAT], strict=True))
    return hashlib.sha256(";".join(rows).encode()).hexdigest()
