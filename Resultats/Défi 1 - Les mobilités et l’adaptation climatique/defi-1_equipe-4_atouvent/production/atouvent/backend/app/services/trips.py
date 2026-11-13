"""Paquet hors ligne d'un trajet : tout ce qu'il faut pour continuer sans réseau sous terre."""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

import httpx

from . import open_meteo
from .prim import get_departures


def _parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts) if ts else None


def elevators_at(db, station: str | None) -> list[dict]:
    if not station:
        return []
    rx = {"$regex": f"^{re.escape(station)}", "$options": "i"}
    return [{"elevator_id": d["elevator_id"], "situation": d.get("situation"), "status": d.get("status")}
            for d in db.elevator_latest.find({"station": rx}, {"_id": 0})]


def mark_elevators(db, itinerary: dict) -> dict:
    """Ajoute les ascenseurs en panne aux gares du trajet."""
    stations = {p["name"] for leg in itinerary["legs"] if leg["mode"] != "WALK" for p in (leg["from"], leg["to"])}
    out = []
    for s in sorted(stations):
        down = [e for e in elevators_at(db, s) if e["status"] == "hors_service"]
        if down:
            out.append({"station": s, "count": len(down),
                        "situations": [e["situation"][:240] for e in down if e.get("situation")][:2]})
    itinerary["elevators_out"] = out
    # Gares du trajet dont tous les ascenseurs suivis sont en service
    itinerary["elevators_ok"] = sum(1 for s in stations if (lst := elevators_at(db, s)) and all(e["status"] == "en_service" for e in lst))
    if out:
        itinerary["accessible"] = False
    return itinerary


def build_warnings(trip: dict, elevators: dict[str, list], weather: dict | None, hazards: list[str]) -> list[dict]:
    """Avertissements à annoncer AVANT le moment concerné (descente sous terre, sortie, météo)."""
    out = []
    # Priorité haute dès que l'usager a demandé un trajet sans marche, vérifié ou non
    needs_step_free = bool(trip.get("accessible") or trip.get("accessible_requested"))
    for i, leg in enumerate(trip["legs"]):
        if leg.get("underground"):
            out.append({"code": "underground", "leg": i, "station": leg["from"]["name"], "at": leg["start"]})
        if leg["mode"] != "WALK":
            for name in (leg["from"]["name"], leg["to"]["name"]):
                down = [e for e in elevators.get(name, []) if e["status"] == "hors_service"]
                if down:
                    out.append({"code": "elevator_out", "leg": i, "station": name, "count": len(down),
                                "priority": "high" if needs_step_free else "normal"})
    for h in hazards:
        out.append({"code": "hazard", "hazard": h, "leg": len(trip["legs"]) - 1})
    if weather and weather.get("ressenti") is not None and weather["ressenti"] >= 30 and "chaleur" not in hazards:
        out.append({"code": "hot_arrival", "temperature": weather["ressenti"], "leg": len(trip["legs"]) - 1})
    return out


def build_bundle(db, trip: dict, guard=None, weather_client=None) -> dict:
    stations = {p["name"] for leg in trip["legs"] if leg["mode"] != "WALK" for p in (leg["from"], leg["to"])}
    elevators = {s: elevators_at(db, s) for s in stations}

    dest = trip["legs"][-1]["to"]
    weather, hazards, weather_error = None, [], None
    try:
        fc = open_meteo.get_forecast(db, dest["lat"], dest["lon"], weather_client)
        end = _parse(trip.get("end")) or datetime.now(timezone.utc)
        weather = open_meteo.at_time(fc, end)
        day = next((d for d in open_meteo.daily_hazards(fc) if d["date"] == end.date().isoformat()), None)
        hazards = day["aleas"] if day else []
    except Exception as exc:  # la météo ne doit jamais empêcher de partir
        weather_error = type(exc).__name__

    # Un seul appel PRIM par trajet : le premier arrêt en transport
    departures = None
    first = next((leg for leg in trip["legs"] if leg["mode"] != "WALK"), None)
    if guard and first and first["from"].get("stop_id"):
        try:
            departures = get_departures(db, first["from"]["stop_id"], guard)
        except Exception:
            departures = None

    return {"trip": trip, "elevators": elevators, "weather_arrival": weather, "hazards": hazards,
            "weather_error": weather_error, "departures": departures,
            "warnings": build_warnings(trip, elevators, weather, hazards),
            "generated_at": datetime.now(timezone.utc).isoformat()}


