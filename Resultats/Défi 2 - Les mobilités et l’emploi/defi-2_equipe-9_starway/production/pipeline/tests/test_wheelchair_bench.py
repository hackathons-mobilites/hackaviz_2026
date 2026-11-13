"""Tests sans Java du banc fauteuil (04l) : comparaison sans / avec `wheelchair` et estimation du calcul complet."""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "04l_wheelchair_bench.py"


def load():
    spec = importlib.util.spec_from_file_location("wheelchair_bench", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def rec(dep_s: int | None, arr_s: int | None) -> dict:
    return {"option": None if dep_s is None else {"dep_s": dep_s, "arr_s": arr_s, "legs": []}}


def test_compare_runs_counts_each_case_and_median() -> None:
    m = load()
    base = [rec(0, 1800), rec(0, 1800), rec(0, 1800), rec(None, None), rec(None, None)]
    wheel = [rec(0, 1800), rec(0, 2400), rec(None, None), rec(0, 3000), rec(None, None)]
    c = m.compare_runs(base, wheel)
    assert (c["found_both"], c["found_without_wheelchair_only"], c["found_with_wheelchair_only"], c["found_neither"]) == (
        2, 1, 1, 1)
    assert c["median_delta_min_when_both"] == 5.0  # écarts 0 et 10 min
    assert c["identical_duration_when_both"] == 1 and c["longer_with_wheelchair"] == 1 and c["shorter_with_wheelchair"] == 0


def test_compare_runs_without_common_trip_has_no_median() -> None:
    m = load()
    c = m.compare_runs([rec(None, None)], [rec(None, None)])
    assert c["median_delta_min_when_both"] is None and c["found_neither"] == 1


def test_estimate_refuses_empty_bench_and_scales_otherwise() -> None:
    m = load()
    assert m.estimate(0.0, 1000)["hours_one_process"] is None
    assert m.estimate(1.0, 3600)["hours_one_process"] == 1.0


def test_planner_wheelchair_is_off_by_default() -> None:
    from dataclasses import fields

    from starway.transit_planner import Planner

    f = {x.name: x for x in fields(Planner)}["wheelchair"]
    assert f.default is False
