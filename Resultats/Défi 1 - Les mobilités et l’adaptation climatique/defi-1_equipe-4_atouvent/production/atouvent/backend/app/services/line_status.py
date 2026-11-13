"""État d'une ligne entière en temps réel (PRIM, Estimated Timetable / SIRI) : retards de tous les trains ou bus."""
from __future__ import annotations

from datetime import datetime, timedelta

import httpx

from ..core.config import settings
from . import http
from .cache import remember

URL = "https://prim.iledefrance-mobilites.fr/marketplace/estimated-timetable"
CACHE = timedelta(seconds=60)
LATE_MIN = 3


def _t(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v.replace("Z", "+00:00")) if v else None


def summarize(payload: dict) -> dict:
    """Nombre de courses suivies, courses en retard (≥ 3 min) et retard moyen, d'après le prochain arrêt de chacune."""
    journeys = late = 0
    delays = []
    deliveries = payload.get("Siri", {}).get("ServiceDelivery", {}).get("EstimatedTimetableDelivery") or []
    for d in deliveries:
        for frame in d.get("EstimatedJourneyVersionFrame") or []:
            for vj in frame.get("EstimatedVehicleJourney") or []:
                calls = (vj.get("EstimatedCalls") or {}).get("EstimatedCall") or []
                delay = None
                for c in calls:
                    exp = _t(c.get("ExpectedDepartureTime") or c.get("ExpectedArrivalTime"))
                    aim = _t(c.get("AimedDepartureTime") or c.get("AimedArrivalTime"))
                    if exp and aim:
                        delay = (exp - aim).total_seconds() / 60
                        break
                journeys += 1
                if delay is not None:
                    delays.append(delay)
                    late += delay >= LATE_MIN
    return {"journeys": journeys, "late": late, "avg_delay_min": round(sum(delays) / len(delays), 1) if delays else None,
            "max_delay_min": round(max(delays)) if delays else None}


def line(db, route_id: str, guard, client: httpx.Client | None = None) -> dict | None:
    if not settings.prim_api_key or not route_id:
        return None

    def compute():
        if not guard.allow():
            raise ValueError("quota PRIM atteint")
        r = (client or http.shared()).get(URL, params={"LineRef": f"STIF:Line::{route_id}:"},
                                          headers={"apikey": settings.prim_api_key}, timeout=15)
        r.raise_for_status()
        return summarize(r.json())
    try:
        return remember(db, "line_status_cache", route_id, CACHE, compute)
    except (httpx.HTTPError, ValueError):
        return None
