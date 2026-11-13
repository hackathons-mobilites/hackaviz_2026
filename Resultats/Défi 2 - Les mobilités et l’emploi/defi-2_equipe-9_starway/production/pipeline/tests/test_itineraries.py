"""Tests sans Java : choix de l'itinéraire, tâches aller/retour, GTFS, tickets, carbone (04h)."""

from __future__ import annotations

import pandas as pd
import pytest

from starway import fares_carbon as fc
from starway import itineraries as it


def opt(arr_s: int, n_transit: int = 1, walk_s: int = 0, dep_s: int = 0) -> dict:
    legs = [{"kind": "walk", "role": "access", "dep_s": dep_s, "arr_s": dep_s + walk_s}]
    legs += [{"kind": "transit", "dep_s": 0, "arr_s": 0} for _ in range(n_transit)]
    return {"dep_s": dep_s, "arr_s": arr_s, "legs": legs}


# ----------------------------------------------------------------------------- choix de l'option
def test_trip_minutes_floor_like_r5():
    assert it.trip_minutes(8 * 3600 + 59 * 60 + 59, 8 * 3600) == 59
    assert it.trip_minutes(9 * 3600, 8 * 3600) == 60


def test_select_exact_minute_wins_over_faster():
    dep = 28800
    o_fast, o_exact = opt(dep + 40 * 60), opt(dep + 45 * 60 + 30)
    best, delta = it.select_option([o_fast, o_exact], dep, 45)
    assert best is o_exact and delta == 0


def test_select_closest_and_signed_delta():
    dep = 28800
    best, delta = it.select_option([opt(dep + 50 * 60), opt(dep + 47 * 60)], dep, 45)
    assert delta == 2 and best["arr_s"] == dep + 47 * 60


def test_select_tiebreak_fewer_rides_then_less_walk():
    dep = 0
    a, b, c = opt(45 * 60, 2, 100), opt(45 * 60, 1, 300), opt(45 * 60, 1, 200)
    best, _ = it.select_option([a, b, c], dep, 45)
    assert best is c


def test_select_no_option():
    assert it.select_option([], 0, 10) == (None, None)


# ----------------------------------------------------------------------------- tâches
def test_tasks_out_at_published_dep_ret_at_end():
    df = pd.DataFrame([{"from_id": "75101", "to_id": "P_X", "out": 39.0, "dep": "2026-11-17 08:20:00", "ret": 36.0,
                        "reason": None}])
    out, ret = it.tasks_from_matrix("d09", df, 17 * 3600, 120)
    assert (out.direction, out.departure_s, out.target_min) == ("out", 8 * 3600 + 20 * 60, 39)
    assert (ret.direction, ret.departure_s, ret.target_min) == ("ret", 17 * 3600, 36)


def test_tasks_null_and_over_cap_have_no_target():
    df = pd.DataFrame([{"from_id": "1", "to_id": "P", "out": 121.0, "dep": "2026-11-17 06:00:00", "ret": None,
                        "reason": "no_trip_within_120"}])
    out, ret = it.tasks_from_matrix("d06", df, 14 * 3600, 120)
    assert out.target_min is None and out.reason == "no_trip_within_120" and out.departure_s == -1
    assert ret.target_min is None and ret.reason == "no_trip_within_120"
    rec = it.record(out, it.STATUS_NOT_IN_MATRIX)
    assert rec["dep_s"] is None and rec["option"] is None


def test_hhmm_roundtrip():
    assert it.hhmm_to_s("08:05") == 29100 and it.s_to_hhmm(29159) == "08:05" and it.s_to_hhmm(87000) == "24:10"


def test_agreement_counts():
    t = it.Task("1", "P", "d09", "out", 0, 10, None)
    recs = [it.record(t, it.STATUS_OK, opt(600), 0), it.record(t, it.STATUS_OK, opt(660), 1),
            it.record(t, it.STATUS_NOT_IN_MATRIX)]
    ag = it.agreement(recs)
    assert ag["n_ok"] == 2 and ag["exact"] == 1 and ag["longer"] == 1 and ag["statuses"]["no_trip_in_matrix"] == 1


