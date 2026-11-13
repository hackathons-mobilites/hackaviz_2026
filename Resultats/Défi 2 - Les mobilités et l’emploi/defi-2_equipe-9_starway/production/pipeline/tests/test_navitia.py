"""Recoupement Navitia : lecture des réponses, définitions comparées, échantillon (FIXTURES synthétiques, sans réseau)."""

from __future__ import annotations

from datetime import datetime

from starway.navitia import (
    Sample,
    Trip,
    aligned_settings,
    bin_of,
    cache_key,
    compare_status,
    describe_diffs,
    diff,
    duration_bins,
    floor_to_grid,
    inbound_value,
    insight_trips,
    journey_sections,
    navitia_error,
    outbound_value,
    parse_journeys,
    request_params,
    stratified_sample,
    tour_trips,
    weighted_quantile,
)

S = datetime(2026, 11, 17, 9, 0)
E = datetime(2026, 11, 17, 22, 0)


def _j(dep: str, arr: str, sections=None, transfers: int = 0) -> dict:
    return {"type": "best", "departure_date_time": f"20261117T{dep}", "arrival_date_time": f"20261117T{arr}",
            "duration": 0, "nb_transfers": transfers, "durations": {"walking": 600},
            "sections": sections or []}


def _pt(code: str, mode: str, a: str, b: str) -> dict:
    return {"type": "public_transport", "display_informations": {"commercial_mode": mode, "code": code},
            "from": {"name": a}, "to": {"name": b}}


def test_parse_journeys_reads_lines_waiting_and_times() -> None:
    body = {"journeys": [_j("082253", "085906", [
        {"type": "street_network", "mode": "walking", "duration": 537},
        _pt("A", "RER", "Maisons-Laffitte", "Houilles"),
        {"type": "waiting", "duration": 460},
        _pt("J", "Train Transilien", "Houilles", "Gare Saint-Lazare")], transfers=1)]}
    (j,) = parse_journeys(body)
    assert j.departure == datetime(2026, 11, 17, 8, 22, 53) and j.arrival == datetime(2026, 11, 17, 8, 59, 6)
    assert j.lines == ("RER A", "Train Transilien J") and j.waiting_s == 460 and j.nb_transfers == 1
    assert j.stops == ("Maisons-Laffitte", "Houilles", "Houilles", "Gare Saint-Lazare")
    assert j.walking_s == 600


def test_floor_to_grid() -> None:
    assert floor_to_grid(datetime(2026, 11, 17, 8, 22, 53), 5) == datetime(2026, 11, 17, 8, 20)
    assert floor_to_grid(datetime(2026, 11, 17, 8, 25, 0), 5) == datetime(2026, 11, 17, 8, 25)


def test_outbound_aligns_on_the_5_min_grid_and_keeps_native_duration() -> None:
    js = parse_journeys({"journeys": [_j("082253", "085906"), _j("081543", "085702"), _j("080743", "084806")]})
    v = outbound_value(js, S, 5, 120, 120)
    # dernier départ 08:22:53 -> grille 08:20 ; arrivée la plus tôt parmi les départs >= 08:20 : 08:59:06
    assert v.grid_departure == datetime(2026, 11, 17, 8, 20)
    assert v.minutes == round((39 * 60 + 6) / 60, 2)
    assert v.native_minutes == round((36 * 60 + 13) / 60, 2)
    assert v.reason is None


def test_outbound_ignores_late_arrivals_and_departures_outside_window() -> None:
    js = parse_journeys({"journeys": [_j("085000", "090100"), _j("065500", "085000")]})
    v = outbound_value(js, S, 5, 120, 120)
    assert v.minutes is None and v.reason == "navitia_no_journey_arriving_in_time"


def test_outbound_picks_earliest_arrival_after_grid_departure() -> None:
    # Deux trajets partent après 08:20 ; le plus rapide n'est pas le dernier parti.
    js = parse_journeys({"journeys": [_j("082400", "085900"), _j("082100", "084500")]})
    v = outbound_value(js, S, 5, 120, 120)
    assert v.grid_departure == datetime(2026, 11, 17, 8, 20) and v.minutes == 25.0


def test_inbound_counts_wait_from_end_of_shift() -> None:
    js = parse_journeys({"journeys": [_j("223500", "231500"), _j("220800", "231700")]})
    v = inbound_value(js, E, 120)
    assert v.minutes == 75.0 and v.native_minutes == 40.0 and v.journey.departure.minute == 35


