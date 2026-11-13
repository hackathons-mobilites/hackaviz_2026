"""Parts sociales : dénominateurs, secret, petits effectifs (jamais de 0 inventé)."""

import pandas as pd
import pytest

from starway.context import (
    age_bin,
    rp_cv,
    share_margin95,
    commute_blocks,
    flows_to_poles,
    income_blocks,
    pct_shares,
    population_blocks,
)


def test_pct_shares_sum_and_zero_denominator():
    s = pct_shares({"F": 1, "H": 2}, ["F", "H"])
    assert s == {"F": 33.3, "H": 66.7}
    assert pct_shares({}, ["F", "H"]) == {"F": None, "H": None}


@pytest.mark.parametrize(("code", "expected"), [("Y0", "0-14"), ("Y14", "0-14"), ("Y15", "15-29"),
                                                ("Y74", "60-74"), ("Y75", "75+"), ("Y_GE100", "75+"), ("_T", None)])
def test_age_bin(code, expected):
    assert age_bin(code) == expected


def _pop_rows(geo: str, f: float, m: float) -> pd.DataFrame:
    rows = [(geo, "F", "_T", f), (geo, "M", "_T", m), (geo, "_T", "_T", f + m),
            (geo, "_T", "Y10", (f + m) / 2), (geo, "_T", "Y80", (f + m) / 2)]
    return pd.DataFrame(rows, columns=["GEO", "SEX", "AGE", "value"])


def test_population_blocks_uses_total_population_and_h_key():
    b = population_blocks(_pop_rows("93048", 60.0, 40.0))["93048"]
    assert b["sex"] == {"total": 100, "shares": {"F": 60.0, "H": 40.0}, "status": "ok"}
    assert b["age"]["shares"] == [50.0, 0.0, 0.0, 0.0, 0.0, 50.0]


def _nav(geo: str, f_counts: dict, h_counts: dict) -> pd.DataFrame:
    rows = [(geo, "F", t, v) for t, v in f_counts.items()] + [(geo, "M", t, v) for t, v in h_counts.items()]
    return pd.DataFrame(rows, columns=["GEO", "SEX", "TRANS", "value"])


def test_commute_blocks_denominator_is_each_sex_and_groups_other():
    b = commute_blocks(_nav("1", {"6": 300, "5": 100, "1": 50, "4": 50}, {"6": 200, "5": 200, "3": 100}),
                       {"1": 5000})["1"]
    assert b["status"] == "ok"
    assert b["F"] == {"transit": 60.0, "car": 20.0, "bike": 0.0, "walk": 0.0, "other": 20.0}
    assert b["H"]["transit"] == 40.0 and b["totals"] == {"F": 500, "H": 500}


def test_rp_cv_follows_insee_fiche():
    # < 10 000 hab. : CV = 1/sqrt(0,2 x a) ; exemple de la fiche : a = 4 900 (Tc 20 %) -> 140 / 4 900 ~ 2,9 %
    assert rp_cv(4900, 5000) == pytest.approx(1 / (0.2 * 4900) ** 0.5)
    # >= 10 000 hab. : tableau § 4.2
    assert rp_cv(2700, 20000) == 0.030  # exemple de lecture de la fiche
    assert rp_cv(249, 20000) is None  # « > 8,0 % » : non calculable
    assert rp_cv(0, 5000) is None


def test_share_margin_matches_insee_example():
    # Fiche § 5.2 : 4 000 sur 20 000 (CV 2,5 % et 1,0 %) -> 20 % +/- 1,1 point
    assert share_margin95(4000, 20000, 20000) == 1.1


def test_every_cell_gets_its_own_margin_and_no_threshold():
    b = commute_blocks(_nav("1", {"6": 150, "5": 0}, {"6": 900}), {"1": 3000})["1"]
    assert b["status"] == "ok" and b["F"]["transit"] == 100.0  # publiée, pas de seuil
    assert b["margin95"]["F"]["car"] is None  # effectif nul : CV non calculable
    assert b["margin95"]["F"]["transit"] is not None


def test_income_secret_gives_null():
    filo = pd.DataFrame([
        ("1", "MED_SL", "F", 24100.0), ("1", "PR_MD60", "C", float("nan")),
        ("2", "MED_SL", "C", float("nan")), ("2", "PR_MD60", "C", float("nan")),
    ], columns=["GEO", "FILOSOFI_MEASURE", "CONF_STATUS", "value"])
    b = income_blocks(filo)
    assert b["1"]["median_living_standard_eur"] == 24100 and b["1"]["poverty_rate"] is None
    assert b["1"]["poverty_rate_status"] == "secret" and b["1"]["status"] == "ok"
    assert b["2"]["status"] == "secret" and b["2"]["median_living_standard_eur"] is None


