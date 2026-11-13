"""Flux en direct (Server-Sent Events) : le serveur pousse chaque changement à l'application, sans attendre qu'elle demande."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import httpx
from starlette.concurrency import run_in_threadpool

from . import flood, live, traffic, vigilance
from .geo import distance_m

TICK_S = 3
PING_S = 15
NEAR_M = 800


def _stamp(db, coll: str, field: str):
    d = db[coll].find_one({}, {field: 1}, sort=[(field, -1)])
    return str(d.get(field)) if d else None


def versions(db) -> dict:
    return {"traffic": _stamp(db, "traffic_cache", "at"), "elevators": _stamp(db, "elevator_latest", "written_at"),
            "velib": _stamp(db, "velib_latest", "written_at"), "reports": f"{_stamp(db, 'reports', 'created_at')}|{db.reports.estimated_document_count()}",
            "climate": f"{_stamp(db, 'weather_cache', 'fetched_at')}|{_stamp(db, 'vigilance_cache', 'at')}|{_stamp(db, 'flood_cache', 'at')}|{_stamp(db, 'air_cache', 'at')}"}


def payload(db, kind: str, lat: float, lon: float, lines: set[str]) -> dict | None:
    if kind == "traffic":
        try:
            items = traffic.current(db).get("items", [])
        except (traffic.TrafficUnavailable, httpx.HTTPError):
            return None
        return {"items": [x for x in items if not lines or x.get("line_id") in lines][:30]}
    if kind == "elevators":
        down = [{"station": d.get("station"), "situation": (d.get("situation") or "")[:200]}
                for d in db.elevator_latest.find({"status": "hors_service"}, {"station": 1, "situation": 1})]
        return {"out": len(down), "down": down if lines else [], "at": datetime.now(timezone.utc).isoformat()}
    if kind == "velib":
        out = []
        for s in db.velib_stations.find({}, {"station_id": 1, "name": 1, "location": 1}):
            slon, slat = s["location"]["coordinates"]
            d = distance_m((lat, lon), (slat, slon))
            if d <= NEAR_M:
                out.append((d, s))
        out.sort(key=lambda x: x[0])
        ids = [s["station_id"] for _, s in out[:8]]
        latest = {x["station_id"]: x for x in db.velib_latest.find({"station_id": {"$in": ids}}, {"_id": 0, "station_id": 1, "bikes": 1, "ebike": 1, "docks": 1})}
        return {"stations": [{"station_id": s["station_id"], "name": s.get("name"), "distance_m": round(d), **latest.get(s["station_id"], {})}
                             for d, s in out[:8]]}
    if kind == "reports":
        return {"items": live.reports_near(db, [(lat, lon)], lines, radius=NEAR_M)}
    if kind == "climate":
        try:
            fl = flood.vigilance(db)
        except (httpx.HTTPError, ValueError):
            fl = None
        vig = vigilance.current(db)
        return {"vigilance": {k: v for k, v in vig.items() if k in ("J", "J1")} if vig.get("available") else None,
                "flood": {"level": fl["level"], "color": fl["color"], "watch": fl["watch"]} if fl else None}
    return None


async def events(db, lat: float, lon: float, lines: set[str], is_disconnected):
    """Générateur SSE : premier envoi de tout, puis seulement ce qui change."""
    seen: dict = {}
    last_ping = 0.0
    loop = asyncio.get_event_loop()
    tick = 0
    while not await is_disconnected():
        if tick % 20 == 0:  # toutes les ~60 s : l'info trafic est rafraîchie (cache 5 min côté PRIM)
            await run_in_threadpool(lambda: payload(db, "traffic", lat, lon, lines))
        current = await run_in_threadpool(versions, db)
        for kind, v in current.items():
            if seen.get(kind) != v:
                seen[kind] = v
                data = await run_in_threadpool(payload, db, kind, lat, lon, lines)
                if data is not None:
                    yield f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
        now = loop.time()
        if now - last_ping >= PING_S:
            last_ping = now
            yield ": ping\n\n"
        tick += 1
        await asyncio.sleep(TICK_S)
