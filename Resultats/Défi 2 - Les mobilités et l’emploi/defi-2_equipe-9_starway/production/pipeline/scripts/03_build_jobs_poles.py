"""03 - Postes salariés par commune (Flores 2023) et pôles d'emploi disjoints (points + positions du ciel).

Entrées : data/raw/EMP01/DS_FLORES_2023_CSV_FR.zip, data/raw/TRA01/IDFM-gtfs.zip (stops, trips, calendar,
          stop_times), data/processed/communes_idf_2026.csv, data/interim/communes_idf_2026.gpkg
Sorties :
    data/processed/jobs_by_commune_2023.csv  (insee, name, dep, geo_object, jobs, pole_id)
    data/processed/poles.json                (pôles : communes, postes, point, ciel)
    data/processed/pole_anchor_stops.csv     (arrêt retenu, nombre de départs, deuxième arrêt)
    data/processed/flores_top_validation.csv (top 60 communes/arrondissements et pôle d'appartenance)
"""

from __future__ import annotations

import json

import geopandas as gpd
import numpy as np
import pandas as pd

from starway.config import INTERIM_DIR, JOBS_YEAR, PARIS_COMMUNE, PROCESSED_DIR, RAW_DIR, SERVICE_DATE
from starway.gtfs import departures_by_parent_stop, most_served_in
from starway.geo import harmonize, load_passage_table, relax_min_gap, round_sky, sky_project
from starway.poles import POLE_DEFS, aggregate_poles, check_disjoint, jobs_by_commune, read_flores_totals

GTFS_ZIP = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"


def load_departures():
    """Départs par arrêt parent à SERVICE_DATE (mis en cache : la lecture de stop_times.txt prend ~1 min)."""
    cache = INTERIM_DIR / f"gtfs_departures_{SERVICE_DATE:%Y%m%d}.csv"
    if cache.exists():
        return pd.read_csv(cache, dtype={"stop_id": str})
    deps = departures_by_parent_stop(GTFS_ZIP, SERVICE_DATE)
    deps.to_csv(cache, index=False)
    return deps


