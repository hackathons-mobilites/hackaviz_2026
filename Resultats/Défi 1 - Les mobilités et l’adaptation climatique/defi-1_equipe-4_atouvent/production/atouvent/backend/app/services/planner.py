"""Calcul d'itinéraire : transports en commun (OpenTripPlanner si OTP_URL est configurée, sinon calculateur intégré sur le GTFS IDFM, app/router), plus le vélo (Vélib' en temps réel, ou vélo personnel) et la marche."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx

from ..core.config import settings
from . import http
from .geo import distance_m
from ..router import engine

# Modes où le GPS risque de couper (métro, RER en tunnel)
UNDERGROUND_MODES = {"SUBWAY", "RAIL"}

QUERY = """
query Plan($from: InputCoordinates!, $to: InputCoordinates!, $wheelchair: Boolean, $date: String, $time: String) {
  plan(from: $from, to: $to, wheelchair: $wheelchair, date: $date, time: $time, numItineraries: 3) {
    itineraries {
      startTime endTime
      legs {
        mode startTime endTime headsign
        route { shortName }
        from { name lat lon stop { gtfsId } }
        to { name lat lon stop { gtfsId } }
        intermediatePlaces { name lat lon arrivalTime stop { gtfsId } }
      }
    }
  }
}
"""


class PlannerUnavailable(Exception):
    pass


def _at(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def _key(it: dict) -> tuple:
    return tuple((l["mode"], l["line"], l["start"]) for l in it["legs"] if l["mode"] != "WALK")


def _iso(ms: int | None) -> str | None:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat() if ms else None


def _place(p: dict) -> dict:
    return {"name": p.get("name"), "lat": p.get("lat"), "lon": p.get("lon"),
            "stop_id": (p.get("stop") or {}).get("gtfsId")}


def normalize(itinerary: dict, accessible: bool) -> dict:
    """Format commun back/front : une liste d'étapes (legs) avec arrêts et horaires."""
    legs = []
    for leg in itinerary.get("legs", []):
        mode = leg.get("mode", "WALK")
        legs.append({
            "mode": mode,
            "line": (leg.get("route") or {}).get("shortName"),
            "headsign": leg.get("headsign"),
            "start": _iso(leg.get("startTime")), "end": _iso(leg.get("endTime")),
            "from": _place(leg["from"]), "to": _place(leg["to"]),
            "stops": [{**_place(p), "time": _iso(p.get("arrivalTime"))} for p in leg.get("intermediatePlaces") or []],
            "underground": mode in UNDERGROUND_MODES,
        })
    # OTP calcule en mode fauteuil (wheelchair=true) : le trajet est accessible selon les données GTFS
    return {"start": _iso(itinerary.get("startTime")), "end": _iso(itinerary.get("endTime")),
            "accessible": accessible, "accessible_requested": accessible, "legs": legs, "source": "otp"}


WALK_MS = 1.25 / 1.3       # 4,5 km/h, 30 % de détour par rapport à la ligne droite
BIKE_MS = 15 / 3.6 / 1.3   # 15 km/h
WALK_MAX_M = 2500          # au-delà, la marche seule n'est pas proposée
BIKE_MAX_M = 20000
VELIB_NEAR_M = 600         # station Vélib' cherchée à moins de 600 m du départ et de l'arrivée




def _leg(mode, a, b, start: datetime, secs: float, line=None) -> dict:
    return {"mode": mode, "line": line, "headsign": None, "start": start.isoformat(),
            "end": (start + timedelta(seconds=secs)).isoformat(),
            "from": {"name": a[2], "lat": a[0], "lon": a[1], "stop_id": None},
            "to": {"name": b[2], "lat": b[0], "lon": b[1], "stop_id": None}, "stops": [], "underground": False}


def _itinerary(legs: list[dict], source: str) -> dict:
    return {"start": legs[0]["start"], "end": legs[-1]["end"], "accessible": False, "accessible_requested": False,
            "legs": legs, "source": source}


def walk_plan(o, d, when: datetime, slow: bool = False, db=None) -> list[dict]:
    """Trajet à pied, proposé jusqu'à 2,5 km (1,5 km en marche lente) ; durée et chemin réels (IGN) si disponibles."""
    from . import walking
    dist = distance_m(o, d)
    factor = engine.SLOW if slow else 1
    if dist > WALK_MAX_M / factor:
        return []
    real = walking.route(db, o[:2], d[:2]) if db is not None else None
    # 4,5 km/h : sur la distance réelle des rues (IGN), ou sur la ligne droite majorée de 30 % de détour (WALK_MS)
    secs = (real["distance_m"] / (WALK_MS * 1.3) if real else dist / WALK_MS) * factor
    leg = _leg("WALK", o, d, when, secs)
    if real:
        leg["geometry"], leg["distance_m"] = real["coords"], real["distance_m"]
    return [_itinerary([leg], "walk")]


