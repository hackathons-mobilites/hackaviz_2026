"""Qualité de l'air sur les quais du métro et du RER (évaluation Airparif publiée par IDFM, 665 quais)."""
from __future__ import annotations

import re
from datetime import timedelta

import httpx

from . import http
from .cache import remember
from .geo import distance_m

URL = ("https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/"
       "qualite-de-lair-dans-le-reseau-de-transport-francilien/exports/json")
TTL = timedelta(days=1)
NEAR_M = 300
# Du plus sain au plus pollué ; « inconnu » n'est jamais affiché comme un niveau
LEVELS = {"station aérienne": "open_air", "pollution faible": "low", "pollution moyenne": "medium", "pollution élevée": "high"}
RANK = {"open_air": 0, "low": 1, "medium": 2, "high": 3}


def _line_key(name: str) -> str:
    """« Métro 7B » → « 7B », « RER C » → « C », « L » → « L » : même clé que les étapes du calculateur."""
    return re.sub(r"^(Métro|RER)\s+", "", (name or "").strip())


def parse(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        level = LEVELS.get((r.get("niveau_pollution") or "").strip().lower())
        geo = r.get("point_geo") or {}
        if not level or "lat" not in geo:
            continue
        ref = r.get("identifiant_station") or ""
        out.append({"quay": ref.split(":")[-1] if "monomodal" not in ref else None, "name": r.get("nom_de_la_station"),
                    "line": _line_key(r.get("nom_de_la_ligne")), "level": level, "lat": geo["lat"], "lon": geo["lon"],
                    "permanent": "permanentes" in (r.get("incertitude") or ""),
                    "watch": (r.get("recommandation_de_surveillance") or "").lower() == "oui"})
    return out


def load(db, client: httpx.Client | None = None) -> list[dict]:
    def compute():
        r = (client or http.shared()).get(URL, timeout=60)
        r.raise_for_status()
        return parse(r.json())
    return remember(db, "places_cache", "air_quais", TTL, compute)


def for_stop(records: list[dict], lat: float, lon: float, line: str | None = None, quay_id: str | None = None) -> dict | None:
    """Évaluation du quai d'une ligne (ou, sans ligne, la plus défavorable des lignes de la gare)."""
    if quay_id:
        q = quay_id.rstrip(":").split(":")[-1]
        hit = next((x for x in records if x["quay"] == q), None)
        if hit:
            return _public(hit)
    near = [x for x in records if (line is None or x["line"] == line) and distance_m((lat, lon), (x["lat"], x["lon"])) <= NEAR_M]
    if not near:
        return None
    return _public(max(near, key=lambda x: RANK[x["level"]]))


def _public(x: dict) -> dict:
    return {"air": x["level"], "air_measured": "permanent" if x["permanent"] else "campaign"}


def annotate(db, itineraries: list[dict]) -> None:
    """Ajoute au départ et à l'arrivée de chaque étape en métro ou RER le niveau de pollution du quai."""
    try:
        records = load(db)
    except httpx.HTTPError:
        return  # source indisponible : l'information est simplement absente
    for it in itineraries:
        for leg in it["legs"]:
            if leg["mode"] not in ("SUBWAY", "RAIL"):
                continue
            for end in ("from", "to"):
                p = leg[end]
                found = for_stop(records, p["lat"], p["lon"], leg.get("line"), p.get("quay_id"))
                if found:
                    p["info"] = {**(p.get("info") or {}), **found}