def main() -> int:
    dup = check_disjoint()
    if dup:
        raise SystemExit(f"Pôles non disjoints : {dup}")

    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str, "dep": str})
    totals = read_flores_totals()
    jobs = jobs_by_commune(totals)

    # Harmonisation géographique Flores -> 2026
    valid = set(communes["insee"])
    mapping, orphans = harmonize(jobs["insee"], load_passage_table(), valid)
    if orphans:
        raise SystemExit(f"Codes Flores sans correspondance 2026 : {orphans}")
    jobs["insee_2026"] = jobs["insee"].map(mapping)
    remapped = jobs[jobs["insee"] != jobs["insee_2026"]]
    if not remapped.empty:
        print(f"codes remappés : {remapped[['insee', 'insee_2026']].values.tolist()}")
    jobs = jobs.groupby(["insee_2026", "geo_object"], as_index=False)["jobs"].sum(min_count=1)
    jobs = jobs.rename(columns={"insee_2026": "insee"})

    # Contrôles de cohérence Flores
    reg = totals[(totals["GEO_OBJECT"] == "REG") & (totals["GEO"] == "11")]["jobs"].iloc[0]
    com_sum = jobs[jobs["geo_object"] == "COM"]["jobs"].sum()
    arm_sum = jobs[jobs["geo_object"] == "ARM"]["jobs"].sum()
    paris = jobs[(jobs["insee"] == PARIS_COMMUNE)]["jobs"].iloc[0]
    assert int(com_sum) == int(reg), (com_sum, reg)
    assert int(arm_sum) == int(paris), (arm_sum, paris)
    print(f"postes salariés IDF fin {JOBS_YEAR} (REG 11) : {int(reg):,} = somme communes ; Paris = somme arrondissements")

    pole_of = {c: p.id for p in POLE_DEFS for c in p.communes}
    jobs = jobs.merge(communes[["insee", "name", "dep", "lon", "lat"]], on="insee", how="left")
    jobs["pole_id"] = jobs["insee"].map(pole_of)
    jobs[["insee", "name", "dep", "geo_object", "jobs", "pole_id"]].to_csv(
        PROCESSED_DIR / f"jobs_by_commune_{JOBS_YEAR}.csv", index=False
    )

    # Pôles
    poles = aggregate_poles(jobs[jobs["insee"] != PARIS_COMMUNE])
    if poles["missing"].map(len).any():
        raise SystemExit(f"Communes de pôle sans postes Flores : {poles[poles['missing'].map(len) > 0]}")
    # Point représentatif : arrêt parent le plus desservi à SERVICE_DATE dans les communes du pôle (règle unique)
    deps = load_departures()
    contours = gpd.read_file(INTERIM_DIR / "communes_idf_2026.gpkg")[["insee", "geometry"]]
    contours = contours[contours["insee"] != PARIS_COMMUNE]  # Paris : contours des arrondissements
    pts = gpd.GeoDataFrame(deps, geometry=gpd.points_from_xy(deps["lon"], deps["lat"]), crs="EPSG:4326")
    located = gpd.sjoin(pts, contours.to_crs("EPSG:4326"), predicate="within", how="inner")
    points, anchors = [], []
    for p in POLE_DEFS:
        cand = located[located["insee"].isin(p.communes)]
        top = most_served_in(cand, 2)
        if top.empty:
            raise SystemExit(f"{p.id} : aucun arrêt desservi le {SERVICE_DATE} dans ses communes")
        a = top.iloc[0]
        b = top.iloc[1] if len(top) > 1 else None
        points.append({"lon": round(float(a["lon"]), 5), "lat": round(float(a["lat"]), 5),
                       "method": f"arrêt le plus desservi le {SERVICE_DATE:%d/%m/%Y} ({int(a['departures'])} départs) : "
                                 f"{a['stop_name']} ({a['stop_id']}, GTFS IDFM)"})
        anchors.append({"pole_id": p.id, "stop_id": a["stop_id"], "stop_name": a["stop_name"], "insee": a["insee"],
                        "lon": a["lon"], "lat": a["lat"], "departures": int(a["departures"]),
                        "second_stop_id": None if b is None else b["stop_id"],
                        "second_stop_name": None if b is None else b["stop_name"],
                        "second_departures": None if b is None else int(b["departures"]),
                        "candidates": len(cand), "service_date": SERVICE_DATE.isoformat()})
    pd.DataFrame(anchors).to_csv(PROCESSED_DIR / "pole_anchor_stops.csv", index=False)
    poles["point"] = points

    sx, sy = sky_project(np.array([pt["lon"] for pt in points]), np.array([pt["lat"] for pt in points]))
    raw_xy = np.column_stack([sx, sy])
    relaxed = relax_min_gap(raw_xy)
    shift = np.hypot(*(relaxed - raw_xy).T)
    poles["sky"] = [{"x": round_sky(x), "y": round_sky(y)} for x, y in relaxed]
    poles["sky_shift"] = shift.round(4)

    total_idf = int(reg)
    in_poles = int(poles["jobs"].sum())
    print(f"{len(poles)} pôles, {in_poles:,} postes ({in_poles / total_idf:.1%} des postes IDF)")
    print(poles[["id", "jobs", "sky", "sky_shift"]].to_string())

    out = poles.drop(columns=["missing"]).to_dict(orient="records")
    for r in out:
        r["jobs_year"] = JOBS_YEAR
        r["jobs_source"] = "EMP01"
    (PROCESSED_DIR / "poles.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    # Validation : top 60 (communes hors Paris + arrondissements)
    top = jobs[jobs["insee"] != PARIS_COMMUNE].sort_values("jobs", ascending=False).head(60)
    top = top.assign(rank=range(1, len(top) + 1))[["rank", "insee", "name", "jobs", "pole_id"]]
    top.to_csv(PROCESSED_DIR / "flores_top_validation.csv", index=False)
    print("top 30 hors pôle :", top[top["pole_id"].isna()].head(30)[["rank", "name", "jobs"]].values.tolist()[:12])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
