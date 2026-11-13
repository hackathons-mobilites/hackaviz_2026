"""Découvertes des 44 astres sur la table commune x commune (insights_astres) : règles du front, astres atteints en
partie, commune de départ jamais comptée, valeur manquante jamais un écart, voisines comparées sur les mêmes destinations,
aucune découverte qui cite un pôle de l'ancien ciel."""

import json

import numpy as np
import pytest

from starway import insights_astres as ia
from starway import od_export as ox

FIRST, STEP, N = 180, 5, 229  # grille de la table : départs de 03:00 à 22:00
SLOTS = np.arange(FIRST, FIRST + STEP * N, STEP)
DAYS = ia.day_specs([{"id": "d06", "start": "06:00", "end": "14:00"}, {"id": "d09", "start": "09:00", "end": "17:00"},
                     {"id": "d14", "start": "14:00", "end": "22:00"}])
BUDGETS = [30, 45, 60]
JOBS = [100, 10, 20, 30, 40, 50]  # communes 0 à 5 (0 = origine)
CODES = ["A", "B", "C", "D", "E", "F"]
# 3 astres : {0, 1}, {2, 3}, {4, 5}
GROUP = [0, 0, 1, 1, 2, 2]


def series(f) -> np.ndarray:
    return np.array([f(int(t)) for t in SLOTS], dtype=np.uint8)


def parsed(origin: int, recs: dict[int, tuple[np.ndarray, np.ndarray]]) -> ox.ParsedFile:
    return ox.ParsedFile(origin, STEP, FIRST, N, 120, {0: recs}, {}, {0: sorted(recs)})


def reach_of(pf, origin_code="A"):
    return ia.origin_reach(pf, len(CODES), JOBS, GROUP, 0, DAYS, BUDGETS, 120, origin_code)


ALWAYS = series(lambda t: 30)
NEVER = series(lambda t: 255)
EVENING_OFF = series(lambda t: 30 if t < 18 * 60 else 255)  # retour impossible à partir de 18h


def test_astre_atteint_en_partie_et_commune_de_depart_jamais_comptee():
    # B (même astre que l'origine) atteinte, C atteinte, D aucun trajet, E aller seulement le soir, F absente
    pf = parsed(0, {1: (ALWAYS, ALWAYS), 2: (ALWAYS, ALWAYS), 3: (NEVER, NEVER), 4: (ALWAYS, EVENING_OFF)})
    r = reach_of(pf).reach
    d09 = r[("d09", 60)]
    assert d09.reached == 10 + 20 + 40  # B, C et E (retour avant 18h) ; les 100 postes de l'origine n'y sont pas
    assert d09.lit == 3  # astre de l'origine (par B), astre de C, astre de E : atteints au moins en partie
    assert d09.out_only == 0 and d09.unknown == 0
    d14 = r[("d14", 60)]
    assert d14.out_only == 40 and d14.out_only_astres == 1  # E : aller dans le budget, retour hors budget
    assert d14.reached == 10 + 20  # E n'est pas atteinte aller et retour


def test_budget_trop_court_aller_et_retour():
    slow = series(lambda t: 50)
    pf = parsed(0, {2: (slow, ALWAYS)})
    r = reach_of(pf).reach
    assert r[("d09", 45)].reached == 0 and r[("d09", 45)].out_only == 0  # aller 50 > 45 : non atteinte
    assert r[("d09", 60)].reached == 20


def test_valeur_manquante_n_est_pas_un_ecart():
    not_snapped = series(lambda t: 254)
    pf = parsed(0, {1: (not_snapped, not_snapped), 2: (ALWAYS, ALWAYS)})
    res = {"A": reach_of(pf)}
    assert res["A"].reach[("d09", 60)].unknown == 10
    assert not ia._usable(res, "A", "d09", BUDGETS)
    assert ia.eclipse(res, BUDGETS, ["d06", "d09", "d14"]) == []
    assert ia.late_return(res, BUDGETS, ["d06", "d09", "d14"]) == []


def _res():
    flaky = (ALWAYS, EVENING_OFF)
    a = parsed(0, {1: (ALWAYS, ALWAYS), 2: flaky, 4: (ALWAYS, ALWAYS)})
    return {"A": reach_of(a, "A")}


def test_eclipse_et_retour_tardif_comptent_des_postes_et_des_astres():
    res = _res()
    ecl = ia.eclipse(res, BUDGETS, ["d06", "d09", "d14"])
    assert [x["scenario"]["d"] for x in ecl] == ["d14"]  # d06 = d09 : aucun écart
    x = ecl[0]
    assert x["scenario"] == {"o": "A", "d": "d14", "b": 30, "m": "transit", "vs": None, "compare_day": "d09"}
    assert x["metric"] == {"jobs_delta": -20, "poles_delta": -1, "jobs": 10 + 40, "jobs_ref": 10 + 20 + 40}
    assert x["robust"] is True  # tient aux trois budgets
    late = ia.late_return(res, BUDGETS, ["d06", "d09", "d14"])
    assert [(y["scenario"]["d"], y["metric"]["jobs_delta"], y["metric"]["poles_delta"]) for y in late] == [("d14", -20, -1)]
    assert late[0]["metric"]["jobs"] == 10 + 40 and late[0]["metric"]["jobs_ref"] == 10 + 40 + 20


