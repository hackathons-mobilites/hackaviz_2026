"""Géométries simplifiées pour la « carte miroir » (plan § 15) : contours des communes, des pôles et arrêts d'ancrage.

La simplification est un CHOIX DE RENDU (poids du fichier servi au navigateur), pas une donnée : elle ne sert à
aucun calcul (la matrice, les pôles et la contiguïté utilisent les contours GEO01 non simplifiés).

Méthode : simplification de couverture (`shapely.coverage_simplify`, GEOS >= 3.12) en Lambert-93 : les frontières
partagées par deux communes sont simplifiées une seule fois, à l'identique des deux côtés (ni trou ni chevauchement
entre communes voisines). Les contours des pôles sont l'union des contours simplifiés de leurs communes membres.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import mapping

L93 = "EPSG:2154"
WGS84 = "EPSG:4326"


def simplify_coverage(gdf: gpd.GeoDataFrame, tolerance_m: float, decimals: int) -> gpd.GeoSeries:
    """Contours simplifiés (couverture) en WGS84, coordonnées arrondies à `decimals` décimales.

    L'arrondi s'applique sommet par sommet : deux sommets identiques avant arrondi le restent, donc les frontières
    partagées restent identiques."""
    l93 = gdf.geometry.to_crs(L93)
    simp = shapely.coverage_simplify(l93.values, tolerance_m)
    wgs = gpd.GeoSeries(simp, index=gdf.index, crs=L93).to_crs(WGS84)
    rounded = shapely.transform(wgs.values, lambda c: np.round(c, decimals))
    return gpd.GeoSeries(orient_for_d3(rounded), index=gdf.index, crs=WGS84)


def orient_for_d3(geoms: np.ndarray | shapely.Geometry) -> np.ndarray | shapely.Geometry:
    """Anneaux extérieurs dans le sens horaire, trous dans le sens antihoraire : convention de d3-geo (qui, sinon,
    remplit le complément de la sphère). C'est l'inverse de la recommandation RFC 7946 § 3.1.6, que les lecteurs
    ne doivent pas imposer (« parsers SHOULD NOT reject Polygons that do not follow the right-hand rule »)."""
    return shapely.orient_polygons(geoms, exterior_cw=True)


def union_by_group(geoms: Mapping[str, shapely.Geometry], groups: Mapping[str, Iterable[str]],
                   decimals: int) -> dict[str, shapely.Geometry]:
    """Union des géométries de chaque groupe (pôle -> codes INSEE membres). Code absent -> KeyError."""
    out: dict[str, shapely.Geometry] = {}
    for gid, members in groups.items():
        u = shapely.union_all([geoms[c] for c in members])
        out[gid] = orient_for_d3(shapely.transform(u, lambda c: np.round(c, decimals)))
    return out


def area_change(original: gpd.GeoSeries, simplified: gpd.GeoSeries) -> np.ndarray:
    """Écart relatif de surface |S_simpl - S_orig| / S_orig (Lambert-93), pour documenter l'effet du rendu."""
    a0 = original.to_crs(L93).area.to_numpy()
    a1 = simplified.to_crs(L93).area.to_numpy()
    return np.abs(a1 - a0) / a0


def feature(geom: shapely.Geometry, props: dict) -> dict:
    return {"type": "Feature", "properties": props, "geometry": mapping(geom)}


def feature_collection(features: Sequence[dict], **foreign: object) -> dict:
    """FeatureCollection GeoJSON (RFC 7946) ; `foreign` = membres étrangers de premier niveau (métadonnées)."""
    return {"type": "FeatureCollection", **foreign, "features": list(features)}
