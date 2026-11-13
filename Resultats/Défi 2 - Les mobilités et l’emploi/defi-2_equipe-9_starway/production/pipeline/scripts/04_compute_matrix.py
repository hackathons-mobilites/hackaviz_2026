"""04 - Matrice aller / retour (r5py) : origines × pôles × journées-types × modes, par lots REPRENABLES.

Usage :
    python scripts/04_compute_matrix.py                              # POC : 3 communes, d09 + d06, TC
    python scripts/04_compute_matrix.py --origins all --days d06 d09 d14 \\
        --modes transit bike_transit walk bike car --batch-size 100 --max-memory 10G
    (relancer la même commande après une coupure : les lots déjà calculés sont sautés)

Entrées : data/raw/CYC01/*.osm.pbf, data/raw/TRA01/IDFM-gtfs.zip, data/processed/{communes_idf_2026.csv,poles.json}
Sorties (data/interim/matrix/) :
    batches/{mode}_{day}/batch_NNNN.csv   points de reprise (un fichier par lot d'origines, écrit atomiquement)
    {mode}_{day}.csv                      consolidation de tous les lots disponibles (lue par 06 et 07)
    run_params.json                       paramètres du calcul ; une reprise avec d'autres paramètres est refusée
    run_log.jsonl                         une ligne par lot (durée, mémoire)
data/interim/access/{insee}.json : écrit au fil de l'eau, dès qu'un lot a toutes ses combinaisons mode × journée
(copié vers frontend/public/data/access/ par 06 après les contrôles 07).
Le réseau r5py est mis en cache par r5py (%LOCALAPPDATA%/r5py) : seul le premier lancement le construit (~30 min).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import threading
import time
import warnings
import zipfile
from datetime import UTC, datetime

import geopandas as gpd
import pandas as pd
import psutil
from shapely.geometry import Point

from starway import r5_transfers
from starway.config import (
    DAY_TYPES_BY_ID,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    POC_COMMUNES,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    R5_MAX_MEMORY,
    RAW_DIR,
    SERVICE_DATE,
    SPEED_CYCLING_KMH,
    SPEED_WALKING_KMH,
)
from starway.export import build_access, write_json
from starway.origin_points import ORIGIN_LAT, ORIGIN_LON, origin_points_sha256
from starway.routing import MODE_LEGS, REASON_NO_TRIP, REASON_NOT_SNAPPED, configure_java, day_bounds
from starway.sources import read_manifest

OSM = RAW_DIR / "CYC01" / "ile-de-france-latest.osm.pbf"
GTFS = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"
OUT_DIR = INTERIM_DIR / "matrix"
BATCH_DIR = OUT_DIR / "batches"
ACCESS_DIR = INTERIM_DIR / "access"
# destinations : pôles publiés ; 04e et 04b le remplacent avec --poles (D-030 : poles_d030.json, 44 astres)
POLES_FILE = PROCESSED_DIR / "poles.json"
TIME_DEPENDENT = {"transit", "bike_transit"}
ALL_MODES = ["transit", "bike_transit", "walk", "bike", "car"]


class MemoryWatch:
    def __init__(self) -> None:
        self.peak_rss = 0
        self.min_available = psutil.virtual_memory().available
        self._stop = False
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        proc = psutil.Process()
        while not self._stop:
            self.peak_rss = max(self.peak_rss, proc.memory_info().rss)
            self.min_available = min(self.min_available, psutil.virtual_memory().available)
            time.sleep(1)

    def snapshot(self) -> dict[str, float]:
        return {"peak_rss_gb": round(self.peak_rss / 1e9, 2), "min_available_gb": round(self.min_available / 1e9, 2)}


def check_service_date() -> int:
    """Nombre de courses actives à SERVICE_DATE (doit être > 0)."""
    ds = SERVICE_DATE.strftime("%Y%m%d")
    wd = SERVICE_DATE.strftime("%A").lower()
    with zipfile.ZipFile(GTFS) as z:
        cal = pd.read_csv(z.open("calendar.txt"), dtype=str)
        cd = pd.read_csv(z.open("calendar_dates.txt"), dtype=str)
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["service_id"])
    active = set(cal[(cal.start_date <= ds) & (cal.end_date >= ds) & (cal[wd] == "1")].service_id)
    active |= set(cd[(cd.date == ds) & (cd.exception_type == "1")].service_id)
    active -= set(cd[(cd.date == ds) & (cd.exception_type == "2")].service_id)
    return int(trips.service_id.isin(active).sum())


def points_gdf(df: pd.DataFrame, id_col: str, lon: str = "lon", lat: str = "lat") -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {"id": df[id_col].astype(str).to_list()},
        geometry=[Point(x, y) for x, y in zip(df[lon], df[lat], strict=True)],
        crs="EPSG:4326",
    )




def scenarios(modes: list[str], days: list[str]) -> list[tuple[str, str]]:
    """(mode, journée) à calculer ; 'any' pour les modes sans horaire."""
    return [(m, d) for m in modes for d in (days if m in TIME_DEPENDENT else ["any"])]


def batches_of(origins: list[str], size: int) -> list[list[str]]:
    """Découpage déterministe (origines triées) : la reprise retrouve les mêmes lots."""
    o = sorted(origins)
    return [o[i:i + size] for i in range(0, len(o), size)]


def batch_path(mode: str, day: str, k: int):
    return BATCH_DIR / f"{mode}_{day}" / f"batch_{k:04d}.csv"


def run_params(args: argparse.Namespace, origins: list[str], points_sha: str | None = None) -> dict:
    sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "CYC01")}
    return {
        "processing_version": PROCESSING_VERSION, "service_date": SERVICE_DATE.isoformat(),
        "gtfs_sha256": sha.get("TRA01"), "osm_sha256": sha.get("CYC01"),
        "outbound_step_min": OUTBOUND_STEP_MIN, "outbound_lookback_min": OUTBOUND_LOOKBACK_MIN,
        "max_trip_min": MAX_TRIP_MIN, "speed_walking_kmh": SPEED_WALKING_KMH, "speed_cycling_kmh": SPEED_CYCLING_KMH,
        "batch_size": args.batch_size,
        # modes r5py par sens (transport / access / egress) : une reprise ne mélange jamais deux hypothèses
        "mode_legs": {m: MODE_LEGS[m] for m in args.modes},
        "r5py_defaults": {"max_public_transport_rides": 8, "max_bicycle_traffic_stress": 3},
        # les lots dépendent de l'ensemble des origines : un POC et un calcul complet ne se mélangent pas
        "origins_sha256": hashlib.sha256(",".join(sorted(origins)).encode()).hexdigest(),
        "n_origins": len(origins),
        # coordonnées des origines (D-017) : deux calculs avec des points différents ne se mélangent pas
        "origin_point_rule": "D-017 : origin_lon/origin_lat de communes_idf_2026.csv",
        "origin_points_sha256": points_sha,
        # autre fichier de pôles que poles.json : empreinte figée (aucune clé pour le défaut, reprises inchangées)
        **r5_transfers.poles_params(POLES_FILE),
    }


def check_resume(params: dict, fresh: bool) -> None:
    path = OUT_DIR / "run_params.json"
    if fresh and BATCH_DIR.exists():
        for f in BATCH_DIR.glob("*/*.csv"):
            f.unlink()
    if path.exists() and not fresh:
        old = r5_transfers.reconcile_poles_params(json.loads(path.read_text(encoding="utf-8")), params)
        if old != params:
            diff = {k: (old.get(k), v) for k, v in params.items() if old.get(k) != v}
            raise SystemExit(f"Paramètres différents du calcul en cours {diff} : relancer avec --fresh")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(params, indent=1), encoding="utf-8")


def consolidate(scen: list[tuple[str, str]]) -> dict[tuple[str, str], pd.DataFrame]:
    out = {}
    for mode, day in scen:
        files = sorted((BATCH_DIR / f"{mode}_{day}").glob("batch_*.csv"))
        if not files:
            continue
        m = pd.concat([pd.read_csv(f, dtype={"from_id": str, "to_id": str, "reason": str}) for f in files])
        m = m.sort_values(["from_id", "to_id"])
        m.to_csv(OUT_DIR / f"{mode}_{day}.csv", index=False)
        out[(mode, day)] = m
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--origins", nargs="*", default=list(POC_COMMUNES), help="codes INSEE ou 'all'")
    p.add_argument("--days", nargs="*", default=["d09", "d06"], choices=list(DAY_TYPES_BY_ID))
    p.add_argument("--modes", nargs="*", default=["transit"], choices=ALL_MODES)
    p.add_argument("--batch-size", type=int, default=100, help="origines par lot (point de reprise)")
    p.add_argument("--max-memory", default=R5_MAX_MEMORY, help="heap max de la JVM R5 (ex. 10G)")
    p.add_argument("--fresh", action="store_true", help="ignore et efface les lots existants")
    p.add_argument("--dry-run", action="store_true", help="affiche le plan (lots restants) sans lancer r5py")
    args = p.parse_args()

    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    communes = communes[communes["is_origin"]]
    if ORIGIN_LON not in communes or communes[[ORIGIN_LON, ORIGIN_LAT]].isna().any().any():
        raise SystemExit("points d'origine absents (origin_lon/origin_lat) : relancer 02_build_geo.py (D-017)")
    if args.origins != ["all"]:
        missing = set(args.origins) - set(communes["insee"])
        if missing:
            raise SystemExit(f"Origines inconnues : {missing}")
        communes = communes[communes["insee"].isin(args.origins)]
    poles = json.loads(POLES_FILE.read_text(encoding="utf-8"))
    poles_df = pd.DataFrame([{"id": x["id"], "lon": x["point"]["lon"], "lat": x["point"]["lat"]} for x in poles])
    pole_ids = poles_df["id"].tolist()

    scen = scenarios(args.modes, args.days)
    lots = batches_of(communes["insee"].tolist(), args.batch_size)
    todo = [(k, m, d) for k in range(len(lots)) for m, d in scen if not batch_path(m, d, k).exists()]
    print(f"{len(lots)} lots × {len(scen)} scénarios ; {len(todo)} (lot, scénario) restants")
    if args.dry_run:
        params = run_params(args, communes["insee"].tolist(), origin_points_sha256(communes))
        print(f"points d'origine : {ORIGIN_LON}/{ORIGIN_LAT} (D-017), empreinte {params['origin_points_sha256'][:12]}")
        old = OUT_DIR / "run_params.json"
        if old.exists():
            prev = r5_transfers.reconcile_poles_params(json.loads(old.read_text(encoding="utf-8")), params)
            diff = sorted(k for k in params if prev.get(k) != params[k])
            print("reprise possible sans --fresh" if not diff else f"--fresh nécessaire (paramètres différents : {diff})")
        return 0

    params = run_params(args, communes["insee"].tolist(), origin_points_sha256(communes))
    check_resume(params, args.fresh)
    n_trips = check_service_date()
    if n_trips == 0:
        raise SystemExit(f"Aucune course active le {SERVICE_DATE} dans le GTFS : changer SERVICE_DATE")
    print(f"date de service {SERVICE_DATE} ({SERVICE_DATE:%A}) : {n_trips} courses actives")

    configure_java(max_memory=args.max_memory)
    from starway.routing import direct, inbound, load_network, outbound, snap_points

    watch = MemoryWatch()
    t0 = time.time()
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        network = load_network(OSM, GTFS)
    print(f"réseau chargé en {time.time() - t0:.0f} s ({len(w)} avertissements R5) ; {watch.snapshot()}")

    dests_s, d_unsnapped, d_dist = snap_points(network, points_gdf(poles_df, "id"))
    if d_unsnapped:
        raise SystemExit(f"Pôles non accrochés au réseau : {d_unsnapped}")
    log_path = OUT_DIR / "run_log.jsonl"
    ACCESS_DIR.mkdir(parents=True, exist_ok=True)

    for k, lot in enumerate(lots):
        pending = [(m, d) for m, d in scen if not batch_path(m, d, k).exists()]
        if not pending:
            continue
        origins_s, o_unsnapped, o_dist = snap_points(
            network, points_gdf(communes[communes["insee"].isin(lot)], "insee", ORIGIN_LON, ORIGIN_LAT))
        for mode, day in pending:
            t1 = time.time()
            ref_day = day if day != "any" else "d09"
            start, end = day_bounds(SERVICE_DATE, ref_day)
            if origins_s.empty:
                res = pd.DataFrame(columns=["from_id", "to_id", "out", "dep", "ret"])
            elif mode in TIME_DEPENDENT:
                out_df = outbound(network, origins_s, dests_s, start, mode)
                in_df = inbound(network, dests_s, origins_s, end, mode).rename(
                    columns={"from_id": "to_id", "to_id": "from_id"})
                res = out_df.merge(in_df, how="outer", on=["from_id", "to_id"])
            else:
                res = direct(network, origins_s, dests_s, start, mode)
            full = pd.MultiIndex.from_product([lot, pole_ids], names=["from_id", "to_id"]).to_frame(index=False)
            m = full.merge(res, how="left", on=["from_id", "to_id"])
            m["out"] = m["out"].astype("Int64")
            m["ret"] = m["ret"].astype("Int64")
            m["reason"] = None
            m.loc[m["out"].isna() | m["ret"].isna(), "reason"] = REASON_NO_TRIP
            m.loc[m["from_id"].isin(o_unsnapped), ["out", "ret", "reason"]] = [pd.NA, pd.NA, REASON_NOT_SNAPPED]
            dest = batch_path(mode, day, k)
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(".part")
            m.to_csv(tmp, index=False)
            os.replace(tmp, dest)  # écriture atomique : un lot présent est un lot complet
            entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "batch": k, "origins": len(lot),
                     "mode": mode, "day": day, "seconds": round(time.time() - t1, 1),
                     "null_pairs": int(m["reason"].notna().sum()), "unsnapped": o_unsnapped,
                     "snap_m_max": round(max(o_dist.values())) if o_dist else None, **watch.snapshot()}
            with log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            print(f"lot {k + 1}/{len(lots)} {mode} {day} : {len(m)} couples en {entry['seconds']} s")

        # access/{insee}.json au fil de l'eau pour ce lot (toutes ses combinaisons sont calculées)
        mats = {(m_, d_): pd.read_csv(batch_path(m_, d_, k), dtype={"from_id": str, "to_id": str, "reason": str})
                for m_, d_ in scen}
        for insee in lot:
            write_json(ACCESS_DIR / f"{insee}.json", build_access(insee, pole_ids, mats))

    consolidate(scen)
    print(f"terminé en {time.time() - t0:.0f} s ; {watch.snapshot()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
