"""Centre de gravité de la population (FIXTURE DE TEST synthétique, jamais exportée)."""

from __future__ import annotations

import pandas as pd
import pytest

from starway.origin_points import cell_of, parse_idcar, touches_idf, weighted_centroids


def test_parse_idcar_reads_south_west_corner() -> None:
    xy = parse_idcar(pd.Series(["CRS3035RES200mN2890200E3762400"]))
    assert (xy["n"].iloc[0], xy["e"].iloc[0]) == (2890200, 3762400)
    with pytest.raises(ValueError):
        parse_idcar(pd.Series(["CRS5490RES200mN1592600E728800"]))  # autre projection : refus


def test_cell_of_is_the_inverse_of_the_grid() -> None:
    assert cell_of([3762499.9], [2890200.0]) == ["CRS3035RES200mN2890200E3762400"]


def test_touches_idf_reads_concatenated_codes() -> None:
    s = pd.Series(["60001", "6000195001", "77001", None])
    assert touches_idf(s).tolist() == [False, True, True, False]


def test_weighted_centroid_and_zero_weight() -> None:
    cells = pd.DataFrame({"insee": ["A", "A", "B"], "e": [0.0, 300.0, 50.0], "n": [0.0, 0.0, 50.0], "ind": [1, 2, 0]})
    g = weighted_centroids(cells)
    assert g.loc["A", "e"] == 200.0 and g.loc["A", "pop_carreaux"] == 3
    assert "B" not in g.index  # aucun habitant : pas de centre de gravité inventé


def test_residential_point_falls_back_to_nearest_inhabited_cell_of_same_commune() -> None:
    from starway.origin_points import METHOD_GRAVITY, METHOD_NEAREST, origin_points_sha256, residential_points

    # A : deux bourgs séparés par un carreau vide -> le barycentre (au milieu) n'est pas habité
    # B : un seul carreau habité -> barycentre = son centre
    cells = pd.DataFrame({
        "idcar_200m": ["CRS3035RES200mN0E0", "CRS3035RES200mN0E800", "CRS3035RES200mN0E2000"],
        "insee": ["A", "A", "B"], "e": [100.0, 900.0, 2100.0], "n": [100.0, 100.0, 100.0], "ind": [10, 30, 5]})
    pts = residential_points(cells)
    assert pts.loc["A", "method"] == METHOD_NEAREST and (pts.loc["A", "e"], pts.loc["A", "n"]) == (900.0, 100.0)
    assert pts.loc["A", "g_e"] == 700.0  # barycentre conservé pour la traçabilité
    assert pts.loc["B", "method"] == METHOD_GRAVITY and pts.loc["B", "e"] == 2100.0
    c = pd.DataFrame({"insee": ["B", "A"], "origin_lon": [2.1, 2.0], "origin_lat": [48.1, 48.0]})
    assert origin_points_sha256(c) == origin_points_sha256(c.iloc[::-1])  # indépendant de l'ordre
    assert origin_points_sha256(c) == origin_points_sha256(c.assign(origin_lon=[2.1, 2.0000004]))  # arrondi 6 déc.
    assert origin_points_sha256(c) != origin_points_sha256(c.assign(origin_lon=[2.1, 2.000002]))
