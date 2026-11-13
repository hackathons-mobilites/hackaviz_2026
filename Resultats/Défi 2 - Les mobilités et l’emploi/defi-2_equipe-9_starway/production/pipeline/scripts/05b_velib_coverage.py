"""05b - Couverture du service Vélib' Métropole (VEL01) : analyse seule, AUCUN export vers le front, aucun r5py.

Lit data/raw/VEL01/station_information.json (GBFS, téléchargé par `01_download.py --only VEL01`) et compte, à partir
des données :
- les stations situées dans une commune (ou un arrondissement) parmi les 1 285 origines STARWAY (contours GEO01,
  data/interim/communes_idf_2026.gpkg, jointure « point dans le contour ») ;
- par origine : nombre de stations, capacité totale (bornettes déclarées), distance à vol d'oiseau (Lambert-93) du point
  de départ D-017 à la station la plus proche ;
- par pôle : distance de l'arrêt d'ancrage à la station la plus proche.

Écrit data/processed/velib_coverage_2026.csv (une ligne par origine) et affiche un résumé repris dans
docs/proposition-velib.md. Aucun seuil : les distances sont décrites (quantiles), jamais classées en « proche » ou
« loin ».
"""

from __future__ import annotations

import json

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from starway.config import INTERIM_DIR, PROCESSED_DIR, RAW_DIR

STATIONS = RAW_DIR / "VEL01" / "station_information.json"
OUT = PROCESSED_DIR / "velib_coverage_2026.csv"
L93 = "EPSG:2154"


def load_stations() -> gpd.GeoDataFrame:
    raw = json.loads(STATIONS.read_text(encoding="utf-8"))
    st = pd.DataFrame(raw["data"]["stations"])
    print(f"GBFS : {len(st)} stations, lastUpdatedOther = {raw.get('lastUpdatedOther')} "
          f"({pd.to_datetime(raw.get('lastUpdatedOther'), unit='s', utc=True)}), colonnes {sorted(st.columns)}")
    return gpd.GeoDataFrame(st, geometry=gpd.points_from_xy(st["lon"], st["lat"]), crs="EPSG:4326").to_crs(L93)


def main() -> int:
    st = load_stations()
    contours = gpd.read_file(INTERIM_DIR / "communes_idf_2026.gpkg")
    origins = contours[contours["is_origin"]].to_crs(L93)
    joined = gpd.sjoin(st, origins[["insee", "geometry"]], predicate="within", how="left")
    outside = int(joined["insee"].isna().sum())
    per = joined.dropna(subset=["insee"]).groupby("insee").agg(stations=("station_id", "count"),
                                                                capacity=("capacity", "sum"))
    pts = gpd.GeoSeries(gpd.points_from_xy(origins["origin_lon"], origins["origin_lat"]), crs="EPSG:4326").to_crs(L93)
    tree = cKDTree(np.column_stack([st.geometry.x, st.geometry.y]))
    d, k = tree.query(np.column_stack([pts.x, pts.y]))
    out = pd.DataFrame({"insee": origins["insee"].to_numpy(), "name": origins["name"].to_numpy(),
                        "dep": origins["dep"].to_numpy(), "population": origins["population"].to_numpy()})
    out = out.merge(per, left_on="insee", right_index=True, how="left")
    out["stations"] = out["stations"].fillna(0).astype(int)
    out["capacity"] = out["capacity"].astype("Int64")  # vide si aucune station (pas 0 bornette déclarée)
    out["nearest_station_m"] = np.round(d).astype(int)
    out["nearest_station_code"] = st["stationCode"].to_numpy()[k]
    out.sort_values("insee").to_csv(OUT, index=False)

    served = out[out["stations"] > 0]
    q = served["nearest_station_m"].quantile([0.5, 0.9, 1.0]).round().astype(int).tolist()
    print(f"stations dans une des 1 285 origines : {len(st) - outside} ; hors IDF ou hors contours : {outside}")
    print(f"origines avec au moins une station : {len(served)} sur {len(out)} "
          f"(dont {int((served['dep'] == '75').sum())} arrondissements de Paris), population "
          f"{int(served['population'].sum()):,} sur {int(out['population'].sum()):,}".replace(",", " "))
    print("par département : " + ", ".join(f"{dep} {n}" for dep, n in served.groupby("dep").size().items()))
    print(f"origines desservies : distance du point de départ à la station la plus proche, médiane {q[0]} m, "
          f"9e décile {q[1]} m, maximum {q[2]} m")
    hours = st["station_opening_hours"].notna().sum() if "station_opening_hours" in st else "colonne absente"
    print(f"stations avec des heures d'ouverture renseignées : {hours}")

    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    pp = gpd.GeoSeries(gpd.points_from_xy([p["point"]["lon"] for p in poles], [p["point"]["lat"] for p in poles]),
                       crs="EPSG:4326").to_crs(L93)
    dp, kp = tree.query(np.column_stack([pp.x, pp.y]))
    for p, dist, i in zip(poles, dp, kp, strict=True):
        print(f"  pôle {p['id']:24} ancrage -> station {st['stationCode'].iloc[i]} à {round(dist)} m")
    print(f"écrit {OUT} ({len(out)} lignes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
