"""Trajets alternatifs (D-055) : choix de A, B et C, horaires, couverture, file des calculs."""

from __future__ import annotations

from starway import alternatives as alt


def option(dep: int, arr: int, *lines: str) -> dict:
    legs = [{"kind": "transit", "route_id": x, "from_stop": f"a{i}", "to_stop": f"b{i}", "dep_s": dep, "arr_s": arr}
            for i, x in enumerate(lines)]
    return {"dep_s": dep, "arr_s": arr, "legs": legs or [{"kind": "walk", "dep_s": dep, "arr_s": arr}]}


COSTS = {("L1", "L2"): 2.55, ("L3",): 2.05, ("L1",): 2.55}


def rate(o: dict) -> dict:
    k = alt.lines_key(o)
    return {"min": alt.minutes(o), "rides": len(k), "cost_eur": COSTS.get(k)}


def test_a_est_la_minute_de_la_matrice_b_le_moins_cher_c_le_moins_de_montees():
    fast = option(0, 1800, "L1", "L2")
    cheap = option(0, 2400, "L3")
    res = alt.select_abc([fast, cheap], [fast, cheap], 0, 30, rate)
    assert res["A"]["option"] is fast and res["delta_min"] == 0
    assert res["B"]["option"] is cheap
    assert res["C"]["option"] is cheap
    assert res["n_distinct"] == 2


def test_prix_inconnu_jamais_retenu_en_b():
    fast = option(0, 1800, "L1")
    unknown = option(0, 2000, "INCONNUE")
    res = alt.select_abc([fast, unknown], [fast, unknown], 0, 30, rate)
    assert res["B"]["option"] is fast


def test_deux_horaires_de_la_meme_ligne_ne_font_qu_une_option():
    a = option(0, 1800, "L1")
    later = option(0, 2400, "L1")
    assert alt.distinct_by_lines([later, a]) == [a]


def test_arrivee_a_la_minute_comme_la_matrice_et_retour_apres_la_fin():
    assert alt.on_time(option(0, 3659, "L1"), "out", 3600, 0)
    assert not alt.on_time(option(0, 3660, "L1"), "out", 3600, 0)
    assert alt.on_time(option(100, 900, "L1"), "ret", 0, 100)
    assert not alt.on_time(option(99, 900, "L1"), "ret", 0, 100)


def test_troncon_degenere_refuse():
    o = option(0, 900, "L1")
    o["legs"][0]["to_stop"] = o["legs"][0]["from_stop"]
    assert alt.is_degenerate(o)


def test_couverture_trois_etats_stricts():
    a = option(0, 1800, "L1")
    other = option(0, 2400, "L3")
    assert alt.coverage_state(None) == alt.NOT_YET
    assert alt.coverage_state({"A": None}) == alt.CALCULATED_WITHOUT
    assert alt.coverage_state({"A": {"option": a}, "B": {"option": a}, "C": {"option": a}}) == alt.CALCULATED_WITHOUT
    assert alt.coverage_state({"A": {"option": a}, "B": {"option": other}, "C": None}) == alt.CALCULATED_WITH


def test_file_des_calculs_dans_l_ordre_des_paliers():
    assert alt.priority_rows(["1", "2", "1"], ["3", "2", "4"]) == [
        (1, "1"), (1, "2"), (2, "1"), (2, "2"), (3, "3"), (3, "4"), (4, "3"), (4, "4")]
