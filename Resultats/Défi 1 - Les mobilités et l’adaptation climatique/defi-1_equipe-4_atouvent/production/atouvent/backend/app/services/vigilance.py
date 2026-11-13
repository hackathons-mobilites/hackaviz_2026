"""Vigilance météorologique officielle de Météo-France (API DPVigilance, portail-api.meteofrance.fr)."""
from __future__ import annotations

from datetime import timedelta

import httpx

from ..core.config import settings
from . import http
from .cache import remember

URL = "https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours"
IDF = {"75", "77", "78", "91", "92", "93", "94", "95"}
COLORS = {1: "vert", 2: "jaune", 3: "orange", 4: "rouge"}
# Phénomènes Météo-France → aléas AtouVent
PHENOMENA = {"1": "vent_fort", "2": "orages_pluie", "3": "orages_pluie", "4": "crue", "5": "neige_verglas", "6": "chaleur", "7": "grand_froid"}
CACHE = timedelta(minutes=15)


def parse(payload: dict) -> dict:
    """{"J": {"chaleur": {"color": "orange", "level": 3, "departments": ["75", …]}}, "J1": {…}}"""
    out: dict[str, dict] = {}
    for period in (payload.get("product") or {}).get("periods", []):
        when = period.get("echeance")
        if when not in ("J", "J1"):
            continue
        day = out.setdefault(when, {})
        for dom in (period.get("timelaps") or {}).get("domain_ids", []):
            dep = str(dom.get("domain_id", ""))
            if dep not in IDF:
                continue
            for item in dom.get("phenomenon_items", []):
                hazard = PHENOMENA.get(str(item.get("phenomenon_id")))
                level = int(item.get("phenomenon_max_color_id") or 1)
                if not hazard or level < 2:
                    continue
                cur = day.setdefault(hazard, {"level": level, "departments": []})
                cur["level"] = max(cur["level"], level)
                cur["departments"].append(dep)
                # Heures de début et de fin de la vigilance (jaune ou plus), en UTC
                spans = [t for t in item.get("timelaps_items", []) if int(t.get("color_id") or 1) >= 2]
                if spans:
                    cur["start"] = min([cur.get("start", spans[0]["begin_time"])] + [t["begin_time"] for t in spans])
                    cur["end"] = max([cur.get("end", spans[0]["end_time"])] + [t["end_time"] for t in spans])
    for day in out.values():
        for v in day.values():
            v["color"] = COLORS[v["level"]]
            v["departments"] = sorted(set(v["departments"]))
    return out


TEXTS = "https://public-api.meteofrance.fr/public/DPVigilance/v1/textesvigilance/encours"


def _texts(node, inside: bool = False, out: list | None = None) -> list[str]:
    """Textes des blocs qui concernent l'Île-de-France (parcours générique du JSON des bulletins)."""
    out = [] if out is None else out
    if isinstance(node, dict):
        here = inside or str(node.get("domain_id", "")) in IDF
        for k, v in node.items():
            if k == "text" and here:
                out += [x for x in (v if isinstance(v, list) else [v]) if isinstance(x, str) and x.strip()]
            else:
                _texts(v, here, out)
    elif isinstance(node, list):
        for v in node:
            _texts(v, inside, out)
    return out


def bulletin(db, client: httpx.Client | None = None) -> list[str]:
    """Conseils et commentaires officiels pour l'Île-de-France ; vide quand aucune vigilance n'est en cours (404)."""
    if not settings.meteofrance_api_key:
        return []

    def compute():
        r = (client or http.shared()).get(TEXTS, headers={"apikey": settings.meteofrance_api_key}, timeout=20)
        if r.status_code == 404:  # pas de bulletin : vigilance verte partout
            return []
        r.raise_for_status()
        seen, out = set(), []
        for t in _texts(r.json()):
            if t not in seen:
                seen.add(t)
                out.append(t.strip())
        return out[:12]
    try:
        return remember(db, "vigilance_cache", "texts", CACHE, compute)
    except httpx.HTTPError:
        return []


def current(db, client: httpx.Client | None = None) -> dict:
    if not settings.meteofrance_api_key:
        return {"available": False, "reason": "key_missing"}

    def compute():
        r = (client or http.shared()).get(URL, headers={"apikey": settings.meteofrance_api_key}, timeout=20)
        r.raise_for_status()
        return parse(r.json())
    try:
        return {"available": True, **remember(db, "vigilance_cache", "idf", CACHE, compute)}
    except httpx.HTTPError:
        return {"available": False, "reason": "unavailable"}
