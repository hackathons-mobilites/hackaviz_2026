"""Prochains passages (PRIM, format SIRI Lite) avec cache et garde-fou de quota."""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import httpx

from ..core.config import settings
from . import http


def _now():
    return datetime.now(timezone.utc)


def parse_siri(payload: dict) -> list[dict]:
    out = []
    deliveries = (payload.get("Siri", {}).get("ServiceDelivery", {}).get("StopMonitoringDelivery") or [])
    for d in deliveries:
        for v in d.get("MonitoredStopVisit") or []:
            j = v.get("MonitoredVehicleJourney", {})
            call = j.get("MonitoredCall", {})
            dest = j.get("DestinationName") or [{}]
            out.append({
                "line": (j.get("LineRef") or {}).get("value"),
                "destination": dest[0].get("value") if isinstance(dest, list) and dest else None,
                "expected": call.get("ExpectedDepartureTime") or call.get("ExpectedArrivalTime"),
                "aimed": call.get("AimedDepartureTime") or call.get("AimedArrivalTime"),
                "realtime": bool(call.get("ExpectedDepartureTime") or call.get("ExpectedArrivalTime")),
            })
    out.sort(key=lambda x: x["expected"] or x["aimed"] or "")
    return out


class QuotaGuard:
    """Compteur journalier en base (survit aux redémarrages) + limite par seconde en mémoire."""

    def __init__(self, db, daily: int, per_second: int):
        self.db, self.daily, self.per_second = db, daily, per_second
        self._second, self._count_second = None, 0
        self._lock = threading.Lock()  # les routes synchrones tournent dans plusieurs fils

    def allow(self) -> bool:
        now = _now()
        sec = now.replace(microsecond=0)
        with self._lock:
            if sec != self._second:
                self._second, self._count_second = sec, 0
            if self._count_second >= self.per_second:
                return False
            # Lecture et incrément en une seule opération : deux requêtes simultanées ne dépassent pas le quota
            day = now.date().isoformat()
            self.db.api_quota.update_one({"day": day}, {"$setOnInsert": {"count": 0}}, upsert=True)
            doc = self.db.api_quota.find_one_and_update({"day": day, "count": {"$lt": self.daily}}, {"$inc": {"count": 1}})
            if doc is None:
                return False
            self._count_second += 1
            return True


def get_departures(db, ref: str, guard: QuotaGuard, client: httpx.Client | None = None) -> dict:
    cached = db.departures_cache.find_one({"ref": ref})
    if cached:
        age = _now() - (cached["fetched_at"] if cached["fetched_at"].tzinfo else cached["fetched_at"].replace(tzinfo=timezone.utc))
        if age < timedelta(seconds=settings.departures_cache_s):
            return {"ref": ref, "departures": cached["departures"], "fetched_at": cached["fetched_at"], "stale": False}
    if not settings.prim_api_key or not guard.allow():
        return {"ref": ref, "departures": cached["departures"] if cached else [],
                "fetched_at": cached["fetched_at"] if cached else None, "stale": True,
                "message": "Horaires en direct momentanément indisponibles : dernière information connue."}
    c = client or http.shared()
    r = c.get(settings.prim_url, params={"MonitoringRef": ref}, headers={"apikey": settings.prim_api_key}, timeout=10)
    r.raise_for_status()
    deps = parse_siri(r.json())
    now = _now()
    db.departures_cache.update_one({"ref": ref}, {"$set": {"ref": ref, "departures": deps, "fetched_at": now}}, upsert=True)
    return {"ref": ref, "departures": deps, "fetched_at": now, "stale": False}
