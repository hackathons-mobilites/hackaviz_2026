"""Tests des chiffres du pitch : règle d'allumage, alignement sur poles.json, valeurs d'un jeu minimal."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from starway import pitch_figures as pf

POLES = [
    {"id": "A", "jobs": 100},
    {"id": "B", "jobs": 200},
    {"id": "C", "jobs": 400},
]


def test_lit_exige_aller_et_retour_dans_le_temps() -> None:
    s = {"out": [30, 30, None], "ret": [30, 61, 10]}
    assert pf.lit_poles(s, 60) == [True, False, False]


def test_reach_refuse_un_jeu_non_aligne() -> None:
    with pytest.raises(ValueError):
        pf.reach(POLES, [True, False])


def test_scenario_somme_des_postes() -> None:
    access = {"modes": {"transit": {"d09": {"out": [10, 10, 10], "ret": [10, 10, 99]}}}}
    r = pf.scenario(POLES, access, "transit", "d09", 60)
    assert (r["poles"], r["jobs"], r["ids"]) == (2, 300, ["A", "B"])


def _write(tmp: Path) -> None:
    (tmp / "access").mkdir()
    (tmp / "poles.json").write_text(json.dumps(POLES), encoding="utf-8")
    (tmp / "meta.json").write_text(json.dumps({"processing_version": "t", "access_communes": ["1", "2"]}), encoding="utf-8")
    a = {"modes": {
        "transit": {"d09": {"out": [10, 10, 10], "ret": [10, 10, 10]}, "d14": {"out": [10, 99, 99], "ret": [10, 99, 99]}},
        "bike_transit": {"d14": {"out": [10, 10, 99], "ret": [10, 10, 99]}},
    }}
    b = {"modes": {"transit": {"d09": {"out": [10, 99, 99], "ret": [10, 99, 99]}}}}
    (tmp / "access" / "1.json").write_text(json.dumps(a), encoding="utf-8")
    (tmp / "access" / "2.json").write_text(json.dumps(b), encoding="utf-8")


def test_figures_eclipse_et_gain(tmp_path: Path) -> None:
    _write(tmp_path)
    dark = [{"reached": 0, "unknown": 0, "not_reached": 1}] * 3
    f = pf.figures(tmp_path, "1", "2", 60, commune_parts=lambda o, d, b: dark)
    assert f["poles_in_sky"] == 3 and f["communes"] == 2
    assert f["eclipse"] == {"poles_delta": -2, "jobs_delta": -600}
    assert f["gain_bike_transit_d14"] == {"poles_gained": 1, "jobs_gained": 200, "ids": ["B"], "poles_lost": 0}
    md = pf.to_markdown(f)
    assert "| Montesson, 9h-17h, transports en commun | 1 | 100 |" in md
    assert "\u2014" not in md and "\u2013" not in md


def test_gain_exclut_un_astre_deja_eclaire_commune_par_commune(tmp_path: Path) -> None:
    _write(tmp_path)
    lit_b = [{"reached": 0, "unknown": 0, "not_reached": 1}, {"reached": 50, "unknown": 0, "not_reached": 150},
             {"reached": 0, "unknown": 0, "not_reached": 1}]
    g = pf.figures(tmp_path, "1", "2", 60, commune_parts=lambda o, d, b: lit_b)["gain_bike_transit_d14"]
    assert g == {"poles_gained": 0, "jobs_gained": 0, "ids": [], "poles_lost": 0}


def test_gain_non_calculable_sans_table_commune_par_commune(tmp_path: Path) -> None:
    _write(tmp_path)  # meta.json sans walk_settings : pas de table publiée
    f = pf.figures(tmp_path, "1", "2", 60)
    g = f["gain_bike_transit_d14"]
    assert g["status"] == "no_commune_transit" and g["poles_gained"] is None and g["ids"] is None
    assert "non calculable" in pf.to_markdown(f)
