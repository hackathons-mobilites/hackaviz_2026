"""Recoupement Navitia du 6h-14h recalculé avec le réseau de nuit (D-040) : choix des trajets, tirage déterministe, résumé.

Les durées sont des FIXTURES de test (synthétiques), pas des résultats r5py ni Navitia.
"""

from __future__ import annotations

import pandas as pd
import pytest

from starway import night_check as nc


def frame(rows: list[tuple]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["from_id", "to_id", "old_out", "old_ret", "new_out", "new_ret", "new_dep"])


def sample() -> pd.DataFrame:
    rows = []
    # 12 trajets gagnés : aucun aller ni retour dans le calcul d'origine (None), possibles dans le recalcul de nuit
    for i in range(12):
        rows.append((f"7510{i:02d}", f"P{i % 6}", None, None, 30 + i, 35 + i, "05:40"))
    # 3 gagnés seulement par l'aller (retour absent) : comptent aussi, le trajet complet n'existait pas
    for i in range(3):
        rows.append((f"7720{i}", "P1", None, 40, 41, 40, "05:55"))
    # 12 inchangés
    for i in range(12):
        rows.append((f"9300{i:02d}", f"P{i % 6}", 25 + i, 28 + i, 25 + i, 28 + i, "06:30"))
    # modifiés (plus courts) : ni gagnés ni inchangés
    rows.append(("78001", "P2", 50, 50, 44, 50, "06:10"))
    # impossibles partout
    rows.append(("78002", "P2", None, None, None, None, None))
    # gagnés hors budget 60
    rows.append(("78003", "P2", None, None, 90, 95, "05:00"))
    return frame(rows)


def test_gained_needs_both_legs_in_the_recalculation_and_one_missing_before() -> None:
    g = nc.gained(sample(), budget=60)
    assert len(g) == 15 and g["new_out"].notna().all() and g["new_ret"].notna().all()
    assert (g["old_out"].isna() | g["old_ret"].isna()).all()
    assert "78003" not in set(g["from_id"])  # hors budget
    assert "78003" in set(nc.gained(sample())["from_id"])  # sans budget : gagné


def test_kept_are_identical_in_both_calculations() -> None:
    k = nc.kept(sample(), budget=60)
    assert len(k) == 12 and (k["old_out"] == k["new_out"]).all()
    assert "78001" not in set(k["from_id"])  # modifié : ni l'un ni l'autre


def test_pick_is_deterministic_and_balanced() -> None:
    a = nc.pick_trips(sample(), 5, 5, seed=7)
    b = nc.pick_trips(sample(), 5, 5, seed=7)
    assert a == b
    assert [t.kind for t in a] == ["gained"] * 5 + ["kept"] * 5
    assert len({t.insee for t in a if t.kind == "gained"}) == 5  # une commune d'origine une seule fois
    assert nc.pick_trips(sample(), 5, 5, seed=8) != a  # une autre graine, un autre tirage


def test_gained_trips_carry_the_night_departure() -> None:
    t = nc.pick_trips(sample(), 5, 5, seed=7)
    assert all(x.old_out is None or x.old_ret is None for x in t if x.kind == "gained")
    assert all(x.new_dep is not None and x.new_out is not None and x.new_ret is not None for x in t)


def test_not_enough_gained_trips_is_an_error_not_a_silent_completion() -> None:
    few = frame([("75101", "P1", None, None, 30, 30, "05:40"), ("75102", "P2", 20, 20, 20, 20, "06:00")] * 1)
    with pytest.raises(ValueError, match="gained"):
        nc.pick_trips(few, 5, 1)


def test_join_matrices_pairs_origin_and_destination() -> None:
    old = pd.DataFrame({"from_id": ["a", "b"], "to_id": ["P", "P"], "out": [None, 20], "ret": [None, 21], "dep": [None, "06:00"]})
    new = pd.DataFrame({"from_id": ["a", "b"], "to_id": ["P", "P"], "out": [33, 20], "ret": [34, 21], "dep": ["05:40", "06:00"]})
    j = nc.join_matrices(old, new)
    assert len(j) == 2 and set(j.columns) >= {"old_out", "new_out", "old_ret", "new_ret", "new_dep"}
    assert len(nc.gained(j)) == 1 and len(nc.kept(j)) == 1


def test_summary_reports_gaps_per_kind_and_leg() -> None:
    rows = pd.DataFrame([
        {"kind": "gained", "leg": "out", "starway_min": 40, "navitia_min": 38},
        {"kind": "gained", "leg": "out", "starway_min": 50, "navitia_min": None},
        {"kind": "gained", "leg": "ret", "starway_min": 45, "navitia_min": 60},
        {"kind": "kept", "leg": "out", "starway_min": 30, "navitia_min": 30},
    ])
    s = nc.summarize(rows)
    g = s["gained"]["out"]
    assert g["n"] == 2 and g["navitia_found"] == 1 and g["median_diff_min"] == 2 and g["within_5_min"] == 1
    assert s["gained"]["ret"]["median_diff_min"] == -15 and s["gained"]["ret"]["within_5_min"] == 0
    assert s["kept"]["out"]["max_abs_diff_min"] == 0
