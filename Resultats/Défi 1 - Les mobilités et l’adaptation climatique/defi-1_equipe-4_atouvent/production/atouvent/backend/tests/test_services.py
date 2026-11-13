from datetime import datetime, timedelta, timezone

import httpx

from app.collectors.common import select_changes
from app.services import open_meteo, planner, trips
from app.services.history import reconstruct
from app.services.prim import parse_siri
from tests.conftest import sample_trip

NOW = datetime(2026, 7, 1, 12, tzinfo=timezone.utc)


def test_select_changes_keeps_changes_and_heartbeat():
    latest = {"a": {"hash": select_changes([{"id": "a", "v": 1}], {}, "id", ["v"], NOW, timedelta(hours=1))[0]["_hash"],
                    "written_at": NOW - timedelta(hours=2)}}
    rows = [{"id": "a", "v": 1}, {"id": "b", "v": 2}]
    out = {r["id"]: r["_reason"] for r in select_changes(rows, latest, "id", ["v"], NOW, timedelta(hours=1))}
    assert out == {"a": "battement", "b": "premier relevé"}


def test_history_gap_is_unknown_not_zero():
    docs = [{"ts": NOW, "bikes": 4}]
    runs = [NOW, NOW + timedelta(minutes=5)]  # collecte arrêtée ensuite
    out = reconstruct(docs, runs, NOW, NOW + timedelta(hours=1), timedelta(minutes=30), "bikes", timedelta(minutes=15))
    assert [p["value"] for p in out] == [4, None, None]


def test_hazards_cover_all_weather():
    assert open_meteo.hazards({"temperature_2m_max": 35}) == ["chaleur"]
    assert open_meteo.hazards({"temperature_2m_min": -7}) == ["grand_froid"]
    assert open_meteo.hazards({"snowfall_sum": 2}) == ["neige_verglas"]
    assert open_meteo.hazards({"weather_code": 95}) == ["orages_pluie"]
    assert open_meteo.hazards({"wind_gusts_10m_max": 80}) == ["vent_fort"]
    assert open_meteo.hazards({"temperature_2m_min": -1, "precipitation_sum": 3}) == ["neige_verglas"]
    assert open_meteo.hazards({}) == []


def test_parse_siri():
    payload = {"Siri": {"ServiceDelivery": {"StopMonitoringDelivery": [{"MonitoredStopVisit": [
        {"MonitoredVehicleJourney": {"LineRef": {"value": "A"}, "DestinationName": [{"value": "Cergy"}],
                                     "MonitoredCall": {"ExpectedDepartureTime": "2026-07-01T12:05:00Z"}}}]}]}}}
    assert parse_siri(payload)[0] == {"line": "A", "destination": "Cergy", "expected": "2026-07-01T12:05:00Z",
                                      "aimed": None, "realtime": True}


def _weather_client(tmax=35.0):
    def handler(request):
        hours = [f"2026-07-01T{h:02d}:00" for h in range(24)]
        return httpx.Response(200, json={
            "hourly": {"time": hours, "temperature_2m": [30.0] * 24, "apparent_temperature": [33.0] * 24,
                       "precipitation": [0.0] * 24, "snowfall": [0.0] * 24, "wind_gusts_10m": [20.0] * 24,
                       "weather_code": [0] * 24},
            "daily": {"time": ["2026-07-01"], "temperature_2m_max": [tmax], "temperature_2m_min": [20.0],
                      "precipitation_sum": [0.0], "snowfall_sum": [0.0], "wind_gusts_10m_max": [20.0], "weather_code": [0]}})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_bundle_warns_before_underground_and_elevator(db):
    trip = sample_trip(when=NOW, accessible=True)
    db.elevator_latest.insert_one({"elevator_id": "e1", "station": "Charles de Gaulle-Étoile", "status": "hors_service"})
    b = trips.build_bundle(db, trip, guard=None, weather_client=_weather_client())
    codes = [w["code"] for w in b["warnings"]]
    assert "underground" in codes
    elev = next(w for w in b["warnings"] if w["code"] == "elevator_out")
    assert elev["station"] == "Charles de Gaulle-Étoile" and elev["priority"] == "high"
    assert b["hazards"] == ["chaleur"] and b["weather_arrival"]["temperature"] == 30.0


