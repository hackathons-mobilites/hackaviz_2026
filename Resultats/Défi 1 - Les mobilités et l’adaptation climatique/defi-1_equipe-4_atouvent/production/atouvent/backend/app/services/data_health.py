"""Santé des données : chaque source est-elle à jour, complète et plausible ?"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from ..core.config import settings
from .cache import aware

DATA = Path(__file__).resolve().parents[2] / "data"


def _age_min(dt) -> float | None:
    return None if dt is None else round((datetime.now(timezone.utc) - aware(dt)).total_seconds() / 60)


def _grade(age: float | None, warn: float, ko: float) -> str:
    return "ko" if age is None or age > ko else "warn" if age > warn else "ok"


def _last_ok(db, source: str):
    r = db.collection_runs.find_one({"source": source, "ok": True}, sort=[("started_at", -1)])
    return r["started_at"] if r else None


def _cache_at(db, coll: str, field: str = "at"):
    d = db[coll].find_one(sort=[(field, -1)])
    return d.get(field) if d else None


def _file(name: str) -> tuple[datetime | None, Path]:
    p = DATA / name
    return (datetime.fromtimestamp(p.stat().st_mtime, timezone.utc) if p.exists() else None), p


def check(db) -> dict:
    out = []

    def add(key, label, status, age=None, detail="", unit="min"):
        out.append({"key": key, "label": label, "status": status, "age_min": age, "detail": detail})

    # 1. Collecte automatique (worker)
    for key, label, every in (("velib_status", "Vélib’ (disponibilités)", settings.velib_every_min),
                              ("elevators", "Ascenseurs (IDFM temps réel)", settings.elevators_every_min),
                              ("traffic", "Info trafic (PRIM)", 5)):
        if key == "traffic" and not settings.prim_api_key:
            add(key, label, "warn", detail="clé PRIM absente")
            continue
        age = _age_min(_last_ok(db, key))
        add(key, label, _grade(age, 3 * every, 10 * every), age, "collecte automatique")

    # 2. Plausibilité des dernières valeurs
    stations = db.velib_latest.count_documents({})
    bikes = sum(d.get("bikes") or 0 for d in db.velib_latest.find({}, {"bikes": 1}))
    add("velib_values", "Vélib’ : valeurs plausibles", "ok" if stations > 1000 and bikes > 1000 else "ko",
        detail=f"{stations} stations, {bikes} vélos")
    lifts = db.elevator_latest.count_documents({})
    unknown = db.elevator_latest.count_documents({"status": "inconnu"})
    add("elevator_values", "Ascenseurs : valeurs plausibles",
        "ok" if lifts > 500 and unknown < 0.2 * lifts else "warn" if lifts > 500 else "ko", detail=f"{lifts} suivis, {unknown} d’état inconnu")

    # 3. Caches des sources consultées à la demande
    w = db.weather_cache.find_one(sort=[("fetched_at", -1)])
    age = _age_min(w["fetched_at"]) if w else None
    temps = [t for t in ((w or {}).get("data", {}).get("hourly", {}).get("temperature_2m") or []) if t is not None]
    plausible = bool(temps) and -30 <= min(temps) and max(temps) <= 50
    add("weather", "Météo (Open-Meteo)", "ko" if w and not plausible else _grade(age, settings.weather_cache_min * 3, 24 * 60), age,
        "températures plausibles" if plausible else "températures hors bornes" if w else "jamais consultée")
    add("air", "Qualité de l’air (CAMS)", _grade(_age_min(_cache_at(db, "air_cache")), 180, 24 * 60), _age_min(_cache_at(db, "air_cache")))
    vig = db.vigilance_cache.find_one({"key": "idf"})
    add("vigilance", "Vigilance Météo-France", "warn" if not settings.meteofrance_api_key else _grade(_age_min(vig["at"]) if vig else None, 60, 24 * 60),
        _age_min(vig["at"]) if vig else None, "" if settings.meteofrance_api_key else "clé absente")
    for key, label, coll, warn, ko in (("flood", "Vigilance crues (Vigicrues)", "flood_cache", 120, 24 * 60),
                                       ("rivers", "Hauteur des rivières (Hub’Eau)", "hydro_cache", 60, 24 * 60),
                                       ("traffic_now", "Info trafic affichée", "traffic_cache", 30, 6 * 60),
                                       ("places", "Lieux (fontaines, toilettes…)", "places_cache", 2 * 24 * 60, 7 * 24 * 60)):
        age = _age_min(_cache_at(db, coll))
        add(key, label, _grade(age, warn, ko), age)

    # 4. Horaires et données préparées
    meta = DATA / "router.json"
    if meta.exists():
        end = json.loads(meta.read_text(encoding="utf-8")).get("valid", [None, None])[1]
        until = datetime.strptime(end, "%Y%m%d").date() if end else None
        days = (until - date.today()).days if until else None
        st = json.loads((DATA / "gtfs_state.json").read_text(encoding="utf-8")) if (DATA / "gtfs_state.json").exists() else {}
        add("gtfs", "Horaires IDFM (calculateur)", "ko" if days is None or days < 0 else "warn" if days < 10 else "ok",
            detail=f"valables jusqu’au {until:%d/%m/%Y}" + (f" · réseau reconstruit le {st['built_at'][:10]}" if st.get("built_at") else "")
            if until else "dates inconnues")
    else:
        add("gtfs", "Horaires IDFM (calculateur)", "ko", detail="réseau absent")
    for name, label, max_days in (("stop_info.json", "Équipements des arrêts", 35), ("shade.json", "Ombre des arbres", 400),
                                  ("hotspots.json", "Points noirs piétons et vélos", 400), ("chaleur.json", "Analyse décideurs", 400)):
        at, _ = _file(name)
        age = _age_min(at)
        add(name.split(".")[0], label, _grade(age, max_days * 24 * 60 * 0.8, max_days * 24 * 60), age)

    worst = "ko" if any(x["status"] == "ko" for x in out) else "warn" if any(x["status"] == "warn" for x in out) else "ok"
    return {"status": worst, "checked_at": datetime.now(timezone.utc).isoformat(), "sources": out}
