"""Tests sans Java de starway.transfer_times (temps de correspondance officiels, recalage sur les mêmes lignes)."""

from __future__ import annotations

from starway import transfer_times as tx

P = tx.FEED_PREFIX


def leg_walk(dep: int, arr: int, role: str = "transfer", a: str | None = None, b: str | None = None) -> dict:
    return {"kind": "walk", "role": role, "from_stop": a and P + a, "to_stop": b and P + b, "dep_s": dep, "arr_s": arr}


def leg_tc(route: str, a: str, b: str, dep: int, arr: int) -> dict:
    return {"kind": "transit", "route_id": route, "from_stop": P + a, "to_stop": P + b, "dep_s": dep, "arr_s": arr}


OFFICIAL = tx.OfficialTransfers.from_rows(
    [("A2", "B1", 300), ("B1", "A2", 300), ("C1", "D1", 120)],
    {"A1": "SA", "A2": "SA", "B1": "SA", "B9": "SA", "C1": "SC", "D1": "SD", "E1": "SE"})


def two_leg(dep2: int, walk: int = 60, b: str = "B1") -> dict:
    return {"dep_s": 1000, "arr_s": dep2 + 600 + 100, "legs": [
        leg_walk(1000, 1100, "access", None, "X"),
        leg_tc("R1", "X", "A2", 1200, 2000),
        leg_walk(2000, 2000 + walk, "transfer", "A2", b),
        leg_tc("R2", b, "Y", dep2, dep2 + 600),
        leg_walk(dep2 + 600, dep2 + 700, "egress", "Y", None)]}


def test_short_and_ok() -> None:
    c = tx.check_option(two_leg(2200), OFFICIAL)
    assert len(c) == 1 and c[0].status == tx.SHORT and c[0].available_s == 200 and c[0].missing_s == 100
    c = tx.check_option(two_leg(2300), OFFICIAL)
    assert c[0].status == tx.OK and c[0].missing_s == 0  # disponible = minimum : respecté
    assert tx.trip_status(c) == tx.TRIP_VERIFIED


def test_no_line_same_stop_and_parent_context() -> None:
    c = tx.check_option(two_leg(2200, b="B9"), OFFICIAL)[0]
    assert c.status == tx.NO_LINE and c.official_min_s is None and c.missing_s is None
    assert c.same_parent and c.parent_pairs == (2, 300, 300)  # contexte seulement, jamais un minimum
    opt = two_leg(2200, b="A2")
    assert tx.check_option(opt, OFFICIAL)[0].status == tx.SAME_STOP
    assert tx.trip_status(tx.check_option(opt, OFFICIAL)) == tx.TRIP_UNVERIFIED


def test_trip_without_transfer() -> None:
    opt = {"legs": [leg_walk(0, 10, "access"), leg_tc("R1", "X", "A2", 100, 200), leg_walk(200, 300, "egress")]}
    assert tx.check_option(opt, OFFICIAL) == [] and tx.trip_status([]) == tx.TRIP_NO_TRANSFER


def test_required_gaps_official_or_engine_rule() -> None:
    assert tx.required_gaps(two_leg(2200), OFFICIAL) == [300]
    assert tx.required_gaps(two_leg(2200, walk=80, b="B9"), OFFICIAL) == [80 + 61]


TT = tx.Timetable({("R2", "B1", "Y"): [tx.Run(2200, 2800, "t1"), tx.Run(2500, 3100, "t2"), tx.Run(2900, 3500, "t3")],
                   ("R1", "X", "A2"): [tx.Run(600, 1400, "s0"), tx.Run(1200, 2000, "s1")]})


def test_retime_return_takes_next_run() -> None:
    rec = {"dir": "ret", "dep_s": 1000, "option": two_leg(2200)}
    rt = tx.retime(rec, OFFICIAL, TT, day_start_s=0, lookback_s=7200, max_min=120)
    # arrivée 2000 + 300 -> course t2 (2500 -> 3100), sortie 100 s : 3200 - 1000 = 2200 s = 36 min
    assert rt == tx.Retimed(36, "forward")


