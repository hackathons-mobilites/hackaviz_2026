"""Comparaison publiée / variante D-022 (sans Java)."""

import pandas as pd
import pytest

from starway.variant_compare import accessible, day_summary, paired, verdict_changes

NA = pd.NA


def frame(rows):
    return pd.DataFrame(rows, columns=["from_id", "to_id", "out", "dep", "ret"])


PUB = frame([("A", "P1", 30, "x", NA), ("A", "P2", 40, "x", 50), ("B", "P1", NA, None, NA), ("B", "P2", 20, "x", 25)])
VAR = frame([("A", "P1", 30, "x", 45), ("A", "P2", 40, "x", 44), ("B", "P1", 70, "x", NA), ("B", "P2", 21, "y", 25)])


def test_accessible_requires_both_legs_within_budget():
    out = pd.Series([30, 30, NA, 50], dtype="Int64")
    ret = pd.Series([30, NA, 10, 40], dtype="Int64")
    assert accessible(out, ret, 45).tolist() == [True, False, False, False]


def test_paired_refuses_mismatched_pairs():
    with pytest.raises(ValueError):
        paired(PUB, VAR.iloc[:3])


def test_day_summary_counts():
    s = day_summary(paired(PUB, VAR))
    assert s["ret_found_more"] == 1  # A-P1
    assert s["out_found_more"] == 1  # B-P1
    assert s["ret_shorter"] == 1 and s["ret_same"] == 1 and s["ret_lost"] == 0
    assert s["out_longer"] == 1  # B-P2 : départ plus tardif possible, aller plus long (pas une erreur)
    assert s["communes_ret_found_more"] == 1
    assert s["communes_no_return_pub"] == 0 and s["communes_no_return_resolved"] == 0


def test_no_return_commune_resolved():
    pub = frame([("C", "P1", 10, "x", NA), ("C", "P2", 10, "x", NA)])
    var = frame([("C", "P1", 10, "x", 60), ("C", "P2", 10, "x", NA)])
    s = day_summary(paired(pub, var))
    assert (s["communes_no_return_pub"], s["communes_no_return_var"], s["communes_no_return_resolved"]) == (1, 0, 1)


def test_verdict_changes_by_budget_with_jobs():
    v = verdict_changes(paired(PUB, VAR), [30, 45, 50], pd.Series({"P1": 1000, "P2": 10}))
    by = v.set_index("budget")
    assert by.loc[30, "gained_pairs"] == 0
    assert by.loc[45, "gained_pairs"] == 2 and by.loc[45, "gained_jobs"] == 1010  # A-P1 (45), A-P2 (44)
    assert by.loc[50, "gained_pairs"] == 1  # A-P2 était déjà accessible à 50
    assert (v["lost_pairs"] == 0).all()


def test_matrix_errors_flags_late_arrival_and_missing_reason():
    from starway.variant_compare import matrix_errors

    start = pd.Timestamp("2026-11-17 09:00")
    ok = pd.DataFrame({"out": [30.0, None], "dep": ["2026-11-17 08:30:00", None], "ret": [40.0, 50.0],
                       "reason": [None, "no_trip_within_120"]})
    assert matrix_errors(ok, start) == []
    bad = pd.DataFrame({"out": [35.0, None], "dep": ["2026-11-17 08:30:00", None], "ret": [40.0, None],
                        "reason": [None, None]})
    errs = matrix_errors(bad, start)
    assert any("sans raison" in e for e in errs)
    assert any("après le début" in e for e in errs)


def test_lost_walk_only_counts_published_all_walk_trips():
    from starway.variant_compare import lost_walk_only

    walk = frame([("A", "P1", 30, None, 80), ("A", "P2", 90, None, 90), ("B", "P1", NA, None, NA),
                  ("B", "P2", 50, None, 60)])
    pub = frame([("A", "P1", 30, "x", 80), ("A", "P2", 40, "x", 50), ("B", "P1", NA, None, NA), ("B", "P2", 20, "x", 25)])
    var = frame([("A", "P1", 30, "x", NA), ("A", "P2", 40, "x", NA), ("B", "P1", NA, None, NA), ("B", "P2", 20, "x", 25)])
    m = paired(pub, var)
    assert lost_walk_only(m, walk, "ret") == 1  # A-P1 : 80 min publiées = tout à pied ; A-P2 : trajet TC perdu
    assert lost_walk_only(m, walk, "out") == 0
