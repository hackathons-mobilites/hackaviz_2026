"""Empreinte carbone d'un trajet (facteurs d'émission officiels ADEME, API Impact CO2, sans clé, cache 30 jours)."""
from __future__ import annotations

import math
from datetime import timedelta

import httpx

from . import http
from .cache import remember
from .geo import distance_m

URL = "https://impactco2.fr/api/v1/transport"
# Identifiants Impact CO2 → modes AtouVent ; valeurs de repli (kg/km, ADEME, oct. 2026) si l'API ne répond pas
IDS = {"SUBWAY": (11, 0.0042), "RAIL": (14, 0.0066), "TRAM": (10, 0.0038), "BUS": (9, 0.1135),
       "VELIB": (8, 0.00223), "BICYCLE": (7, 0.0), "WALK": (30, 0.0), "CAR": (4, 0.1105577600556303)}
ROAD_DETOUR = 1.3


def factors(db, client: httpx.Client | None = None) -> dict[str, float]:
    """Grammes de CO2e par personne et par km, par mode."""
    def compute():
        r = (client or http.shared()).get(URL, params={"km": 1, "displayAll": 1, "language": "fr"}, timeout=15)
        r.raise_for_status()
        by_id = {x["id"]: x["value"] for x in r.json().get("data", [])}
        return {mode: round(1000 * by_id.get(i, fallback), 3) for mode, (i, fallback) in IDS.items()}
    try:
        return remember(db, "insights_cache", "co2_factors", timedelta(days=30), compute)
    except (httpx.HTTPError, ValueError, KeyError):
        return {mode: round(1000 * fallback, 3) for mode, (_, fallback) in IDS.items()}


def _length_km(leg: dict) -> float:
    if leg.get("distance_m"):
        return leg["distance_m"] / 1000
    pts = leg.get("geometry")
    if pts and len(pts) > 1:
        return sum(math.hypot((b[1] - a[1]) * 111.0, (b[0] - a[0]) * 73.0) for a, b in zip(pts, pts[1:]))
    stops = [leg["from"], *leg.get("stops", []), leg["to"]]
    return sum(distance_m((a["lat"], a["lon"]), (b["lat"], b["lon"])) for a, b in zip(stops, stops[1:])) / 1000


def footprint(itinerary: dict, f: dict[str, float]) -> dict:
    """{co2_g, car_g, saved_g, km} : émissions du trajet, du même trajet en voiture, et la différence."""
    co2 = km = 0.0
    for leg in itinerary["legs"]:
        mode = leg["mode"]
        if mode == "BICYCLE":
            mode = "VELIB" if itinerary.get("source") == "velib" else "BICYCLE"
        length = _length_km(leg)
        km += length
        co2 += length * f.get(mode, f["BUS"])
    first, last = itinerary["legs"][0]["from"], itinerary["legs"][-1]["to"]
    car_km = distance_m((first["lat"], first["lon"]), (last["lat"], last["lon"])) / 1000 * ROAD_DETOUR
    car = car_km * f["CAR"]
    return {"co2_g": round(co2), "car_g": round(car), "saved_g": round(max(0.0, car - co2)), "km": round(km, 1)}


def annotate(db, itineraries: list[dict]) -> None:
    f = factors(db)
    for it in itineraries:
        it["carbon"] = footprint(it, f)
