"""03b - D-030 : astres = bassins d'emploi France Travail 2026, Paris en 20 arrondissements (44 astres).

Choix de Nicolas du 04/11/2026 (docs/decisions.md, D-030) : Paris en 20 arrondissements, noms courts sur le ciel
(commune qui compte le plus de postes dans l'astre) et officiels dans le panneau, position au barycentre des postes.

Entrées (lecture seule) :
    data/raw/GEO04/Bassins_d_emploi_2026_lu_2026-11-03.xlsx    commune -> bassin d'emploi (France Travail, 17/04/2026)
    data/processed/communes_idf_2026.csv                        origines (1 285 : communes hors Paris + arrondissements)
    data/processed/jobs_by_commune_2023.csv                     postes Flores 2023 (EMP01), écrit par 03
    data/processed/pole_anchor_stops.csv                        arrêts des pôles actuels (contrôle de la règle)
    data/interim/gtfs_departures_20261117.csv                   départs par arrêt parent (cache de 03)
    data/interim/communes_idf_2026.gpkg                         contours GEO01 (arrondissements pour Paris)
Sorties :
    data/processed/sky_groups_v2_communes.csv   rattachement de chaque code du fichier GEO04 (origine, commune déléguée)
    data/processed/sky_groups_v2.csv            un astre par ligne, Paris en 3 pôles actuels (27 astres, comparaison)
    data/processed/sky_groups_v2_paris20.csv    même table, Paris en 20 arrondissements (44 astres, retenu)
    data/processed/poles_d030.json              poles.json des 44 astres (contrat « D-030 »)
    <FRONT_SKY44_DIR>/poles.json                avec --publish (alias --preview) seulement : ciel des 44 astres publié
                                                (preview-d030/ avant la bascule, racine de frontend/public/data/ après ;
                                                config.SKY_DEFAULT)

Règles :
    arrêt d'affichage = arrêt parent le plus desservi le 17/11/2026 situé dans les communes du groupe (règle de 03) ;
    ciel de poles_d030.json = sky_project(barycentre des postes Flores des communes du groupe, centres API Géo en
    Lambert-93), même projection que les pôles et les communes, SANS relaxation : l'écart minimal 0,07 des pôles
    actuels, fixé à la main, déplacerait 36 astres sur 44 jusqu'à 0,14 et inverserait des arrondissements (mesure
    affichée par le script) ; les chevauchements sont traités par le front (positions brutes, zoom automatique et
    dimensionnement dynamique de Maia : sky/layout.ts, methodologie.md § 3 bis).
    Les colonnes sky_x / sky_y des CSV gardent la règle actuelle (arrêt + relaxation 0,07) pour comparaison.

Usage : python scripts/03b_sky_groups.py [--publish | --preview]
"""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np
import pandas as pd

from starway import sky_groups as sg
from starway.config import FRONT_SKY44_DIR, JOBS_YEAR, PROCESSED_DIR, SERVICE_DATE
from starway.export import write_json
from starway.geo import (
    _TO_L93,
    SKY_CENTER_LONLAT,
    SKY_MIN_POLE_GAP,
    SKY_R0_KM,
    load_passage_table,
    relax_min_gap,
    round_sky,
    sky_project,
)

OUT_COMMUNES = PROCESSED_DIR / "sky_groups_v2_communes.csv"
OUT_GROUPS = {"poles3": PROCESSED_DIR / "sky_groups_v2.csv", "arrondissements": PROCESSED_DIR / "sky_groups_v2_paris20.csv"}
OUT_POLES = PROCESSED_DIR / "poles_d030.json"
PUBLISHED_POLES = FRONT_SKY44_DIR / "poles.json"  # ciel des 44 astres publié (preview-d030/ avant la bascule)
SCREENS = ((1280, 720), (1600, 900), (1920, 1080))  # écrans de référence des captures (motion-spec)


