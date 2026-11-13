"""Trajets à pied réels dans les rues (calcul d'itinéraire piéton IGN, Géoplateforme, sans clé), avec cache commun."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import httpx

from . import http
from .cache import remember
from .geo import distance_m

URL = "https://data.geopf.fr/navigation/itineraire"
CACHE = timedelta(days=30)
MIN_M = 60  # en dessous, la ligne droite suffit


def route(db, a: tuple[float, float], b: tuple[float, float], client: httpx.Client | None = None) -> dict | None:
    """{distance_m, duration_s, coords: [[lon, lat], …]} ou None."""
    if distance_m(a, b) < MIN_M:
        return None
    key = f"{a[0]:.4f},{a[1]:.4f}>{b[0]:.4f},{b[1]:.4f}"

    def compute():
        r = (client or http.shared()).get(URL, params={
            "resource": "bdtopo-osrm", "profile": "pedestrian", "optimization": "fastest",
            "start": f"{a[1]},{a[0]}", "end": f"{b[1]},{b[0]}", "geometryFormat": "geojson", "getSteps": "false",
            "distanceUnit": "meter", "timeUnit": "second"}, timeout=8)
        r.raise_for_status()
        d = r.json()
        coords = (d.get("geometry") or {}).get("coordinates") or []
        return {"distance_m": round(float(d.get("distance", 0))), "duration_s": round(float(d.get("duration", 0))),
                "coords": [[round(x, 5), round(y, 5)] for x, y in coords]}
    try:
        return remember(db, "walk_cache", key, CACHE, compute, stale_ok=True)
    except (httpx.HTTPError, ValueError, KeyError):
        return None


def enrich(db, itineraries: list[dict]) -> None:
    """Ajoute le tracé et la distance réels à chaque étape à pied (requêtes en parallèle, cache 30 jours)."""
    walks = [leg for it in itineraries for leg in it["legs"] if leg["mode"] == "WALK"]
    pairs = [((l["from"]["lat"], l["from"]["lon"]), (l["to"]["lat"], l["to"]["lon"])) for l in walks]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda p: route(db, *p), pairs))
    for leg, res in zip(walks, results):
        if res and res["coords"]:
            leg["geometry"] = res["coords"]
            leg["distance_m"] = res["distance_m"]
