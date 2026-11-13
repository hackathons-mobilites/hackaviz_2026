"""Règle de l'or du vélo + TC (D-056) : les mêmes cas que `goldDelta` du front (frontend/src/data/gain.ts)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from starway import gold
from starway.config import FRONT_DATA_DIR
from starway.navitia import Trip, insight_trips


def part(reached: int = 0, unknown: int = 0, not_reached: int = 100) -> dict:
    return {"reached": reached, "unknown": unknown, "not_reached": not_reached}


DARK = part()
TC = {"out": [50, 80, 80, 80], "ret": [50, 80, 80, 80]}
BIKE = {"out": [50, 40, 40, 40], "ret": [50, 40, 40, 40]}


def test_or_seulement_si_part_tc_commune_par_commune_nulle() -> None:
    """Astre 1 : mérité ; astre 2 : déjà éclairé en TC commune par commune ; astre 3 : une commune sans verdict."""
    gained, lost = gold.gold_delta(TC, BIKE, 60, [DARK, DARK, part(reached=30, not_reached=70), part(unknown=5)])
    assert gained == [1] and lost == []


def test_astre_accessible_en_tc_dans_access_jamais_en_or() -> None:
    assert gold.gold_delta(TC, BIKE, 60, [DARK] * 4)[0] == [1, 2, 3]  # l'astre 0 est déjà accessible en TC dans access/


def test_retour_vers_le_velo_hors_budget_pas_d_or() -> None:
    bike = {"out": [50, 40, 40, 40], "ret": [50, 90, 40, 40]}
    assert gold.gold_delta(TC, bike, 60, [DARK] * 4)[0] == [2, 3]


def test_sans_table_commune_par_commune_aucun_or_mais_pertes_mesurees() -> None:
    tc = {"out": [10, 80], "ret": [10, 80]}
    bike = {"out": [90, 40], "ret": [90, 40]}
    assert gold.gold_delta(tc, bike, 60, None) == (None, [0])


def test_non_calcule_ni_gain_ni_perte() -> None:
    tc = {"out": [None, 10], "ret": [None, 10], "reason": ["not_computed", None]}
    bike = {"out": [40, None], "ret": [40, None], "reason": [None, "origin_not_snapped"]}
    assert gold.gold_delta(tc, bike, 60, [DARK, DARK]) == ([], [])


def test_aucun_trajet_tc_reste_un_gain_possible() -> None:
    tc = {"out": [None], "ret": [None], "reason": ["no_trip_within_120"]}
    assert gold.gold_delta(tc, {"out": [40], "ret": [40]}, 60, [DARK])[0] == [0]


def test_commune_de_depart_seule_ne_prouve_rien() -> None:
    assert not gold.commune_dark(part(not_reached=0))  # astre fait de la seule commune de départ, ou sans mesure
    assert gold.commune_dark(DARK) and not gold.commune_dark(None)


def test_parts_non_alignees_refusees() -> None:
    with pytest.raises(ValueError):
        gold.gold_delta(TC, BIKE, 60, [DARK])


def test_navitia_ne_recoupe_que_les_astres_en_or() -> None:
    poles, jobs = ["P1", "P2", "P3", "P4"], [100, 500, 400, 50]
    data = {("A", "transit", "d09"): TC, ("A", "bike_transit", "d09"): BIKE}
    series = lambda insee, mode, day: data.get((insee, mode, day))  # noqa: E731
    ins = {"kind": "bike_gain", "scenario": {"o": "A", "d": "d09", "b": 60, "m": "bike_transit"}}
    # P2 (le plus de postes) est déjà éclairé en TC commune par commune : le recoupement porte sur P3
    parts = [DARK, part(reached=10), DARK, DARK]
    assert insight_trips(ins, series, poles, jobs, lambda o, d, b: parts)[0] == [Trip("A", "P3", "d09", "out"),
                                                                                  Trip("A", "P3", "d09", "ret")]
    assert insight_trips(ins, series, poles, jobs, lambda o, d, b: None) == ([], gold.NO_COMMUNE_TRANSIT)
    assert insight_trips(ins, series, poles, jobs) == ([], gold.NO_COMMUNE_TRANSIT)


def test_08c_juge_avec_la_regle_de_l_or() -> None:
    path = Path(__file__).resolve().parents[1] / "scripts" / "08c_tour_challenge_cases.py"
    spec = importlib.util.spec_from_file_location("tour_challenge_cases", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    poles = [{"id": f"P{i}", "jobs": 100 * (i + 1)} for i in range(4)]
    tc, bt = mod.states(TC, poles, 60), mod.states(BIKE, poles, 60)
    block = mod.bike_gain_block(tc, bt, TC, BIKE, 60, [DARK, DARK, part(reached=30), DARK])
    assert [g["id"] for g in block["gained"]] == ["P1", "P3"] and block["jobs"] == 200 + 400 and block["lost"] == []
    none = mod.bike_gain_block(tc, bt, TC, BIKE, 60, None)
    assert none["gained"] is None and none["jobs"] is None and none["status"] == gold.NO_COMMUNE_TRANSIT


def test_table_publiee_alignee_sur_les_astres() -> None:
    """Sur les fichiers publiés (aucune valeur attendue écrite ici : le test tient après une nouvelle publication)."""
    table = gold.CommuneTransit.from_front(FRONT_DATA_DIR)
    if table is None:
        pytest.skip("table commune par commune non publiée dans cet arbre")
    meta = json.loads((FRONT_DATA_DIR / "meta.json").read_text(encoding="utf-8"))
    poles = json.loads((FRONT_DATA_DIR / "poles.json").read_text(encoding="utf-8"))
    communes = (meta.get("mode_coverage") or {}).get("bike_transit") or []
    if not communes:
        pytest.skip("aucune commune publiée en vélo + TC")
    insee = communes[0]
    access = json.loads((FRONT_DATA_DIR / "access" / f"{insee}.json").read_text(encoding="utf-8"))
    day, budget = meta["day_types"][1]["id"], max(meta["budgets"])
    parts = table.parts(insee, day, budget)
    assert parts is not None and len(parts) == len(poles)
    for p in parts:
        assert p["reached"] + p["not_reached"] + p["unknown"] + p["self"] == p["jobs"]
    gained, _ = gold.gold_delta(access["modes"]["transit"][day], access["modes"]["bike_transit"][day], budget, parts)
    assert gained is not None
    assert all(parts[i]["reached"] == 0 and parts[i]["unknown"] == 0 for i in gained)
    assert table.parts("00000", day, budget) is None and table.parts(insee, "d99", budget) is None
