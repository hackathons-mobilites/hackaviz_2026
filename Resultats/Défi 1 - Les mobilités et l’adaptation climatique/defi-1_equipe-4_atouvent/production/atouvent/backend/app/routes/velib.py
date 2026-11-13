"""Vélib' : stations proches et historique reconstruit."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from ..core.config import settings
from ..core.ratelimit import limit
from ..deps import db_dep
from ..schemas import LAT, LON
from ..services.history import reconstruct

router = APIRouter(prefix="/velib", tags=["vélib"])

FIELDS = {"bikes", "mechanical", "ebike", "docks"}
MAX_POINTS = 2000  # points renvoyés au plus par /history


@router.get("/near", dependencies=[Depends(limit("nearby"))])
def near(lat: float = Query(**LAT), lon: float = Query(**LON), radius_m: int = Query(500, ge=50, le=3000),
         limit: int = Query(5, ge=1, le=50), db=Depends(db_dep)):
    stations = list(db.velib_stations.find({"location": {"$near": {
        "$geometry": {"type": "Point", "coordinates": [lon, lat]}, "$maxDistance": radius_m}}}, {"_id": 0}).limit(limit))
    ids = [s["station_id"] for s in stations]
    latest = {d["station_id"]: d for d in db.velib_latest.find({"station_id": {"$in": ids}}, {"_id": 0, "hash": 0})}
    trends = trend(db, ids)
    return [{**s, "status": latest.get(s["station_id"]), "trend": trends.get(s["station_id"])} for s in stations]


def trend(db, ids: list[str], minutes: int = 60) -> dict[str, dict]:
    """Évolution des vélos et des places sur la dernière heure, et estimation dans 30 min (tendance prolongée)."""
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    first = {}
    for d in db.velib_status.find({"meta.station_id": {"$in": ids}, "ts": {"$gte": since}}, {"meta": 1, "bikes": 1, "docks": 1, "ts": 1}).sort("ts", 1):
        first.setdefault(d["meta"]["station_id"], d)
    out = {}
    for sid, d in first.items():
        cur = db.velib_latest.find_one({"station_id": sid}, {"bikes": 1, "docks": 1})
        if not cur or cur.get("bikes") is None or d.get("bikes") is None:
            continue
        db_, dd = cur["bikes"] - d["bikes"], (cur.get("docks") or 0) - (d.get("docks") or 0)
        soon_b, soon_d = max(0, round(cur["bikes"] + db_ / 2)), max(0, round((cur.get("docks") or 0) + dd / 2))
        out[sid] = {"bikes_change": db_, "docks_change": dd, "bikes_30min": soon_b, "docks_30min": soon_d,
                    "emptying": cur["bikes"] > 0 and db_ < 0 and soon_b <= 1, "filling": (cur.get("docks") or 0) > 0 and dd < 0 and soon_d <= 1}
    return out


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.get("/summary")
def summary(db=Depends(db_dep)):
    """Vélib' disponibles sur tout le réseau, d'après la dernière collecte."""
    rows = list(db.velib_latest.find({}, {"bikes": 1, "renting": 1, "written_at": 1}))
    last = db.collection_runs.find_one({"source": "velib_status", "ok": True}, sort=[("started_at", -1)])
    return {"bikes": sum(r.get("bikes") or 0 for r in rows), "stations": len(rows),
            "empty": sum(1 for r in rows if r.get("renting") and not r.get("bikes")),
            "at": last["started_at"] if last else None}


@router.get("/history")
def history(station_id: str = Query(max_length=40), start: datetime = Query(), end: datetime = Query(),
            step_min: int = Query(60, ge=5, le=1440), field: str = "bikes", db=Depends(db_dep)):
    start, end = _aware(start), _aware(end)
    if field not in FIELDS:
        raise HTTPException(422, "unknown_field")
    if end <= start or (end - start) / timedelta(minutes=step_min) > MAX_POINTS:
        raise HTTPException(422, "range_too_large")
    # Dernier état connu avant le début (report de la valeur), puis les changements de la période
    before = list(db.velib_status.find({"meta.station_id": station_id, "ts": {"$lt": start}}, {"_id": 0})
                  .sort("ts", -1).limit(1))
    docs = before + list(db.velib_status.find({"meta.station_id": station_id, "ts": {"$gte": start, "$lte": end}},
                                              {"_id": 0}).sort("ts", 1))
    tolerance = timedelta(minutes=3 * settings.velib_every_min)
    ok = [r["started_at"] for r in db.collection_runs.find(
        {"source": "velib_status", "ok": True, "started_at": {"$gte": start - tolerance, "$lte": end}}, {"started_at": 1})]
    return reconstruct(docs, ok, start, end, timedelta(minutes=step_min), field, tolerance=tolerance)