def test_bundle_survives_weather_failure(db):
    failing = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    b = trips.build_bundle(db, sample_trip(when=NOW), weather_client=failing)
    assert b["weather_arrival"] is None and b["weather_error"] == "HTTPStatusError"


def test_otp_normalize_marks_underground():
    it = {"startTime": 0, "endTime": 60000, "legs": [
        {"mode": "SUBWAY", "startTime": 0, "endTime": 60000, "route": {"shortName": "14"},
         "from": {"name": "A", "lat": 48.8, "lon": 2.3}, "to": {"name": "B", "lat": 48.9, "lon": 2.4, "stop": {"gtfsId": "S:B"}},
         "intermediatePlaces": []}]}
    leg = planner.normalize(it, True)["legs"][0]
    assert leg["underground"] and leg["line"] == "14" and leg["to"]["stop_id"] == "S:B"


def test_empty_elevator_feed_is_a_failure(db):
    from app.collectors import ascenseurs
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=[])))
    run = ascenseurs.collect(db, client)
    assert run["ok"] is False and "IDFM_API_KEY" in run["error"]


def test_places_normalized_filtered_and_cached(db):
    from app.services import places
    calls = []
    rows = {
        "fontaines-a-boire": [{"voie": "RUE X", "dispo": "OUI", "geo_point_2d": {"lat": 48.8501, "lon": 2.3501}},
                              {"voie": "RUE EN PANNE", "dispo": "NON", "geo_point_2d": {"lat": 48.8502, "lon": 2.3502}}],
        "fontaines-arrets-de-transport-en-commun-didf": [],
        "sanisettesparis": [{"adresse": "1 rue y", "statut": "En service", "horaire": "24/24h", "acces_pmr": "Oui",
                             "geo_point_2d": {"lat": 48.8503, "lon": 2.3503}}],
        "sanitaires-reseau-ratp": [],
    }

    def handler(req):
        calls.append(req.url.path)
        name = req.url.path.split("/datasets/")[1].split("/")[0]
        return httpx.Response(200, json=rows.get(name, []))
    client = httpx.Client(transport=httpx.MockTransport(handler))
    f = places.near(db, "fountain", 48.85, 2.35, client=client)
    assert [x["name"] for x in f] == ["Rue X"]  # la fontaine en panne est écartée
    t = places.near(db, "toilets", 48.85, 2.35, client=client)
    assert t[0]["name"] == "1 rue y".capitalize() and t[0]["pmr"] is True and t[0]["hours"] == "24/24h"
    places.near(db, "fountain", 48.85, 2.35, client=client)
    assert len(calls) == 4  # une requête par source, puis le cache

def test_geocode_keeps_named_places_in_ile_de_france():
    from app.services.geocode import parse
    poi = lambda name, code: {"geometry": {"coordinates": [2.37, 48.84]}, "properties": {"name": [name], "city": ["Paris 12e"], "citycode": [code, "75056"], "_type": "poi"}}
    out = parse({"features": [poi("Gare de Lyon", "75112"), poi("Gare de Lyon", "75112"), poi("Gare de Lyon-Gorge-de-Loup", "69389"),
                              {"geometry": {"coordinates": [2.3, 48.8]}, "properties": {"label": "1 rue X 75001 Paris", "citycode": "75101"}}]})
    assert [o["label"] for o in out] == ["Gare de Lyon, Paris 12e", "1 rue X 75001 Paris"]


def test_seine_level_and_trend():
    from app.services.hydro import parse
    obs = [{"date_obs": "2026-10-15T20:40:00Z", "resultat_obs": 1100.0}] + [{"date_obs": "x", "resultat_obs": 1000.0}] * 12
    assert parse({"data": obs}) == {"level_m": 1.1, "at": "2026-10-15T20:40:00Z", "trend": "hausse",
                                    "station": "La Seine à Paris-Austerlitz", "source": "Hub'Eau hydrométrie, La Seine à Paris-Austerlitz"}
    assert parse({"data": []}) is None


def test_idfm_lift_status_values():
    from app.collectors.ascenseurs import normalize
    rows, missing = normalize([{"liftid": "a", "liftstatus": "notavailable", "zdcname": "Barbès"},
                               {"liftid": "b", "liftstatus": "available"}, {"liftid": "c", "liftstatus": "unknown"}])
    assert [r["status"] for r in rows] == ["hors_service", "en_service", "inconnu"] and not missing


