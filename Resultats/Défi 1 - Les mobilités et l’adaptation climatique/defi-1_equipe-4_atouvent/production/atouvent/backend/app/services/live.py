"""Suivi en direct d'un trajet, façon Waze : perturbations sur les lignes du trajet, passages en temps réel à la prochaine montée (retard ou avance), ascenseurs en panne, et signalements des autres voyageurs."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx

from . import traffic
from .geo import distance_m
from .prim import get_departures
from .trips import mark_elevators

# Durée de vie d'un signalement selon son type
REPORTS = {"delay": 45, "crowded": 45, "hot": 120, "elevator": 360, "not_served": 120, "works": 360, "obstacle": 180}
NEAR_M = 300   # signalement pris en compte à moins de 300 m d'un arrêt du trajet




def public_report(r: dict) -> dict:
    return {"id": str(r["_id"]), "kind": r["kind"], "lat": r["lat"], "lon": r["lon"], "line": r.get("line"),
            "stop": r.get("stop"), "at": r["created_at"], "up": r.get("up", 0), "down": r.get("down", 0)}


def add_report(db, kind: str, lat: float, lon: float, line: str | None, stop: str | None, author: str | None) -> dict:
    now = datetime.now(timezone.utc)
    doc = {"kind": kind, "lat": lat, "lon": lon, "line": line, "stop": stop, "author": author, "up": 0, "down": 0,
           "created_at": now, "expires_at": now + timedelta(minutes=REPORTS[kind])}
    doc["_id"] = db.reports.insert_one(doc).inserted_id
    # Copie sans expiration (ni auteur) pour les statistiques des décideurs
    db.reports_log.insert_one({k: v for k, v in doc.items() if k not in ("_id", "author", "expires_at")})
    return public_report(doc)


def vote(db, rid, still: bool) -> dict | None:
    """« Toujours là » prolonge le signalement ; deux « plus là » de plus que de confirmations le retirent."""
    r = db.reports.find_one({"_id": rid})
    if not r:
        return None
    if still:
        db.reports.update_one({"_id": rid}, {"$inc": {"up": 1}, "$set": {
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=REPORTS[r["kind"]])}})
    else:
        db.reports.update_one({"_id": rid}, {"$inc": {"down": 1}})
        if r.get("down", 0) + 1 >= r.get("up", 0) + 2:
            db.reports.delete_one({"_id": rid})
            return {"removed": True}
    return public_report(db.reports.find_one({"_id": rid}))


def reports_near(db, points: list[tuple[float, float]], lines: set[str] = frozenset(), radius: float = NEAR_M) -> list[dict]:
    now = datetime.now(timezone.utc)
    out = []
    for r in db.reports.find({"expires_at": {"$gt": now}}).sort("created_at", -1).limit(500):
        if (r.get("line") and r["line"] in lines) or any(distance_m(p, (r["lat"], r["lon"])) <= radius for p in points):
            out.append(public_report(r))
    return out


def _live_departure(db, leg: dict, guard) -> dict | None:
    """Prochain passage en temps réel de la ligne à l'arrêt de montée, comparé à l'horaire prévu."""
    ref = leg["from"].get("quay_id") or leg["from"].get("stop_id")
    if not ref:
        return None
    try:
        deps = get_departures(db, ref, guard)
    except httpx.HTTPError:
        return None
    route = (leg.get("route_id") or "").replace("IDFM:", "")
    planned = datetime.fromisoformat(leg["start"])
    best = None
    for d in deps.get("departures", []):
        if route and route not in (d.get("line") or ""):
            continue
        when = d.get("expected") or d.get("aimed")
        if not when:
            continue
        t = datetime.fromisoformat(when.replace("Z", "+00:00"))
        if t < planned - timedelta(minutes=10):
            continue
        aimed = datetime.fromisoformat((d.get("aimed") or when).replace("Z", "+00:00"))
        # Le passage prévu au plus près de l'horaire du trajet
        gap = abs((aimed - planned).total_seconds())
        if best is None or gap < best[0]:
            best = (gap, {"expected": t.isoformat(), "aimed": aimed.isoformat(), "realtime": d.get("realtime", False),
                          "delay_min": round((t - aimed).total_seconds() / 60), "destination": d.get("destination")})
    return best[1] if best else None


def live(db, trip: dict, next_leg: int, guard) -> dict:
    rides = [(i, l) for i, l in enumerate(trip["legs"]) if l["mode"] not in ("WALK", "BICYCLE")]
    route_ids = {(l.get("route_id") or "").replace("IDFM:", "") for _, l in rides} - {""}
    names = {(l.get("line") or "") for _, l in rides}
    try:
        items = traffic.current(db).get("items", [])
    except (traffic.TrafficUnavailable, httpx.HTTPError):
        items = []
    disruptions = [x for x in items if x.get("line_id") in route_ids or (not x.get("line_id") and x.get("line") in names)]
    points = [(p["lat"], p["lon"]) for _, l in rides for p in (l["from"], l["to"])] or \
             [(trip["legs"][0]["from"]["lat"], trip["legs"][0]["from"]["lon"]), (trip["legs"][-1]["to"]["lat"], trip["legs"][-1]["to"]["lon"])]
    upcoming = next(((i, l) for i, l in rides if i >= next_leg), None)
    departure = _live_departure(db, upcoming[1], guard) if upcoming else None
    from .line_status import line as line_state
    line_info = line_state(db, (upcoming[1].get("route_id") or "").replace("IDFM:", ""), guard) if upcoming else None
    elevators = mark_elevators(db, {"legs": trip["legs"]})["elevators_out"]
    return {"at": datetime.now(timezone.utc).isoformat(), "disruptions": disruptions,
            "departure": {"leg": upcoming[0], **departure} if departure else None,
            "elevators_out": elevators, "reports": reports_near(db, points, names),
            "line": {"leg": upcoming[0], **line_info} if line_info and line_info["journeys"] else None}



def trip_context(db, trips: list[dict]) -> None:
    """Pour chaque trajet proposé : perturbations PRIM en cours sur ses lignes et signalements récents sur son parcours."""
    try:
        items = traffic.current(db).get("items", [])
    except (traffic.TrafficUnavailable, httpx.HTTPError):
        items = []
    for it in trips:
        rides = [l for l in it["legs"] if l["mode"] not in ("WALK", "BICYCLE")]
        ids = {(l.get("route_id") or "").replace("IDFM:", "") for l in rides} - {""}
        it["disruptions"] = [{k: x.get(k) for k in ("id", "line", "mode", "title", "severity", "tags", "message")}
                             for x in items if x.get("line_id") in ids][:4]
        points = [(p["lat"], p["lon"]) for l in rides for p in (l["from"], l["to"])]
        it["reports"] = reports_near(db, points, {l.get("line") or "" for l in rides} - {""}) if points else []
