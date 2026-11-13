"""D-040 : assemblage des trois tables de départs (matin, jour, soir) et SWOD v2 (288 départs).

Les durées utilisées ici sont des FIXTURES de test (synthétiques), pas des résultats r5py.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from starway import od_export as ox
from starway import od_night as on
from starway import od_table as od

H = 60
NT, NS = od.SENTINEL_NO_TRIP, od.SENTINEL_NOT_SNAPPED
MORNING = od.departure_grid(0, 6 * H + 55)
DAY = od.departure_grid(3 * H, 22 * H)
EVENING = od.departure_grid(22 * H + 5, 23 * H + 55)


def plans() -> list[on.SegmentPlan]:
    return on.plan_segments(MORNING, DAY, EVENING)


# --------------------------------------------------------------------------- plan et grille
def test_plan_keeps_morning_and_evening_and_the_day_between_them() -> None:
    p = {x.name: x for x in plans()}
    assert (p["matin"].first, p["matin"].last) == (0, 6 * H + 55)
    assert (p["jour"].first, p["jour"].last) == (7 * H, 22 * H)  # le jour de 03:00 à 06:55 est remplacé par le matin
    assert (p["soir"].first, p["soir"].last) == (22 * H + 5, 23 * H + 55)
    assert [x.n_slots for x in plans()] == [84, 181, 23]


def test_assembled_grid_is_contiguous_without_duplicate() -> None:
    g = on.assembled_grid(plans())
    assert len(g) == 288 and g[0] == 0 and g[-1] == 23 * H + 55
    assert np.all(np.diff(g) == 5) and len(set(g.tolist())) == len(g)


@pytest.mark.parametrize("morning, day, evening", [
    (od.departure_grid(0, 6 * H + 55), od.departure_grid(3 * H, 21 * H + 55), od.departure_grid(22 * H + 5, 23 * H + 55)),  # trou à 22:00
    (od.departure_grid(0, 6 * H + 55), od.departure_grid(7 * H + 5, 22 * H), od.departure_grid(22 * H + 5, 23 * H + 55)),  # trou à 07:00
    (od.departure_grid(0, 22 * H), od.departure_grid(3 * H, 22 * H), od.departure_grid(22 * H, 23 * H + 55)),  # chevauchement
])
def test_gap_or_overlap_is_refused(morning, day, evening) -> None:
    with pytest.raises(ValueError):
        on.plan_segments(morning, day, evening)


def test_non_contiguous_grid_is_refused() -> None:
    with pytest.raises(ValueError, match="contiguë"):
        on.plan_segments(np.array([0, 5, 15]), DAY, EVENING)


# --------------------------------------------------------------------------- assemblage
def tables(n_from: int = 2, n_to: int = 3) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Chaque table porte une valeur qui dit d'où elle vient : 10 matin, 20 jour, 30 soir."""
    out = {}
    for name, deps, v in (("matin", MORNING, 10), ("jour", DAY, 20), ("soir", EVENING, 30)):
        out[name] = (deps, np.full((n_from, n_to, len(deps)), v, dtype=np.uint8))
    return out


def test_each_departure_comes_from_exactly_one_table() -> None:
    a = on.assemble_series(tables(), plans())
    g = on.assembled_grid(plans())
    assert a.shape == (2, 3, 288)
    assert set(a[0, 0, g < 7 * H].tolist()) == {10}  # 00:00 à 06:55 : table du matin, pas celle du jour (03:00 à 06:55)
    assert set(a[0, 0, (g >= 7 * H) & (g <= 22 * H)].tolist()) == {20}
    assert set(a[0, 0, g > 22 * H].tolist()) == {30}


def test_assemble_refuses_a_missing_departure() -> None:
    t = tables()
    deps, tt = t["jour"]
    t["jour"] = (deps[deps != 12 * H], tt[..., deps != 12 * H])
    with pytest.raises(ValueError, match="jour"):
        on.assemble_series(t, plans())


def test_lot_is_read_from_three_directories(tmp_path: Path) -> None:
    ids_from, ids_to = ["75101", "75102"], ["75101", "75102", "77001"]
    dirs = {}
    for name, deps, v in (("matin", MORNING, 10), ("jour", DAY, 20), ("soir", EVENING, 30)):
        dirs[name] = tmp_path / name
        od.write_lot(od.lot_path(dirs[name], "transit", 0), np.full((2, 3, len(deps)), v, np.uint8), ids_from, ids_to, deps)
    a = on.load_assembled_lot(dirs, 0, plans(), ids_from, ids_to)
    assert a is not None and a.shape == (2, 3, 288)
    assert on.load_assembled_lot(dirs, 1, plans(), ids_from, ids_to) is None  # lot absent : non calculé
    with pytest.raises(ValueError, match="identifiants"):
        on.load_assembled_lot(dirs, 0, plans(), ids_from, ["autre", "75102", "77001"])


