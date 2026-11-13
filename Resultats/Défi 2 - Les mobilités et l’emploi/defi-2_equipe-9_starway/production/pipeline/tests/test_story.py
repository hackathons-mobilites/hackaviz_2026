"""Candidats du récit : classements reproductibles (FIXTURE DE TEST synthétique, jamais exportée)."""

from __future__ import annotations

import pandas as pd

from starway.story import Cell, cells_from_matrix, eclipse_rows, pair_rows, quantile_class

JOBS = [1000, 200, 50]
BUDGETS = [30, 45, 60]
NAMES = ["P1", "P2", "P3"]


def test_cells_from_matrix_keeps_pole_order_and_nulls() -> None:
    m = pd.DataFrame({"from_id": ["A", "A"], "to_id": ["P2", "P1"], "out": [40, None], "ret": [41, None]})
    c = cells_from_matrix(m, ["P1", "P2", "P3"])["A"]
    assert c.out == [None, 40, None] and c.ret == [None, 41, None]


def test_eclipse_rows_names_the_failing_leg() -> None:
    cells = {"A": {"d09": Cell([20, 40, 50], [20, 40, 50]), "d06": Cell([20, 70, 50], [20, 40, 50]),
                   "d14": Cell([20, 40, 50], [20, 40, 90])},
             "B": {"d09": Cell([20, 20, 20], [20, 20, 20]), "d06": Cell([20, 20, 20], [20, 20, 20])}}
    df = eclipse_rows(cells, JOBS, BUDGETS, NAMES)
    assert list(df["insee"]) == ["A", "A"]  # B : aucune perte, absente
    d06 = df[df["day"] == "d06"].iloc[0]
    assert d06["jobs_lost"] == 200 and d06["poles_off"] == "P2 (aller)" and bool(d06["robust"])
    d14 = df[df["day"] == "d14"].iloc[0]
    assert d14["poles_off"] == "P3 (retour)" and d14["budget"] == 60 and not d14["robust"]


def test_quantile_class_uses_ranks() -> None:
    s = pd.Series([10, 20, 30, 40])
    assert list(quantile_class(s, 2)) == [1, 1, 2, 2]
    assert quantile_class(s, 4).max() == 4 and quantile_class(s, 4).min() == 1


def test_pairs_only_within_same_population_and_distance_class() -> None:
    cells = {"A": Cell([20, 20, 20], [20, 20, 20]), "B": Cell([50, 50, 50], [50, 50, 50]),
             "C": Cell([None] * 3, [None] * 3), "D": Cell([20, 20, 20], [20, 20, 20])}
    info = pd.DataFrame({"insee": ["A", "B", "C", "D"], "population": [100, 110, 5000, 5100],
                         "dist_km": [10.0, 11.0, 50.0, 51.0]})
    df = pair_rows(cells, info, JOBS, BUDGETS, n_classes=2)
    assert set(map(tuple, df[["o", "vs"]].values)) == {("B", "A"), ("C", "D")}  # jamais A avec C ou D
    ba = df[df["o"] == "B"].iloc[0]
    assert ba["jobs_gap"] == 1250 and bool(ba["robust"]) and ba["budget"] == 30


def test_unmeasured_return_flags_eclipse_and_pair_rows() -> None:
    from starway.story import relies_on

    # pôle 0 : aller 20 min, retour nul non mesuré à 22h ; perdu par rapport à 9h-17h
    ref = Cell([20, 20, 20], [20, 20, 20])
    day = Cell([20, 20, 20], [None, 20, 20], frozenset({0}))
    assert relies_on(day, 30) and not relies_on(Cell([40, 20, 20], [None, 20, 20], frozenset({0})), 30)
    df = eclipse_rows({"A": {"d09": ref, "d14": day}}, JOBS, BUDGETS, NAMES)
    assert df["unmeasured"].tolist() == [True]
    m = pd.DataFrame({"from_id": ["A", "A"], "to_id": ["p1", "p2"], "out": [20, None], "ret": [None, None]})
    assert cells_from_matrix(m, ["p1", "p2"], ["A"])["A"].unmeasured == frozenset({0})
    assert cells_from_matrix(m, ["p1", "p2"])["A"].unmeasured == frozenset()
