"""Hauteur des principales rivières d'Île-de-France (Hub'Eau hydrométrie, temps réel, sans clé), avec cache commun."""
from __future__ import annotations

from datetime import timedelta

import httpx

from . import http
from .cache import remember

URL = "https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr"
STATION = "F700000103"  # La Seine à Paris - Austerlitz (repère historique des crues de Paris)
# Stations représentatives, de l'amont vers l'aval
STATIONS = {
    "F700000103": "La Seine à Paris-Austerlitz",
    "F449000601": "La Seine à Corbeil-Essonnes",
    "F490000104": "La Seine à Alfortville",
    "F664000104": "La Marne à Gournay-sur-Marne",
    "F643000101": "La Marne à Meaux",
    "H227000102": "L'Oise à Pontoise",
    "H300000201": "La Seine à Poissy",
}
CACHE = timedelta(minutes=10)


def parse(payload: dict, label: str = STATIONS[STATION]) -> dict | None:
    obs = payload.get("data") or []
    if not obs:
        return None
    last = obs[0]
    # Tendance sur l'heure écoulée (12 relevés de 5 min)
    old = obs[min(len(obs) - 1, 12)]
    delta = (last["resultat_obs"] - old["resultat_obs"]) / 1000
    trend = "hausse" if delta > 0.02 else "baisse" if delta < -0.02 else "stable"
    return {"level_m": round(last["resultat_obs"] / 1000, 2), "at": last["date_obs"], "trend": trend,
            "station": label, "source": f"Hub'Eau hydrométrie, {label}"}


def level(db, code: str, client: httpx.Client | None = None) -> dict | None:
    def compute():
        r = (client or http.shared()).get(URL, params={"code_entite": code, "grandeur_hydro": "H", "size": 13, "sort": "desc"}, timeout=10)
        r.raise_for_status()
        return parse(r.json(), STATIONS.get(code, code))
    return remember(db, "hydro_cache", code, CACHE, compute)


def seine(db, client: httpx.Client | None = None) -> dict | None:
    return level(db, STATION, client)


def rivers(db, client: httpx.Client | None = None) -> list[dict]:
    """Toutes les stations suivies ; une station qui ne répond pas est simplement absente."""
    out = []
    for code in STATIONS:
        try:
            v = level(db, code, client)
        except httpx.HTTPError:
            continue
        if v:
            out.append({"code": code, **v})
    return out