def _velib(db, p, field: str):
    """Station Vélib' la plus proche avec au moins un vélo (field=bikes) ou une place libre (field=docks)."""
    # ~1 500 stations : distance calculée ici (pas d'index géographique nécessaire)
    near = []
    for s in db.velib_stations.find({}, {"station_id": 1, "name": 1, "location": 1}):
        lon, lat = s["location"]["coordinates"]
        dist = distance_m(p, (lat, lon))
        if dist <= VELIB_NEAR_M:
            near.append((dist, lat, lon, s))
    near.sort(key=lambda x: x[0])
    latest = {d["station_id"]: d for d in db.velib_latest.find({"station_id": {"$in": [x[3]["station_id"] for x in near]}})}
    for _, lat, lon, s in near:
        st = latest.get(s["station_id"], {})
        if (st.get(field) or 0) > 0 and st.get("renting" if field == "bikes" else "returning", 1):
            return (lat, lon, f"Vélib’ {s.get('name') or s['station_id']}"), st.get(field)
    return None, 0


def bike_plan(db, o, d, when: datetime) -> list[dict]:
    """À vélo : Vélib' (stations avec vélo au départ et place libre à l'arrivée, état en direct) ou vélo personnel."""
    dist = distance_m(o, d)
    if dist > BIKE_MAX_M or dist < 300:
        return []
    out = []
    a, bikes = _velib(db, o, "bikes")
    b, docks = _velib(db, d, "docks")
    if a and b and a[:2] != b[:2]:
        t = when
        legs = []
        for mode, x, y, speed, line in (("WALK", o, a, WALK_MS, None), ("BICYCLE", a, b, BIKE_MS, "Vélib’"), ("WALK", b, d, WALK_MS, None)):
            secs = distance_m(x, y) / speed + (60 if mode == "BICYCLE" else 0)  # 1 min pour décrocher et raccrocher le vélo
            legs.append(_leg(mode, x, y, t, secs, line))
            t += timedelta(seconds=secs)
        it = _itinerary([l for l in legs if l["start"] != l["end"]], "velib")
        it["velib"] = {"bikes": bikes, "docks": docks}
        out.append(it)
    out.append(_itinerary([_leg("BICYCLE", o, d, when, dist / BIKE_MS, None)], "bike"))
    return out


def plan(from_: tuple[float, float], to: tuple[float, float], accessible: bool, when: datetime | None = None,
         client: httpx.Client | None = None, names: tuple[str, str] = ("Départ", "Arrivée"),
         modes: list[str] | None = None, db=None, walk: str = "normal") -> list[dict]:
    """Itinéraires réels selon les modes choisis : transports en commun, vélo, marche."""
    when = (when or datetime.now(timezone.utc)).astimezone(engine.PARIS)
    modes = set(modes or ["rail", "bus", "bike", "walk"])
    o, d = (*from_, names[0]), (*to, names[1])
    out = []
    if modes & {"rail", "bus"}:
        out += transit(from_, to, accessible, when, client, names, rail="rail" in modes, bus="bus" in modes, slow=walk == "slow")
    if not accessible:  # vélo et marche : pas proposés en mode « sans marche » (fauteuil)
        if "walk" in modes:
            out += walk_plan(o, d, when, slow=walk == "slow", db=db)
        if "bike" in modes and db is not None:
            out += bike_plan(db, o, d, when)
    return out


def transit(from_, to, accessible, when, client=None, names=("Départ", "Arrivée"), rail=True, bus=True, slow=False,
            avoid: set[str] | None = None) -> list[dict]:
    """Transports en commun : OpenTripPlanner s'il est configuré, sinon le calculateur intégré sur le GTFS IDFM."""
    if not settings.otp_url:
        try:
            its = engine.plan(from_, to, when, accessible, origin_name=names[0], dest_name=names[1], bus=bus, rail=rail, slow=slow,
                              avoid=avoid)
            if avoid:
                return its
            if rail and bus:
                surface = engine.plan(from_, to, when, accessible, count=1, origin_name=names[0], dest_name=names[1], bus=True, rail=False,
                                      slow=slow)
                fastest = min((_at(it["end"]) for it in its), default=None)
                # Proposé seulement s'il n'arrive pas beaucoup plus tard (30 min au plus)
                seen = {_key(it) for it in its}
                its += [it for it in surface if _key(it) not in seen
                        and (fastest is None or _at(it["end"]) <= fastest + timedelta(minutes=30))]
            return its
        except engine.RouterUnavailable as exc:
            raise PlannerUnavailable(str(exc))
    c = client or http.shared()
    r = c.post(settings.otp_url, json={"query": QUERY, "variables": {
        "from": {"lat": from_[0], "lon": from_[1]}, "to": {"lat": to[0], "lon": to[1]},
        "wheelchair": accessible, "date": when.strftime("%Y-%m-%d"), "time": when.strftime("%H:%M")}}, timeout=20)
    r.raise_for_status()
    its = ((r.json().get("data") or {}).get("plan") or {}).get("itineraries") or []
    return [normalize(i, accessible) for i in its]
