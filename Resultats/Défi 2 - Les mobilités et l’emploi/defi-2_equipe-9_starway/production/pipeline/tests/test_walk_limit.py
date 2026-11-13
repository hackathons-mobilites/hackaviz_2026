"""Marquage des retours nuls dus à la limite de marche finale de R5 (raison no_stop_within_walk_limit)."""

import pandas as pd

from starway.config import REASONS
from starway.egress import (
    BASIS_CROW,
    BASIS_NETWORK,
    CAT_FAR,
    CAT_NEAR,
    CAT_SUSPECT,
    REASON_NO_TRIP,
    REASON_WALK_LIMIT,
    check_marks_fresh,
    mark_reason,
    walk_limit_basis,
    walk_limit_marks,
)
from starway.export import build_access
from starway.insights import compute_insights, relies_on_unmeasured, unmeasured_at


def test_reason_no_longer_published_since_d024():
    # D-024 (03/11/2026) : la limite de marche est un réglage annoncé, la raison de D-023 n'est plus publiée
    assert REASON_WALK_LIMIT not in REASONS


def test_basis_crow_between_2km_and_walk_reach():
    # quai le plus proche à 2 km ou plus à vol d'oiseau : la marche par le réseau est au moins aussi longue
    assert walk_limit_basis(CAT_SUSPECT, None, 0, 0) == BASIS_CROW


def test_no_mark_beyond_walk_reach():
    # aucun quai à portée de marche en 120 min : « aucun trajet en 120 min » tient avec ou sans la limite
    assert walk_limit_basis(CAT_FAR, None, 0, 0) is None
    assert walk_limit_basis(CAT_FAR, False, 0, 0) is None


def test_near_needs_a_network_measure():
    assert walk_limit_basis(CAT_NEAR, None, 0, 0) is None  # pas de mesure : on ne peut rien affirmer
    assert walk_limit_basis(CAT_NEAR, True, 0, 0) is None  # quai à moins de 2 km par le réseau
    assert walk_limit_basis(CAT_NEAR, False, 0, 0) == BASIS_NETWORK


def test_no_mark_when_r5_found_a_transit_return():
    # 3 retours trouvés dont 1 seul tout à pied : R5 a trouvé un quai desservi à moins de 2 km sur SON réseau
    assert walk_limit_basis(CAT_NEAR, False, 3, 1) is None
    assert walk_limit_basis(CAT_SUSPECT, None, 3, 1) is None
    # retours trouvés tous à pied : pas de contradiction
    assert walk_limit_basis(CAT_SUSPECT, None, 2, 2) == BASIS_CROW


def test_marks_from_files():
    eg = pd.DataFrame({"insee": ["1", "2", "3", "4"], "day": ["d14"] * 4,
                       "category": [CAT_SUSPECT, CAT_NEAR, CAT_NEAR, CAT_FAR],
                       "ret_found": [0, 0, 0, 0], "ret_found_equal_walk": [0, 0, 0, 0]})
    net = pd.DataFrame({"insee": ["2", "3"], "day": ["d14", "d14"], "network_lt_2km": [False, True]})
    assert walk_limit_marks(eg, net) == {("1", "d14"): BASIS_CROW, ("2", "d14"): BASIS_NETWORK}
    assert walk_limit_marks(eg, None) == {("1", "d14"): BASIS_CROW}


def test_mark_reason_only_when_out_found_and_ret_null():
    assert mark_reason(40, None, REASON_NO_TRIP, True) == REASON_WALK_LIMIT
    assert mark_reason(None, None, REASON_NO_TRIP, True) == REASON_NO_TRIP  # la raison décrit l'aller, mesuré
    assert mark_reason(40, 50, None, True) is None
    assert mark_reason(40, None, REASON_NO_TRIP, False) == REASON_NO_TRIP
    assert mark_reason(40, None, "not_computed", True) == "not_computed"  # autre raison : inchangée


def _matrix(rows):
    return pd.DataFrame(rows, columns=["from_id", "to_id", "out", "ret", "reason", "dep"])


def test_build_access_marks_transit_only_and_flags_series():
    nan = float("nan")
    tc = _matrix([["A", "p1", 40, nan, REASON_NO_TRIP, "13:15"], ["A", "p2", nan, nan, REASON_NO_TRIP, None],
                  ["A", "p3", 30, 35, None, "13:30"]])
    bt = _matrix([["A", "p1", 40, nan, REASON_NO_TRIP, "13:15"], ["A", "p2", 40, 40, None, "13:15"],
                  ["A", "p3", 30, 35, None, "13:30"]])
    a = build_access("A", ["p1", "p2", "p3"], {("transit", "d14"): tc, ("bike_transit", "d14"): bt},
                     {("A", "d14"): BASIS_CROW})
    t = a["modes"]["transit"]["d14"]
    assert t["reason"] == [REASON_WALK_LIMIT, REASON_NO_TRIP, None]
    assert t["walk_limit"] == BASIS_CROW
    b = a["modes"]["bike_transit"]["d14"]
    assert b["reason"][0] == REASON_NO_TRIP and "walk_limit" not in b  # vélo + TC : autre limite, non analysée
    # sans marque : rien ne change
    a0 = build_access("A", ["p1", "p2", "p3"], {("transit", "d14"): tc})
    assert a0["modes"]["transit"]["d14"]["reason"][0] == REASON_NO_TRIP and "walk_limit" not in a0["modes"]["transit"]["d14"]


