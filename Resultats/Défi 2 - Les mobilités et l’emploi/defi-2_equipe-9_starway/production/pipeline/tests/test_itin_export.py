"""Tests sans Java : fichier itineraries/{insee}.json proposé (06h) et ses contrôles."""

from __future__ import annotations

import pandas as pd

from starway import fares_carbon as fc
from starway import itin_export as ie
from starway import itineraries as it


def lookup() -> it.GtfsLookup:
    routes = pd.DataFrame([{"route_id": "IDFM:M9", "agency_id": "A", "route_short_name": "9", "route_long_name": "9",
                            "route_type": "1", "route_color": "D5C900", "route_text_color": "000000"}])
    agency = pd.DataFrame([{"agency_id": "A", "agency_name": "RATP"}])
    stops = pd.DataFrame([{"stop_id": "IDFM:a", "stop_name": "Mairie de Montreuil", "parent_station": None,
                           "wheelchair_boarding": "1"},
                          {"stop_id": "IDFM:b", "stop_name": "Nation", "parent_station": None,
                           "wheelchair_boarding": "0"}])
    trips = pd.DataFrame([{"trip_id": "IDFM:t", "wheelchair_accessible": "1"}])
    return it.GtfsLookup.from_frames(routes, agency, stops, trips)


CO2 = fc.co2_factors(pd.DataFrame([{"transportmode": "metro", "id_line": "M9", fc.ENV01_MODE_COLUMN: "3.8"}]))


def ok_record(day: str = "d09", direction: str = "out") -> dict:
    dep = 8 * 3600
    legs = [{"kind": "walk", "role": "access", "from_stop": None, "to_stop": "F:IDFM:a", "dep_s": dep,
             "arr_s": dep + 360, "dist_m": 360.0},
            {"kind": "transit", "route_id": "IDFM:M9", "trip": "F:IDFM:t", "route_type": 1, "from_stop": "F:IDFM:a",
             "to_stop": "F:IDFM:b", "ready_s": dep + 360, "dep_s": dep + 420, "arr_s": dep + 1260, "dist_m": 5000.0,
             "shape": True},
            {"kind": "walk", "role": "egress", "from_stop": "F:IDFM:b", "to_stop": None, "dep_s": dep + 1260,
             "arr_s": dep + 1500, "dist_m": 240.0}]
    t = it.Task("93048", "P_EST", day, direction, dep, 25, None)
    return it.record(t, it.STATUS_OK, {"dep_s": dep, "arr_s": dep + 1500, "legs": legs}, 0, 2)


def test_trip_json_fields():
    t = ie.trip_json(ok_record(), lookup(), {}, frozenset(), CO2)
    assert (t["dep"], t["arr"], t["min"], t["matrix_min"], t["rides"], t["walk_m"]) == ("08:00", "08:25", 25, 25, 1,
                                                                                          600)
    assert t["legs"][1]["line"] == "9" and t["legs"][1]["from"] == "Mairie de Montreuil" and t["legs"][1]["wc_to"] is None
    assert t["tickets"]["metro_train_rer"] == 1 and t["tickets"]["cost_eur"] == 2.55
    assert t["co2_g"] == {"value": 19, "status": "ok"}


def test_commune_file_shape_and_checks():
    recs = [ok_record()]
    none = it.record(it.Task("93048", "P_EST", "d09", "ret", 17 * 3600, None, "no_trip_within_120"),
                     it.STATUS_NOT_IN_MATRIX)
    doc = ie.commune_file("93048", recs + [none], ["P_EST", "P_OTHER"], ["d09"], lookup(), {}, frozenset(),
                          {("93048", "P_EST"): {"out": 30.0, "ret": None, "reason": "no_trip_within_120"}}, "11:00",
                          {"processing_version": "0.1.0"}, CO2)
    assert doc["days"]["d09"]["out"][0]["status"] == "ok"
    assert doc["days"]["d09"]["out"][1] == {"status": "not_computed", "reason": "not_computed"}
    assert doc["days"]["d09"]["ret"][0] == {"status": "no_trip_in_matrix", "reason": "no_trip_within_120"}
    assert doc["offpeak"]["out"] == [30, None] and doc["offpeak"]["ret"] == [None, None]
    assert ie.check_file(doc, 120) == []


def test_check_file_catches_overlap():
    doc = ie.commune_file("93048", [ok_record()], ["P_EST"], ["d09"], lookup(), {}, frozenset(), None, None, {}, CO2)
    doc["days"]["d09"]["out"][0]["legs"][1]["dep"] = "07:59"
    assert ie.check_file(doc, 120)


def test_complete_communes_requires_every_pole_day_and_direction():
    recs = [{"insee": "A", "pole": p, "day": d, "dir": s} for p in ("P1", "P2") for d in ("d06", "d09")
            for s in ("out", "ret")]
    recs += [{"insee": "B", "pole": "P1", "day": "d06", "dir": "out"}]
    assert ie.complete_communes(recs, ["P1", "P2"], ["d06", "d09"]) == ["A"]


def access_for(out_min: int | None, dep: str | None, ret_min: int | None) -> dict:
    return {"modes": {"transit": {"d09": {"out": [out_min], "dep": [dep], "ret": [ret_min], "reason": [None]}}}}


