"""Ascenseurs : état actuel et part hors service par jour (à croiser avec la météo)."""
import re
from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query

from ..deps import clean, db_dep
from ..services.open_meteo import PARIS

router = APIRouter(prefix="/elevators", tags=["ascenseurs"])

MAX_DAYS = 400


@router.get("")
def current(zdc_id: str | None = Query(None, max_length=40), station: str | None = Query(None, max_length=100),
            db=Depends(db_dep)):
    q = {}
    if zdc_id:
        q["zdc_id"] = zdc_id
    if station:
        q["station"] = {"$regex": re.escape(station), "$options": "i"}
    return [clean(d) for d in db.elevator_latest.find(q).limit(500)]


@router.get("/summary")
def summary(db=Depends(db_dep)):
    """Ascenseurs hors service en ce moment, d'après la dernière collecte (jeu IDFM « État des ascenseurs »)."""
    counts = {s: db.elevator_latest.count_documents({"status": s}) for s in ("hors_service", "en_service", "inconnu", "ferme_nuit")}
    last = db.collection_runs.find_one({"source": "elevators", "ok": True}, sort=[("started_at", -1)])
    return {"out": counts["hors_service"], "total": sum(counts.values()), "unknown": counts["inconnu"], "night": counts["ferme_nuit"],
            "at": last["started_at"] if last else None}


@router.get("/daily-outages")
def daily_outages(start: date, end: date, source: str | None = Query(None, max_length=40), db=Depends(db_dep)):
    """Part des ascenseurs hors service par jour (jours calendaires de Paris)."""
    if end <= start or (end - start).days > MAX_DAYS:
        raise HTTPException(422, "range_too_large")
    q = {"ts": {"$gte": datetime.combine(start, time(), PARIS), "$lt": datetime.combine(end, time(), PARIS)}}
    if source:
        q["meta.source"] = source
    days: dict[str, dict] = {}
    for d in db.elevator_status.find(q, {"ts": 1, "status": 1, "meta.elevator_id": 1}):
        x = days.setdefault(d["ts"].astimezone(PARIS).date().isoformat(), {"down": set(), "seen": set()})
        x["seen"].add(d["meta"]["elevator_id"])
        if d.get("status") == "hors_service":
            x["down"].add(d["meta"]["elevator_id"])
    return [{"date": k, "observed": len(v["seen"]), "out_of_service": len(v["down"]),
             "share": round(len(v["down"]) / len(v["seen"]), 4) if v["seen"] else None} for k, v in sorted(days.items())]