def test_traffic_keeps_active_rail_disruptions_with_tags():
    from zoneinfo import ZoneInfo
    from app.services import traffic
    now = datetime(2026, 10, 16, 8, 0, tzinfo=ZoneInfo("Europe/Paris"))
    period = [{"begin": "20261016T060000", "end": "20261016T200000"}]
    payload = {"disruptions": [
        {"id": "d1", "cause": "PERTURBATION", "severity": "BLOQUANTE", "title": "RER B : trafic interrompu", "message": "<p>En raison de la <b>chaleur</b>…</p>", "applicationPeriods": period},
        {"id": "d2", "cause": "TRAVAUX", "severity": "PERTURBEE", "title": "Ascenseur fermé", "message": "", "applicationPeriods": period},
        {"id": "d3", "cause": "TRAVAUX", "severity": "BLOQUANTE", "title": "Plus tard", "message": "", "applicationPeriods": [{"begin": "20261017T060000", "end": "20261017T200000"}]},
        {"id": "d4", "cause": "TRAVAUX", "severity": "BLOQUANTE", "title": "Bus dévié", "message": "", "applicationPeriods": period}],
        "lines": [{"id": "line:IDFM:C01743", "shortName": "B", "mode": "RapidTransit", "impactedObjects": [{"disruptionIds": ["d1", "d3"]}]},
                  {"id": "line:IDFM:C01371", "shortName": "1", "mode": "Metro", "impactedObjects": [{"disruptionIds": ["d2"]}]},
                  {"id": "line:IDFM:C01279", "shortName": "312", "mode": "Bus", "impactedObjects": [{"disruptionIds": ["d4"]}]}]}
    out = traffic.parse(payload, now)
    assert [(x["line"], x["tags"]) for x in out["items"]] == [("B", ["meteo"]), ("1", ["acces", "travaux"])]
    assert out["rail"] == 2 and out["bus"] == 1 and "chaleur" in out["items"][0]["message"]


def test_flood_vigilance_uses_idf_sections_only():
    from app.services.flood import parse
    feat = lambda code, name, lvl: {"properties": {"CdEntCru": code, "lbentcru": name, "NivInfViCr": lvl}}
    out = parse({"features": [feat("IF5", "Seine à Paris", 2), feat("IF22", "Yerres", 3), feat("NO2", "Epte", 4)]})
    assert out["level"] == 3 and out["color"] == "orange" and out["paris"] == "jaune"
    assert [w["name"] for w in out["watch"]] == ["Seine à Paris", "Yerres"]


def test_air_quality_daily_levels_and_pollution():
    from app.services import air
    hourly = {"time": ["2026-10-16T08:00", "2026-10-16T15:00", "2026-10-17T08:00"], "european_aqi": [35, 72, 18],
              "pm2_5": [8, 30, 5], "pm10": [12, 40, 9], "ozone": [40, 120, 30], "nitrogen_dioxide": [20, 25, 10],
              "uv_index": [1, 7, 2], "birch_pollen": [0, 0, 0], "grass_pollen": [10, 60, 0], "ragweed_pollen": [0, 0, 0]}
    d = air.daily(hourly)
    assert d["2026-10-16"]["aqi"] == 72 and d["2026-10-16"]["level"] == "degrade" and d["2026-10-16"]["pollution"] is True
    assert d["2026-10-16"]["uv_high"] is True and d["2026-10-16"]["pollen_high"] is True
    assert d["2026-10-17"]["level"] == "bon" and d["2026-10-17"]["pollution"] is False


def test_official_vigilance_keeps_idf_orange_and_above():
    from app.services import vigilance
    payload = {"product": {"periods": [
        {"echeance": "J", "timelaps": {"domain_ids": [
            {"domain_id": "75", "phenomenon_items": [{"phenomenon_id": "6", "phenomenon_max_color_id": 3, "timelaps_items": [
                {"begin_time": "2026-07-01T10:00:00Z", "end_time": "2026-07-01T20:00:00Z", "color_id": 3},
                {"begin_time": "2026-07-01T00:00:00Z", "end_time": "2026-07-01T10:00:00Z", "color_id": 1}]}]},
            {"domain_id": "92", "phenomenon_items": [{"phenomenon_id": "6", "phenomenon_max_color_id": 2},
                                                     {"phenomenon_id": "1", "phenomenon_max_color_id": 1}]},
            {"domain_id": "13", "phenomenon_items": [{"phenomenon_id": "6", "phenomenon_max_color_id": 4}]}]}},
        {"echeance": "J1", "timelaps": {"domain_ids": []}}]}}
    v = vigilance.parse(payload)
    assert v["J"] == {"chaleur": {"level": 3, "color": "orange", "departments": ["75", "92"],
                                  "start": "2026-07-01T10:00:00Z", "end": "2026-07-01T20:00:00Z"}}  # rouge des Bouches-du-Rhône ignoré
    assert v["J1"] == {}