def test_retime_outbound_kept_when_still_on_time() -> None:
    rec = {"dir": "out", "dep_s": 1000, "option": two_leg(2200)}
    assert tx.retime(rec, OFFICIAL, TT, day_start_s=3600, lookback_s=7200, max_min=120) == tx.Retimed(36, "forward")


def test_retime_outbound_backward_when_late() -> None:
    rec = {"dir": "out", "dep_s": 1000, "option": two_leg(2200)}
    # début du poste 3000 : t2 arriverait à 3200 > 3000. À rebours : t1 (arr 2800 + 100 <= 3000), montée R1 au plus
    # tard 2200 - 300 = 1900 d'arrivée -> s0 (600 -> 1400), départ au plus tard 600 - 61 - 100 = 439 s ; grille de
    # 300 s comptée depuis 3000 : 300. Depuis 300 : s0 (>= 300 + 100 + 61), t1, arrivée 2900.
    rt = tx.retime(rec, OFFICIAL, TT, day_start_s=3000, lookback_s=7200, max_min=120)
    assert rt.method == "backward"
    assert rt.minutes == max(2900 - 300, 3000 - 300 - 300) // 60


def test_retime_not_found() -> None:
    rec = {"dir": "ret", "dep_s": 1000, "option": two_leg(2200)}
    tt = tx.Timetable({("R2", "B1", "Y"): [tx.Run(2200, 2800, "t1")]})
    assert tx.retime(rec, OFFICIAL, tt, 0, 7200, 120) == tx.Retimed(None, "no_run")


def test_timetable_first_after_picks_earliest_arrival() -> None:
    tt = tx.Timetable({("R", "a", "b"): [tx.Run(100, 900, "slow"), tx.Run(150, 500, "fast")]})
    assert tt.first_after(("R", "a", "b"), 100).trip_id == "fast"  # dépassement : arrivée la plus tôt
    assert tt.last_before(("R", "a", "b"), 600).trip_id == "fast"


def test_verdict_and_engine_value() -> None:
    assert tx.verdict(30, 60, 60) and not tx.verdict(30, None, 60) and not tx.verdict(61, 10, 60)
    assert tx.apply_gtfs_min_gap(377) == 316 and tx.apply_gtfs_min_gap(30) == 0


def test_strip_feed() -> None:
    assert tx.strip_feed("IDFM-gtfs:IDFM:1") == "IDFM:1" and tx.strip_feed("IDFM:1") == "IDFM:1"
    assert tx.strip_feed(None) is None


def test_retime_over_max_and_lookback() -> None:
    rec = {"dir": "ret", "dep_s": 1000, "option": two_leg(2200)}
    assert tx.retime(rec, OFFICIAL, TT, 0, 7200, 30) == tx.Retimed(None, "over_max")
    out = {"dir": "out", "dep_s": 1000, "option": two_leg(2200)}
    assert tx.retime(out, OFFICIAL, TT, 3000, 600, 120) == tx.Retimed(None, "over_lookback")


def test_navitia_reference_only_where_gtfs_has_no_line() -> None:
    off = OFFICIAL.with_navitia([("A2", "A2", 300), ("A2", "B1", 999)])  # A2 -> B1 a une ligne GTFS : ignoré
    assert off.navitia_s == {("A2", "A2"): 300}
    c = tx.check_option(two_leg(2200, b="A2"), off)[0]
    assert c.status == tx.SAME_STOP and c.navitia_min_s == 300 and c.reference_status == tx.SHORT
    assert tx.trip_status([c]) == tx.TRIP_UNVERIFIED and tx.trip_status([c], reference=True) == tx.TRIP_SHORT
    assert tx.required_gaps(two_leg(2200, b="A2"), off) == [60 + 61] and tx.required_gaps(two_leg(2200, b="A2"), off, True) == [300]
    g = tx.check_option(two_leg(2200), off)[0]
    assert g.official_min_s == 300 and g.navitia_min_s is None and g.reference_min_s == 300