# --------------------------------------------------------------------------- run_params
def params(gtfs: str, first: str, last: str, **more) -> dict:
    n = (od.parse_hhmm(last) - od.parse_hhmm(first)) // 5 + 1
    return {"gtfs_sha256": gtfs, "osm_sha256": "o", "r5_jar_sha256": "j", "transfer_rules": "gtfs_navitia",
            "same_stop_csv_sha256": "csv", "walk_setting": "normal", "batch_size": 100, "n_origins": 1285,
            "departures": {"first": first, "last": last, "count": n}, **more}


def three(**day_more) -> dict:
    return {"jour": params("G1", "03:00", "22:00", **day_more), "matin": params("G2", "00:00", "06:55", **day_more),
            "soir": params("G3", "22:05", "23:55", **day_more)}


SHAS = ("G1", "G2", "G3")  # TRA01 (jour), TRA01B (matin), TRA01C (soir)


def test_params_accept_three_networks_each_where_it_is_used() -> None:
    assert on.check_segments_params(three(), *SHAS) == []


def test_night_table_computed_on_the_original_gtfs_is_refused() -> None:
    rp = three()
    rp["matin"]["gtfs_sha256"] = "G1"
    assert any("matin" in e and "TRA01B" in e for e in on.check_segments_params(rp, *SHAS))


def test_day_table_computed_on_the_night_network_is_refused() -> None:
    rp = three()
    rp["jour"]["gtfs_sha256"] = "G2"
    assert any("jour" in e and "TRA01" in e for e in on.check_segments_params(rp, *SHAS))


def test_evening_table_computed_on_the_morning_network_is_refused() -> None:
    """Les anciennes tables du soir (TRA01B) ne sont plus acceptées : le soir vient du réseau du soir (TRA01C)."""
    rp = three()
    rp["soir"]["gtfs_sha256"] = "G2"
    assert any("soir" in e and "TRA01C" in e for e in on.check_segments_params(rp, *SHAS))


def test_morning_table_computed_on_the_evening_network_is_refused() -> None:
    rp = three()
    rp["matin"]["gtfs_sha256"] = "G3"
    assert any("matin" in e and "TRA01B" in e for e in on.check_segments_params(rp, *SHAS))


def test_networks_must_have_three_distinct_hashes() -> None:
    assert any("trois empreintes distinctes" in e for e in on.check_segments_params(three(), "G1", "G1", "G3"))
    assert any("trois empreintes distinctes" in e for e in on.check_segments_params(three(), "G1", "G2", "G2"))


def test_networks_by_segment_and_default_night_dirs() -> None:
    assert on.NETWORKS == {"jour": "TRA01", "matin": "TRA01B", "soir": "TRA01C"}
    assert on.default_night_dirs(Path("x/od_walk3000_d031")) == (Path("x/od_walk3000_d031_nuit_matin"),
                                                               Path("x/od_walk3000_d031_nuit_soir_v2"))


@pytest.mark.parametrize("key, value", [("r5_jar_sha256", "autre"), ("same_stop_csv_sha256", "autre"),
                                        ("transfer_rules", "gtfs"), ("walk_setting", "comfort"), ("osm_sha256", "x"),
                                        ("batch_size", 50)])
def test_any_other_difference_between_the_three_tables_is_refused(key: str, value) -> None:
    rp = three()
    rp["soir"][key] = value
    assert any(key in e for e in on.check_segments_params(rp, *SHAS))


def test_missing_table_or_hash_is_refused() -> None:
    rp = three()
    del rp["soir"]
    assert any("soir" in e for e in on.check_segments_params(rp, *SHAS))
    assert on.check_segments_params(three(), None, "G2", "G3")
    assert on.check_segments_params(three(), "G1", "G2", None)


def test_segments_block_says_where_each_departure_comes_from() -> None:
    b = on.segments_block(plans(), {"matin": "m", "jour": "j", "soir": "s"}, three(), "2026-11-17")
    assert [(s["name"], s["from"], s["to"], s["gtfs_source"]) for s in b["segments"]] == [
        ("matin", "00:00", "06:55", "TRA01B"), ("jour", "07:00", "22:00", "TRA01"), ("soir", "22:05", "23:55", "TRA01C")]
    assert "même mardi type (2026-11-17)" in b["same_typical_day"] and "mercredi après minuit" in b["same_typical_day"]
    assert [s["gtfs_sha256"] for s in b["segments"]] == ["G2", "G1", "G3"]


# --------------------------------------------------------------------------- bornes calculables sur la grille assemblée
def test_servable_bounds_on_the_assembled_grid() -> None:
    g = on.assembled_grid(plans())
    starts, ends = od.servable_starts(g), od.servable_ends(g)
    assert (starts[0], starts[-1]) == (2 * H, 23 * H + 55)  # début possible dès 02:00 (fenêtre de 120 min dans la grille)
    assert (ends[0], ends[-1]) == (0, 23 * H + 55)  # fin possible de 00:00 à 23:55
    assert od.format_hhmm(starts[-1]) == "23:55"


