"""Recherche d'adresse via la Géoplateforme IGN (sans clé), avec cache Mongo."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ..core.config import settings
from . import http

# Boîte Île-de-France : on ne garde que les résultats franciliens
IDF_DEPTS = {"75", "77", "78", "91", "92", "93", "94", "95"}


def _first(v):
    return v[0] if isinstance(v, list) and v else v


def parse(payload: dict) -> list[dict]:
    """Adresses et lieux nommés (gares, monuments) d'Île-de-France, sans doublon de nom."""
    out, seen = [], set()
    for f in payload.get("features", []):
        p, (lon, lat) = f.get("properties", {}), f["geometry"]["coordinates"]
        if str(_first(p.get("citycode")) or "")[:2] not in IDF_DEPTS:
            continue
        # Lieu nommé (POI) : nom et commune sont des listes ; adresse : libellé complet
        city = _first(p.get("city"))
        label = p.get("label") or ", ".join(x for x in (_first(p.get("name")), city) if x)
        if not label or label in seen:
            continue
        seen.add(label)
        out.append({"label": label, "city": city, "lat": lat, "lon": lon, "type": p.get("type") or p.get("_type")})
    return out


def search(db, q: str, client: httpx.Client | None = None) -> list[dict]:
    """Gares et stations du réseau d'abord (« saint lazare » → Gare Saint-Lazare, pas une rue de Seine-et-Marne), puis adresses et lieux IGN."""
    stations = _stations(q)
    names = {s["label"].split(" (")[0].lower() for s in stations}
    return stations + [r for r in _addresses(db, q, client) if r["label"].split(",")[0].lower() not in names][:10 - len(stations)]


def _stations(q: str) -> list[dict]:
    from ..router import engine
    try:
        return engine.find_stations(q)
    except Exception:  # réseau pas encore chargé : la recherche d'adresses suffit
        return []


def _addresses(db, q: str, client: httpx.Client | None = None) -> list[dict]:
    key = q.strip().lower()
    cached = db.geocode_cache.find_one({"q": key})
    if cached:
        return cached["results"]
    c = client or http.shared()
    r = c.get(settings.geocode_url, params={"q": q, "limit": 10, "index": "address,poi", "lat": 48.8566, "lon": 2.3522}, timeout=10)
    r.raise_for_status()
    results = parse(r.json())
    db.geocode_cache.update_one({"q": key}, {"$set": {"q": key, "results": results,
                                                      "at": datetime.now(timezone.utc)}}, upsert=True)
    return results
