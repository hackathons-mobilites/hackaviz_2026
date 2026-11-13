"""Découvertes : uniquement des écarts présents dans la matrice, aller ET retour, robustesse sur 2 budgets."""

from starway.insights import (
    accessible_mask,
    bike_gain,
    compute_insights,
    eclipse,
    late_return,
    territorial_gap,
)

JOBS = [1000, 200, 50]
BUDGETS = [30, 45, 60]


def cell(out, ret):
    return {"out": out, "ret": ret}


def dark(insee, day, budget):
    """Part TC commune par commune nulle pour tous les pôles (D-056)."""
    return [{"reached": 0, "unknown": 0, "not_reached": 1}] * 3


def test_accessible_needs_both_directions():
    assert accessible_mask([20, 20, None], [50, 20, 10], 45) == [False, True, False]


def test_eclipse_detects_loss_and_robustness():
    access = {"A": {"transit": {"d09": cell([20, 40, 50], [20, 40, 50]), "d06": cell([20, 70, 70], [20, 40, 50])}}}
    [x] = eclipse(access, JOBS, BUDGETS, ["d06", "d09"])
    assert x["scenario"] == {"o": "A", "d": "d06", "b": 60, "m": "transit", "vs": None, "compare_day": "d09"}
    assert x["metric"] == {"jobs_delta": -250, "poles_delta": -2, "jobs": 1000, "jobs_ref": 1250}
    assert x["robust"] is True  # écart à 45 (-200) et à 60 (-250) : on retient le plus grand


def test_no_eclipse_when_identical():
    c = cell([20, 40, None], [20, 40, None])
    assert eclipse({"A": {"transit": {"d09": c, "d06": c}}}, JOBS, BUDGETS, ["d06"]) == []


def test_single_budget_gap_is_not_robust():
    access = {"A": {"transit": {"d09": cell([20, 55, None], [20, 55, None]),
                                "d06": cell([20, 65, None], [20, 55, None])}}}
    [x] = eclipse(access, JOBS, BUDGETS, ["d06"])
    assert x["scenario"]["b"] == 60 and x["robust"] is False


def test_late_return_counts_poles_reached_out_but_not_back():
    access = {"A": {"transit": {"d14": cell([25, 25, 80], [None, 25, 25])}}}
    [x] = late_return(access, JOBS, BUDGETS, ["d14"])
    assert x["metric"]["jobs_delta"] == -1000 and x["metric"]["poles_delta"] == -1
    assert x["robust"] is True and x["scenario"]["b"] == 30


def test_bike_gain_only_if_both_directions_improve():
    access = {"A": {"transit": {"d09": cell([50, 50, 50], [50, 50, 50])},
                    "bike_transit": {"d09": cell([40, 40, 50], [40, 70, 50])}}}
    [x] = bike_gain(access, JOBS, BUDGETS, ["d09"], dark)
    assert x["scenario"]["m"] == "bike_transit" and x["scenario"]["b"] == 45
    assert x["metric"]["jobs_delta"] == 1000 and x["robust"] is False
    assert x["metric"]["jobs"] - x["metric"]["jobs_ref"] == x["metric"]["jobs_delta"]


def test_bike_gain_suit_la_regle_de_l_or():
    access = {"A": {"transit": {"d09": cell([50, 50, 50], [50, 50, 50])},
                    "bike_transit": {"d09": cell([40, 40, 50], [40, 40, 50])}}}
    # À 45 min, le pôle 0 est déjà atteint en TC commune par commune : seul le pôle 1 est un gain
    lit_first = lambda insee, day, b: [{"reached": 5, "unknown": 0, "not_reached": 1},  # noqa: E731
                                       {"reached": 0, "unknown": 0, "not_reached": 1},
                                       {"reached": 0, "unknown": 0, "not_reached": 1}]
    [x] = bike_gain(access, JOBS, BUDGETS, ["d09"], lit_first)
    assert x["metric"]["jobs_delta"] == 200 and x["metric"]["poles_delta"] == 1
    assert bike_gain(access, JOBS, BUDGETS, ["d09"]) == []  # sans table commune par commune : aucun or
    assert bike_gain(access, JOBS, BUDGETS, ["d09"], lambda insee, day, b: None) == []


def test_territorial_gap_only_between_contiguous_communes():
    access = {"A": {"transit": {"d09": cell([20, 20, 20], [20, 20, 20])}},
              "B": {"transit": {"d09": cell([50, 50, 50], [50, 50, 50])}},
              "C": {"transit": {"d09": cell([None] * 3, [None] * 3)}}}
    [x] = territorial_gap(access, JOBS, BUDGETS, [("B", "A")])  # C n'est contiguë à personne
    assert x["scenario"]["o"] == "B" and x["scenario"]["vs"] == "A"
    assert x["metric"]["jobs_delta"] == -1250 and x["robust"] is True