def annotate_walks(db, itinerary: dict) -> dict:
    """Étapes à pied et à vélo : ombre des arbres (Paris), chantiers gênants, points noirs piétons et cyclistes (accidents 2021-2024)."""
    from ..router import hotspots, shade
    from . import places
    walk_points, spots = [], []
    for leg in itinerary["legs"]:
        if leg["mode"] not in ("WALK", "BICYCLE"):
            continue
        a, b = (leg["from"]["lat"], leg["from"]["lon"]), (leg["to"]["lat"], leg["to"]["lon"])
        path = leg.get("geometry") or [[a[1], a[0]], [b[1], b[0]]]
        # Points tous les ~25 m le long du chemin
        pts = []
        for (x1, y1), (x2, y2) in zip(path, path[1:]):
            n = max(1, int(math.hypot((y2 - y1) * 111_000, (x2 - x1) * 73_000) // 25))
            pts += [(y1 + (y2 - y1) * k / n, x1 + (x2 - x1) * k / n) for k in range(n)]
        pts.append((path[-1][1], path[-1][0]))
        if leg["mode"] == "WALK":
            leg["shade"] = shade.score_path(leg["geometry"]) if leg.get("geometry") else shade.score(a, b)
            walk_points += pts[::2] + [pts[-1]]  # un point tous les ~50 m (chantiers à moins de 40 m)
        spots += hotspots.along(pts, "walk" if leg["mode"] == "WALK" else "bike")
    try:
        itinerary["works"] = places.works_along(db, walk_points) if walk_points else []
    except httpx.HTTPError:
        itinerary["works"] = []
    itinerary["hotspots"] = sorted(spots, key=lambda x: -x["accidents"])[:3]
    return itinerary


LIFT_UNRELIABLE = 0.2  # ascenseurs hors service plus de 20 % du temps (moyenne de la gare, 2013-2023)


def unreliable_lifts(itinerary: dict) -> list[dict]:
    """Gares du trajet dont les ascenseurs ont été souvent en panne (Dispotrains) : à éviter en fauteuil."""
    out = {}
    for leg in itinerary["legs"]:
        if leg["mode"] in ("WALK", "BICYCLE"):
            continue
        for place in (leg["from"], leg["to"]):
            share = (place.get("info") or {}).get("lift_downtime")
            if share is not None and share >= LIFT_UNRELIABLE:
                out[place["name"]] = {"station": place["name"], "share": share}
    return list(out.values())

# Gares fermées lors de la crue de juin 2016 (RER C fermé entre Paris-Austerlitz et Javel) : signalées si vigilance crue
FLOOD_CLOSED = ("austerlitz", "saint-michel", "musée d'orsay", "invalides", "pont de l'alma", "champ de mars", "javel")
LEVELS = {"autonomie": "ok", "agent": "assisted", "reservation": "assisted", "non": "ko"}


def _stop_access(place: dict) -> tuple[str, str]:
    """État fauteuil d'un arrêt : (ok | assisted | ko | unknown, raison)."""
    info = place.get("info") or {}
    if info.get("station_access"):  # niveau d'accessibilité de la gare (IDFM « Accessibilité en gare »)
        level = info["station_access"]
        return LEVELS.get(level, "unknown"), f"station_{level}"
    a = info.get("access")
    if a == 1:
        return "ok", "stop_ok"
    if a == 0:
        return "ko", "stop_ko"
    if a == 0.5:
        return "assisted", "stop_partial"
    return "unknown", "no_data"


def verify_access(itinerary: dict) -> dict:
    """Accessibilité en fauteuil vérifiée étape par étape, avec toutes les données disponibles : arrêts (référentiel IDFM, OpenStreetMap), gares (IDFM Accessibilité en gare), véhicule (GTFS), ascenseurs (temps réel)."""
    rank = {"ok": 0, "unknown": 1, "assisted": 2, "ko": 3}
    if not any(leg["mode"] not in ("WALK", "BICYCLE") for leg in itinerary["legs"]):
        # Marche ou vélo seuls : aucun arrêt ni véhicule à vérifier, on ne dit rien plutôt que « accessible »
        itinerary["access"] = None
        itinerary["accessible"] = False
        return itinerary
    issues, worst = [], "ok"
    down = {e["station"] for e in itinerary.get("elevators_out", [])}
    for leg in itinerary["legs"]:
        if leg["mode"] in ("WALK", "BICYCLE"):
            continue
        for place in (leg["from"], leg["to"]):
            state, reason = _stop_access(place)
            if place["name"] in down:
                state, reason = "ko", "elevator"
            if state != "ok":
                issues.append({"stop": place["name"], "state": state, "reason": reason})
            worst = max(worst, state, key=rank.get)
        if leg.get("wheelchair") == 2:  # véhicule déclaré non accessible
            issues.append({"stop": leg.get("line") or leg["mode"], "state": "ko", "reason": "vehicle"})
            worst = "ko"
    # Doublons (même arrêt, même raison) retirés
    uniq = list({(i["stop"], i["reason"]): i for i in issues}.values())
    itinerary["access"] = {"status": worst, "issues": uniq}
    itinerary["accessible"] = worst == "ok"
    return itinerary


def flood_exposure(itinerary: dict) -> list[str]:
    """Gares du trajet fermées lors de la dernière grande crue (RER C dans Paris)."""
    out = []
    for leg in itinerary["legs"]:
        if leg["mode"] != "RAIL" or (leg.get("line") or "") != "C":
            continue
        for place in [leg["from"], *leg.get("stops", []), leg["to"]]:
            name = place["name"]
            if any(k in name.lower() for k in FLOOD_CLOSED) and name not in out:
                out.append(name)
    return out