def test_freshness_detects_changed_matrix():
    eg = pd.DataFrame({"insee": ["A"], "day": ["d14"], "ret_null": [2], "ret_null_out_found": [1]})
    nan = float("nan")
    same = _matrix([["A", "p1", 40, nan, REASON_NO_TRIP, None], ["A", "p2", nan, nan, REASON_NO_TRIP, None],
                    ["A", "p3", 30, 35, None, None]])
    assert check_marks_fresh(eg, {("transit", "d14"): same}) == []
    changed = same.copy()
    changed.loc[0, "ret"] = 50
    assert check_marks_fresh(eg, {("transit", "d14"): changed}) == ["A/d14"]


JOBS = [1000, 200, 50]
BUDGETS = [30, 45, 60]


def cell(out, ret, reason=None):
    return {"out": out, "ret": ret, "reason": reason or [None if o is not None and r is not None else REASON_NO_TRIP
                                                         for o, r in zip(out, ret)]}


def test_unmeasured_depends_on_budget():
    c = cell([40, 25], [None, 20], [REASON_WALK_LIMIT, None])
    assert unmeasured_at(c, 30) == []  # aller 40 > 30 : non accessible quel que soit le retour
    assert unmeasured_at(c, 45) == [0]


def test_late_return_relying_on_unmeasured_is_dropped_and_others_move_up():
    walk = [REASON_WALK_LIMIT, None, None]
    access = {"A": {"transit": {"d14": cell([25, 25, 25], [None, 25, 25], walk)}},  # perte de 1 000 (non mesurée)
              "B": {"transit": {"d14": cell([25, 25, 25], [25, None, 25])}}}  # perte de 200 (mesurée)
    excluded: list = []
    ins = compute_insights(access, JOBS, BUDGETS, ["d14"], [], excluded=excluded)
    lr = [x for x in ins if x["kind"] == "late_return"]
    assert [x["scenario"]["o"] for x in lr] == ["B"] and lr[0]["id"] == "late_return_01"
    assert [(x["id"], x["scenario"]["o"]) for x in excluded] == [("late_return_01", "A")]


def test_eclipse_relying_on_unmeasured_return_is_dropped():
    access = {"A": {"transit": {"d09": cell([20, 20, 20], [20, 20, 20]),
                                "d14": cell([20, 20, 20], [None, 20, 20], [REASON_WALK_LIMIT, None, None])}}}
    ins = compute_insights(access, JOBS, BUDGETS, ["d09", "d14"], [])
    assert [x for x in ins if x["kind"] == "eclipse"] == []
    # même perte, mais mesurée (aucun trajet trouvé) : la découverte reste
    access["A"]["transit"]["d14"] = cell([20, 20, 20], [None, 20, 20])
    ins = compute_insights(access, JOBS, BUDGETS, ["d09", "d14"], [])
    assert [x["scenario"]["o"] for x in ins if x["kind"] == "eclipse"] == ["A"]


def test_territorial_gap_checks_both_communes():
    item = {"kind": "territorial_gap", "scenario": {"o": "A", "d": "d09", "b": 45, "m": "transit", "vs": "B",
                                                     "compare_day": None}}
    access = {"A": {"transit": {"d09": cell([20], [20])}},
              "B": {"transit": {"d09": cell([20], [None], [REASON_WALK_LIMIT])}}}
    assert relies_on_unmeasured(item, access) is True


def test_relay_suspects_from_pairs():
    from starway.egress import relay_suspects

    nan = float("nan")
    pairs = pd.DataFrame({"insee": ["A", "A", "A", "B"], "day": ["d14"] * 4, "pole_id": ["p1", "p2", "p3", "p1"],
                          "ret": [nan, nan, 30.0, nan], "relay": [87.0, 144.0, 25.0, nan]})
    # p1 : retour nul et indice 87 <= 120 ; p2 : indice au-delà de 120 ; p3 : retour trouvé ; B : aucun indice
    assert relay_suspects(pairs, ["p1", "p2", "p3"], 120) == {("A", "d14"): {0}}


def test_late_return_contested_by_relay_index_is_dropped():
    # cas du Mesnil-le-Roi : un arrêt desservi à moins de 2 km (pas de raison de limite), mais l'indice relais
    # conteste le « aucun retour » du pôle 0
    access = {"A": {"transit": {"d14": cell([25, 25, 25], [None, 25, 25])}},
              "B": {"transit": {"d14": cell([25, 25, 25], [25, None, 25])}}}
    excluded: list = []
    ins = compute_insights(access, JOBS, BUDGETS, ["d14"], [], excluded=excluded, suspect={("A", "d14"): {0}})
    assert [x["scenario"]["o"] for x in ins if x["kind"] == "late_return"] == ["B"]
    assert [(x["id"], x["excluded_cause"]) for x in excluded] == [("late_return_01", "relay_index")]
    # sans signalement : A reste en tête
    ins = compute_insights(access, JOBS, BUDGETS, ["d14"], [])
    assert [x["scenario"]["o"] for x in ins if x["kind"] == "late_return"] == ["A", "B"]


def test_relay_suspect_ignored_when_out_exceeds_budget():
    c = cell([70, 25], [None, 25])
    assert unmeasured_at(c, 60, {0}) == []  # aller 70 > 60 : le verdict ne dépend pas du retour
    assert unmeasured_at(c, 60) == []
