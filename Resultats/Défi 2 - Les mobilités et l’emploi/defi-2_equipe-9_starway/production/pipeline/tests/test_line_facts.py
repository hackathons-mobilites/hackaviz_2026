"""Tests sans Java : climatisation (TRA03) et ponctualité (QS01) par ligne des itinéraires (06h, 04/11/2026)."""

from __future__ import annotations

import pandas as pd

from starway import fares_carbon as fc
from starway import itin_export as ie
from starway import itineraries as it
from starway import line_facts as lf

TRA03 = pd.DataFrame([{"id_line": "C01742", "air_conditioning": "true"},
                      {"id_line": "C01743", "air_conditioning": "partial"},
                      {"id_line": "C00001", "air_conditioning": ""},
                      {"id_line": "C00002", "air_conditioning": "maybe"}])
QS01 = pd.DataFrame([{"date": "2026-09", "service": "RER", "ligne": "A", "taux_de_ponctualite": "89.4"},
                     {"date": "2026-08", "service": "RER", "ligne": "A", "taux_de_ponctualite": "91.0"},
                     {"date": "2026-08", "service": "Transilien", "ligne": "H", "taux_de_ponctualite": "95.1"},
                     {"date": "2026-09", "service": "Transilien", "ligne": "J", "taux_de_ponctualite": ""}])


def facts() -> lf.LineFacts:
    punct, covered, month = lf.load_punctuality(QS01)
    return lf.LineFacts(lf.load_ac(TRA03), punct, covered, month)


def test_air_conditioning_copied_as_is_and_unknown_otherwise():
    ac = lf.load_ac(TRA03)
    assert ac == {"C01742": "true", "C01743": "partial", "C00001": "unknown", "C00002": "unknown"}
    f = facts()
    assert f.leg_fields("rer", "IDFM:C01742", "A")["air_conditioning"] == "true"
    assert f.leg_fields("bus", "IDFM:C99999", "1")["air_conditioning"] is None  # absente du référentiel


def test_punctuality_latest_month_only_never_an_older_value():
    f = facts()
    assert f.month == "2026-09"
    assert f.leg_fields("rer", "IDFM:C01742", "A")["punctuality"] == {"value_pct": 89.4, "month": "2026-09"}
    # ligne H : publiée en août seulement -> pas de valeur de septembre, pas de repli sur août
    assert f.leg_fields("train", None, "H")["punctuality"] == {"value_pct": None, "month": None,
                                                               "reason": lf.REASON_MONTH_MISSING}
    # ligne J : case vide au mois retenu
    assert f.leg_fields("train", None, "J")["punctuality"]["reason"] == lf.REASON_MONTH_MISSING
    # métro, tram, bus, TER, ligne absente du jeu : pas de donnée ouverte
    for kind, line in (("metro", "14"), ("tram", "T2"), ("bus", "129"), ("ter", "TER"), ("train", "V")):
        assert f.leg_fields(kind, None, line)["punctuality"] == {"value_pct": None, "month": None,
                                                                 "reason": lf.REASON_NO_OPEN_DATA}
    # RER A ne doit pas répondre à un Transilien « A »
    assert f.leg_fields("train", None, "A")["punctuality"]["value_pct"] is None
    assert f.seen["legs"] == 9


def test_route_line_id_strips_the_gtfs_prefix():
    assert lf.route_line_id("IDFM:C01742") == "C01742"
    assert lf.route_line_id("C01742") == "C01742"
    assert lf.route_line_id(None) is None


def test_published_meta_needs_the_same_block_everywhere():
    b = facts().file_meta()
    assert lf.published_meta([b, b])["texts"] == lf.TEXTS
    assert lf.published_meta([b, None]) is None
    assert lf.published_meta([b, {**b, "punctuality_month": "2026-08"}]) is None
    assert lf.published_meta([]) is None


def _doc_with_facts() -> dict:
    routes = pd.DataFrame([{"route_id": "IDFM:C01742", "agency_id": "R", "route_short_name": "A",
                            "route_long_name": "A", "route_type": "2", "route_color": "EB2132",
                            "route_text_color": "FFFFFF"}])
    agency = pd.DataFrame([{"agency_id": "R", "agency_name": "RER"}])
    stops = pd.DataFrame([{"stop_id": "IDFM:a", "stop_name": "Nation", "parent_station": None,
                           "wheelchair_boarding": "1"},
                          {"stop_id": "IDFM:b", "stop_name": "La Défense", "parent_station": None,
                           "wheelchair_boarding": "1"}])
    trips = pd.DataFrame([{"trip_id": "IDFM:t", "wheelchair_accessible": "1"}])
    gtfs = it.GtfsLookup.from_frames(routes, agency, stops, trips)
    dep = 8 * 3600
    legs = [{"kind": "walk", "role": "access", "from_stop": None, "to_stop": "F:IDFM:a", "dep_s": dep,
             "arr_s": dep + 300, "dist_m": 300.0},
            {"kind": "transit", "route_id": "IDFM:C01742", "trip": "F:IDFM:t", "route_type": 2,
             "from_stop": "F:IDFM:a", "to_stop": "F:IDFM:b", "ready_s": dep + 300, "dep_s": dep + 360,
             "arr_s": dep + 1200, "dist_m": 9000.0, "shape": True}]
    t = it.Task("93048", "P_DEF", "d09", "out", dep, 20, None)
    rec = it.record(t, it.STATUS_OK, {"dep_s": dep, "arr_s": dep + 1200, "legs": legs}, 0, 1)
    co2 = fc.co2_factors(pd.DataFrame([{"transportmode": "rail", "id_line": "C01742", fc.ENV01_MODE_COLUMN: "5.5"}]))
    return ie.commune_file("93048", [rec], ["P_DEF"], ["d09"], gtfs, {}, frozenset(), None, None, {}, co2,
                           facts=facts())


def test_commune_file_carries_line_facts_and_check_file_guards_them():
    doc = _doc_with_facts()
    assert doc["line_facts_meta"]["sources"] == ["TRA03", "QS01"]
    walk, rer = doc["days"]["d09"]["out"][0]["legs"]
    assert "air_conditioning" not in walk and "punctuality" not in walk
    assert rer["air_conditioning"] == "true"
    assert rer["punctuality"] == {"value_pct": 89.4, "month": "2026-09"}
    assert ie.check_file(doc, 120) == []
    rer["air_conditioning"] = "oui"
    assert any("climatisation" in e for e in ie.check_file(doc, 120))
    rer["air_conditioning"] = "true"
    rer["punctuality"] = {"value_pct": 89.4, "month": None}
    assert any("ponctualité" in e for e in ie.check_file(doc, 120))
    rer["punctuality"] = {"value_pct": None, "month": None}
    assert any("sans raison" in e for e in ie.check_file(doc, 120))
    del doc["line_facts_meta"]
    rer["punctuality"] = {"value_pct": None, "month": None, "reason": lf.REASON_NO_OPEN_DATA}
    assert any("sans line_facts_meta" in e for e in ie.check_file(doc, 120))
