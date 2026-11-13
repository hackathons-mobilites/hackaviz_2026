"""Vigilance crues officielle (Vigicrues) sur les tronçons de rivière d'Île-de-France, avec cache Mongo."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx

from . import http
from .cache import remember

URL = "https://www.vigicrues.gouv.fr/services/InfoVigiCru.geojson"
CACHE = timedelta(minutes=30)
LEVELS = {1: "vert", 2: "jaune", 3: "orange", 4: "rouge"}
PARIS = "IF5"  # tronçon « Seine à Paris »


def parse(payload: dict) -> dict:
    idf = [f["properties"] for f in payload.get("features", []) if str(f["properties"].get("CdEntCru", "")).startswith("IF")]
    level = lambda p: int(p.get("NivInfViCr") or 1)
    paris = next((p for p in idf if p["CdEntCru"] == PARIS), None)
    worst = max((level(p) for p in idf), default=1)
    return {"level": worst, "color": LEVELS.get(worst, "vert"),
            "paris": LEVELS.get(level(paris), "vert") if paris else None,
            "watch": sorted(({"name": p["lbentcru"], "color": LEVELS.get(level(p))} for p in idf if level(p) >= 2),
                            key=lambda x: x["name"]),
            "troncons": len(idf), "source": "Vigicrues (vigilance crues officielle)"}


def vigilance(db, client: httpx.Client | None = None) -> dict:
    def compute():
        r = (client or http.shared()).get(URL, timeout=30)
        r.raise_for_status()
        return {**parse(r.json()), "at": datetime.now(timezone.utc).isoformat()}
    return remember(db, "flood_cache", "idf", CACHE, compute)