def test_inbound_over_max_trip_is_null() -> None:
    js = parse_journeys({"journeys": [_j("230000", "000500".replace("000500", "235959"))]})
    assert inbound_value(js, E, 60).minutes is None


def test_navitia_error_and_status() -> None:
    assert navitia_error({"error": {"id": "no_solution"}}, 404) == "navitia_no_solution"
    assert navitia_error({"journeys": []}, 200) is None
    assert navitia_error(None, 503) == "http_503"
    assert compare_status(40, 41.5) == "both" and compare_status(40, None) == "starway_only"
    assert compare_status(None, 41.5) == "navitia_only" and compare_status(None, None) == "neither"
    assert diff(76, 75.0) == 1.0 and diff(None, 3.0) is None


def test_aligned_settings_and_params() -> None:
    s = aligned_settings(3.6, 120, 2000, 8)
    assert s.walking_speed_ms == 1.0 and s.max_trip_s == 7200 and s.egress_limit_s == 2000 and s.max_nb_transfers == 7
    p_out = request_params("2.1;48.9", "2.3;48.8", S, "arrival", "out", s)
    p_ret = request_params("2.3;48.8", "2.1;48.9", E, "departure", "ret", s)
    assert p_out["datetime"] == "20261117T090000" and p_out["max_walking_duration_to_pt"] == "7200"
    assert p_ret["max_walking_duration_to_pt"] == "2000" and p_ret["data_freshness"] == "base_schedule"
    assert "apikey" not in p_out
    t = Trip("78358", "P_DEFENSE", "d14", "ret")
    assert cache_key(t, p_ret) == cache_key(t, dict(reversed(list(p_ret.items()))))
    assert cache_key(t, p_ret) != cache_key(t, p_out)


def test_duration_bins_derived_from_budgets() -> None:
    bins = duration_bins([30, 45, 60], 120)
    assert [b[0] for b in bins] == ["0-30", "31-45", "46-60", "61-120"]
    assert bin_of(30, bins) == "0-30" and bin_of(31, bins) == "31-45" and bin_of(120, bins) == "61-120"
    assert bin_of(121, bins) is None


def test_stratified_sample_is_deterministic_and_capped() -> None:
    cands = [(Trip(f"7700{i}", "P", "d09", "out"), "77", 10 + i) for i in range(10)]
    cands += [(Trip("75101", "P", "d09", "out"), "75", 50)]
    bins = duration_bins([30, 45, 60], 120)
    a, sizes = stratified_sample(cands, bins, 3, seed=1)
    b, _ = stratified_sample(list(reversed(cands)), bins, 3, seed=1)
    assert a == b and sizes == {"75|46-60": 1, "77|0-30": 10}
    assert sum(1 for _, s in a if s == "77|0-30") == 3 and sum(1 for _, s in a if s == "75|46-60") == 1


def test_tour_trips_and_sample_groups() -> None:
    trips = tour_trips([("78358", "d09")], ["P1", "P2"])
    assert len(trips) == 4
    s = Sample()
    s.add(trips[0], "tour")
    s.add(trips[0], "random", "78|0-30")
    s.add(trips[0], "tour")
    assert s.groups[trips[0]] == ["tour", "random"] and s.strata[trips[0]] == "78|0-30"


POLES = ["P1", "P2", "P3"]
JOBS = [100, 500, 50]


def _series(data: dict) -> callable:
    return lambda insee, mode, day: data.get((insee, mode, day))


def test_insight_eclipse_picks_biggest_switching_pole_and_failing_leg() -> None:
    data = {("A", "transit", "d09"): {"out": [20, 40, 30], "ret": [20, 40, 30]},
            ("A", "transit", "d14"): {"out": [20, 40, 30], "ret": [20, 76, 90]}}
    ins = {"kind": "eclipse", "scenario": {"o": "A", "d": "d14", "b": 60, "m": "transit", "compare_day": "d09"}}
    trips, why = insight_trips(ins, _series(data), POLES, JOBS)
    assert why is None
    assert trips == [Trip("A", "P2", "d14", "ret"), Trip("A", "P2", "d09", "ret")]


