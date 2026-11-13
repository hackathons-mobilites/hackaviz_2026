"""Vélo et marche : trajets calculés sans le GTFS."""
from datetime import datetime, timezone

from app.services import planner

WHEN = datetime(2026, 10, 16, 8, 0, tzinfo=timezone.utc)


def test_walk_only_for_short_trips():
    near = planner.walk_plan((48.850, 2.300, "A"), (48.855, 2.310, "B"), WHEN)
    assert len(near) == 1 and near[0]["legs"][0]["mode"] == "WALK"
    assert planner.walk_plan((48.85, 2.30, "A"), (48.90, 2.40, "B"), WHEN) == []


def test_bike_uses_velib_stations_with_bikes_and_docks(db):
    for sid, lat, lon in (("1", 48.8501, 2.3001), ("2", 48.8801, 2.3501), ("3", 48.8802, 2.3502)):
        db.velib_stations.insert_one({"station_id": sid, "name": f"S{sid}", "location": {"type": "Point", "coordinates": [lon, lat]}})
    db.velib_latest.insert_many([{"station_id": "1", "bikes": 3, "docks": 5, "renting": 1, "returning": 1},
                                 {"station_id": "2", "bikes": 4, "docks": 0, "renting": 1, "returning": 1},
                                 {"station_id": "3", "bikes": 0, "docks": 7, "renting": 1, "returning": 1}])
    its = planner.bike_plan(db, (48.850, 2.300, "A"), (48.880, 2.350, "B"), WHEN)
    velib = next(it for it in its if it["source"] == "velib")
    bike = next(l for l in velib["legs"] if l["mode"] == "BICYCLE")
    assert bike["from"]["name"] == "Vélib’ S1" and bike["to"]["name"] == "Vélib’ S3"  # S2 n'a plus de place
    assert any(it["source"] == "bike" for it in its)
