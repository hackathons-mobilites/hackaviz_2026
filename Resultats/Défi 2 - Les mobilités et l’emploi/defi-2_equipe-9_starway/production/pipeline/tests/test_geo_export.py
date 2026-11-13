"""Tests de la simplification de rendu de la carte miroir (géométries synthétiques, aucune donnée réelle)."""

from __future__ import annotations

import geopandas as gpd
import shapely
from shapely.geometry import Polygon, box

from starway.geo_export import area_change, feature_collection, orient_for_d3, simplify_coverage, union_by_group


def _grid() -> gpd.GeoDataFrame:
    """Fixture de test : 4 carrés contigus de 2 km en Lambert-93 (frontière commune en zigzag)."""
    x0, y0 = 650_000, 6_860_000
    zig = [(x0 + 2000, y0 + k * 100 + (30 if k % 2 else 0)) for k in range(0, 21)]
    left = Polygon([(x0, y0), *zig, (x0, y0 + 2000)])
    right = Polygon([*zig, (x0 + 4000, y0 + 2000), (x0 + 4000, y0)])
    bottom = box(x0, y0 - 2000, x0 + 2000, y0)
    other = box(x0 + 2000, y0 - 2000, x0 + 4000, y0)
    return gpd.GeoDataFrame({"insee": ["A", "B", "C", "D"]}, geometry=[left, right, bottom, other], crs="EPSG:2154")


def test_coverage_simplification_keeps_shared_borders_identical() -> None:
    g = _grid()
    s = simplify_coverage(g, tolerance_m=50, decimals=4)
    assert s.crs.to_epsg() == 4326
    assert s.is_valid.all() and not s.is_empty.any()
    # ni trou ni chevauchement : l'union des contours simplifiés reste d'un seul tenant, sans anneau intérieur
    u = shapely.union_all(s.values)
    assert u.geom_type == "Polygon" and len(u.interiors) == 0
    inter = shapely.intersection(s.iloc[0], s.iloc[1])
    assert inter.area < 1e-12  # contact par une ligne, pas par une surface


def test_simplification_reduces_vertices_and_area_change_is_small() -> None:
    g = _grid()
    s = simplify_coverage(g, tolerance_m=50, decimals=4)
    n0 = sum(len(shapely.get_coordinates(x)) for x in g.to_crs(4326).geometry)
    n1 = sum(len(shapely.get_coordinates(x)) for x in s)
    assert n1 < n0
    assert area_change(g.geometry, s).max() < 0.05


def test_union_by_group_and_winding_for_d3() -> None:
    g = _grid()
    s = simplify_coverage(g, tolerance_m=50, decimals=4)
    areas = union_by_group(dict(zip(g["insee"], s, strict=True)), {"P1": ["A", "B"], "P2": ["C"]}, 4)
    assert areas["P1"].geom_type == "Polygon"
    assert not areas["P1"].exterior.is_ccw and not s.iloc[2].exterior.is_ccw  # extérieur horaire (d3-geo)
    ccw_square = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])
    assert not orient_for_d3(ccw_square).exterior.is_ccw


def test_feature_collection_keeps_metadata_before_features() -> None:
    fc = feature_collection([], processing_version="x")
    assert list(fc) == ["type", "processing_version", "features"]