def test_voisines_comparees_sur_les_memes_destinations():
    # A et B voisines : A atteint B (10 postes) mais pas C ; B atteint A (100 postes) et C. Sans retrait des deux
    # communes, B semblerait voir 100 postes de plus que A uniquement parce que A est sa voisine
    a = parsed(0, {1: (ALWAYS, ALWAYS)})
    b = parsed(1, {0: (ALWAYS, ALWAYS), 2: (ALWAYS, ALWAYS)})
    res = {"A": reach_of(a, "A"), "B": reach_of(b, "B")}
    gaps = ia.territorial_gap(res, BUDGETS, [("A", "B")], JOBS, GROUP, CODES)
    assert len(gaps) == 1
    g = gaps[0]
    assert g["scenario"]["o"] == "A" and g["scenario"]["vs"] == "B" and g["scenario"]["d"] == "d09"
    assert g["metric"]["jobs_delta"] == -20  # seulement C (20 postes), pas les 100 postes de A
    assert g["metric"]["jobs"] == 0 and g["metric"]["jobs_ref"] == 20
    assert g["metric"]["poles_delta"] == -1


def test_classement_robuste_d_abord_puis_ecart_et_ids_stables():
    res = _res()
    items = ia.compute_insights(res, BUDGETS, ["d06", "d09", "d14"], [], JOBS, GROUP, CODES)
    assert [x["id"] for x in items] == ["eclipse_01", "late_return_01"]
    assert all(x["rank"] == 1 for x in items)


def test_bike_gain_jamais_ok_et_types_partiels_non_publies():
    k = ia.kinds_status(1285, 1285)
    assert k["eclipse"]["status"] == k["late_return"]["status"] == k["territorial_gap"]["status"] == "ok"
    assert k["bike_gain"]["status"] == "not_computed" and "table commune x commune" in k["bike_gain"]["reason"]
    part = ia.kinds_status(1285, 1280)
    assert part["eclipse"]["status"] == "not_computed" and "1 280 sur 1 285" in part["eclipse"]["reason"]


def test_bike_gain_dit_ce_qui_manque_reellement():
    """Le vélo + TC publié dans access/ (lu dans meta.json) ; ce qui manque est la table commune x commune (10/11)."""
    meta = {"modes": [{"id": "transit"}, {"id": "bike_transit"}], "mode_coverage": {"velib": ["A"]},
            "access_communes": ["A", "B", "C"]}
    assert ia.bike_transit_origins(meta) == 3  # mode absent de mode_coverage : toutes les origines
    assert ia.bike_transit_origins({**meta, "mode_coverage": {"bike_transit": ["A"]}}) == 1
    assert ia.bike_transit_origins({"modes": [{"id": "transit"}]}) is None
    k = ia.kinds_status(1285, 1285, 1285, 44)["bike_gain"]
    assert k["status"] == "not_computed" and "pas encore" not in k["reason"] + k["detail"]
    assert "1 285 communes" in k["detail"] and "44 astres" in k["detail"] and "VM" not in k["detail"]
    assert "non publié" in ia.kinds_status(1285, 1285, None)["bike_gain"]["detail"]


def test_decouvertes_publiees_gardees_sans_statut_invente():
    res = _res()
    items = ia.compute_insights(res, BUDGETS, ["d06", "d09", "d14"], [], JOBS, GROUP, CODES)
    out = ia.published_items(items)
    assert [x["id"] for x in out] == [x["id"] for x in items]  # rien de retiré
    assert {x["crosscheck"] for x in out} == {"not_checked"}  # jamais un statut inventé


def test_bloc_meta_et_controle_de_publication():
    res = _res()
    items = ia.published_items(ia.compute_insights(res, BUDGETS, ["d06", "d09", "d14"], [], JOBS, GROUP, CODES))
    block = ia.meta_insights_block(items, ia.kinds_status(1, 1), {})
    assert block["sky"] == "44" and block["basis"] == "od_astres" and block["excluded"] == []
    assert ia.check_published(block, items, BUDGETS, ["A"]) == []
    bad = json.loads(json.dumps(block))
    bad["kinds"]["bike_gain"]["status"] = "ok"
    assert any("bike_gain" in p for p in ia.check_published(bad, items, BUDGETS, ["A"]))
    contradicted = [{**items[0], "crosscheck": "contradicted"}]
    assert any("contredite" in p for p in ia.check_published(block, contradicted, BUDGETS, ["A"]))
    assert any("basis" in p for p in ia.check_published({"sky": "15"}, items, BUDGETS, ["A"]))


def test_aucune_decouverte_ne_cite_un_pole_de_l_ancien_ciel():
    """Les découvertes ne portent que des codes INSEE de communes : aucun identifiant `P_...` ni nom d'ancien pôle."""
    res = _res()
    items = ia.published_items(ia.compute_insights(res, BUDGETS, ["d06", "d09", "d14"], [], JOBS, GROUP, CODES))
    text = json.dumps(items, ensure_ascii=False)
    assert '"P_' not in text
    for gone in ("Massy", "Saclay", "Orly", "Rungis", "Créteil"):
        assert gone not in text


@pytest.mark.parametrize("hhmm,minutes", [("06:00", 360), ("22:00", 1320)])
def test_day_specs(hhmm, minutes):
    assert ia.hhmm(hhmm) == minutes


def test_statut_de_recoupement_par_scenario_et_ecartee_jamais_ajustee() -> None:
    from starway import insights_astres as ia
    item = {"id": "eclipse_01", "kind": "eclipse", "scenario": {"o": "94021", "d": "d06", "b": 60}, "metric": {}}
    key = ia.scenario_key(item)
    assert key == ia.scenario_key({**item, "id": "eclipse_09"})  # le rang ne change pas l'identité
    assert ia.published_items([item], {key: "confirmed"})[0]["crosscheck"] == "confirmed"
    assert ia.published_items([item])[0]["crosscheck"] == "not_checked"
    block = ia.meta_insights_block([], {}, {}, [item])
    assert block["excluded"] == [{"would_be_id": "eclipse_01", "kind": "eclipse", "scenario": item["scenario"],
                                  "cause": "navitia_contradicted"}]