# ----------------------------------------------------------------------------- GTFS
@pytest.fixture()
def gtfs() -> it.GtfsLookup:
    routes = pd.DataFrame([
        {"route_id": "IDFM:C1", "agency_id": "A71", "route_short_name": "A", "route_long_name": "A", "route_type": "2",
         "route_color": "EB2132", "route_text_color": "FFFFFF"},
        {"route_id": "IDFM:M9", "agency_id": "A100", "route_short_name": "9", "route_long_name": "9",
         "route_type": "1", "route_color": "D5C900", "route_text_color": "000000"},
        {"route_id": "IDFM:B1", "agency_id": "A100", "route_short_name": "26", "route_long_name": "26",
         "route_type": "3", "route_color": "", "route_text_color": ""}])
    agency = pd.DataFrame([{"agency_id": "A71", "agency_name": "RER"}, {"agency_id": "A100", "agency_name": "RATP"}])
    stops = pd.DataFrame([
        {"stop_id": "IDFM:P1", "stop_name": "Nation", "parent_station": None, "wheelchair_boarding": "1"},
        {"stop_id": "IDFM:q1", "stop_name": "Nation", "parent_station": "IDFM:P1", "wheelchair_boarding": "0"},
        {"stop_id": "IDFM:q2", "stop_name": "Mairie de Montreuil", "parent_station": None,
         "wheelchair_boarding": "2"},
        {"stop_id": "IDFM:q3", "stop_name": "X", "parent_station": None, "wheelchair_boarding": "0"}])
    trips = pd.DataFrame([{"trip_id": "IDFM:t1", "wheelchair_accessible": "1"},
                          {"trip_id": "IDFM:t2", "wheelchair_accessible": "0"}])
    return it.GtfsLookup.from_frames(routes, agency, stops, trips)


def test_strip_feed():
    known = {"IDFM:q1"}
    assert it.strip_feed("IDFM-gtfs:IDFM:q1", known) == "IDFM:q1"
    assert it.strip_feed("IDFM:q1", known) == "IDFM:q1"
    assert it.strip_feed("IDFM-gtfs:IDFM:zz", known) is None and it.strip_feed(None, known) is None


def test_kind_rail_by_agency(gtfs):
    assert gtfs.kind("IDFM:C1") == "rer" and gtfs.kind("IDFM:M9") == "metro" and gtfs.kind("IDFM:B1") == "bus"
    assert gtfs.kind("IDFM:nope") is None


def test_wheelchair_never_guessed(gtfs):
    assert gtfs.stop_wheelchair("IDFM:q1") is True  # 0 sur un quai : hérité de la station parente
    assert gtfs.stop_wheelchair("IDFM:q2") is False
    assert gtfs.stop_wheelchair("IDFM:q3") is None  # 0 sans parent : aucune information
    assert gtfs.trip_wheelchair("IDFM:t1") is True and gtfs.trip_wheelchair("IDFM:t2") is None


def test_enrich_transit_leg(gtfs):
    leg = {"kind": "transit", "route_id": "IDFM:M9", "trip": "IDFM-gtfs:IDFM:t1", "route_type": 1,
           "from_stop": "IDFM-gtfs:IDFM:q2", "to_stop": "IDFM-gtfs:IDFM:q1", "ready_s": 100, "dep_s": 160,
           "arr_s": 1000, "dist_m": 5123.4, "shape": True}
    e = it.enrich_leg(leg, gtfs)
    assert e["kind"] == "metro" and e["line"] == "9" and e["color"] == "D5C900" and e["wait_s"] == 60
    assert e["from_name"] == "Mairie de Montreuil" and e["to_name"] == "Nation" and e["dist_m"] == 5123
    assert (e["wheelchair_trip"], e["wheelchair_from"], e["wheelchair_to"]) == (True, False, True)


def test_enrich_walk_leg_nan_distance(gtfs):
    e = it.enrich_leg({"kind": "walk", "role": "egress", "dep_s": 0, "arr_s": 240, "dist_m": float("nan"),
                       "from_stop": "IDFM-gtfs:IDFM:q1", "to_stop": None}, gtfs)
    assert e["kind"] == "walk" and e["dist_m"] is None and e["from_name"] == "Nation" and e["min"] == 4.0


# ----------------------------------------------------------------------------- tickets
def tleg(kind: str, line: str, frm: str, to: str, dep: int, arr: int, wait: int = 60) -> dict:
    return {"kind": kind, "line": line, "route_type": 1, "from_stop": frm, "to_stop": to, "dep_s": dep,
            "arr_s": arr, "wait_s": wait}


PARENTS = {"q_nat_rer": "P_NAT", "q_nat_m": "P_NAT", "q_cdg2": "IDFM:73699", "q_gdn": "P_GDN", "q_lach": "P_LACH"}