def distance_km(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    x, y = _TO_L93.transform(np.asarray(lon, float), np.asarray(lat, float))
    cx, cy = _TO_L93.transform(*SKY_CENTER_LONLAT)
    return np.hypot(np.asarray(x) - cx, np.asarray(y) - cy) / 1000.0


def build_table(groups: list[sg.Group], located: pd.DataFrame, total_idf: int, bary: np.ndarray) -> pd.DataFrame:
    anchors = pd.DataFrame(sg.anchor_rows(groups, located)).set_index("group_id")
    if anchors["stop_id"].isna().any():
        raise SystemExit(f"groupes sans arrêt desservi : {anchors[anchors['stop_id'].isna()].index.tolist()}")
    lon, lat = anchors["lon"].to_numpy(), anchors["lat"].to_numpy()
    raw = np.column_stack(sky_project(lon, lat))
    relaxed = relax_min_gap(raw)
    alt = np.column_stack(sky_project(bary[:, 0], bary[:, 1]))
    rows = []
    for i, g in enumerate(groups):
        a = anchors.loc[g.id]
        rows.append({
            "group_id": g.id, "name": g.name, "bassin_code": g.bassin_code, "bassin_name": g.bassin_name,
            "n_communes": len(g.communes), "communes": " ".join(g.communes), "jobs": g.jobs,
            "share_idf_pct": None if g.jobs is None else round(100 * g.jobs / total_idf, 2),
            "stop_id": a["stop_id"], "stop_name": a["stop_name"], "stop_insee": a["insee"],
            "stop_lon": round(float(a["lon"]), 5), "stop_lat": round(float(a["lat"]), 5),
            "departures": int(a["departures"]), "second_stop_id": a["second_stop_id"],
            "second_stop_name": a["second_stop_name"], "second_departures": a["second_departures"],
            "candidates": int(a["candidates"]),
            "sky_x": round_sky(relaxed[i, 0]), "sky_y": round_sky(relaxed[i, 1]),
            "sky_raw_x": round_sky(raw[i, 0]), "sky_raw_y": round_sky(raw[i, 1]),
            "sky_shift": round(float(np.hypot(*(relaxed[i] - raw[i]))), 4),
            "alt_bary_lon": round(float(bary[i, 0]), 5), "alt_bary_lat": round(float(bary[i, 1]), 5),
            "alt_sky_x": round_sky(alt[i, 0]), "alt_sky_y": round_sky(alt[i, 1]),
        })
    df = pd.DataFrame(rows)
    df["second_departures"] = df["second_departures"].astype("Int64")
    return df


def screen_report(poles: list[dict], communes: pd.DataFrame) -> None:
    """Chevauchements des disques à l'échelle actuelle du front (sans zoom) et zoom qui les sépare."""
    xy = np.array([[p["sky"]["x"], p["sky"]["y"]] for p in poles])
    jobs = [p["jobs"] for p in poles]
    bounds = np.vstack([communes[["sky_x", "sky_y"]].to_numpy(float), xy])
    names = [p["name_short"] for p in poles]
    for w, h in SCREENS:
        pxy, r = sg.screen_geometry(xy, jobs, bounds, w, h)
        disks = sg.overlapping_pairs(pxy, r)
        rings = sg.overlapping_pairs(pxy, r, extra=sg.FrontSky.ring_gap + sg.FrontSky.ring_width)
        print(f"  {w} x {h} : rayons {r.min():.1f} à {r.max():.1f} px ; disques qui se recouvrent : {len(disks)} "
              f"couples ; contours d'état qui se touchent : {len(rings)} couples ; zoom qui sépare les disques : "
              f"x {sg.zoom_to_separate(pxy, r, 'constant'):.2f} (rayons constants), "
              f"x {sg.zoom_to_separate(pxy, r, 'sqrt'):.2f} (rayons en racine du zoom)")
        print("    " + " ; ".join(f"{names[i]} / {names[j]} ({d:.0f} px pour {need:.0f})" for i, j, d, need in disks))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--publish", "--preview", dest="publish", action="store_true",
                    help="écrit aussi poles.json dans le dossier du ciel des 44 astres (config.FRONT_SKY44_DIR)")
    args = ap.parse_args()
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    origins = communes[communes["is_origin"]].sort_values("insee").reset_index(drop=True)
    jobs_df = pd.read_csv(PROCESSED_DIR / f"jobs_by_commune_{JOBS_YEAR}.csv", dtype={"insee": str})
    jobs = {r.insee: (None if pd.isna(r.jobs) else int(r.jobs)) for r in jobs_df.itertuples()}
    total_idf = int(jobs_df.loc[jobs_df["geo_object"] == "COM", "jobs"].sum())

    bassins = sg.read_bassins()
    att = sg.attach_origins(origins[["insee", "name"]], bassins, load_passage_table())
    rep = att.report
    att.report.to_csv(OUT_COMMUNES, index=False)
    print(f"GEO04 : {len(bassins)} codes IDF, {bassins['bassin_code'].nunique()} bassins ; "
          f"origines rattachées : {len(att.bassin_of)}/{len(origins)}")
    for st, n in rep["status"].value_counts().items():
        print(f"  {st} : {n}")
    deleg = rep[rep["status"] == "delegated_commune"]
    for r in deleg.itertuples():
        print(f"  commune déléguée {r.insee_geo04} {r.lib_commune_geo04} -> {r.insee_origin} {r.name_origin} "
              f"(même bassin que le chef-lieu : {r.same_bassin_as_chef_lieu})")
    if (~deleg["same_bassin_as_chef_lieu"].astype(bool)).any():
        raise SystemExit("commune déléguée dans un autre bassin que son chef-lieu : à trancher par un humain")
    print(f"  libellés de commune différents de l'API Géo après normalisation : {int(rep['name_differs'].fillna(False).sum())}")
    print(f"  libellés de bassin avec tiret U+2013/U+2014 remplacé : {int(bassins['name_dash_replaced'].sum())}")

    # échelle de compression dérivée des données (proposition, non appliquée) : distance au point zéro au-dessous
    # de laquelle se trouve la moitié des postes salariés d'IDF (centres API Géo des origines, poids Flores)
    d = distance_km(origins["lon"].to_numpy(), origins["lat"].to_numpy())
    w = origins["insee"].map(jobs).astype(float).to_numpy()
    r0_alt = round(sg.weighted_median(d, w), 1)
    print(f"ciel : échelle appliquée {SKY_R0_KM} km (choix d'origine) ; dérivée des postes (médiane pondérée) : {r0_alt} km")

    try:
        located = sg.located_departures()
    except FileNotFoundError as exc:
        raise SystemExit(f"{exc} absent : lancer d'abord scripts/03_build_jobs_poles.py") from exc
    current_anchors = pd.read_csv(PROCESSED_DIR / "pole_anchor_stops.csv", dtype={"stop_id": str}).set_index("pole_id")

    for split in sg.PARIS_SPLITS:
        groups = sg.build_groups(att, jobs, split)
        errs = sg.check_partition(groups, origins["insee"].tolist())
        if errs:
            raise SystemExit(f"{split} : partition fausse : {errs[:5]}")
        if any(g.jobs is None for g in groups):
            raise SystemExit(f"{split} : groupes sans postes Flores : {[g.id for g in groups if g.jobs is None]}")
        if sum(g.jobs for g in groups if g.jobs is not None) != total_idf:
            raise SystemExit(f"{split} : somme des postes des groupes != total Flores IDF {total_idf}")
        lonlat = {r.insee: (float(r.lon), float(r.lat)) for r in origins.itertuples()}
        df = build_table(groups, located, total_idf, sg.jobs_barycentre(groups, lonlat, jobs))
        # contrôle de la règle : les groupes identiques à un pôle actuel retrouvent son arrêt
        for r in df.itertuples():
            if r.group_id in current_anchors.index and current_anchors.at[r.group_id, "stop_id"] != r.stop_id:
                raise SystemExit(f"{r.group_id} : arrêt {r.stop_id} différent de pole_anchor_stops.csv")
        df.to_csv(OUT_GROUPS[split], index=False)
        xy = df[["sky_raw_x", "sky_raw_y"]].to_numpy()
        alt = df[["alt_sky_x", "alt_sky_y"]].to_numpy()
        print(f"\n[{split}] {len(df)} astres, {int(df['jobs'].sum()):,} postes (100 % de {total_idf:,}) ; "
              f"plus petit {int(df['jobs'].min()):,} ({df.loc[df['jobs'].idxmin(), 'name']}), "
              f"plus grand {int(df['jobs'].max()):,} ({df.loc[df['jobs'].idxmax(), 'name']}) ; "
              f"déplacement de relaxation max {df['sky_shift'].max():.4f} ({int((df['sky_shift'] > 0).sum())} astres) ; "
              f"écart minimal avant relaxation {sg.min_pair_distance(xy):.4f} (variante barycentre des postes : "
              f"{sg.min_pair_distance(alt):.4f}) ; écart minimal imposé {SKY_MIN_POLE_GAP}")
        print(df[["group_id", "name", "n_communes", "jobs", "share_idf_pct", "stop_name", "departures", "sky_x",
                  "sky_y", "sky_shift"]].to_string(index=False))

    # --- poles.json D-030 : 44 astres, barycentre des postes, sans relaxation
    poles = sg.build_sky_poles(att, origins, jobs, located, JOBS_YEAR, f"{SERVICE_DATE:%d/%m/%Y}", sg.D030_SPLIT)
    n_expected = sg.expected_group_count(att, sg.D030_SPLIT)
    if len(poles) != n_expected:
        raise SystemExit(f"{len(poles)} astres, {n_expected} attendus (bassins GEO04 - T1 Paris + 20 arrondissements)")
    if sum(p["jobs"] for p in poles) != total_idf:
        raise SystemExit("somme des postes des astres != total Flores IDF")
    xy = np.array([[p["sky"]["x"], p["sky"]["y"]] for p in poles])
    relaxed = relax_min_gap(xy, SKY_MIN_POLE_GAP)
    shift = np.hypot(*(relaxed - xy).T)
    print(f"\n[poles_d030.json] {len(poles)} astres (= {n_expected} : bassins GEO04 rattachés - T1 Paris + 20 "
          f"arrondissements), {sum(p['jobs'] for p in poles):,} postes (100 %) ; écart minimal entre astres "
          f"{sg.min_pair_distance(xy):.4f} ; si on appliquait l'écart minimal {SKY_MIN_POLE_GAP} des pôles actuels : "
          f"{int((shift > 1e-6).sum())} astres déplacés, jusqu'à {shift.max():.3f} (non appliqué)")
    screen_report(poles, communes[communes["is_origin"]])
    OUT_POLES.write_text(json.dumps(poles, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    written = [OUT_COMMUNES.name, OUT_GROUPS["poles3"].name, OUT_GROUPS["arrondissements"].name, OUT_POLES.name]
    if args.publish:
        size = write_json(PUBLISHED_POLES, poles)
        written.append(f"{FRONT_SKY44_DIR.name}/{PUBLISHED_POLES.name} ({size / 1024:.1f} Ko)")
    print(f"\nécrit : {', '.join(written)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
