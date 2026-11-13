"""02 - Communes IDF en géographie 2026 (+ arrondissements de Paris), table de passage, positions du ciel.

Entrées : data/raw/GEO01/*.json, data/raw/GEO02/Filosofi2021_carreaux_200m_csv.zip
Sorties :
    data/processed/communes_idf_2026.csv   (insee, name, dep, kind, population, lon, lat, sky_x, sky_y, is_origin,
                                            origin_lon, origin_lat, origin_method)
    lon, lat = centre API Géo (sert au ciel, sky_x / sky_y, et aux libellés) ; origin_lon, origin_lat = point
    d'origine du routage (D-017) : centre de gravité de la population Filosofi 2021, ou carreau habité le plus
    proche si ce centre tombe dans un carreau vide. Vide pour 75056 (Paris n'est pas une origine).
    data/processed/passage_codes_2026.csv  (code_source, code_2026, motif)
    data/processed/adjacency_2026.csv      (insee_a, insee_b : origines dont les contours se touchent)
    data/interim/communes_idf_2026.gpkg    (avec contours, pour les étapes suivantes)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from starway.config import INTERIM_DIR, PARIS_COMMUNE, PROCESSED_DIR, RAW_DIR
from starway.geo import (
    _TO_L93,
    adjacency,
    SKY_CENTER_LONLAT,
    SKY_RMAX_KM,
    load_communes_2026,
    load_passage_table,
    round_sky,
    sky_project,
)
from starway.origin_points import assign_cells, origin_points_wgs84, read_idf_cells, residential_points


def main() -> int:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    INTERIM_DIR.mkdir(parents=True, exist_ok=True)

    communes = load_communes_2026()
    sx, sy = sky_project(communes["lon"].to_numpy(), communes["lat"].to_numpy())
    communes["sky_x"] = [round_sky(v) for v in sx]
    communes["sky_y"] = [round_sky(v) for v in sy]
    communes["is_origin"] = communes["insee"] != PARIS_COMMUNE

    # distance max au centre (contrôle de SKY_RMAX_KM)
    x, y = _TO_L93.transform(communes["lon"].to_numpy(), communes["lat"].to_numpy())
    cx, cy = _TO_L93.transform(*SKY_CENTER_LONLAT)
    rmax = float(np.max(np.hypot(np.asarray(x) - cx, np.asarray(y) - cy)) / 1000)
    if rmax > SKY_RMAX_KM:
        raise SystemExit(f"SKY_RMAX_KM={SKY_RMAX_KM} < distance max observée {rmax:.1f} km")

    # Point d'origine résidentiel (D-017) pour les 1 285 origines ; aucune origine sans point (sinon échec)
    origins = communes[communes["is_origin"]]
    cells = assign_cells(read_idf_cells(RAW_DIR / "GEO02" / "Filosofi2021_carreaux_200m_csv.zip"), origins)
    pts = origin_points_wgs84(residential_points(cells))
    missing = sorted(set(origins["insee"]) - set(pts.index))
    if missing:
        raise SystemExit(f"origines sans carreau habité (aucun point inventé) : {missing[:10]}")
    communes = communes.join(pts, on="insee")

    cols = ["insee", "name", "dep", "kind", "population", "surface_ha", "lon", "lat", "sky_x", "sky_y", "is_origin",
            "origin_lon", "origin_lat", "origin_method"]
    communes.sort_values("insee")[cols].to_csv(PROCESSED_DIR / "communes_idf_2026.csv", index=False)
    communes.to_file(INTERIM_DIR / "communes_idf_2026.gpkg", driver="GPKG")

    adj = adjacency(communes[communes["is_origin"]])
    adj.to_csv(PROCESSED_DIR / "adjacency_2026.csv", index=False)

    passage = load_passage_table()
    pd.DataFrame(
        [{"code_source": k, "code_2026": v, "motif": "commune associée/déléguée -> chef-lieu"} for k, v in sorted(passage.items())]
    ).to_csv(PROCESSED_DIR / "passage_codes_2026.csv", index=False)

    n_origins = int(communes["is_origin"].sum())
    print(f"communes IDF (dont 75056) : {int((communes['kind'] == 'commune').sum())}")
    print(f"arrondissements de Paris  : {int((communes['kind'] == 'arrondissement').sum())}")
    print(f"origines (étoiles-guides) : {n_origins}")
    print(f"codes de passage          : {len(passage)}")
    print(f"couples d'origines contiguës : {len(adj)}")
    print(f"distance max au centre    : {rmax:.1f} km (SKY_RMAX_KM={SKY_RMAX_KM})")
    print(f"points d'origine (D-017)  : {pts['origin_method'].value_counts().to_dict()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
