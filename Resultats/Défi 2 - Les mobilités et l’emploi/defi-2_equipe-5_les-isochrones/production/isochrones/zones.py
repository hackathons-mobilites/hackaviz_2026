"""Analysis zones: the 1,265 Île-de-France communes, with Paris split into its 20 arrondissements.

Each zone gets a reference point used as trip origin / destination:
    - the town hall (mairie) when geo.api.gouv.fr provides it, else the polygon's representative point
    - a few large job clusters whose jobs sit far from the town hall get a manual override
"""
import json

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from config import RAW, PROCESSED, CRS_M

# Job clusters far from their commune's town hall (lon, lat). Used only as the
# destination point of that zone; the zone stays the INSEE commune.
POINT_OVERRIDES = {
    "95527": ("Roissy-CDG (Aéroport CDG 2 TGV)",   2.5711, 49.0040),   # Roissy-en-France
    "93073": ("Tremblay - Paris Nord 2 / CDG",     2.5620, 48.9887),   # Tremblay-en-France
    "94054": ("Orly airport (Orly 1-2-3)",         2.3652, 48.7280),   # Orly
    "91479": ("Paray - Orly airport side",         2.3720, 48.7230),   # Paray-Vieille-Poste
    "94065": ("Rungis - MIN / Silic",              2.3480, 48.7580),   # Rungis
    "92062": ("La Défense (Puteaux side)",         2.2390, 48.8910),   # Puteaux
    "92026": ("La Défense (Courbevoie side)",      2.2430, 48.8950),   # Courbevoie
    "78423": ("Saint-Quentin-en-Yvelines centre",  2.0440, 48.7860),   # Montigny-le-Bretonneux
    "77111": ("Val d'Europe / Chessy station",     2.7820, 48.8710),   # Chessy
    "91272": ("Paris-Saclay campus (Gif side)",    2.1660, 48.7110),   # Gif-sur-Yvette
    "91471": ("Paris-Saclay (Orsay / Moulon)",     2.1730, 48.7120),   # Orsay
}


PARIS_CENTRE_ARR = ["75101", "75102", "75103", "75104"]


def _points(path, prefer="mairie"):
    other = "centre" if prefer == "mairie" else "mairie"
    rows  = []
    for c in json.load(open(path)):
        geom = c.get(prefer) or c.get(other)
        if geom:
            lon, lat = geom["coordinates"]
            rows.append((c["code"], lon, lat, prefer if c.get(prefer) else other))
    return pd.DataFrame(rows, columns=["code", "lon", "lat", "point_src"])


def build_zones() -> gpd.GeoDataFrame:
    com = gpd.read_file(RAW / "communes_idf.geojson")
    arr = gpd.read_file(RAW / "arrondissements.geojson")
    zones = pd.concat([com[com.code != "75056"], arr], ignore_index=True)
    zones = gpd.GeoDataFrame(zones, geometry="geometry", crs=4326).to_crs(CRS_M)

    pts = []
    for f in ("communes_idf_points.json", "arrondissements_points.json"):
        p = RAW / f
        if p.exists():
            pts.append(_points(p, "mairie"))
    pts = pd.concat(pts) if pts else pd.DataFrame(columns=["code", "lon", "lat", "point_src"])
    # 1er-4e share the "Paris Centre" town hall since 2020: use each one's centre instead
    centre = PARIS_CENTRE_ARR
    if (RAW / "arrondissements_points.json").exists():
        c = _points(RAW / "arrondissements_points.json", "centre")
        pts = pd.concat([pts[~pts.code.isin(centre)], c[c.code.isin(centre)]])

    for code, (label, lon, lat) in POINT_OVERRIDES.items():
        pts = pts[pts.code != code]
        pts = pd.concat([pts, pd.DataFrame([(code, lon, lat, f"override: {label}")],
                                           columns=pts.columns)])

    zones = zones.merge(pts, on="code", how="left")
    rep   = zones.geometry.representative_point()
    has   = zones.lon.notna()
    pt    = gpd.GeoSeries([Point(xy) for xy in zip(zones.lon.fillna(0), zones.lat.fillna(0))],
                          crs=4326).to_crs(CRS_M)
    zones["px"]        = pt.x.where(has, rep.x)
    zones["py"]        = pt.y.where(has, rep.y)
    zones["point_src"] = zones.point_src.fillna("representative_point")
    zones["dep"]       = zones.code.str[:2]
    zones = zones[["code", "nom", "dep", "population", "px", "py", "point_src", "geometry"]]
    zones = zones.sort_values("code").reset_index(drop=True)
    zones.to_file(PROCESSED / "zones.gpkg", driver="GPKG")
    return zones


if __name__ == "__main__":
    z = build_zones()
    print(len(z), "zones")
    print(z.point_src.str.split(":").str[0].value_counts())
