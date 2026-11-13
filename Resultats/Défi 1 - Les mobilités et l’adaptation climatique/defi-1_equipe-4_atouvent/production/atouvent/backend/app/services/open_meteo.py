"""Prévisions Open-Meteo (meilleur modèle : Météo-France à courte échéance, puis ECMWF) et détection des aléas : chaleur, froid, neige, orage, pluie, vent."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
from zoneinfo import ZoneInfo

from ..core.config import settings
from . import http

PARIS = ZoneInfo("Europe/Paris")
HOURLY = "temperature_2m,apparent_temperature,precipitation,snowfall,wind_gusts_10m,weather_code"
DAILY = "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max,weather_code"

# Seuils communs avec importers/meteo.py (rafales en km/h ici)
THRESHOLDS = {"chaleur_tx": 33.0, "froid_tn": -5.0, "pluie_rr": 20.0, "vent_kmh": 60.0, "neige_cm": 0.5}
STORM_CODES = {95, 96, 99}           # codes WMO : orage, avec ou sans grêle
FREEZING_CODES = {56, 57, 66, 67}    # bruine ou pluie verglaçante


def _cell(lat: float, lon: float) -> tuple[float, float]:
    # Arrondi à ~5 km : une seule requête partagée par quartier, et Open-Meteo ne reçoit jamais la position exacte
    return round(lat * 20) / 20, round(lon * 20) / 20


def _key(lat: float, lon: float) -> str:
    return "{:.2f},{:.2f}".format(*_cell(lat, lon))


def fetch(lat: float, lon: float, client: httpx.Client | None = None) -> dict:
    c = client or http.shared()
    r = c.get(settings.open_meteo_url, params={
        "latitude": lat, "longitude": lon, "hourly": HOURLY, "daily": DAILY,
        "timezone": "Europe/Paris", "forecast_days": 7}, timeout=15)
    r.raise_for_status()
    return r.json()


def get_forecast(db, lat: float, lon: float, client: httpx.Client | None = None) -> dict:
    """Prévision avec cache Mongo ; renvoie la dernière connue si Open-Meteo ne répond pas."""
    key, now = _key(lat, lon), datetime.now(timezone.utc)
    cached = db.weather_cache.find_one({"key": key})
    if cached and now - _aware(cached["fetched_at"]) < timedelta(minutes=settings.weather_cache_min):
        return {**cached["data"], "fetched_at": cached["fetched_at"], "stale": False}
    try:
        data = fetch(*_cell(lat, lon), client)
    except httpx.HTTPError:
        if cached:
            return {**cached["data"], "fetched_at": cached["fetched_at"], "stale": True}
        raise
    db.weather_cache.update_one({"key": key}, {"$set": {"key": key, "data": data, "fetched_at": now}}, upsert=True)
    return {**data, "fetched_at": now, "stale": False}


def daily_hazards(data: dict) -> list[dict]:
    """Un objet par jour avec la liste de ses aléas."""
    d = data.get("daily", {})
    out = []
    for i, day in enumerate(d.get("time", [])):
        v = {k: (d.get(k) or [None] * (i + 1))[i] for k in DAILY.split(",")}
        out.append({"date": day, "tx": v["temperature_2m_max"], "tn": v["temperature_2m_min"],
                    "rr": v["precipitation_sum"], "neige_cm": v["snowfall_sum"],
                    "rafales_kmh": v["wind_gusts_10m_max"], "code": v["weather_code"], "aleas": hazards(v)})
    return out


def hazards(v: dict, t: dict = THRESHOLDS) -> list[str]:
    """Aléas d'un jour Open-Meteo. Une valeur manquante ne déclenche rien."""
    out = []
    tx, tn = v.get("temperature_2m_max"), v.get("temperature_2m_min")
    rr, sn = v.get("precipitation_sum"), v.get("snowfall_sum")
    gust, code = v.get("wind_gusts_10m_max"), v.get("weather_code")
    if tx is not None and tx >= t["chaleur_tx"]:
        out.append("chaleur")
    if tn is not None and tn <= t["froid_tn"]:
        out.append("grand_froid")
    if (sn is not None and sn >= t["neige_cm"]) or code in FREEZING_CODES or (tn is not None and tn <= 0 and (rr or 0) > 0):
        out.append("neige_verglas")
    if code in STORM_CODES or (rr is not None and rr >= t["pluie_rr"]):
        out.append("orages_pluie")
    if gust is not None and gust >= t["vent_kmh"]:
        out.append("vent_fort")
    return out


