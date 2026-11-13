"""Lieux utiles autour de l'usager, toutes sources confondues, dans un format commun."""
from __future__ import annotations

from datetime import date, timedelta

import httpx

from . import http
from .cache import remember
from .geo import distance_m

PARIS = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/{}/exports/json"
# Espaces verts et boisés surfaciques ouverts au public d'Île-de-France 2024 (Institut Paris Region, Licence Ouverte)
IPR_GREEN = "https://geoweb.iau-idf.fr/agsmap1/rest/services/OPENDATA/OpendataIAU4/MapServer/9/query"
IDFM = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/{}/exports/json"
TTL = timedelta(days=1)

# Type d'équipement frais (Ville de Paris) → catégorie affichée
PLACE_KIND = {"Piscine": "pool", "Baignade extérieure": "pool", "Brumisateur": "mist", "Musée": "museum", "Bibliothèque": "library",
              "Ombrière pérenne": "shade", "Ombrière temporaire": "shade"}


def _yes(v) -> bool | None:
    return None if v in (None, "") else str(v).strip().lower() in ("oui", "true", "1", "yes")


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _name(v) -> str:
    v = (v or "").strip()
    return v.title() if v.isupper() else v[:1].upper() + v[1:] if v.islower() else v


def _geo(r: dict, key: str = "geo_point_2d") -> tuple[float, float] | None:
    g = r.get(key) or {}
    return (g["lat"], g["lon"]) if isinstance(g, dict) and "lat" in g else None


# Une source : (url, filtre ODS, fonction ligne → lieu ou None)
def _fountain_paris(r):
    return {"kind": "fountain", "name": _name(r.get("voie")) or "Fontaine"} if r.get("dispo") == "OUI" else None


def _fountain_idfm(r):
    if r.get("indisponible") in ("true", True):
        return None
    return {"kind": "fountain", "name": r.get("arrname") or "Fontaine", "pmr": _yes(r.get("accessible_pmr")), "_geo": "pointgeo"}


def _green(r):
    return {"kind": "green", "name": _name(r.get("nom")), "type": r.get("type"), "open24h": _yes(r.get("ouvert_24h")),
            "heatwave": _yes(r.get("canicule_ouverture")), "night": _yes(r.get("ouverture_estivale_nocturne"))}


def _cool_place(r):
    return {"kind": PLACE_KIND.get(r.get("type"), "indoor"), "name": _name(r.get("nom")), "type": r.get("type"),
            "paid": _yes(r.get("payant")), "hours": r.get("horaires_periode")}


def _sanisette(r):
    if r.get("statut") and r["statut"] != "En service":
        return None
    return {"kind": "toilets", "name": _name(r.get("adresse")) or "Sanisette", "type": r.get("type"), "hours": r.get("horaire"),
            "pmr": _yes(r.get("acces_pmr")), "baby": _yes(r.get("relais_bebe")), "paid": False}


def _toilets_ratp(r):
    return {"kind": "toilets", "name": f"{r.get('station')} (ligne {r.get('ligne')})", "type": "RATP", "pmr": _yes(r.get("accessibilite_pmr")),
            "paid": (r.get("tarif_gratuit_payant") or "").lower() == "payant", "inside": _yes(r.get("en_zone_controlee")),
            "hours": r.get("localisation"), "_geo": "coord_geo"}


def _bike_parking(r):
    if not _yes(r.get("is_installed")):
        return None
    return {"kind": "bike_parking", "name": r.get("name_station") or r.get("name"), "type": r.get("type"),
            "capacity": _num(r.get("num_docks_available")), "secure": r.get("type") == "Consigne",
            "price_navigo": r.get("price_navigo"), "cargo": _num(r.get("cargo_docks")), "repair": _yes(r.get("repair_station"))}


def _park_ride(r):
    if r.get("etat_pr") not in (None, "MES"):  # MES : mis en service
        return None
    return {"kind": "park_ride", "name": _name(r.get("nom_pr")), "station": r.get("nom_gare"), "capacity": _num(r.get("pl_pr")),
            "pmr": _num(r.get("pl_pmr")), "electric": _num(r.get("pl_elec")), "bikes": _num(r.get("pl_velo")), "label": r.get("label_pr")}


def _works(r):
    # Le statut n'est pas toujours mis à jour : un chantier dont la date de fin est passée est ignoré
    if r.get("statut") not in (None, "En cours", "A venir") or (r.get("date_fin") or "9999") < date.today().isoformat():
        return None
    detail = r.get("impact_circulation_detail") or ""
    return {"kind": "works", "name": r.get("voie") or "Chantier", "type": (r.get("objet") or "").replace("_", " ").capitalize(),
            "detail": detail, "until": r.get("date_fin"), "level": r.get("niveau_perturbation"),
            "sidewalk": "trottoir" in detail.lower() or "piéton" in detail.lower()}


# Espaces verts hors Paris (Paris est couvert, avec plus de détails, par les îlots de fraîcheur de la Ville).
IPR_SKIP = {"Jardin famillial", "Jardin partagé", "Espace vert en projet", "Cimetière paysager", "Jardin non identifié (Ex Jardin potager)",
            "Parc sportif", "Plaine de jeux"}
IPR_WHERE = "statouvlib='Ouvert' AND entpaylib='Non' AND surftotha>=0.3 AND numdep<>75"