def test_vigilance_without_key_says_so(db, monkeypatch):
    from app.services import vigilance
    import dataclasses
    monkeypatch.setattr(vigilance, "settings", dataclasses.replace(vigilance.settings, meteofrance_api_key=""))
    assert vigilance.current(db) == {"available": False, "reason": "key_missing"}


def test_walks_get_shade_and_works(db, monkeypatch):
    from app.services import places, trips
    monkeypatch.setattr(places, "load", lambda db, name, client=None: [
        {"kind": "works", "name": "Rue A", "type": "Voirie", "detail": "Trottoir fermé", "sidewalk": True, "lat": 48.8700, "lon": 2.3000},
        {"kind": "works", "name": "Loin", "type": "Voirie", "detail": "", "sidewalk": False, "lat": 48.9000, "lon": 2.4000}])
    it = {"legs": [{"mode": "WALK", "from": {"lat": 48.8698, "lon": 2.3005}, "to": {"lat": 48.8702, "lon": 2.2995}},
                   {"mode": "BUS", "from": {"lat": 48.87, "lon": 2.30}, "to": {"lat": 48.88, "lon": 2.31}}]}
    trips.annotate_walks(db, it)
    assert [w["name"] for w in it["works"]] == ["Rue A"] and it["works"][0]["sidewalk"] is True
    assert "shade" in it["legs"][0] and "shade" not in it["legs"][1]



def test_access_verified_stop_by_stop():
    from app.services import trips
    leg = lambda a, b, wc=1: {"mode": "BUS", "line": "29", "wheelchair": wc, "from": {"name": "A", "info": a}, "to": {"name": "B", "info": b}}
    ok = trips.verify_access({"legs": [leg({"access": 1}, {"access": 1})]})
    assert ok["access"] == {"status": "ok", "issues": []} and ok["accessible"] is True
    assisted = trips.verify_access({"legs": [leg({"station_access": "reservation"}, {"access": 1})]})
    assert assisted["access"]["status"] == "assisted" and assisted["access"]["issues"][0]["reason"] == "station_reservation"
    ko = trips.verify_access({"legs": [leg({"access": 1}, {"access": 1}, wc=2)], "elevators_out": []})
    assert ko["access"]["status"] == "ko" and ko["access"]["issues"][0]["reason"] == "vehicle"
    lift = trips.verify_access({"legs": [leg({"access": 1}, {"access": 1})], "elevators_out": [{"station": "B"}]})
    assert lift["access"]["issues"] == [{"stop": "B", "state": "ko", "reason": "elevator"}]
    unknown = trips.verify_access({"legs": [leg({}, {"access": 1})]})
    assert unknown["access"]["status"] == "unknown" and unknown["accessible"] is False


def test_flood_exposure_rer_c_only():
    from app.services import trips
    it = {"legs": [{"mode": "RAIL", "line": "C", "from": {"name": "Gare d'Austerlitz"}, "stops": [{"name": "Saint-Michel Notre-Dame"}],
                    "to": {"name": "Versailles Château Rive Gauche"}},
                   {"mode": "SUBWAY", "line": "4", "from": {"name": "Saint-Michel"}, "to": {"name": "Châtelet"}}]}
    assert trips.flood_exposure(it) == ["Gare d'Austerlitz", "Saint-Michel Notre-Dame"]


