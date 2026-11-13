"""Météo (Open-Meteo), fontaines et lieux frais, Seine et vigilance crues."""
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from ..core.ratelimit import limit
from ..deps import db_dep
from ..schemas import LAT, LON
from ..services import air, flood, hydro, open_meteo, places, vigilance

router = APIRouter(tags=["environnement"])


@router.get("/weather", dependencies=[Depends(limit("weather"))])
def weather(lat: float = Query(**LAT), lon: float = Query(**LON), at: datetime | None = None, db=Depends(db_dep)):
    """Prévision sur 7 jours, conditions de l'heure en cours et aléas détectés (Île-de-France)."""
    try:
        fc = open_meteo.get_forecast(db, lat, lon)
    except httpx.HTTPError:
        raise HTTPException(503, "weather_unavailable")
    days = open_meteo.daily_hazards(fc)
    now = datetime.now(timezone.utc)
    current = open_meteo.at_time(fc, now)
    # Qualité de l'air, UV, pollens : jour par jour (l'aléa « pollution » rejoint les autres aléas du jour)
    try:
        hourly = air.fetch(db, lat, lon)
        by_day = air.daily(hourly)
        current = {**(current or {}), "air": air.now(hourly, now.astimezone(open_meteo.PARIS))}
    except httpx.HTTPError:
        by_day = {}
    official = vigilance.current(db)
    for i, d in enumerate(days):
        d["air"] = by_day.get(d["date"])
        if d["air"] and d["air"]["pollution"] and "pollution" not in d["aleas"]:
            d["aleas"].append("pollution")
        # Vigilance officielle (aujourd'hui et demain) : orange ou rouge s'ajoute aux aléas, quelle que soit la prévision
        vig = official.get("J" if i == 0 else "J1" if i == 1 else "", {}) if official.get("available") else {}
        d["vigilance"] = vig or None
        for hazard, v in vig.items():
            if v["level"] >= 3 and hazard not in d["aleas"]:
                d["aleas"].append(hazard)
    planned = None
    if at is not None:
        planned = open_meteo.planned(fc, at)
        if planned:
            planned["day"] = next((d for d in days if d["date"] == planned["time"][:10]), None)
    return {"days": days, "now": current, "hours": open_meteo.hourly_hazards(fc, now), "at": planned,
            "fetched_at": fc["fetched_at"], "stale": fc["stale"],
            "vigilance_available": official.get("available", False),
            # Textes officiels (conseils de comportement) quand une vigilance jaune ou plus concerne l'Île-de-France
            "bulletin": vigilance.bulletin(db) if any(d.get("vigilance") for d in days[:2]) else [],
            "source": "Open-Meteo, modèles Météo-France puis ECMWF, qualité de l'air CAMS (CC BY 4.0)"
                      + (" · vigilance Météo-France" if official.get("available") else "")}


@router.get("/cool/near", dependencies=[Depends(limit("nearby"))])
def cool_near(lat: float = Query(**LAT), lon: float = Query(**LON), db=Depends(db_dep)):
    """Fontaine à boire et lieu frais les plus proches (tuiles de l'écran d'accueil)."""
    try:
        f, c = places.near(db, "fountain", lat, lon, limit=1), places.near(db, "cool", lat, lon, limit=1)
    except httpx.HTTPError:
        raise HTTPException(503, "cool_unavailable")
    return {"fountain": f[0] if f else None, "cool": c[0] if c else None}


@router.get("/places/near", dependencies=[Depends(limit("nearby"))])
def places_near(group: str = Query(pattern="^(" + "|".join(places.GROUPS) + ")$"), lat: float = Query(**LAT), lon: float = Query(**LON),
                db=Depends(db_dep)):
    """Lieux d'un groupe autour d'un point : fountain, cool, toilets, bike_parking, park_ride, works."""
    try:
        return places.near(db, group, lat, lon)
    except httpx.HTTPError:
        raise HTTPException(503, "places_unavailable")


@router.get("/seine")
def seine(db=Depends(db_dep)):
    """Hauteur de la Seine à Paris-Austerlitz en temps réel et tendance sur l'heure."""
    try:
        return hydro.seine(db)
    except httpx.HTTPError:
        raise HTTPException(503, "seine_unavailable")


@router.get("/rivers")
def rivers(db=Depends(db_dep)):
    """Hauteur et tendance des principales rivières d'Île-de-France (Seine, Marne, Oise)."""
    return hydro.rivers(db)


@router.get("/flood")
def flood_vigilance(db=Depends(db_dep)):
    """Vigilance crues officielle (Vigicrues) sur les rivières d'Île-de-France."""
    try:
        return flood.vigilance(db)
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, "flood_unavailable")
