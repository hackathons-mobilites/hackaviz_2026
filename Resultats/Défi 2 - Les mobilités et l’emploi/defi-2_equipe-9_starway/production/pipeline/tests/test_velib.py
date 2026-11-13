"""Mode Vélib' V1 (D-027) : combinaison min-plus exacte (sans Java)."""

import itertools
import json
from pathlib import Path

import numpy as np
import pytest

from starway.velib import INF, cap_minutes, minplus, read_stations, velib_times


def brute(walk_in, bike, walk_out):
    n_o, n_s = walk_in.shape
    n_p = walk_out.shape[1]
    t = np.full((n_o, n_p), INF)
    for o, p in itertools.product(range(n_o), range(n_p)):
        for s1, s2 in itertools.product(range(n_s), range(n_s)):
            if s1 != s2:
                t[o, p] = min(t[o, p], walk_in[o, s1] + bike[s1, s2] + walk_out[s2, p])
    return t


def test_minplus_and_argmin():
    a = np.array([[1.0, 5.0], [INF, 2.0]])
    b = np.array([[10.0, 1.0], [1.0, INF]])
    c, arg = minplus(a, b)
    assert c.tolist() == [[6.0, 2.0], [3.0, INF]]
    assert arg.tolist() == [[1, 0], [1, -1]]


@pytest.mark.parametrize("shape", [(3, 4, 2), (2, 4, 5)])  # les deux ordres de calcul
def test_velib_times_matches_brute_force(shape):
    rng = np.random.default_rng(1)
    n_o, n_s, n_p = shape
    walk_in = rng.integers(1, 30, (n_o, n_s)).astype(float)
    bike = rng.integers(1, 30, (n_s, n_s)).astype(float)
    walk_out = rng.integers(1, 30, (n_s, n_p)).astype(float)
    walk_in[0, 1] = INF
    bike[2, 3] = INF
    r = velib_times(walk_in, bike, walk_out)
    assert np.array_equal(r["time"], brute(walk_in, bike, walk_out))
    for o, p in itertools.product(range(n_o), range(n_p)):
        s1, s2 = r["s1"][o, p], r["s2"][o, p]
        assert s1 != s2
        assert walk_in[o, s1] + bike[s1, s2] + walk_out[s2, p] == r["time"][o, p]


def test_same_station_is_not_a_velib_trip():
    walk_in = np.array([[1.0, 50.0]])
    bike = np.array([[0.0, 1.0], [1.0, 0.0]])  # diagonale 0 (même point) : exclue
    walk_out = np.array([[1.0], [50.0]])
    r = velib_times(walk_in, bike, walk_out)
    assert r["time"][0, 0] == 52.0  # 1 + 1 + 50, pas 1 + 0 + 1
    assert (r["s1"][0, 0], r["s2"][0, 0]) == (0, 1)


def test_no_path_gives_minus_one():
    r = velib_times(np.array([[INF, INF]]), np.array([[0.0, 1.0], [1.0, 0.0]]), np.array([[1.0], [1.0]]))
    assert r["time"][0, 0] == INF
    assert (r["s1"][0, 0], r["s2"][0, 0]) == (-1, -1)


def test_cap_minutes():
    assert np.array_equal(cap_minutes(np.array([30.0, 120.0, 121.0, INF]), 120), np.array([30.0, 120.0, np.nan, np.nan]),
                          equal_nan=True)


def test_read_stations(tmp_path: Path):
    f = tmp_path / "s.json"
    f.write_text(json.dumps({"data": {"stations": [
        {"station_id": 2, "stationCode": "16107", "name": "B", "lat": 48.86, "lon": 2.27, "capacity": 35},
        {"station_id": 1, "stationCode": "1026", "name": "A", "lat": 48.85, "lon": 2.34, "capacity": 20}]}}),
        encoding="utf-8")
    st = read_stations(f)
    assert st["id"].tolist() == ["1026", "16107"]


def test_ids_must_be_disjoint_because_r5py_zeroes_same_ids():
    from starway.velib import STATION_PREFIX, check_disjoint_ids

    with pytest.raises(ValueError):
        check_disjoint_ids(["92007", "75101"], ["92007"], ["P_DEFENSE"])  # stationCode = code INSEE
    check_disjoint_ids(["92007"], [STATION_PREFIX + "92007"], ["P_DEFENSE"])
