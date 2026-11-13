"""Calculateur intégré : préparation d'un mini-GTFS puis recherche d'itinéraires."""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.router import build, engine

PARIS = ZoneInfo("Europe/Paris")
# Deux lignes : métro 1 (A → B → C, accessible) et RER A (C → D, non accessible), correspondance à C
FILES = {
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n"
                  "IDFM:C01371,X,1,1,1,FFCD00,000000\nIDFM:C01742,X,A,A,2,EB2132,FFFFFF\nIDFM:BUS,X,38,38,3,,\n",
    "trips.txt": "route_id,service_id,trip_id,trip_headsign,wheelchair_accessible\n"
                 "IDFM:C01371,S1,m1,Vers C,1\nIDFM:C01371,S1,m2,Vers C,1\nIDFM:C01742,S1,r1,Vers D,2\nIDFM:BUS,S1,b1,Bus,1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                      "m1,08:00:00,08:00:00,IDFM:a,1\nm1,08:05:00,08:05:00,IDFM:b,2\nm1,08:10:00,08:10:00,IDFM:c,3\n"
                      "m2,08:20:00,08:20:00,IDFM:a,1\nm2,08:25:00,08:25:00,IDFM:b,2\nm2,08:30:00,08:30:00,IDFM:c,3\n"
                      "r1,08:15:00,08:15:00,IDFM:c2,1\nr1,08:30:00,08:30:00,IDFM:d,2\n"
                      "b1,08:00:00,08:00:00,IDFM:a,1\nb1,08:01:00,08:01:00,IDFM:d,2\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station,wheelchair_boarding\n"
                 "IDFM:a,A,48.850,2.300,0,IDFM:1001,1\nIDFM:b,B,48.850,2.330,0,IDFM:1002,1\nIDFM:c,C,48.850,2.360,0,IDFM:1003,1\n"
                 "IDFM:c2,C RER,48.850,2.361,0,IDFM:1003,1\nIDFM:d,D,48.850,2.420,0,IDFM:1004,2\n"
                 "IDFM:1001,A,48.85,2.30,1,,\nIDFM:1002,B,48.85,2.33,1,,\nIDFM:1003,C,48.85,2.36,1,,\nIDFM:1004,D,48.85,2.42,1,,\n",
    "transfers.txt": "from_stop_id,to_stop_id,transfer_type,min_transfer_time\nIDFM:c,IDFM:c2,2,180\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS1,1,1,1,1,1,0,0,20261012,20261113\n",
    "calendar_dates.txt": "service_id,date,exception_type\nS1,20261019,2\n",
}


@pytest.fixture
def net(tmp_path, monkeypatch):
    src = tmp_path / "gtfs"
    src.mkdir()
    for name, text in FILES.items():
        (src / name).write_text(text, encoding="utf-8")
    monkeypatch.setattr(build, "OUT", tmp_path / "data")
    stats = build.build(src)
    assert stats["routes"] == 3 and stats["connections"] == 6  # bus compris
    return engine.Network(tmp_path / "data")


def at(h, m, day=16):
    return datetime(2026, 10, day, h, m, tzinfo=PARIS)


def search(net, when, wheelchair=False):
    raw = net.earliest((48.850, 2.300), (48.850, 2.420), when.hour * 3600 + when.minute * 60, when.date(), wheelchair)
    return raw and engine.to_itinerary(net, raw, (48.850, 2.300), (48.850, 2.420), when.date(), "Maison", "Travail", wheelchair)


def test_transfer_between_lines(net):
    it = search(net, at(7, 55))
    rides = [(l["line"], l["from"]["name"], l["to"]["name"]) for l in it["legs"] if l["mode"] != "WALK"]
    assert rides == [("1", "A", "C"), ("A", "C", "D")]
    metro = next(l for l in it["legs"] if l["line"] == "1")
    assert it["end"].startswith("2026-10-16T08:30") and [s["name"] for s in metro["stops"]] == ["B"]
    assert metro["from"]["stop_id"] == "STIF:StopArea:SP:1001:" and metro["mode"] == "SUBWAY"
    # Correspondance à pied de C (métro) à C RER : 3 min déclarées dans transfers.txt
    walk = next(l for l in it["legs"] if l["mode"] == "WALK" and l["from"]["name"] == "C")
    assert walk["start"].startswith("2026-10-16T08:10") and walk["end"].startswith("2026-10-16T08:13")
    assert it["accessible"] is False  # RER A et gare D non accessibles dans ce GTFS


def test_missed_connection_gives_no_trip(net):
    # Le métro de 8 h 20 arrive à C à 8 h 30, après le départ du RER : pas d'itinéraire
    assert search(net, at(8, 15)) is None


def test_wheelchair_mode_and_calendar(net):
    assert search(net, at(7, 55), wheelchair=True) is None   # D n'est pas accessible
    assert search(net, at(7, 55, day=17)) is None              # samedi : pas de service
    assert search(net, at(7, 55, day=19)) is None              # jour retiré (calendar_dates)


def test_bus_only_when_requested(net):
    # Le bus 38 relie A à D en 1 min : choisi seulement si l'usager accepte le bus
    raw = net.earliest((48.850, 2.300), (48.850, 2.420), 7 * 3600 + 55 * 60, at(7, 55).date(), False, bus=True)
    it = engine.to_itinerary(net, raw, (48.850, 2.300), (48.850, 2.420), at(7, 55).date(), "Maison", "Travail", False)
    assert [(l["mode"], l["line"]) for l in it["legs"] if l["mode"] != "WALK"] == [("BUS", "38")]
    assert [l["line"] for l in search(net, at(7, 55))["legs"] if l["mode"] != "WALK"] == ["1", "A"]


def test_station_search_words():
    """Recherche de gares : sans accents, début de mot et faute de frappe d'une lettre (« lion » pour « lyon »)."""
    assert engine._norm("Gare Saint-Lazare") == ["gare", "saint", "lazare"]
    assert engine._norm("Châtelet") == ["chatelet"]
    assert engine._close("lazar", "lazare") and engine._close("lion", "lyon") and engine._close("chatlet", "chatelet")
    assert not engine._close("nord", "nation") and not engine._close("de", "da")