def test_hourly_hazard_episodes():
    from datetime import datetime, timezone
    from app.services import open_meteo
    data = {"hourly": {"time": ["2026-07-01T15:00", "2026-07-01T16:00", "2026-07-01T17:00", "2026-07-01T18:00"],
                       "weather_code": [1, 1, 95, 95], "precipitation": [0, 0, 6, 3], "temperature_2m": [34, 35, 28, 25],
                       "wind_gusts_10m": [20, 20, 70, 40], "snowfall": [0, 0, 0, 0]}}
    eps = open_meteo.hourly_hazards(data, datetime(2026, 7, 1, 13, 10, tzinfo=timezone.utc))  # 15 h 10 à Paris
    assert {e["hazard"]: (e["start"][11:16], e["end"][11:16]) for e in eps} == {
        "chaleur": ("15:00", "16:00"), "orages_pluie": ("17:00", "18:00"), "vent_fort": ("17:00", "17:00")}



def test_line_status_summary():
    from app.services import line_status
    vj = lambda aim, exp: {"EstimatedCalls": {"EstimatedCall": [{"AimedDepartureTime": aim, "ExpectedDepartureTime": exp}]}}
    payload = {"Siri": {"ServiceDelivery": {"EstimatedTimetableDelivery": [{"EstimatedJourneyVersionFrame": [{"EstimatedVehicleJourney": [
        vj("2026-10-16T08:00:00Z", "2026-10-16T08:06:00Z"), vj("2026-10-16T08:05:00Z", "2026-10-16T08:05:00Z")]}]}]}}}
    assert line_status.summarize(payload) == {"journeys": 2, "late": 1, "avg_delay_min": 3.0, "max_delay_min": 6}


def test_vigilance_texts_only_for_idf():
    from app.services import vigilance
    doc = {"product": {"text_bloc_items": [
        {"domain_id": "75", "bloc_items": [{"text_items": [{"text": ["Canicule : buvez régulièrement."]}]}]},
        {"domain_id": "13", "bloc_items": [{"text_items": [{"text": ["Mistral violent."]}]}]}]}}
    assert vigilance._texts(doc) == ["Canicule : buvez régulièrement."]


def test_shade_along_real_path_and_unreliable_lifts():
    from app.router import shade
    from app.services import trips
    assert shade.score_path([[2.35, 48.85]]) is None
    it = {"legs": [{"mode": "RAIL", "from": {"name": "Pontoise", "info": {"lift_downtime": 0.79}},
                    "to": {"name": "Cergy", "info": {"lift_downtime": 0.05}}}]}
    assert trips.unreliable_lifts(it) == [{"station": "Pontoise", "share": 0.79}]



def test_walk_or_bike_only_has_no_access_claim():
    from app.services import trips
    it = trips.verify_access({"legs": [{"mode": "BICYCLE", "from": {"name": "A"}, "to": {"name": "B"}}]})
    assert it["access"] is None and it["accessible"] is False



def test_carbon_footprint_vs_car():
    from app.services import carbon
    f = {"SUBWAY": 4.2, "RAIL": 6.6, "TRAM": 3.8, "BUS": 113.5, "VELIB": 2.23, "BICYCLE": 0.0, "WALK": 0.0, "CAR": 110.6}
    leg = lambda mode, a, b, **k: {"mode": mode, "from": {"lat": a[0], "lon": a[1]}, "to": {"lat": b[0], "lon": b[1]}, **k}
    metro = {"legs": [leg("WALK", (48.85, 2.30), (48.85, 2.301), distance_m=100), leg("SUBWAY", (48.85, 2.301), (48.85, 2.40))]}
    out = carbon.footprint(metro, f)
    assert out["km"] > 7 and 25 < out["co2_g"] < 40 and out["car_g"] > 900 and out["saved_g"] == out["car_g"] - out["co2_g"]
    bike = carbon.footprint({"source": "bike", "legs": [leg("BICYCLE", (48.85, 2.30), (48.85, 2.40))]}, f)
    assert bike["co2_g"] == 0
    assert carbon.footprint({"source": "velib", "legs": [leg("BICYCLE", (48.85, 2.30), (48.85, 2.40))]}, f)["co2_g"] > 0



def test_data_health_flags_missing_and_stale(db):
    from datetime import datetime, timedelta, timezone
    from app.services import data_health
    now = datetime.now(timezone.utc)
    db.collection_runs.insert_many([{"source": "velib_status", "started_at": now - timedelta(minutes=2), "ok": True},
                                    {"source": "elevators", "started_at": now - timedelta(hours=10), "ok": True}])
    rep = {s["key"]: s for s in data_health.check(db)["sources"]}
    assert rep["velib_status"]["status"] == "ok"
    assert rep["elevators"]["status"] == "ko"          # 10 h sans collecte réussie
    assert rep["velib_values"]["status"] == "ko"       # aucune station en base : jamais présenté comme bon
    assert data_health.check(db)["status"] == "ko"


