"""Qualité de l'air, UV et pollens (Open-Meteo, modèle européen CAMS de Copernicus, sans clé), avec cache commun."""
from __future__ import annotations

from datetime import datetime, timedelta

import httpx

from . import http
from .cache import remember

URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
HOURLY = "european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,uv_index,birch_pollen,grass_pollen,ragweed_pollen"
POLLUTION_AQI = 60
UV_HIGH = 6            # indice UV « fort » (OMS)
POLLEN_HIGH = 50       # grains/m³, niveau élevé pour graminées et bouleau
BANDS = [(20, "bon"), (40, "correct"), (60, "moyen"), (80, "degrade"), (100, "mauvais"), (10 ** 9, "tres_mauvais")]
CACHE = timedelta(hours=1)


def band(aqi: float | None) -> str | None:
    return None if aqi is None else next(name for top, name in BANDS if aqi < top)


def fetch(db, lat: float, lon: float, client: httpx.Client | None = None) -> dict:
    # Même arrondi (~5 km) que la météo : la position exacte n'est jamais envoyée
    cell = (round(lat * 20) / 20, round(lon * 20) / 20)

    def compute():
        r = (client or http.shared()).get(URL, params={"latitude": cell[0], "longitude": cell[1], "hourly": HOURLY,
                                                       "timezone": "Europe/Paris", "forecast_days": 4}, timeout=15)
        r.raise_for_status()
        return r.json().get("hourly", {})
    return remember(db, "air_cache", f"{cell[0]:.2f},{cell[1]:.2f}", CACHE, compute)


def _max(values):
    v = [x for x in values if x is not None]
    return max(v) if v else None


def daily(hourly: dict) -> dict[str, dict]:
    """Par jour : indice maximal (et sa classe), particules, UV et pollens maximaux."""
    days: dict[str, dict] = {}
    for i, t in enumerate(hourly.get("time", [])):
        d = days.setdefault(t[:10], {k: [] for k in HOURLY.split(",")})
        for k in d:
            d[k].append((hourly.get(k) or [None] * (i + 1))[i])
    out = {}
    for day, v in days.items():
        aqi = _max(v["european_aqi"])
        pollen = _max(v["birch_pollen"] + v["grass_pollen"] + v["ragweed_pollen"])
        out[day] = {"aqi": aqi, "level": band(aqi), "pm2_5": _max(v["pm2_5"]), "pm10": _max(v["pm10"]), "ozone": _max(v["ozone"]),
                    "uv": _max(v["uv_index"]), "pollen": pollen, "pollen_high": pollen is not None and pollen >= POLLEN_HIGH,
                    "uv_high": (_max(v["uv_index"]) or 0) >= UV_HIGH, "pollution": aqi is not None and aqi >= POLLUTION_AQI}
    return out


def now(hourly: dict, at: datetime) -> dict | None:
    key = at.strftime("%Y-%m-%dT%H:00")
    times = hourly.get("time", [])
    if key not in times:
        return None
    i = times.index(key)
    aqi = (hourly.get("european_aqi") or [None] * (i + 1))[i]
    return {"aqi": aqi, "level": band(aqi), "uv": (hourly.get("uv_index") or [None] * (i + 1))[i]}