# Seuils horaires (une heure suffit) : orage, pluie forte, chaleur, vent, neige ou verglas, grand froid
HOURLY_RULES = {
    "orages_pluie": lambda h: h["code"] in STORM_CODES or (h["rr"] or 0) >= 4,
    "chaleur": lambda h: (h["t"] or -99) >= THRESHOLDS["chaleur_tx"],
    "vent_fort": lambda h: (h["gust"] or 0) >= THRESHOLDS["vent_kmh"],
    "neige_verglas": lambda h: (h["snow"] or 0) > 0 or h["code"] in FREEZING_CODES,
    "grand_froid": lambda h: (h["t"] or 99) <= THRESHOLDS["froid_tn"],
}


def hourly_hazards(data: dict, now: datetime, hours: int = 36) -> list[dict]:
    """Épisodes d'aléa à venir : [{hazard, start, end}] (heures de Paris), le premier épisode de chaque aléa."""
    h = data.get("hourly", {})
    times = h.get("time", [])
    local = _aware(now).astimezone(PARIS).replace(tzinfo=None, minute=0, second=0, microsecond=0)
    out: dict[str, dict] = {}
    for i, t in enumerate(times):
        at = datetime.fromisoformat(t)
        if at < local or (at - local).total_seconds() > hours * 3600:
            continue
        v = {"code": (h.get("weather_code") or [None] * (i + 1))[i], "rr": (h.get("precipitation") or [None] * (i + 1))[i],
             "felt": (h.get("apparent_temperature") or [None] * (i + 1))[i],
             "t": (h.get("temperature_2m") or [None] * (i + 1))[i], "gust": (h.get("wind_gusts_10m") or [None] * (i + 1))[i],
             "snow": (h.get("snowfall") or [None] * (i + 1))[i]}
        for hazard, rule in HOURLY_RULES.items():
            if not rule(v):
                continue
            ep = out.get(hazard)
            if ep is None:
                ep = out[hazard] = {"hazard": hazard, "start": t, "end": t}
            elif ep["end"] == (at.replace(hour=at.hour) - timedelta(hours=1)).isoformat(timespec="minutes"):
                ep["end"] = t  # épisode continu
            else:
                continue
            # Température ressentie maximale de l'épisode (chaleur et froid)
            if v["felt"] is not None and hazard in ("chaleur", "grand_froid"):
                pick = max if hazard == "chaleur" else min
                ep["felt"] = round(pick(ep.get("felt", v["felt"]), v["felt"]))
    return sorted(out.values(), key=lambda e: e["start"])


def at_time(data: dict, when: datetime) -> dict | None:
    """Conditions prévues à l'heure la plus proche (sert pour la météo à l'arrivée)."""
    h = data.get("hourly", {})
    times = h.get("time", [])
    if not times:
        return None
    # Les heures Open-Meteo sont en heure de Paris
    local = _aware(when).astimezone(PARIS).replace(tzinfo=None)
    i = min(range(len(times)), key=lambda k: abs(datetime.fromisoformat(times[k]) - local))
    return {"time": times[i], "temperature": h["temperature_2m"][i], "ressenti": h["apparent_temperature"][i],
            "pluie_mm": h["precipitation"][i], "neige_cm": h["snowfall"][i], "rafales_kmh": h["wind_gusts_10m"][i],
            "code": h["weather_code"][i]}


def planned(data: dict, when: datetime, window_h: int = 6) -> dict | None:
    """Trajet à venir : conditions à l'heure de départ et aléas des heures qui suivent ; None hors de l'horizon de prévision."""
    times = data.get("hourly", {}).get("time", [])
    local = _aware(when).astimezone(PARIS).replace(tzinfo=None)
    if not times or not datetime.fromisoformat(times[0]) - timedelta(hours=1) <= local <= datetime.fromisoformat(times[-1]):
        return None
    return {**at_time(data, when), "hours": hourly_hazards(data, when, hours=window_h)}


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