def _ring_points(geometry: dict, area_ha: float) -> list[list[float]]:
    """Points du contour (simplifié par le serveur) : la distance utile est celle de la lisière la plus proche, pas celle du centre (un bois de plusieurs kilomètres a son centre loin de toute entrée)."""
    pts = [p for ring in geometry.get("rings", []) for p in ring]
    keep = 60 if area_ha >= 50 else 16
    step = max(1, len(pts) // keep)
    return [[round(lat, 5), round(lon, 5)] for lon, lat in pts[::step]]


def _ipr_green(client: httpx.Client) -> list[dict]:
    """Parcs, squares, bois et bases de loisirs ouverts au public hors Paris, page par page (1 000 par requête)."""
    out, offset = [], 0
    while True:
        r = client.get(IPR_GREEN, params={
            "where": IPR_WHERE, "outFields": "nom,categlib,catggenlib,surftotha,nomcom,insee", "returnGeometry": "true",
            "outSR": 4326, "maxAllowableOffset": 0.0008, "resultOffset": offset, "resultRecordCount": 1000,
            "orderByFields": "objectid", "f": "json"}, timeout=120)
        r.raise_for_status()
        feats = r.json().get("features", [])
        for f in feats:
            a = f["attributes"]
            if a.get("categlib") in IPR_SKIP or not f.get("geometry"):
                continue
            pts = _ring_points(f["geometry"], a.get("surftotha") or 0)
            if not pts:
                continue
            lat, lon = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            name = (a.get("nom") or "").strip()
            out.append({"kind": "green", "name": _name(name) if name else a.get("categlib"), "type": a.get("categlib"),
                        "area_ha": round(a.get("surftotha") or 0, 1), "city": a.get("nomcom"),
                        "lat": round(lat, 6), "lon": round(lon, 6), "pts": pts})
        if len(feats) < 1000:
            return out
        offset += 1000


SOURCES = {
    "fontaines_paris": (PARIS.format("fontaines-a-boire"), _fountain_paris),
    "fontaines_idfm": (IDFM.format("fontaines-arrets-de-transport-en-commun-didf"), _fountain_idfm),
    "fraicheur_verts": (PARIS.format("ilots-de-fraicheur-espaces-verts-frais"), _green),
    "fraicheur_lieux": (PARIS.format("ilots-de-fraicheur-equipements-activites"), _cool_place),
    "sanisettes": (PARIS.format("sanisettesparis"), _sanisette),
    "toilettes_ratp": (IDFM.format("sanitaires-reseau-ratp"), _toilets_ratp),
    "parkings_velo": (IDFM.format("parking-velos-ile-de-france-mobilites"), _bike_parking),
    "parcs_relais": (IDFM.format("parking_relais_idf"), _park_ride),
    "chantiers": (PARIS.format("chantiers-perturbants"), _works),
    "espaces_verts_idf": (_ipr_green, None),  # source ArcGIS : la fonction renvoie directement les lieux
}
GROUPS = {  # groupe → (sources, rayon de recherche en mètres)
    "fountain": (("fontaines_paris", "fontaines_idfm"), 800),
    "cool": (("fraicheur_verts", "fraicheur_lieux", "espaces_verts_idf"), 1000),
    "toilets": (("sanisettes", "toilettes_ratp"), 1000),
    "bike_parking": (("parkings_velo",), 2000),
    "park_ride": (("parcs_relais",), 10000),
    "works": (("chantiers",), 600),
}


def load(db, name: str, client: httpx.Client | None = None) -> list[dict]:
    """Lieux d'une source, normalisés (nom, type, coordonnées, détails), mis en cache un jour."""
    url, row = SOURCES[name]

    def compute():
        if callable(url):
            return url(client or http.shared())
        r = (client or http.shared()).get(url, timeout=60)
        r.raise_for_status()
        out = []
        for raw in r.json():
            p = row(raw)
            if not p:
                continue
            g = _geo(raw, p.pop("_geo", "geo_point_2d"))
            if g:
                out.append({**{k: v for k, v in p.items() if v is not None}, "lat": round(g[0], 6), "lon": round(g[1], 6)})
        return out
    return remember(db, "places_cache", name, TTL, compute)


def near(db, group: str, lat: float, lon: float, limit: int = 12, radius: float | None = None,
         client: httpx.Client | None = None) -> list[dict]:
    """Lieux d'un groupe autour d'un point, du plus proche au plus loin."""
    sources, default_radius = GROUPS[group]
    radius = radius or default_radius
    out = []
    for s in sources:
        for p in load(db, s, client):
            # Grand espace (contour connu) : distance à la lisière la plus proche, et c'est là qu'on emmène l'usager
            at = min(p["pts"], key=lambda q: distance_m((lat, lon), q)) if p.get("pts") else (p["lat"], p["lon"])
            d = distance_m((lat, lon), at)
            if d <= radius:
                out.append({**{k: v for k, v in p.items() if k != "pts"}, "lat": at[0], "lon": at[1], "distance_m": round(d)})
    # Un même parc découpé en plusieurs morceaux n'apparaît qu'une fois (le morceau le plus proche)
    seen, unique = set(), []
    for p in sorted(out, key=lambda x: x["distance_m"]):
        key = (p["kind"], p["name"])
        if "area_ha" in p and key in seen:
            continue
        seen.add(key)
        unique.append(p)
    return unique[:limit]


def works_along(db, points: list[tuple[float, float]], radius: float = 40) -> list[dict]:
    """Chantiers à moins de 40 m d'un point d'un trajet à pied (trottoir fermé, déviation piétonne…)."""
    seen, out = set(), []
    for p in load(db, "chantiers"):
        if p["name"] not in seen and any(distance_m(q, (p["lat"], p["lon"])) <= radius for q in points):
            seen.add(p["name"])
            out.append({k: p[k] for k in ("name", "type", "detail", "until", "sidewalk", "lat", "lon") if k in p})
    return out