def test_insight_territorial_gap_and_late_return_and_bike_gain() -> None:
    data = {("A", "transit", "d09"): {"out": [20, None, 30], "ret": [20, None, 30]},
            ("B", "transit", "d09"): {"out": [20, 40, 30], "ret": [20, 40, 30]},
            ("A", "bike_transit", "d09"): {"out": [20, 35, 30], "ret": [20, 35, 30]},
            ("C", "transit", "d14"): {"out": [20, 40, 30], "ret": [None, 90, 30]}}
    gap = {"kind": "territorial_gap", "scenario": {"o": "A", "d": "d09", "b": 60, "vs": "B"}}
    assert insight_trips(gap, _series(data), POLES, JOBS)[0] == [
        Trip("A", "P2", "d09", "out"), Trip("A", "P2", "d09", "ret"),
        Trip("B", "P2", "d09", "out"), Trip("B", "P2", "d09", "ret")]
    late = {"kind": "late_return", "scenario": {"o": "C", "d": "d14", "b": 60}}
    assert insight_trips(late, _series(data), POLES, JOBS)[0] == [Trip("C", "P2", "d14", "out"),
                                                                  Trip("C", "P2", "d14", "ret")]
    bike = {"kind": "bike_gain", "scenario": {"o": "A", "d": "d09", "b": 60, "m": "bike_transit"}}
    dark = [{"reached": 0, "unknown": 0, "not_reached": 1}] * 3
    assert insight_trips(bike, _series(data), POLES, JOBS, lambda o, d, b: dark)[0] == [Trip("A", "P2", "d09", "out"),
                                                                                        Trip("A", "P2", "d09", "ret")]
    missing = {"kind": "eclipse", "scenario": {"o": "Z", "d": "d14", "b": 60, "compare_day": "d09"}}
    assert insight_trips(missing, _series(data), POLES, JOBS) == ([], "series_missing")


def test_describe_diffs_and_weighted_quantile() -> None:
    d = describe_diffs([1, -1, 2, 6, 0])
    assert d["n"] == 5 and d["median_signed_min"] == 1.0 and d["median_abs_min"] == 1.0
    assert d["share_within_5_min"] == 0.8 and d["max_abs_min"] == 6.0
    assert weighted_quantile([1, 2, 3], [1, 1, 10], 0.5) == 3.0
    assert describe_diffs([]) == {"n": 0}
    w = describe_diffs([1, 10], [3, 1])["weighted"]
    assert w["median_abs_min"] == 1.0 and w["share_within_5_min"] == 0.75


def test_insight_verdict_rules_and_minute_rounding() -> None:
    from starway.navitia import LegCheck, insight_verdict, pole_verdict

    dark, ref = ("A", "d14"), ("A", "d09")
    # éclipse : retour hors budget en d14, dans le budget en d09
    ok = [LegCheck(dark, "ret", 76, 75.0), LegCheck(ref, "ret", 44, 45.0)]
    assert insight_verdict("eclipse", 60, ok) == "confirmed"
    assert insight_verdict("eclipse", 60, [LegCheck(dark, "ret", 65, 53.9), ok[1]]) == "contradicted"
    assert insight_verdict("eclipse", 60, [ok[0], LegCheck(ref, "ret", 48, 60.48)]) == "within_one_minute"
    # côté éteint : un seul sens décisif hors budget suffit
    two = [LegCheck(dark, "out", 66, 53.1), LegCheck(dark, "ret", 66, 61.5)]
    assert insight_verdict("territorial_gap", 60, two) == "confirmed"
    # retour tardif : l'aller doit rester dans le budget
    late = [LegCheck(dark, "out", 55, 60.3), LegCheck(dark, "ret", 61, 66.6)]
    assert insight_verdict("late_return", 60, late) == "within_one_minute"
    assert insight_verdict("late_return", 60, [LegCheck(dark, "out", 55, 50.0), LegCheck(dark, "ret", 61, None)]) \
        == "confirmed"
    o, r = LegCheck(ref, "out", 54, 59.1), LegCheck(ref, "ret", 57, 65.3)
    assert pole_verdict(o, r, 60) == "different" and pole_verdict(o, r, 70) == "same"
    assert pole_verdict(LegCheck(ref, "out", 30, 30.4), LegCheck(ref, "ret", 20, 20.0), 30) == "within_one_minute"


def test_long_dashes_are_replaced_in_labels() -> None:
    body = {"journeys": [_j("080000", "083000", [_pt("R", "Train Transilien", "Gare de Fontainebleau\u2013Avon", "B\u2014C")])]}
    (j,) = parse_journeys(body)
    assert j.stops == ("Gare de Fontainebleau-Avon", "B-C")


