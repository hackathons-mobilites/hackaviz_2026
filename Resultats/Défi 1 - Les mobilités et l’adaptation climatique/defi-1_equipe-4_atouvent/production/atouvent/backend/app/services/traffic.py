"""Info trafic en direct (PRIM, « Messages Info Trafic », perturbations en masse), avec cache Mongo."""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from ..core.config import settings
from . import http

URL = "https://prim.iledefrance-mobilites.fr/marketplace/disruptions_bulk/disruptions/v2"
CACHE = timedelta(minutes=5)
PARIS = ZoneInfo("Europe/Paris")
RAIL = {"Metro", "RapidTransit", "LocalTrain", "Tramway", "RailShuttle", "Funicular", "CableWay"}
SEVERITY = {"BLOQUANTE": 0, "PERTURBEE": 1, "INFORMATION": 2}
WEATHER = re.compile(r"chaleur|canicule|inondation|crue|neige|verglas|intemp[ée]ries?|orage|temp[êe]te|vent violent|m[ée]t[ée]o|climat|gel\b", re.I)
ACCESS = re.compile(r"ascenseur|escalier m[ée]canique|escalator|accessibilit|fauteuil|PMR", re.I)


class TrafficUnavailable(Exception):
    pass


def _when(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%dT%H%M%S").replace(tzinfo=PARIS)


def _text(raw: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw or ""))).strip()


def tags(d: dict) -> list[str]:
    text = f"{d.get('title', '')} {_text(d.get('message'))}"
    out = []
    if WEATHER.search(text):
        out.append("meteo")
    if ACCESS.search(text):
        out.append("acces")
    if d.get("cause") == "TRAVAUX":
        out.append("travaux")
    return out


def parse(payload: dict, now: datetime) -> dict:
    """Perturbations actives maintenant, une entrée par ligne ferrée touchée ; les bus sont seulement comptés."""
    disruptions = {d["id"]: d for d in payload.get("disruptions", [])}
    active = {i for i, d in disruptions.items()
              if any(_when(p["begin"]) <= now <= _when(p["end"]) for p in d.get("applicationPeriods", []))}
    items, bus = [], set()
    for line in payload.get("lines", []):
        ids = {i for o in line.get("impactedObjects", []) for i in o.get("disruptionIds", []) if i in active}
        if line.get("mode") not in RAIL:
            bus |= ids
            continue
        for i in ids:
            d = disruptions[i]
            since = min((_when(p["begin"]) for p in d["applicationPeriods"] if _when(p["begin"]) <= now), default=None)
            items.append({"id": i, "line": line.get("shortName"), "line_id": line["id"].replace("line:IDFM:", ""),
                          "mode": line.get("mode"), "title": d.get("title"), "message": _text(d.get("message"))[:400],
                          "cause": d.get("cause"), "severity": d.get("severity"), "tags": tags(d),
                          "since": since.isoformat() if since else None})
    items.sort(key=lambda x: (SEVERITY.get(x["severity"], 3), x["line"] or ""))
    return {"items": items, "rail": len({x["id"] for x in items}), "bus": len(bus), "updated": payload.get("lastUpdatedDate")}


def fetch(client: httpx.Client | None = None) -> dict:
    if not settings.prim_api_key:
        raise TrafficUnavailable("PRIM_API_KEY absente")
    r = (client or http.shared()).get(URL, headers={"apikey": settings.prim_api_key}, timeout=30)
    r.raise_for_status()
    return r.json()


def current(db, client: httpx.Client | None = None) -> dict:
    now = datetime.now(timezone.utc)
    cached = db.traffic_cache.find_one({"key": "bulk"})
    if not cached or now - cached["at"].replace(tzinfo=timezone.utc) >= CACHE:
        try:
            payload = fetch(client)
        except httpx.HTTPError:
            if not cached:
                raise
            payload = cached["payload"]
        else:
            db.traffic_cache.update_one({"key": "bulk"}, {"$set": {"key": "bulk", "payload": payload, "at": now}}, upsert=True)
            cached = {"payload": payload, "at": now}
    return {**parse(cached["payload"], now.astimezone(PARIS)), "fetched_at": cached["at"]}
