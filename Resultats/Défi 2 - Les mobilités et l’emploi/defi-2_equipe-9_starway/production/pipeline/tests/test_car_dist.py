"""Distances routières voiture (04g) : couples, synthèse des itinéraires, recoupement, estimation (sans Java).

Les distances et durées ci-dessous sont des FIXTURES de test (synthétiques), pas des résultats r5py.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import timedelta

import pandas as pd
import pytest

from starway import car_dist as cd
from starway.config import PIPELINE_DIR

COMMUNES = pd.DataFrame({"insee": ["75101", "78358"], "x": [2.34, 2.15], "y": [48.86, 48.95]})
POLES = pd.DataFrame({"id": ["P_A", "P_B"], "lon": [2.33, 2.24], "lat": [48.88, 48.89]})


def test_pair_frames_are_aligned_and_unique() -> None:
    o, d = cd.pair_frames(["75101", "78358"], COMMUNES, POLES, "x", "y")
    assert len(o) == len(d) == 2 * 2 * 2
    assert o["id"].is_unique and (o["id"] == d["id"]).all()
    first = o.iloc[0]
    assert first["id"] == "75101|P_A|out" and (first["lon"], first["lat"]) == (2.34, 48.86)
    assert (d.iloc[0]["lon"], d.iloc[0]["lat"]) == (2.33, 48.88)
    back = o[o["id"] == "75101|P_A|ret"].iloc[0]  # retour : départ du pôle
    assert (back["lon"], back["lat"]) == (2.33, 48.88)


def test_pair_id_round_trip_and_bad_direction() -> None:
    assert cd.split_pair_id(cd.pair_id("75101", "P_A", "ret")) == ("75101", "P_A", "ret")
    with pytest.raises(ValueError):
        cd.pair_id("75101", "P_A", "aller")


def test_summarize_sums_segments_and_marks_missing() -> None:
    det = pd.DataFrame({"from_id": ["75101|P_A|out", "75101|P_A|out", "75101|P_A|out"],
                        "to_id": ["75101|P_A|out"] * 3, "option": [0, 0, 1],
                        "distance": [1200.4, 800.0, 99999.0],
                        "travel_time": [timedelta(seconds=100), timedelta(seconds=50), timedelta(seconds=9)]})
    ids = ["75101|P_A|out", "75101|P_A|ret", "78358|P_A|out"]
    s = cd.summarize_itineraries(det, ids, unsnapped=["78358|P_A|out"]).set_index(["insee", "pole_id", "direction"])
    assert s.loc[("75101", "P_A", "out"), "distance_m"] == 2000  # option 1 ignorée
    assert s.loc[("75101", "P_A", "out"), "duration_s"] == 150
    assert s.loc[("75101", "P_A", "ret"), "reason"] == cd.REASON_NO_ROUTE
    assert pd.isna(s.loc[("75101", "P_A", "ret"), "distance_m"])  # jamais 0
    assert s.loc[("78358", "P_A", "out"), "reason"] == cd.REASON_NOT_SNAPPED


def test_summarize_refuses_all_to_all_output() -> None:
    det = pd.DataFrame({"from_id": ["a|P_A|out"], "to_id": ["b|P_A|out"], "option": [0], "distance": [1.0],
                        "travel_time": [timedelta(seconds=1)]})
    with pytest.raises(ValueError, match="un pour un"):
        cd.summarize_itineraries(det, ["a|P_A|out"])


def test_compare_minutes() -> None:
    dist = pd.DataFrame({"insee": ["75101", "75101"], "pole_id": ["P_A", "P_A"], "direction": ["out", "ret"],
                         "distance_m": [2000, 2100], "duration_s": [600, 630], "reason": [None, None]})
    matrix = pd.DataFrame({"from_id": ["75101"], "to_id": ["P_A"], "out": [10], "ret": [11]})
    r = cd.compare_minutes(dist, matrix)
    assert r["pairs"] == 2 and r["diff_min_median"] == pytest.approx(0.25)
    assert r["abs_diff_le_1_min_share"] == 1.0


def test_estimate_hours() -> None:
    assert cd.estimate_hours(360, 100, 38550) == pytest.approx(38.55)
    with pytest.raises(ValueError):
        cd.estimate_hours(0, 100, 10)


def test_dry_run_without_java() -> None:
    r = subprocess.run([sys.executable, str(PIPELINE_DIR / "scripts" / "04g_car_distances.py"), "--dry-run"],
                       check=False, capture_output=True, text=True, encoding="utf-8", cwd=PIPELINE_DIR, timeout=300)
    assert r.returncode == 0, r.stderr
    assert "1285 communes x 15 pôles x 2 sens = 38550 itinéraires" in r.stdout