def test_compute_insights_ranks_and_ids():
    access = {"A": {"transit": {"d09": cell([20, 40, 50], [20, 40, 50]), "d06": cell([20, 70, 70], [20, 40, 50])}},
              "B": {"transit": {"d09": cell([20, 20, 50], [20, 20, 50]), "d06": cell([70, 20, 50], [20, 20, 50])}}}
    res = compute_insights(access, JOBS, BUDGETS, ["d06", "d09"], [], top_n=5)
    ecl = [x for x in res if x["kind"] == "eclipse"]
    assert [x["id"] for x in ecl] == ["eclipse_01", "eclipse_02"]
    assert ecl[0]["scenario"]["o"] == "B"  # 1 000 postes perdus > 250


# --- Modes partiels (D-014) : FIXTURE DE TEST synthétique, jamais exportée -------------------------------------
def _partial_fixture() -> dict:
    """3 communes fictives : A a TC + vélo + TC ; B n'a que les TC (vélo + TC non calculé) ; C n'est pas accrochée."""
    nc = ["not_computed"] * 3
    return {
        "A": {"transit": {"d09": cell([50, 50, 50], [50, 50, 50]), "d06": cell([50, 50, 50], [50, 50, 50])},
              "bike_transit": {"d09": cell([40, 40, 50], [40, 40, 50]), "d06": cell([40, 40, 50], [40, 40, 50])}},
        "B": {"transit": {"d09": cell([20, 20, 20], [20, 20, 20]), "d06": cell([20, 20, 20], [20, 20, 20])}},
        "C": {"transit": {"d09": {"out": [None] * 3, "ret": [None] * 3, "reason": ["origin_not_snapped"] * 3}}},
        "D": {"transit": {"d09": cell([20, 20, 20], [20, 20, 20]),
                          "d06": {"out": [20, None, 20], "ret": [20, None, 20],
                                  "reason": [None, "not_computed", None]}},
              "bike_transit": {"d09": {"out": [None] * 3, "ret": [None] * 3, "reason": nc}}},
    }


def test_partial_modes_do_not_crash_and_only_compare_computed_cells():
    res = compute_insights(_partial_fixture(), JOBS, BUDGETS, ["d06", "d09"], [("A", "B"), ("B", "C"), ("C", "D")],
                           commune_parts_of=dark)
    bike = [x for x in res if x["kind"] == "bike_gain"]
    assert [x["scenario"]["o"] for x in bike] == ["A", "A"]  # B sans vélo + TC, D « not_computed » : exclus
    assert all(x["metric"]["jobs_delta"] != 0 for x in res)
    assert {x["scenario"]["o"] for x in res if x["kind"] == "territorial_gap"} == {"A"}  # A vs B seulement


def test_missing_values_never_create_an_eclipse_or_a_gap():
    access = _partial_fixture()
    # D : le pôle 2 « not_computed » en 6h-14h ne doit pas apparaître comme une perte
    assert eclipse(access, JOBS, BUDGETS, ["d06"]) == []
    # C non accrochée : aucun écart avec ses voisines B et D (jamais « moins bien reliée » par défaut)
    gaps = territorial_gap(access, JOBS, BUDGETS, [("B", "C"), ("C", "D")])
    assert gaps == []
    # retour « not_computed » : pas un retour impossible
    late = {"E": {"transit": {"d14": {"out": [25, 25, 25], "ret": [None, 25, 25],
                                      "reason": ["not_computed", None, None]}}}}
    assert late_return(late, JOBS, BUDGETS, ["d14"]) == []


def test_no_trip_within_120_is_a_real_result():
    access = {"A": {"transit": {"d09": cell([20, 20, 20], [20, 20, 20]),
                                "d06": {"out": [None, 20, 20], "ret": [20, 20, 20],
                                        "reason": ["no_trip_within_120", None, None]}}}}
    [x] = eclipse(access, JOBS, BUDGETS, ["d06"])
    assert x["metric"]["jobs_delta"] == -1000 and x["robust"] is True


def test_extra_cause_drops_before_ranking_and_cascades():
    from starway.insights import CAUSE_NAVITIA, scenario_key

    # trois retours tardifs (1 000, 200, 50 postes perdus) ; les deux premiers « contredits »
    access = {"A": {"transit": {"d14": cell([25, 25, 25], [None, 25, 25])}},
              "B": {"transit": {"d14": cell([25, 25, 25], [25, None, 25])}},
              "C": {"transit": {"d14": cell([25, 25, 25], [25, 25, None])}}}
    base = compute_insights(access, JOBS, BUDGETS, ["d14"], [], top_n=1)
    bad = {scenario_key(x) for x in base}  # A
    first = compute_insights(access, JOBS, BUDGETS, ["d14"], [], top_n=3)
    bad.add(scenario_key(first[1]))  # B
    excluded: list = []
    res = compute_insights(access, JOBS, BUDGETS, ["d14"], [], top_n=1, excluded=excluded,
                           extra_cause=lambda x: CAUSE_NAVITIA if scenario_key(x) in bad else None)
    assert [(x["id"], x["scenario"]["o"]) for x in res] == [("late_return_01", "C")]
    # B n'aurait été publiée qu'après l'écart de A : elle est listée avec sa place du classement complet
    assert [(x["id"], x["scenario"]["o"], x["excluded_cause"]) for x in excluded] == [
        ("late_return_01", "A", CAUSE_NAVITIA), ("late_return_02", "B", CAUSE_NAVITIA)]