def test_aligned_settings_for_walk_setting_d024() -> None:
    # « normal » (D-024) : accès <= 50 min (max_time_walking), sortie <= 3 000 m, tout à pied <= 50 min
    s = aligned_settings(3.6, 120, 3000, 8, access_limit_min=50)
    p_out = request_params("2.1;48.9", "2.3;48.8", S, "arrival", "out", s)
    p_ret = request_params("2.3;48.8", "2.1;48.9", E, "departure", "ret", s)
    assert p_out["max_walking_duration_to_pt"] == "3000" and p_ret["max_walking_duration_to_pt"] == "3000"
    assert p_out["max_walking_direct_path_duration"] == "3000" and p_out["max_duration"] == "7200"
    # réglage R5 d'origine : mêmes paramètres qu'avant (le cache du premier recoupement reste valable)
    legacy = aligned_settings(3.6, 120, 2000, 8)
    assert request_params("a", "b", S, "arrival", "out", legacy)["max_walking_direct_path_duration"] == "7200"
    assert legacy.access_s == 7200


def test_published_crosscheck_needs_same_trips_and_same_durations() -> None:
    from starway.navitia import insight_scenario_key, published_crosscheck

    data = {("A", "transit", "d09"): {"out": [20, 40, 30], "ret": [20, 40, 30]},
            ("A", "transit", "d14"): {"out": [20, 40, 30], "ret": [20, 76, 90]}}
    ins = {"kind": "eclipse", "scenario": {"o": "A", "d": "d14", "b": 60, "m": "transit", "vs": None,
                                           "compare_day": "d09"}}
    trips = [{"insee": "A", "pole_id": "P2", "day": "d14", "leg": "ret", "starway_min": 76, "navitia_min": 55.0},
             {"insee": "A", "pole_id": "P2", "day": "d09", "leg": "ret", "starway_min": 40, "navitia_min": 41.0}]
    chk = {**ins, "verdict": "contradicted", "trips": trips}
    checks = {insight_scenario_key(chk): chk}
    assert published_crosscheck(ins, checks, _series(data), POLES, JOBS)[0] == "contradicted"
    assert published_crosscheck(ins, {}, _series(data), POLES, JOBS) == ("not_checked", None)
    # durée STARWAY changée depuis le recoupement : verdict périmé
    data[("A", "transit", "d14")] = {"out": [20, 40, 30], "ret": [20, 75, 90]}
    assert published_crosscheck(ins, checks, _series(data), POLES, JOBS)[0] == "not_checked"
    # trajet non demandé à Navitia
    data[("A", "transit", "d14")] = {"out": [20, 40, 30], "ret": [20, 76, 90]}
    unk = {**chk, "verdict": "unknown"}
    assert published_crosscheck(ins, {insight_scenario_key(unk): unk}, _series(data), POLES, JOBS)[0] == "not_checked"
    # autre budget = autre découverte
    other = {**ins, "scenario": {**ins["scenario"], "b": 45}}
    assert published_crosscheck(other, checks, _series(data), POLES, JOBS)[0] == "not_checked"


def test_journey_sections_splits_walk_transfer_wait_and_ride() -> None:
    j = _j("170000", "181100", [
        {"type": "street_network", "duration": 300, "from": {"name": "Origine"}, "to": {"name": "Gare A"},
         "departure_date_time": "20261117T170000", "arrival_date_time": "20261117T170500"},
        {**_pt("A", "RER", "Gare A", "Gare B"), "duration": 1800,
         "departure_date_time": "20261117T171000", "arrival_date_time": "20261117T174000"},
        {"type": "transfer", "transfer_type": "walking", "duration": 120, "from": {"name": "Gare B"},
         "to": {"name": "Gare B"}, "departure_date_time": "20261117T174000", "arrival_date_time": "20261117T174200"},
        {"type": "waiting", "duration": 180, "from": {"name": "Gare B"}, "to": {"name": "Gare B"}}])
    s = journey_sections(j)
    assert [x["kind"] for x in s] == ["walk", "ride", "transfer", "wait"]
    assert s[0]["dep"] == "17:00:00" and s[0]["s"] == 300 and s[1]["line"] == "RER A"
    assert s[1]["from"] == "Gare A" and s[1]["arr"] == "17:40:00" and s[2]["transfer_type"] == "walking"
    assert s[3]["dep"] is None and s[3]["s"] == 180