def test_flows_to_poles_denominator_is_all_outgoing_flows():
    flows = pd.DataFrame({"CODGEO": ["A", "A", "A"], "DCLT": ["A", "X1", "X2"],
                          "NBFLUX_C23_ACTOCC15P": [50.0, 30.0, 20.0]})
    out = flows_to_poles(flows, {"P": ["X1", "X2"]})
    assert out.to_dict("records") == [{"insee": "A", "pole_id": "P", "flux": 50, "actifs_occupes": 100,
                                       "share_pct": 50.0, "precision": "order_of_magnitude"}]


def test_flows_to_poles_sums_are_order_independent_and_exact():
    """x,5 exact : l'arrondi ne dépend pas de l'ordre des lignes (math.fsum), 7 fichiers context/ le montraient."""
    vals = [4.75409836065574] * 4 + [9.50819672131148]
    rows = [("A", "X%d" % i, v) for i, v in enumerate(vals)] + [("A", "Z", 123.6)]
    a = pd.DataFrame(rows, columns=["CODGEO", "DCLT", "NBFLUX_C23_ACTOCC15P"])
    members = {"P": [f"X{i}" for i in range(5)]}
    one = flows_to_poles(a, members)
    two = flows_to_poles(a.iloc[::-1].reset_index(drop=True), members)
    assert one.to_dict("records") == two.to_dict("records")


def test_origin_totals_and_destination_coverage_never_spread_what_has_no_astre():
    from starway.context import flow_shares_of_destinations, origin_totals

    flows = pd.DataFrame({"CODGEO": ["A", "A", "A", "A"], "DCLT": ["A", "X1", "Q", "Z"],
                          "NBFLUX_C23_ACTOCC15P": [50.0, 30.0, 10.0, 10.0]})
    assert origin_totals(flows) == {"A": 100.0}
    cov = flow_shares_of_destinations(flows, {"P": ["A", "X1"]}, ["A", "X1", "Q"])
    # Z (hors IDF) et Q (IDF sans astre) ne sont rattachés à aucun astre : ni répartis, ni perdus du total
    assert cov == {"total": 100.0, "in_astres": 80.0, "idf_outside_astres": 10.0, "outside_idf": 10.0}


def _flows_fixture() -> pd.DataFrame:
    """Fixture de test (valeurs synthétiques) : commune A, 3 lieux de travail dont 2 dans le pôle P1."""
    return pd.DataFrame({
        "CODGEO": ["A", "A", "A", "A"],
        "DCLT": ["A", "X1", "X2", "Z"],
        "NBFLUX_C23_ACTOCC15P": [500.0, 150.0, 49.7, 300.3],
    })


def test_flow_precision_applies_insee_rule_on_unrounded_value():
    from starway.context import EMP02_ORDER_OF_MAGNITUDE_BELOW, flow_precision

    assert EMP02_ORDER_OF_MAGNITUDE_BELOW == 200  # page INSEE 8998300 : « moins de 200 »
    assert flow_precision(199.7) == "order_of_magnitude"  # arrondi à 200, mais estimé sous 200
    assert flow_precision(200.0) == "ok"
    fp = flows_to_poles(_flows_fixture(), {"P1": ["X1", "X2"], "P2": ["Z"]}).set_index("pole_id")
    assert fp.loc["P1", "flux"] == 200 and fp.loc["P1", "precision"] == "order_of_magnitude"
    assert fp.loc["P2", "precision"] == "ok"


def test_flows_block_keys_by_pole_and_never_invents_zero():
    from starway.context import flows_block

    members = {"P1": ["X1", "X2"], "P2": ["Z"], "P3": ["A"]}
    fp = flows_to_poles(_flows_fixture(), {"P1": ["X1", "X2"], "P2": ["Z"]})
    b = flows_block("A", fp, ["P1", "P2", "P3", "P4"], {**members, "P4": ["Q"]}, 1000.0)
    assert list(b["poles"]) == ["P1", "P2", "P3", "P4"]
    assert b["poles"]["P1"] == {"flux": 200, "share_pct": 20.0, "precision": "order_of_magnitude"}
    assert b["poles"]["P4"] == {"flux": None, "share_pct": None, "precision": "no_flow_in_file"}
    assert b["origin_pole"] == "P3" and b["actifs_occupes"] == 1000 and b["status"] == "ok"
    assert "dénominateur" not in b["denominator"] and b["denominator"]
    empty = flows_block("B", fp, ["P1"], members, None)
    assert empty["status"] == "not_available" and empty["poles"]["P1"]["flux"] is None
