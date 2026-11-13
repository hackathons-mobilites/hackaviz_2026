"""Tableau ancien et nouveau des découvertes : valeurs recopiées, rien d'interprété."""

from __future__ import annotations

import pytest

from starway import compare_published as cp


def item(iid: str, jobs: int | None, rank: int = 1, robust: bool = True) -> dict:
    return {"id": iid, "kind": "eclipse", "scenario": {"o": "78358", "d": "d14", "b": 60, "m": "transit", "vs": None,
                                                       "compare_day": "d09"},
            "metric": {"jobs": jobs, "jobs_ref": 2000, "jobs_delta": None if jobs is None else jobs - 2000, "poles_delta": -1},
            "rank": rank, "robust": robust}


def test_identical_and_changed_values_are_marked_and_copied() -> None:
    rows = cp.compare([item("a", 1000), item("b", 1500)], [item("a", 1000), item("b", 1700, rank=2)])
    by = {(r["id"], r["indicateur"]): r for r in rows}
    assert by[("a", "jobs")]["état"] == "identique"
    assert (by[("b", "jobs")]["ancien"], by[("b", "jobs")]["nouveau"], by[("b", "jobs")]["état"]) == ("1 500", "1 700", "change")
    assert by[("b", "rank")]["état"] == "change"


def test_a_missing_discovery_is_listed_not_dropped() -> None:
    rows = cp.compare([item("a", 1000), item("old_only", 5)], [item("a", 1000), item("new_only", 7)])
    states = {(r["id"], r["indicateur"]): (r["ancien"], r["nouveau"]) for r in rows if r["indicateur"] == "jobs"}
    assert states[("old_only", "jobs")] == ("5", "absente") and states[("new_only", "jobs")] == ("absente", "7")


def test_a_null_value_stays_null() -> None:
    (row,) = [r for r in cp.compare([item("a", None)], [item("a", None)]) if r["indicateur"] == "jobs"]
    assert (row["ancien"], row["nouveau"]) == ("null", "null")


def test_duplicate_ids_are_refused_and_the_markdown_counts_changes() -> None:
    with pytest.raises(ValueError):
        cp.compare([item("a", 1), item("a", 2)], [])
    text = cp.markdown(cp.compare([item("a", 1000)], [item("a", 1001)]))
    assert text.startswith("| id | type |") and "lignes comparées" in text and "valeurs recopiées" in text
