"""06b - Géométries de la « carte miroir » (plan § 15) dans frontend/public/data/geo/.

Entrées : data/raw/GEO01/ (contours API Géo 2026), data/processed/poles_d030.json (44 astres, 03b),
data/processed/poles.json et pole_anchor_stops.csv (15 pôles)
Sorties :
    frontend/public/data/geo/communes.geojson           (1 285 origines : 1 265 communes + 20 arrondissements)
    <FRONT_SKY44_DIR>/geo/poles.geojson   (D-030 : 44 contours d'astres = union des communes membres + 44 arrêts
                                           d'affichage lus dans `point` de poles_d030.json)

La simplification (tolérance GEO_SIMPLIFY_TOLERANCE_M, GEO_COORD_DECIMALS décimales) est un choix de rendu documenté
dans docs/methodologie.md ; aucune valeur affichée ou calculée n'en dépend. Idempotent, léger en mémoire (< 1 Go).
"""

from __future__ import annotations

import argparse
import json

import pandas as pd
from shapely.geometry import Point

from starway.config import (
    FRONT_DATA_DIR,
    FRONT_SKY44_DIR,
    GEO_COORD_DECIMALS,
    GEO_MAX_COMMUNES_KB,
    GEO_SIMPLIFY_TOLERANCE_M,
    POLES_D030_JSON,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    SERVICE_DATE,
)
from starway.export import write_json
from starway.geo import load_communes_2026, origins_from
from starway.sources import GEO01_LICENCE
from starway.geo_export import area_change, feature, feature_collection, simplify_coverage, union_by_group

OUT_DIR = FRONT_DATA_DIR / "geo"
SOURCE_NOTE = "GEO01 - API Géo (geo.api.gouv.fr), contours des communes et arrondissements, COG 2026"


def pole_features(poles: list[dict], anchors: pd.DataFrame, geoms: dict) -> list[dict]:
    areas = union_by_group(geoms, {p["id"]: p["communes"] for p in poles}, GEO_COORD_DECIMALS)
    feats = [feature(areas[p["id"]], {"kind": "pole_area", "pole_id": p["id"], "name": p["name"],
                                      "communes": p["communes"]}) for p in poles]
    for p in poles:
        a = anchors.loc[p["id"]]
        feats.append(feature(Point(p["point"]["lon"], p["point"]["lat"]), {
            "kind": "anchor", "pole_id": p["id"], "stop_id": a["stop_id"], "stop_name": a["stop_name"],
            "insee": a["insee"], "departures": int(a["departures"]), "service_date": a["service_date"],
            "method": "arrêt parent le plus desservi le jour de référence dans les communes du pôle (TRA01)"}))
    return feats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.parse_args()
    origins = origins_from(load_communes_2026())  # 1 285 origines, Paris en arrondissements
    simp = simplify_coverage(origins, GEO_SIMPLIFY_TOLERANCE_M, GEO_COORD_DECIMALS)
    err = area_change(origins.geometry, simp)
    if not simp.is_valid.all() or simp.is_empty.any():
        raise SystemExit("géométrie simplifiée invalide ou vide : baisser la tolérance")

    rendering = {"method": "shapely.coverage_simplify (frontières partagées simplifiées à l'identique), Lambert-93",
                 "tolerance_m": GEO_SIMPLIFY_TOLERANCE_M, "coord_decimals": GEO_COORD_DECIMALS,
                 "note": "choix de rendu pour la carte miroir, pas une donnée ; aucun calcul n'utilise ces contours",
                 "area_change_median_pct": round(float(pd.Series(err).median()) * 100, 2),
                 "area_change_max_pct": round(float(err.max()) * 100, 1)}
    meta = {"processing_version": PROCESSING_VERSION, "source": SOURCE_NOTE, "licence": GEO01_LICENCE, "coordinates": "WGS84 (EPSG:4326), lon/lat",
            "winding": "anneaux extérieurs dans le sens horaire (convention d3-geo)",
            "rendering": rendering}

    communes_fc = feature_collection(
        [feature(g, {"insee": i, "name": n}) for i, n, g in zip(origins["insee"], origins["name"], simp, strict=True)],
        **meta)
    size_c = write_json(OUT_DIR / "communes.geojson", communes_fc)
    geoms = dict(zip(origins["insee"], simp, strict=True))

    # ciel des 44 astres (D-030) : arrêt d'affichage écrit dans `point` par 03b
    poles44 = json.loads(POLES_D030_JSON.read_text(encoding="utf-8"))
    anchors44 = pd.DataFrame([{"pole_id": p["id"], "stop_id": p["point"]["stop_id"],
                               "stop_name": p["point"]["stop_name"], "insee": p["point"]["insee"],
                               "departures": p["point"]["departures"], "service_date": SERVICE_DATE.isoformat()}
                              for p in poles44]).set_index("pole_id")
    size_44 = write_json(FRONT_SKY44_DIR / "geo" / "poles.geojson", feature_collection(
        pole_features(poles44, anchors44, geoms),
        **{**meta, "anchor_source": "TRA01 - GTFS IDFM, point des astres de data/processed/poles_d030.json (03b)"}))

    big = int((err > 0.10).sum())
    print(f"geo/communes.geojson : {len(origins)} contours, {size_c / 1024:.1f} Ko "
          f"(objectif < {GEO_MAX_COMMUNES_KB} Ko) ; écart de surface médian {rendering['area_change_median_pct']} %, "
          f"max {rendering['area_change_max_pct']} % ({origins['insee'].iloc[int(err.argmax())]}), "
          f"{big} contours à plus de 10 %")
    print(f"{FRONT_SKY44_DIR.name}/geo/poles.geojson : {len(poles44)} astres + arrêts d'affichage, {size_44 / 1024:.1f} Ko")
    return 0 if size_c <= GEO_MAX_COMMUNES_KB * 1024 else 1


if __name__ == "__main__":
    raise SystemExit(main())