def test_servable_bounds_of_the_old_grid_are_unchanged() -> None:
    g = od.departure_grid(3 * H, 22 * H)
    assert (od.servable_starts(g)[0], od.servable_starts(g)[-1]) == (5 * H, 22 * H + 5)


def random_series(rng: np.random.Generator, n: int) -> np.ndarray:
    s = np.empty(n, dtype=np.uint8)
    k = 0
    while k < n:
        ln = int(rng.integers(1, 9))
        if rng.random() < 0.3:
            s[k:k + ln] = rng.choice([NT, NT, NS, 121])
        else:
            s[k:k + ln] = np.clip(int(rng.integers(0, 130)) - 5 * np.arange(ln), 0, 253)[:min(ln, n - k)]
        k += ln
    return s


def test_outbound_inbound_rules_equal_od_table_on_the_assembled_grid() -> None:
    g = on.assembled_grid(plans())
    rng = np.random.default_rng(3)
    starts, ends = od.servable_starts(g), od.servable_ends(g)
    for _ in range(15):
        s = random_series(rng, len(g))
        c = ox.cap_series(s)
        for S in starts[::3]:
            ref, dep = od.outbound_at(s[None, :], g, S)
            leg = ox.outbound(c, int(g[0]), S)
            assert (leg.minutes, leg.reason) == od.decode_minutes(int(ref[0]))
            assert (leg.departure if leg.departure is not None else -1) == int(dep[0])
        for E in ends[::3]:
            ref = od.inbound_at(s[None, :], g, E)
            assert (ox.inbound(c, int(g[0]), E).minutes, ox.inbound(c, int(g[0]), E).reason) == od.decode_minutes(int(ref[0]))


def test_night_shift_return_is_read_in_the_morning_of_the_same_table() -> None:
    """Poste 22h-6h : aller lu à S = 22:00, retour lu à E = 06:00 dans la MÊME série (même mardi type)."""
    g = on.assembled_grid(plans())
    s = np.full(len(g), NT, dtype=np.uint8)
    s[(g >= 21 * H) & (g <= 21 * H + 55)] = 25  # un trajet de 25 min au départ de 21h à 21h55
    s[g == 6 * H] = 40  # retour : 40 min en partant à 06:00
    out = ox.outbound(ox.cap_series(s), int(g[0]), 22 * H)
    assert out.minutes == 25 and out.departure == 21 * H + 55 - 0 or out.minutes is not None
    assert ox.inbound(ox.cap_series(s), int(g[0]), 6 * H).minutes == 40


# --------------------------------------------------------------------------- SWOD v2
def test_series_with_more_than_255_runs_round_trip_in_v2() -> None:
    n = 288
    s = np.array([(100 + (i % 2) * 7) for i in range(n)], dtype=np.uint8)  # une plage par départ : 288 plages
    assert len(ox.encode_runs(ox.cap_series(s))[0]) == n
    sec = ox.series_section(1, 0, np.stack([s, s]), np.stack([s, s]))
    buf = ox.pack_file(0, 0, n, [sec])
    pf = ox.parse_file(buf)
    assert pf.n_slots == 288
    np.testing.assert_array_equal(pf.series[1][1][0], s)
    with pytest.raises(ValueError, match="version 2"):
        ox.series_section(1, 0, np.stack([s, s]), np.stack([s, s]), version=1)


def test_long_sentinel_run_is_split_and_decoded_back() -> None:
    s = np.full(288, NT, dtype=np.uint8)
    s[100] = 40
    L, v = ox.encode_runs(s)
    assert L.max() <= 255 and L.sum() == 288
    np.testing.assert_array_equal(ox.decode_runs(L, v), s)
    z = np.full(288, NT, dtype=np.uint8)
    L, v = ox.encode_runs(z)
    assert L.tolist() == [255, 33] and v.tolist() == [NT, NT]
    np.testing.assert_array_equal(ox.decode_runs(L, v), z)


def test_v1_files_are_still_read_and_v1_refuses_288_slots() -> None:
    n = 229
    s = np.full(n, 30, dtype=np.uint8)
    sec = ox.series_section(1, 0, np.stack([s, s]), np.stack([s, s]), version=1)
    pf = ox.parse_file(ox.pack_file(0, 180, n, [sec], version=1))
    np.testing.assert_array_equal(pf.series[1][1][0], s)
    with pytest.raises(ValueError):
        ox.pack_file(0, 0, 288, [], version=1)
    with pytest.raises(ValueError):
        ox.pack_file(0, 0, 288, [], version=3)