def test_metro_then_rer_same_station_one_ticket():
    legs = [tleg("metro", "9", "q_mm", "q_nat_m", 0, 840), tleg("rer", "A", "q_nat_rer", "q_def", 1000, 2100)]
    r = fc.count_tickets(legs, PARENTS)
    assert (r["metro_train_rer"], r["bus_tram"], r["airport"], r["cost_eur"], r["status"]) == (1, 0, 0, 2.55, "ok")


def test_bus_then_metro_two_tickets():
    legs = [tleg("bus", "26", "b1", "b2", 0, 600), tleg("metro", "9", "q_mm", "q_nat_m", 900, 1500)]
    r = fc.count_tickets(legs, PARENTS)
    assert (r["metro_train_rer"], r["bus_tram"], r["cost_eur"]) == (1, 1, 4.6)


def test_bus_tram_window_and_same_line():
    within = [tleg("bus", "26", "a", "b", 0, 600), tleg("tram", "T3a", "c", "d", 1200, 2000)]
    assert fc.count_tickets(within, {})["bus_tram"] == 1
    late = [tleg("bus", "26", "a", "b", 0, 600), tleg("bus", "57", "c", "d", 60 + 90 * 60 + 1, 7000)]
    assert fc.count_tickets(late, {})["bus_tram"] == 2
    same_line = [tleg("bus", "26", "a", "b", 0, 600), tleg("bus", "26", "c", "d", 900, 1500)]
    assert fc.count_tickets(same_line, {})["bus_tram"] == 2


def test_airport_station_gives_airport_ticket():
    legs = [tleg("rer", "B", "q_gdn", "q_cdg2", 0, 1800)]
    r = fc.count_tickets(legs, PARENTS)
    assert (r["airport"], r["metro_train_rer"], r["cost_eur"]) == (1, 0, 14.0)


def test_rail_window_two_hours():
    legs = [tleg("rer", "D", "a", "x", 0, 3600), tleg("train", "R", "x", "y", 60 + 2 * 3600 + 1, 9000)]
    assert fc.count_tickets(legs, {"a": "PA", "x": "PX"})["metro_train_rer"] == 2


def test_street_transfer_outside_official_list_costs_a_new_ticket():
    legs = [tleg("rer", "B", "a", "q_gdn", 0, 600), tleg("rer", "E", "q_lach", "z", 900, 1500)]
    r = fc.count_tickets(legs, PARENTS, street_pairs=frozenset())
    assert r["metro_train_rer"] == 2 and r["street_transfers"] == 1 and r["status"] == "ok" and r["cost_eur"] == 5.1
    declared = fc.count_tickets(legs, PARENTS, frozenset({("q_gdn", "q_lach")}), street_pairs=frozenset())
    assert declared["metro_train_rer"] == 1 and declared["status"] == "ok"


def test_street_transfer_in_official_list_keeps_the_ticket():
    # Gare de l'Est (P) - Château Landon (7) : liste officielle IDFM des correspondances par la voie publique
    parents = {"q_est": "IDFM:71359", "q_cl": "IDFM:474149"}
    legs = [tleg("train", "P", "a", "q_est", 0, 600), tleg("metro", "7", "q_cl", "z", 900, 1500)]
    r = fc.count_tickets(legs, parents)
    assert (r["metro_train_rer"], r["street_transfers"], r["status"]) == (1, 0, "ok")
    # Madeleine - Auber : pas dans la liste
    parents2 = {"q_mad": "IDFM:71324", "q_aub": "IDFM:478926"}
    legs2 = [tleg("metro", "14", "a", "q_mad", 0, 600), tleg("rer", "A", "q_aub", "z", 900, 1500)]
    assert fc.count_tickets(legs2, parents2)["metro_train_rer"] == 2


def test_bus_tram_ticket_ends_with_a_rail_trip():
    legs = [tleg("bus", "393", "a", "b", 0, 480), tleg("rer", "D", "q1", "q2", 900, 1800),
            tleg("bus", "7810", "c", "d", 2200, 2700)]
    r = fc.count_tickets(legs, {})
    assert (r["bus_tram"], r["metro_train_rer"], r["cost_eur"]) == (2, 1, 6.65)