def test_gtfs_refresh_decision(monkeypatch):
    from datetime import date, datetime, timedelta, timezone
    from app.router import refresh
    monkeypatch.setattr(refresh, "valid_until", lambda: date.today() + timedelta(days=5))
    assert refresh.needs_refresh()[0] is True       # expire bientôt
    monkeypatch.setattr(refresh, "valid_until", lambda: date.today() + timedelta(days=30))
    monkeypatch.setattr(refresh, "upstream_modified", lambda client=None: datetime(2026, 10, 16, tzinfo=timezone.utc))
    monkeypatch.setattr(refresh, "state", lambda: {"upstream_modified": "2026-10-15T00:00:00+00:00"})
    assert refresh.needs_refresh()[0] is True       # IDFM a publié plus récent
    monkeypatch.setattr(refresh, "state", lambda: {"upstream_modified": "2026-10-16T00:00:00+00:00"})
    assert refresh.needs_refresh()[0] is False



def test_night_lift_stop_is_not_a_failure():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.collectors import ascenseurs
    rec = {"liftid": "L1", "liftstatus": "notavailable", "liftreason": "liftFailure", "liftstateupdate": "2026-10-17T01:12"}
    at = lambda h, m=0: datetime(2026, 10, 17, h, m, tzinfo=ZoneInfo("Europe/Paris"))
    assert ascenseurs.normalize([rec], at(3))[0][0]["status"] == "ferme_nuit"       # en pleine nuit
    assert ascenseurs.normalize([rec], at(8))[0][0]["status"] == "hors_service"     # pas reparti au matin : vraie panne
    day = {**rec, "liftstateupdate": "2026-10-17T14:05"}
    assert ascenseurs.normalize([day], at(15))[0][0]["status"] == "hors_service"


def test_planned_weather_inside_and_beyond_horizon():
    """Trajet à venir : conditions à l'heure de départ ; rien d'inventé au-delà de la prévision."""
    start = datetime(2026, 7, 1, 0, 0)
    times = [(start + timedelta(hours=h)).isoformat(timespec="minutes") for h in range(48)]
    n = len(times)
    fc = {"hourly": {"time": times, "temperature_2m": [36.0] * n, "apparent_temperature": [38.0] * n, "precipitation": [0.0] * n,
                     "snowfall": [0.0] * n, "wind_gusts_10m": [10.0] * n, "weather_code": [0] * n}}
    at = datetime(2026, 7, 1, 15, 0, tzinfo=open_meteo.PARIS)
    p = open_meteo.planned(fc, at)
    assert p["time"] == "2026-07-01T15:00" and p["temperature"] == 36.0
    assert [h["hazard"] for h in p["hours"]] == ["chaleur"]
    assert open_meteo.planned(fc, at + timedelta(days=5)) is None


def test_plan_forwards_departure_time_and_rejects_far_future(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(planner, "plan", lambda *a, **k: seen.update(k) or [])
    pt = {"lat": 48.85, "lon": 2.35}
    later = datetime.now(timezone.utc) + timedelta(days=2)
    r = client.post("/api/v1/trips/plan", json={"origin": pt, "destination": pt, "depart_at": later.isoformat()})
    assert r.status_code == 200 and abs((seen["when"] - later).total_seconds()) < 1
    far = datetime.now(timezone.utc) + timedelta(days=60)
    assert client.post("/api/v1/trips/plan", json={"origin": pt, "destination": pt, "depart_at": far.isoformat()}).status_code == 422


def test_collector_retries_transient_network_errors(db):
    """Un délai dépassé ponctuel (ex. Vélib' : ConnectTimeout) ne devient une erreur que si les 3 essais échouent."""
    from app.collectors.common import run_logged
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectTimeout("timed out")
        return {"n_fetched": 1}
    run = run_logged(db, "velib_status", flaky, waits=(0, 0))
    assert run["ok"] and run["attempts"] == 3 and "error" not in run

    def down():
        raise httpx.ConnectTimeout("timed out")
    run = run_logged(db, "velib_status", down, waits=(0, 0))
    assert not run["ok"] and run["attempts"] == 3 and run["error"].startswith("ConnectTimeout")