def test_check_against_access_matches_matrix_and_departure():
    doc = ie.commune_file("93048", [ok_record()], ["P_EST"], ["d09"], lookup(), {}, frozenset(), None, None, {}, CO2)
    doc["days"]["d09"]["ret"][0] = {"status": "no_trip_in_matrix", "reason": "no_trip_within_120"}
    assert ie.check_against_access(doc, access_for(25, "08:00", None), ["P_EST"], ["d09"]) == []
    assert ie.check_against_access(doc, access_for(26, "08:00", None), ["P_EST"], ["d09"])  # durée différente
    assert ie.check_against_access(doc, access_for(25, "07:55", None), ["P_EST"], ["d09"])  # départ différent
    assert ie.check_against_access(doc, access_for(25, "08:00", 40), ["P_EST"], ["d09"])  # trajet de la matrice perdu
    assert ie.check_against_access(doc, access_for(25, "08:00", None), ["P_OTHER"], ["d09"])  # ordre des pôles


def test_check_against_access_refuses_incomplete_commune():
    doc = ie.commune_file("93048", [ok_record()], ["P_EST"], ["d09"], lookup(), {}, frozenset(), None, None, {}, CO2)
    assert any("non calculé" in e for e in ie.check_against_access(doc, access_for(25, "08:00", 30), ["P_EST"],
                                                                     ["d09"]))


def test_check_file_catches_wrong_ticket_price_and_ride_to_itself():
    doc = ie.commune_file("93048", [ok_record()], ["P_EST"], ["d09"], lookup(), {}, frozenset(), None, None, {}, CO2)
    trip = doc["days"]["d09"]["out"][0]
    assert ie.check_file(doc, 120) == []
    trip["tickets"]["cost_eur"] = 2.05
    assert any("prix" in e for e in ie.check_file(doc, 120))
    trip["tickets"]["cost_eur"] = 2.55
    trip["legs"][1]["to"], trip["legs"][1]["dist_m"] = trip["legs"][1]["from"], 0
    assert any("lui-même" in e for e in ie.check_file(doc, 120))


def test_trip_with_a_ride_from_a_stop_to_itself_is_not_detailed():
    """R5 rend parfois un tronçon en TC qui monte et descend au même arrêt (distance nulle, 05/11) : le détail n'est
    jamais publié (statut « aucun itinéraire retrouvé » avec sa raison), la durée de la matrice reste celle du calcul."""
    rec = ok_record()
    rec["option"]["legs"][1]["to_stop"] = rec["option"]["legs"][1]["from_stop"]
    rec["option"]["legs"][1]["dist_m"] = 0.0
    t = ie.trip_json(rec, lookup(), {}, frozenset(), CO2)
    assert t == {"status": it.STATUS_NO_OPTION, "reason": ie.DEGENERATE_LEG_REASON}
    ok = ie.trip_json(ok_record(), lookup(), {}, frozenset(), CO2)
    assert ok["status"] == it.STATUS_OK and not ie.degenerate_legs(ok["legs"])
    assert ie.degenerate_legs([{"m": "metro", "from": "Nation", "to": "Nation", "dist_m": 0}])
    assert not ie.degenerate_legs([{"m": "metro", "from": "Nation", "to": "Nation", "dist_m": 350}])  # même nom, 2 arrêts
    assert not ie.degenerate_legs([{"m": "walk", "from": "Nation", "to": "Nation", "dist_m": 0}])


def test_published_communes_lists_gzip_files(tmp_path):
    (tmp_path / "75101.json.gz").write_bytes(b"")
    (tmp_path / "77001.json.gz").write_bytes(b"")
    (tmp_path / "78001.json").write_text("{}", encoding="utf-8")  # ancien format : pas publié
    (tmp_path / "notes.txt").write_text("", encoding="utf-8")
    assert ie.published_communes(tmp_path) == ["75101", "77001"]
    assert ie.published_communes(tmp_path / "absent") == []


def test_stop_hop_distance_follows_the_trip_and_n_hops():
    coords = {"a": (48.0, 2.0), "b": (48.01, 2.0), "c": (48.02, 2.0), "d": (48.0, 2.0)}
    one = ie.haversine_m(48.0, 2.0, 48.01, 2.0)
    assert abs(ie.stop_hop_distance(["a", "b", "c"], "a", "c", 2, coords) - 2 * one) < 1.0
    # boucle : la descente est n_hops arrêts après la montée, pas la première occurrence venue
    loop = ["a", "b", "c", "b", "d"]
    assert abs(ie.stop_hop_distance(loop, "b", "b", 2, coords) - 2 * one) < 1.0
    assert ie.stop_hop_distance(["a", "b"], "a", "c", None, coords) is None
    assert ie.stop_hop_distance(["a", "x"], "a", "x", 1, coords) is None  # coordonnées inconnues


def test_apply_stop_distances_replaces_r5_distance_and_flags_on_demand():
    legs = [{"route_type": 3, "trip_id": "t1", "from_stop": "a", "to_stop": "c", "line": "1", "dist_m": 398861},
            {"route_type": 3, "trip_id": "t2", "from_stop": "a", "to_stop": "b", "line": "TàD", "dist_m": 5000},
            {"route_type": None, "kind": "walk", "dist_m": 120}]
    raw = [{"n_hops": 2}, {"n_hops": 1}, {}]
    coords = {"a": (48.0, 2.0), "b": (48.01, 2.0), "c": (48.02, 2.0)}
    ie.apply_stop_distances(legs, raw, ie.TripStops({"t1": ["a", "b", "c"], "t2": ["a", "b"]}, coords,
                                                    frozenset({"t2"})))
    assert 2200 < legs[0]["dist_m"] < 2250
    assert legs[1]["dist_m"] is None and legs[1]["on_demand"] and "demande" in legs[1]["dist_reason"]
    assert legs[2]["dist_m"] == 120


def test_typo_removes_long_dashes_from_labels():
    assert ie.typo("Gare de Lagny " + chr(0x2013) + " Thorigny") == "Gare de Lagny - Thorigny"
    assert ie.typo(None) is None