def test_magical_shuttle_and_substitution_bus_have_no_price():
    shuttle = {**tleg("bus", "Orly", "a", "b", 0, 600), "agency": "Magical Shuttle"}
    r = fc.count_tickets([tleg("bus", "2319", "x", "a", -900, -300), shuttle], {})
    assert r["status"] == "unknown" and r["cost_eur"] is None and "Magical Shuttle" in r["reasons"][0]
    subst = {**tleg("bus", "J", "a", "b", 0, 600), "agency": "Transilien", "line_long": "Remplacement Transilien J"}
    r2 = fc.count_tickets([tleg("train", "J", "x", "y", -1200, -60), subst], {})
    assert r2["status"] == "unknown" and r2["cost_eur"] is None and "remplacement de la ligne J" in r2["reasons"][0]
    ordinary = {**tleg("bus", "J", "a", "b", 0, 600), "agency": "Transilien", "line_long": "J"}
    assert fc.count_tickets([ordinary], {})["status"] == "ok"


def test_street_groups_are_sourced_and_named():
    from starway import ticket_rules as tr
    assert all(line and ids for line, ids in tr.STREET_GROUPS)
    assert {i for _, g in tr.STREET_GROUPS for i in g} == set(tr.STATION_NAMES)
    assert ("IDFM:71359", "IDFM:474149") in tr.street_pairs() and ("IDFM:474149", "IDFM:71359") in tr.street_pairs()


def test_funicular_alone_and_unknown_line():
    legs = [tleg("metro", "2", "a", "b", 0, 600), tleg("funicular", "FUN", "c", "d", 700, 800)]
    assert fc.count_tickets(legs, {})["metro_train_rer"] == 2
    cable = [tleg("cable", "C1", "a", "b", 0, 600)]
    assert fc.count_tickets(cable, {})["bus_tram"] == 1
    val = [tleg("tram", "CDG VAL", "a", "b", 0, 600)]
    r = fc.count_tickets(val, {})
    assert r["status"] == "unknown" and r["cost_eur"] is None and r["reasons"]


def test_walk_only_needs_no_ticket():
    r = fc.count_tickets([{"kind": "walk", "role": "direct", "dep_s": 0, "arr_s": 600}], {})
    assert r["cost_eur"] == 0.0 and r["status"] == "ok"


# ----------------------------------------------------------------------------- carbone (ENV01)
@pytest.fixture()
def co2f() -> fc.Co2Factors:
    df = pd.DataFrame([
        {"transportmode": "bus", "id_line": "NA", fc.ENV01_MODE_COLUMN: "92.0"},
        {"transportmode": "metro", "id_line": "C01379", fc.ENV01_MODE_COLUMN: "3.8"},
        {"transportmode": "rail", "id_line": "C01742", fc.ENV01_MODE_COLUMN: "5.5"},
        {"transportmode": "rail", "id_line": "C01729", fc.ENV01_MODE_COLUMN: "6.6"},
        {"transportmode": "tram", "id_line": "C01389", fc.ENV01_MODE_COLUMN: "3.2"}])
    return fc.co2_factors(df)


def test_co2_factors_mode_only_when_unique(co2f):
    assert co2f.by_mode == {"bus": 92.0, "metro": 3.8, "tram": 3.2} and co2f.by_line["C01742"] == 5.5


def test_co2_line_factor_walk_not_counted(co2f):
    legs = [{"kind": "walk", "dist_m": 500},
            {"kind": "rer", "route_id": "IDFM:C01742", "route_type": 2, "line": "A", "dist_m": 10_000}]
    assert fc.trip_co2(legs, co2f)["g"] == 55 and fc.trip_co2(legs, co2f)["status"] == "ok"


def test_co2_bus_and_tram_by_mode(co2f):
    legs = [{"kind": "bus", "route_id": "IDFM:C99999", "route_type": 3, "dist_m": 2000},
            {"kind": "tram", "route_id": "IDFM:T14", "route_type": 0, "dist_m": 1000}]
    assert fc.trip_co2(legs, co2f)["g"] == 187  # 2 x 92 + 1 x 3,2


def test_co2_unknown_rail_line_or_distance(co2f):
    r = fc.trip_co2([{"kind": "train", "route_id": "IDFM:CV", "route_type": 2, "line": "V", "dist_m": 1000}], co2f)
    assert r["g"] is None and "V" in r["reason"]
    assert fc.trip_co2([{"kind": "metro", "route_type": 1, "dist_m": None}], co2f)["reason"] == "distance inconnue"
    assert fc.trip_co2([{"kind": "cable", "route_id": "IDFM:C02666", "route_type": 6, "dist_m": 900}],
                       co2f)["status"] == "unknown"
