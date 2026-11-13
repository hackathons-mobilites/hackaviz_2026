"""Jointures et mesures des sources candidates du panneau de preuve."""

import math

import pandas as pd

from starway.panel_sources import gtfs_route_to_id_line, gtfs_stop_point_id, value_shares


def test_route_to_id_line():
    assert gtfs_route_to_id_line("IDFM:C01742") == "C01742"
    assert gtfs_route_to_id_line("IDFM:TN:C01742") is None
    assert gtfs_route_to_id_line("C01742") is None
    assert gtfs_route_to_id_line(None) is None  # type: ignore[arg-type]


def test_stop_point_id():
    assert gtfs_stop_point_id("stop_point:IDFM:monomodalStopPlace:47915") == "IDFM:monomodalStopPlace:47915"
    assert gtfs_stop_point_id("IDFM:47915") is None


def test_value_shares_counts_empty_as_not_filled():
    s = pd.Series(["1", "2", "0", None, "", "1"])
    out = value_shares(s, {"1", "2"})
    assert out["n"] == 6 and out["filled"] == 3
    assert math.isclose(out["share_filled"], 0.5)
    assert out["value_empty"] == 2 and out["value_1"] == 2


def test_value_shares_empty_series():
    out = value_shares(pd.Series([], dtype=str), {"1"})
    assert out["n"] == 0 and math.isnan(out["share_filled"])
