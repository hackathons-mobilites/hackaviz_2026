"""Logique aller / retour (sans Java)."""

from datetime import date, datetime, timedelta

from starway.routing import assemble_access, day_bounds, latest_feasible, outbound_departures

S = datetime(2026, 11, 17, 9, 0)


def test_grid_is_s_minus_120_to_s_minus_5():
    deps = outbound_departures(S)
    assert len(deps) == 24
    assert deps[0] == S - timedelta(minutes=120)
    assert deps[-1] == S - timedelta(minutes=5)
    assert deps == sorted(deps)


def test_latest_feasible_picks_latest_departure_arriving_before_start():
    samples = {
        S - timedelta(minutes=60): 40.0,  # arrive 8h40 : faisable
        S - timedelta(minutes=45): 40.0,  # arrive 8h55 : faisable, plus tardif
        S - timedelta(minutes=30): 40.0,  # arrive 9h10 : trop tard
    }
    assert latest_feasible(samples, S) == (40, S - timedelta(minutes=45))


def test_latest_feasible_arrival_exactly_at_start_is_ok():
    assert latest_feasible({S - timedelta(minutes=30): 30.0}, S) == (30, S - timedelta(minutes=30))


def test_latest_feasible_wait_effect_shorter_trip_later():
    # Un départ plus tardif peut donner un trajet plus court (moins d'attente) : on garde le plus tardif.
    samples = {S - timedelta(minutes=50): 48.0, S - timedelta(minutes=35): 33.0}
    assert latest_feasible(samples, S) == (33, S - timedelta(minutes=35))


def test_latest_feasible_none_when_nothing_arrives_in_time():
    samples = {S - timedelta(minutes=20): 25.0, S - timedelta(minutes=10): None, S - timedelta(minutes=5): float("nan")}
    assert latest_feasible(samples, S) == (None, None)


def test_assemble_access_reasons_and_order():
    a = assemble_access(["P1", "P2", "P3"], {"P1": 38, "P3": 52}, {"P1": 41, "P2": 30, "P3": None})
    assert a["out"] == [38, None, 52]
    assert a["ret"] == [41, 30, None]
    assert a["reason"] == [None, "no_trip_within_120", "no_trip_within_120"]


def test_assemble_access_not_snapped_never_zero():
    a = assemble_access(["P1"], {}, {}, snapped=False)
    assert a == {"out": [None], "ret": [None], "reason": ["origin_not_snapped"]}


def test_return_is_computed_at_end_of_shift_not_at_start():
    start, end = day_bounds(date(2026, 11, 17), "d14")
    assert (start.hour, end.hour) == (14, 22)
    start, end = day_bounds(date(2026, 11, 17), "d06")
    assert (start.hour, end.hour) == (6, 14)
