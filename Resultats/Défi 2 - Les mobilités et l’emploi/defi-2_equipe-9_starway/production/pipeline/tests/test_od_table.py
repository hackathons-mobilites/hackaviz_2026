"""Table origine-destination D-019 (proposée) : grille, aller / retour, encodage uint8, lots, estimations (sans Java).

Les durées utilisées ici sont des FIXTURES de test (synthétiques), pas des résultats r5py.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from starway import od_table as od
from starway.config import MAX_TRIP_MIN, OUTBOUND_LOOKBACK_MIN, OUTBOUND_STEP_MIN
from starway.routing import REASON_NO_TRIP, REASON_NOT_SNAPPED, latest_feasible

H = 60
NT = od.SENTINEL_NO_TRIP
NS = od.SENTINEL_NOT_SNAPPED


# --------------------------------------------------------------------------- grille
def test_parse_and_format_hhmm() -> None:
    assert od.parse_hhmm("03:00") == 180
    assert od.parse_hhmm("22:05") == 1325
    assert od.format_hhmm(365) == "06:05"
    for bad in ("3h00", "24:00", "12:60", "", "12:5"):
        with pytest.raises(ValueError):
            od.parse_hhmm(bad)


def test_departure_grid_bounds_included_and_step() -> None:
    g = od.departure_grid(3 * H, 22 * H)
    assert g[0] == 180 and g[-1] == 1320
    assert len(g) == (22 - 3) * 12 + 1 == 229
    assert set(np.diff(g)) == {OUTBOUND_STEP_MIN}
    assert len(od.departure_grid(6 * H, 6 * H)) == 1


@pytest.mark.parametrize("first,last", [(3 * H + 2, 22 * H), (3 * H, 22 * H + 1), (14 * H, 3 * H), (-5, 10),
                                         (0, 24 * H)])
def test_departure_grid_rejects_off_grid_or_reversed(first: int, last: int) -> None:
    with pytest.raises(ValueError):
        od.departure_grid(first, last)


def test_servable_starts_and_ends() -> None:
    g = od.departure_grid(3 * H, 22 * H)
    s = od.servable_starts(g)
    assert s[0] == 3 * H + OUTBOUND_LOOKBACK_MIN == 5 * H
    assert s[-1] == 22 * H + OUTBOUND_STEP_MIN
    assert od.servable_ends(g) == list(range(3 * H, 22 * H + 1, 5))
    # 03:00-14:00 : débuts de poste jusqu'à 14:05, mais aucune fin de poste après 14:00
    g2 = od.departure_grid(3 * H, 14 * H)
    assert od.servable_starts(g2)[-1] == 14 * H + 5
    assert od.servable_ends(g2)[-1] == 14 * H
    # plage plus courte que la fenêtre aller : aucun début de poste calculable
    assert od.servable_starts(od.departure_grid(6 * H, 7 * H)) == []


def test_bench_departures_spread_without_duplicates() -> None:
    g = od.departure_grid(3 * H, 22 * H)
    d = od.bench_departures(g, 3)
    assert d == [180, 750, 1320]
    assert od.bench_departures(od.departure_grid(6 * H, 6 * H + 5), 10) == [360, 365]


def test_modes_of_the_table_are_symmetric_bike_transit_is_not() -> None:
    for m in od.OD_MODES:
        assert od.symmetric_legs(m), m
    assert not od.symmetric_legs("bike_transit")


# --------------------------------------------------------------------------- encodage
def test_encode_minutes_nan_to_sentinel_and_roundtrip() -> None:
    e = od.encode_minutes([0.0, 37.0, 120.0, 122.0, np.nan])
    assert e.dtype == np.uint8
    assert e.tolist() == [0, 37, 120, 122, NT]
    assert od.decode_minutes(37) == (37, None)
    assert od.decode_minutes(0) == (0, None)
    assert od.decode_minutes(120) == (120, None)
    assert od.decode_minutes(122) == (None, REASON_NO_TRIP)  # au-delà de la borne de recherche
    assert od.decode_minutes(NT) == (None, REASON_NO_TRIP)
    assert od.decode_minutes(NS) == (None, REASON_NOT_SNAPPED)


@pytest.mark.parametrize("bad", [[-1.0], [254.0], [12.5]])
def test_encode_minutes_refuses_unstorable(bad: list[float]) -> None:
    with pytest.raises(ValueError):
        od.encode_minutes(bad)


def test_sentinels_above_any_trip() -> None:
    assert MAX_TRIP_MIN < od.MAX_STORABLE < NS < NT


def test_encode_pairs_and_unsnapped() -> None:
    idx = pd.MultiIndex.from_tuples([("A", "X"), ("A", "Y"), ("B", "X"), ("B", "Y")], names=["from_id", "to_id"])
    s = pd.Series([10.0, np.nan, 25.0, 3.0], index=idx)
    m = od.encode_pairs(s, ["A", "B", "C"], ["X", "Y", "Z"])
    assert m.tolist() == [[10, NT, NT], [25, 3, NT], [NT, NT, NT]]
    m2 = od.mark_unsnapped(m, ["A", "B", "C"], ["X", "Y", "Z"], ["C"], ["Z"])
    assert m2[2].tolist() == [NS, NS, NS]
    assert m2[:, 2].tolist() == [NS, NS, NS]
    assert m2[0, 0] == 10
    with pytest.raises(ValueError):
        od.encode_pairs(s, ["A"], ["X", "Y"])  # B inattendu


# --------------------------------------------------------------------------- aller / retour
GRID = od.departure_grid(5 * H, 10 * H)  # 05:00 .. 10:00


def series(values: dict[int, int]) -> np.ndarray:
    """TT par départ (minutes) -> vecteur aligné sur GRID, NT ailleurs."""
    v = np.full(len(GRID), NT, dtype=np.uint8)
    for dep, tt in values.items():
        v[int(np.flatnonzero(GRID == dep)[0])] = tt
    return v


def test_outbound_latest_feasible_departure() -> None:
    S = 9 * H
    tt = series({S - 60: 40, S - 45: 40, S - 30: 40})  # 8h40 ok, 8h55 ok, 9h10 trop tard
    out, dep = od.outbound_at(tt, GRID, S)
    assert int(out) == 40 and int(dep) == S - 45


def test_outbound_arrival_exactly_at_start_and_shorter_later_trip() -> None:
    S = 9 * H
    out, dep = od.outbound_at(series({S - 30: 30}), GRID, S)
    assert (int(out), int(dep)) == (30, S - 30)
    out, dep = od.outbound_at(series({S - 50: 48, S - 35: 33}), GRID, S)
    assert (int(out), int(dep)) == (33, S - 35)


def test_outbound_none_when_nothing_arrives_in_time() -> None:
    S = 9 * H
    out, dep = od.outbound_at(series({S - 20: 25, S - 10: NT}), GRID, S)
    assert int(out) == NT and int(dep) == -1


def test_outbound_ignores_departures_outside_window_and_over_max_trip() -> None:
    S = 9 * H + 30
    # départ à S - 125 (hors fenêtre de 120 min) faisable mais ignoré ; S - 100 avec 122 min : au-delà de la borne
    tt = series({S - 125: 10, S - 100: 122})
    out, dep = od.outbound_at(tt, GRID, S)
    assert int(out) == NT and int(dep) == -1
    # départ à S (pas de la fenêtre) ignoré même avec 0 min
    out, _ = od.outbound_at(series({S: 0}), GRID, S)
    assert int(out) == NT


def test_outbound_same_commune_zero_minutes_is_kept() -> None:
    S = 9 * H
    out, dep = od.outbound_at(series({S - 5: 0}), GRID, S)
    assert (int(out), int(dep)) == (0, S - 5)


def test_outbound_not_snapped_and_bounds() -> None:
    S = 9 * H
    out, _ = od.outbound_at(np.full(len(GRID), NS, dtype=np.uint8), GRID, S)
    assert int(out) == NS
    for bad in (5 * H + 115, 10 * H + 10, 9 * H + 2):  # fenêtre incomplète, après la grille, hors pas
        with pytest.raises(ValueError):
            od.outbound_at(series({}), GRID, bad)
    assert od.outbound_at(series({}), GRID, 7 * H)[0] == NT  # première heure calculable
    assert od.outbound_at(series({}), GRID, 10 * H + 5)[0] == NT  # dernière


def test_outbound_matches_latest_feasible_of_routing_on_random_series() -> None:
    rng = np.random.default_rng(19)
    tt = rng.integers(0, 130, size=(200, len(GRID))).astype(np.uint8)
    tt[rng.random(tt.shape) < 0.2] = NT
    day = datetime(2026, 11, 17)
    for S in (7 * H, 8 * H + 25, 10 * H + 5):
        out, dep = od.outbound_at(tt, GRID, S)
        for i in range(tt.shape[0]):
            window = [t for t in GRID if S - OUTBOUND_LOOKBACK_MIN <= t <= S - OUTBOUND_STEP_MIN]
            samples = {day + timedelta(minutes=int(t)): (None if tt[i, j] > MAX_TRIP_MIN else float(tt[i, j]))
                       for j, t in enumerate(GRID) if t in window}
            ref_tt, ref_dep = latest_feasible(samples, day + timedelta(minutes=S))
            if ref_tt is None:
                assert out[i] == NT and dep[i] == -1
            else:
                assert int(out[i]) == ref_tt
                assert day + timedelta(minutes=int(dep[i])) == ref_dep


def test_inbound_reads_reverse_pair_at_end() -> None:
    E = 9 * H + 30
    rev = series({E: 47, E + 5: 12})
    assert int(od.inbound_at(rev, GRID, E)) == 47  # jamais le départ suivant
    assert int(od.inbound_at(series({E: 121}), GRID, E)) == NT
    assert int(od.inbound_at(np.full(len(GRID), NS, dtype=np.uint8), GRID, E)) == NS
    with pytest.raises(ValueError):
        od.inbound_at(rev, GRID, 10 * H + 5)


def test_one_table_gives_outbound_and_return() -> None:
    # table (origines, destinations, départs) : le retour de x depuis y est l'aller de y vers x
    tt = np.full((2, 2, len(GRID)), NT, dtype=np.uint8)
    tt[0, 1] = series({8 * H + 20: 35})  # A -> B
    tt[1, 0] = series({10 * H: 50})  # B -> A au départ de 10:00
    out, _ = od.outbound_at(tt[0], GRID, 9 * H)
    ret = od.inbound_at(tt[:, 0, :], GRID, 10 * H)
    assert int(out[1]) == 35 and int(ret[1]) == 50


# --------------------------------------------------------------------------- lots et points
def test_write_read_lot_roundtrip_atomic(tmp_path: Path) -> None:
    tt = np.arange(2 * 3 * 4, dtype=np.uint8).reshape(2, 3, 4)
    p = od.lot_path(tmp_path, "transit", 0)
    od.write_lot(p, tt, ["75101", "75102"], ["75101", "75102", "77001"], [180, 185, 190, 195])
    assert p.exists() and not p.with_suffix(".part").exists()
    lot = od.read_lot(p)
    assert lot.tt.dtype == np.uint8 and np.array_equal(lot.tt, tt)
    assert lot.from_ids == ["75101", "75102"] and lot.to_ids[-1] == "77001"
    assert lot.departures.tolist() == [180, 185, 190, 195]
    with pytest.raises(ValueError):
        od.write_lot(p, tt, ["75101"], ["75101"], [180])


def test_batches_are_deterministic() -> None:
    assert od.batches_of(["3", "1", "2"], 2) == [["1", "2"], ["3"]]


def test_destination_points_and_hash() -> None:
    c = pd.DataFrame({"insee": ["77001", "75101"], "origin_lon": [2.7, 2.34], "origin_lat": [48.4, 48.86]})
    d = od.destination_points(c)
    assert d["id"].tolist() == ["75101", "77001"] and list(d.columns) == ["id", "lon", "lat"]
    h = od.points_sha256(d)
    moved = d.assign(lon=d["lon"] + 1e-5)
    assert od.points_sha256(moved) != h
    with pytest.raises(ValueError):
        od.destination_points(c.assign(origin_lon=[np.nan, 2.0]))


def test_params_diff() -> None:
    assert od.params_diff({"a": 1}, {"a": 1}) == {}
    assert od.params_diff({"a": 1}, {"a": 2, "b": 3}) == {"a": (1, 2), "b": (None, 3)}


# --------------------------------------------------------------------------- estimation depuis run_log de 04
def test_rates_from_04_use_latest_entry_and_count_searches() -> None:
    entries = [
        {"batch": 0, "mode": "transit", "day": "d06", "origins": 100, "seconds": 9999.0},  # ancienne relance
        {"batch": 0, "mode": "transit", "day": "d06", "origins": 100, "seconds": 2415.0},
        {"batch": 0, "mode": "transit", "day": "d09", "origins": 100, "seconds": 4830.0},
        {"batch": 0, "mode": "car", "day": "any", "origins": 100, "seconds": 230.0},
    ]
    r = od.rates_from_04(entries, n_poles=15, n_out_departures=24)
    assert r["transit"][0] == pytest.approx((2415 / 2415 + 4830 / 2415) / 2)
    assert r["car"][0] == pytest.approx(230 / 115)
    est = od.estimate_mode("transit", [100, 50], 229, r["transit"], same_lots=True)
    mean = r["transit"][0]
    assert est.seconds_per_departure_by_lot == pytest.approx([mean * 100, mean * 50])
    assert est.seconds == pytest.approx(mean * 150 * 229)


# --------------------------------------------------------------------------- volume d'export
def test_publication_times() -> None:
    s = list(range(5 * H, 6 * H + 1, 5))
    assert od.publication_times(s, 30) == [300, 330, 360]
    assert len(od.publication_times(s, 5)) == 13
    with pytest.raises(ValueError):
        od.publication_times(s, 7)


def test_commune_export_volume_measured_on_synthetic_table() -> None:
    rng = np.random.default_rng(3)
    n_dest = 40
    tt_from = rng.integers(0, 121, size=(n_dest, len(GRID))).astype(np.uint8)
    tt_to = rng.integers(0, 121, size=(n_dest, len(GRID))).astype(np.uint8)
    tt_to[:5] = NT
    starts = od.servable_starts(GRID)
    ends = od.servable_ends(GRID)
    v5 = od.commune_export_volume(tt_from, tt_to, GRID, od.publication_times(starts, 5),
                                  od.publication_times(ends, 5))
    v30 = od.commune_export_volume(tt_from, tt_to, GRID, od.publication_times(starts, 30),
                                   od.publication_times(ends, 30))
    assert v5["n_values"] == n_dest * (v5["n_starts"] + v5["n_ends"])
    assert v30["raw_bytes"] < v5["raw_bytes"]
    assert v5["raw_bytes"] <= od.json_upper_bound(v5["n_values"]) + 20 * (v5["n_starts"] + v5["n_ends"]) + 20
    assert 0 < v5["gzip_bytes"] < v5["raw_bytes"]


def test_payload_uses_null_never_zero_for_missing() -> None:
    p = od.export_payload({9 * H: np.array([NT, 12, NS], dtype=np.uint8)}, {17 * H: np.array([0], dtype=np.uint8)})
    assert p == {"out": {"09:00": [None, 12, None]}, "ret": {"17:00": [0]}}


def test_json_upper_bound() -> None:
    assert od.json_upper_bound(10) == 50  # 'null,' ou '120,' : 5 octets au plus


# --------------------------------------------------------------------------- pas de Java
def test_od_table_does_not_import_r5py_or_java() -> None:
    code = "import sys, starway.od_table; print(any(m in sys.modules for m in ('r5py', 'jpype', '_jpype')))"
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert r.stdout.strip() == "False"
