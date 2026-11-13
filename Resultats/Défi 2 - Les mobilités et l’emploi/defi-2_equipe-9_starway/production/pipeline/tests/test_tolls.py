"""Péages traversés par un chemin voiture (04g) : index OSM, rattachement exact, colonnes (sans Java).

Les coordonnées et identifiants ci-dessous sont des FIXTURES synthétiques, pas des données OSM.
"""

from __future__ import annotations

from datetime import timedelta

import pandas as pd
from shapely.geometry import LineString, MultiLineString

from starway import car_dist as cd
from starway import tolls

NODES = [{"osm_id": 11, "lon": 2.0000001, "lat": 48.0000002}, {"osm_id": 12, "lon": 3.0, "lat": 49.0}]
WAYS = [{"osm_id": 21, "coords": [[2.1, 48.1], [2.2, 48.2], [2.3, 48.3]]}]


def test_other_tags_parsing() -> None:
    t = tolls.parse_other_tags('"toll"=>"yes","operator"=>"SANEF","ref"=>"A 14"')
    assert t == {"toll": "yes", "operator": "SANEF", "ref": "A 14"}
    assert tolls.parse_other_tags(None) == {} and tolls.parse_other_tags(float("nan")) == {}


def test_node_matched_only_on_exact_vertex() -> None:
    idx = tolls.TollIndex.build(NODES, WAYS)
    on = [[(1.9, 47.9), (2.0000001, 48.0000002), (2.5, 48.5)]]  # même entier en 1e-7 degré
    near = [[(1.9, 47.9), (2.0000005, 48.0000002), (2.5, 48.5)]]  # 4e-7 degré à côté : pas de seuil, pas rattaché
    above = [[(2.0000002, 48.0000002)]]  # une unité de PLUS : la troncature de R5 n'ajoute jamais, pas rattaché
    assert idx.match(on) == ([11], [])
    assert idx.match(near) == ([], [])
    assert idx.match(above) == ([], [])


def test_r5_truncation_replicated() -> None:
    """Montesson (A14) : 48,9142945 x 1e7 = 489142944,99999994 en double ; R5 garde 489142944 ((int) Java). Le
    premier relevé (arrondi à 7 décimales des deux côtés) ne le reconnaissait pas."""
    lon, lat = 2.1510977, 48.9142945  # coordonnées du portique OSM 12120628914 (CYC01), valeur de l'exemple
    assert tolls.r5_truncated(lon, lat)[1] == tolls.fixed(lon, lat)[1] - 1
    r5 = tuple(v / tolls.FIXED_FACTOR for v in tolls.r5_truncated(lon, lat))  # point tel que R5 le rend
    assert tolls.key(*r5) != tolls.key(lon, lat)  # ancienne règle : pas de correspondance
    idx = tolls.TollIndex.build([{"osm_id": 1, "lon": lon, "lat": lat}],
                                [{"osm_id": 2, "coords": [[2.152, 48.9142], [lon, lat], [2.15, 48.9143]]}])
    a = tuple(v / tolls.FIXED_FACTOR for v in tolls.r5_truncated(2.152, 48.9142))
    assert idx.match([[a, r5]]) == ([1], [2])


def test_way_matched_by_common_segment_either_direction() -> None:
    idx = tolls.TollIndex.build(NODES, WAYS)
    assert idx.match([[(2.3, 48.3), (2.2, 48.2)]]) == ([], [21])  # parcouru à contresens de la digitalisation
    assert idx.match([[(2.1, 48.1), (2.3, 48.3)]]) == ([], [])  # sommets communs mais aucun segment commun


def test_geometry_lines_and_join() -> None:
    assert tolls.geometry_lines(LineString([(0, 0), (1, 1)])) == [[(0.0, 0.0), (1.0, 1.0)]]
    assert len(tolls.geometry_lines(MultiLineString([[(0, 0), (1, 1)], [(2, 2), (3, 3)]]))) == 2
    assert tolls.geometry_lines(None) == [] and tolls.geometry_lines(LineString()) == []
    assert tolls.join_ids([3, 4]) == "3;4" and tolls.join_ids([]) is None


def test_summarize_carries_toll_columns() -> None:
    det = pd.DataFrame({"from_id": ["75101|P_A|out"], "to_id": ["75101|P_A|out"], "option": [0],
                        "distance": [1000.0], "travel_time": [timedelta(seconds=60)]})
    s = cd.summarize_itineraries(det, ["75101|P_A|out", "75101|P_A|ret"],
                                 tolls_by_pair={"75101|P_A|out": ([11, 12], [21])}, toll_checked=True)
    a, b = s.iloc[0], s.iloc[1]
    assert a["toll_checked"] and a["toll_nodes"] == "11;12" and a["toll_ways"] == "21"
    assert not b["toll_checked"] and b["reason"] == cd.REASON_NO_ROUTE  # sans trajet : relevé sans objet


def test_bench_sample_is_reproducible_and_includes_commune() -> None:
    communes = [f"7{i:04d}" for i in range(50)]
    s1 = cd.bench_sample(communes, ["P_A", "P_B"], 10, "70003")
    s2 = cd.bench_sample(communes, ["P_A", "P_B"], 10, "70003")
    assert s1 == s2 and len(set(s1)) == len(s1)
    assert {f"70003|{p}|{d}" for p in ("P_A", "P_B") for d in cd.DIRECTIONS} <= set(s1)
    assert len(cd.bench_sample(communes, ["P_A"], 5, "99999")) == 5  # commune absente : tirage seul
