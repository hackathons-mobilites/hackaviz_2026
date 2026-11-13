"""Collecte Vélib' (GBFS).
Lancer une fois à la main :  python -m app.collectors.velib"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
from pymongo import UpdateOne

from ..core.config import settings
from ..services import http
from .common import select_changes, utcnow, run_logged

STATE_FIELDS = ["bikes", "mechanical", "ebike", "docks", "renting", "returning", "installed"]


def _types(s: dict) -> tuple[int | None, int | None]:
    mech = ebike = None
    for t in s.get("num_bikes_available_types") or []:
        if "mechanical" in t:
            mech = t["mechanical"]
        if "ebike" in t:
            ebike = t["ebike"]
    return mech, ebike


def parse_status(payload: dict) -> list[dict]:
    rows = []
    for s in payload.get("data", {}).get("stations", []):
        mech, ebike = _types(s)
        lr = s.get("last_reported")
        rows.append({
            "station_id": str(s.get("station_id")),
            "bikes": s.get("num_bikes_available"),
            "mechanical": mech,
            "ebike": ebike,
            "docks": s.get("num_docks_available"),
            "renting": bool(s.get("is_renting")),
            "returning": bool(s.get("is_returning")),
            "installed": bool(s.get("is_installed")),
            "last_reported": datetime.fromtimestamp(lr, timezone.utc) if isinstance(lr, (int, float)) and lr > 0 else None,
        })
    return rows


def parse_information(payload: dict) -> list[dict]:
    out = []
    for s in payload.get("data", {}).get("stations", []):
        if s.get("lat") is None or s.get("lon") is None:
            continue
        out.append({
            "station_id": str(s.get("station_id")),
            "name": s.get("name"),
            "capacity": s.get("capacity"),
            "location": {"type": "Point", "coordinates": [float(s["lon"]), float(s["lat"])]},
        })
    return out


def store_status(db, rows: list[dict], now: datetime) -> dict:
    latest = {d["station_id"]: d for d in db.velib_latest.find({}, {"_id": 0})}
    changes = select_changes(rows, latest, "station_id", STATE_FIELDS, now, timedelta(minutes=settings.velib_heartbeat_min))
    if changes:
        db.velib_status.insert_many([
            {"ts": now, "meta": {"station_id": c["station_id"]}, **{f: c[f] for f in STATE_FIELDS},
             "last_reported": c["last_reported"], "reason": c["_reason"]} for c in changes])
        db.velib_latest.bulk_write([
            UpdateOne({"station_id": c["station_id"]},
                      {"$set": {"station_id": c["station_id"], "hash": c["_hash"], "written_at": now,
                                **{f: c[f] for f in STATE_FIELDS}}}, upsert=True) for c in changes])
    return {"n_fetched": len(rows), "n_written": len(changes)}


def collect_status(db, client: httpx.Client | None = None) -> dict:
    def job():
        c = client or http.shared()
        r = c.get(settings.velib_status_url, timeout=20)
        r.raise_for_status()
        return store_status(db, parse_status(r.json()), utcnow())
    return run_logged(db, "velib_status", job)


def collect_information(db, client: httpx.Client | None = None) -> dict:
    def job():
        c = client or http.shared()
        r = c.get(settings.velib_info_url, timeout=20)
        r.raise_for_status()
        rows = parse_information(r.json())
        if rows:
            db.velib_stations.bulk_write([UpdateOne({"station_id": s["station_id"]}, {"$set": s}, upsert=True) for s in rows])
        return {"n_fetched": len(rows), "n_written": len(rows)}
    return run_logged(db, "velib_information", job)


if __name__ == "__main__":
    from ..core.db import get_db, init_db
    d = get_db(); init_db(d)
    print(collect_information(d)); print(collect_status(d))
