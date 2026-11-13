"""04d - Mode Vélib' V1 (D-027) : marche -> station Vélib' -> vélo -> station Vélib' -> marche, aller et retour.

Méthode (docs/proposition-velib.md § 3, V1 ; docs/methodologie.md § 5 nonies) : trois familles de temps r5py
(marche, vélo, marche ; mêmes vitesses et même réseau que la matrice publiée, plafond MAX_TRIP_MIN par morceau),
puis combinaison EXACTE en Python du meilleur couple de stations (starway.velib.velib_times, S1 != S2), sans seuil,
sans distance maximale à la station, sans temps de prise ou de dépose (aucune source, D-011). Total > MAX_TRIP_MIN :
null + no_trip_within_120. Le vélo en libre-service n'a pas d'horaire dans les données : un calcul par sens (clé
`any`, comme `direct()` de 04). La DISPONIBILITÉ d'un vélo ou d'une place n'est pas connue (avertissement D-027).

Entrées : data/raw/VEL01/station_information.json (GBFS), data/processed/velib_coverage_2026.csv (origines avec au
moins une station dans la commune), communes_idf_2026.csv (points D-017), poles.json, réseau r5py en cache (le même
que la matrice publiée : marche et vélo seuls n'utilisent pas les tables de sortie des TC).
Sorties (dossiers SÉPARÉS) :
    data/interim/matrix_velib/velib_any.csv     from_id, to_id, out, dep, ret, reason, stations retenues (codes)
    data/interim/matrix_velib/legs.npz          les 6 matrices de morceaux (minutes, inf = pas de trajet)
    data/interim/matrix_velib/run_params.json   paramètres et empreintes (VEL01, GTFS, OSM, points D-017)
    data/interim/matrix_velib/run_log.jsonl     durée et mémoire par étape
    data/interim/access_velib/{insee}.json      mode `velib`, clé `any` (contrat proposé, non publié)
Usage (VM) :
    python scripts/04d_compute_velib.py --max-memory 16G
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import psutil

from starway import r5_transfers
from starway.config import (
    INTERIM_DIR,
    MAX_TRIP_MIN,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    RAW_DIR,
    SERVICE_DATE,
    SPEED_CYCLING_KMH,
    SPEED_WALKING_KMH,
)
from starway.export import build_access, write_json
from starway.origin_points import ORIGIN_LAT, ORIGIN_LON, origin_points_sha256
from starway.r5jar import check_not_inside, low_memory
from starway.routing import MODE_LEGS, REASON_NO_TRIP, REASON_NOT_SNAPPED, configure_java, day_bounds
from starway.sources import read_manifest
from starway.velib import (
    STATION_PREFIX,
    cap_minutes,
    check_disjoint_ids,
    read_stations,
    to_array,
    velib_times,
)

OSM = RAW_DIR / "CYC01" / "ile-de-france-latest.osm.pbf"
GTFS = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"
STATIONS = RAW_DIR / "VEL01" / "station_information.json"
COVERAGE = PROCESSED_DIR / "velib_coverage_2026.csv"
OUT_DIR = INTERIM_DIR / "matrix_velib"
ACCESS_DIR = INTERIM_DIR / "access_velib"
PROTECTED = [INTERIM_DIR / d for d in ("matrix", "access", "matrix_story", "access_story", "od")]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Watch:
    """Pic de mémoire du processus (JVM comprise) et mémoire libre minimale ; arrêt propre sous le seuil."""

    def __init__(self, min_free_gb: float, log: Path) -> None:
        self.peak_rss, self.min_available = 0, psutil.virtual_memory().available
        self.min_free_gb, self.log = min_free_gb, log
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        proc = psutil.Process()
        while True:
            self.peak_rss = max(self.peak_rss, proc.memory_info().rss)
            avail = psutil.virtual_memory().available
            self.min_available = min(self.min_available, avail)
            if low_memory(avail, self.min_free_gb):
                self.write({"event": "stopped_low_memory", "available_gb": round(avail / 1e9, 2)})
                os._exit(3)
            time.sleep(1)

    def snapshot(self) -> dict[str, float]:
        return {"peak_rss_gb": round(self.peak_rss / 1e9, 2), "min_available_gb": round(self.min_available / 1e9, 2)}

    def write(self, entry: dict) -> None:
        entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), **entry, **self.snapshot()}
        with self.log.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(entry, flush=True)


def gdf(ids: list[str], lon: list[float], lat: list[float]):
    import geopandas as gpd
    from shapely.geometry import Point

    return gpd.GeoDataFrame({"id": ids}, geometry=[Point(x, y) for x, y in zip(lon, lat, strict=True)], crs="EPSG:4326")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--max-memory", default="16G")
    p.add_argument("--min-free-gb", type=float, default=20.0, help="garde-fou d'exploitation (arrêt propre)")
    p.add_argument("--out-dir", type=Path, default=OUT_DIR)
    p.add_argument("--access-dir", type=Path, default=ACCESS_DIR)
    p.add_argument("--reuse-legs", nargs="*", default=[], choices=["walk_o_s", "walk_s_p", "walk_p_s", "walk_s_o", "bike_s_s"],
                   help="morceaux relus dans legs.npz d'un calcul précédent (mêmes stations, origines et pôles exigés)")
    p.add_argument("--reuse-from", type=Path, default=None,
                   help="legs.npz à relire (défaut : celui de --out-dir ; lu seulement, jamais réécrit)")
    r5_transfers.add_poles_cli(p)
    args = p.parse_args()
    published = {OUT_DIR.resolve(), ACCESS_DIR.resolve()}
    if r5_transfers.poles_params(args.poles) and {args.out_dir.resolve(), args.access_dir.resolve()} & published:
        raise SystemExit("--poles : donner --out-dir et --access-dir (dossiers neufs, jamais ceux des pôles publiés)")
    check_not_inside([args.out_dir, args.access_dir], PROTECTED)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    log = args.out_dir / "run_log.jsonl"

    stations = read_stations(STATIONS)
    cov = pd.read_csv(COVERAGE, dtype={"insee": str})
    origin_codes = sorted(cov.loc[cov["stations"] > 0, "insee"])
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    communes = communes[communes["is_origin"] & communes["insee"].isin(origin_codes)].sort_values("insee")
    if len(communes) != len(origin_codes):
        raise SystemExit("origines Vélib' absentes de communes_idf_2026.csv")
    poles_file = (args.poles or PROCESSED_DIR / "poles.json").expanduser().resolve()
    poles = json.loads(poles_file.read_text(encoding="utf-8"))
    pole_ids = [x["id"] for x in poles]
    man = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "CYC01", "VEL01")}
    vel_sha = sha256(STATIONS)
    if man.get("VEL01") and man["VEL01"] != vel_sha:
        raise SystemExit("station_information.json différent de la ligne VEL01 du manifeste")
    params = {
        "processing_version": PROCESSING_VERSION, "run": "04d_velib_v1", "service_date": SERVICE_DATE.isoformat(),
        "gtfs_sha256": man.get("TRA01"), "osm_sha256": man.get("CYC01"), "vel01_sha256": vel_sha,
        "max_trip_min": MAX_TRIP_MIN, "speed_walking_kmh": SPEED_WALKING_KMH, "speed_cycling_kmh": SPEED_CYCLING_KMH,
        "mode_legs": {"walk": MODE_LEGS["walk"]["out"], "bike": MODE_LEGS["bike"]["out"]},
        "r5py_defaults": {"max_bicycle_traffic_stress": 3},
        "origins": "communes avec au moins une station Vélib' (velib_coverage_2026.csv, colonne stations > 0)",
        "n_origins": len(origin_codes), "n_stations": len(stations),
        "origin_point_rule": "D-017 : origin_lon/origin_lat de communes_idf_2026.csv",
        "origin_points_sha256": origin_points_sha256(communes),
        **r5_transfers.poles_params(poles_file),
        "combination": "min sur S1 != S2 de marche(o,S1) + vélo(S1,S2) + marche(S2,p), minutes r5py entières ; "
                       "aucun seuil, aucune distance max à la station, aucun temps de prise ou de dépose",
        "cap": f"total > {MAX_TRIP_MIN} min -> null",
    }
    (args.out_dir / "run_params.json").write_text(json.dumps(params, indent=1, ensure_ascii=False), encoding="utf-8")
    avail = psutil.virtual_memory().available
    if avail < int(args.max_memory[:-1]) * (1 << 30) + args.min_free_gb * 1e9:
        raise SystemExit(f"{avail / 1e9:.1f} Go disponibles < heap {args.max_memory} + seuil {args.min_free_gb} Go")

    configure_java(max_memory=args.max_memory)
    from starway.routing import load_network, snap_points, travel_times

    watch = Watch(args.min_free_gb, log)
    t0 = time.time()
    network = load_network(OSM, GTFS)
    watch.write({"step": "network", "seconds": round(time.time() - t0, 1)})
    origins, o_uns, o_dist = snap_points(network, gdf(communes["insee"].tolist(), communes[ORIGIN_LON].tolist(),
                                                      communes[ORIGIN_LAT].tolist()))
    # identifiants de routage préfixés : r5py force à 0 tout couple dont from_id == to_id (travel_time_matrix.py),
    # or des stationCode Vélib' (ex. 92007) sont aussi des codes INSEE ; le préfixe rend les ensembles disjoints
    st, s_uns, _ = snap_points(network, gdf([STATION_PREFIX + c for c in stations["id"]], stations["lon"].tolist(),
                                            stations["lat"].tolist()))
    pl, p_uns, _ = snap_points(network, gdf(pole_ids, [x["point"]["lon"] for x in poles], [x["point"]["lat"] for x in poles]))
    if p_uns:
        raise SystemExit(f"pôles non accrochés : {p_uns}")
    watch.write({"step": "snap", "unsnapped_origins": o_uns, "unsnapped_stations": s_uns,
                 "snap_m_max_origins": round(max(o_dist.values())) if o_dist else None})
    o_ids, s_ids = origins["id"].tolist(), st["id"].tolist()
    check_disjoint_ids(o_ids, s_ids, pole_ids)
    s_codes = [x.removeprefix(STATION_PREFIX) for x in s_ids]
    start, _ = day_bounds(SERVICE_DATE, "d09")  # marche et vélo ne dépendent pas de l'heure (comme direct() de 04)

    legs: dict[str, np.ndarray] = {}
    if args.reuse_legs:
        old = np.load(args.reuse_from or args.out_dir / "legs.npz", allow_pickle=False)
        same = {"origins": list(old["origins"]) == o_ids, "stations": list(old["stations"]) == s_codes}
        # les tronçons station <-> pôle dépendent des pôles ; les autres non (D-030 : réemploi vers 44 astres)
        if {"walk_s_p", "walk_p_s"} & set(args.reuse_legs):
            same["poles"] = list(old["poles"]) == pole_ids
        if not all(same.values()):
            raise SystemExit(f"legs.npz incompatible : {same}")
        for name in args.reuse_legs:
            legs[name] = old[name]
        watch.write({"step": "reuse", "legs": args.reuse_legs})
    for name, a, b, mode, rows, cols in (
        ("walk_o_s", origins, st, "walk", o_ids, s_ids),
        ("walk_s_p", st, pl, "walk", s_ids, pole_ids),
        ("walk_p_s", pl, st, "walk", pole_ids, s_ids),
        ("walk_s_o", st, origins, "walk", s_ids, o_ids),
        ("bike_s_s", st, st, "bike", s_ids, s_ids),
    ):
        if name in legs:
            continue
        t1 = time.time()
        legs[name] = to_array(travel_times(network, a, b, start, mode, "out"), rows, cols)
        watch.write({"step": name, "seconds": round(time.time() - t1, 1), "shape": list(legs[name].shape),
                     "reached_share": round(float(np.isfinite(legs[name]).mean()), 4)})
    np.savez_compressed(args.out_dir / "legs.npz", origins=np.array(o_ids), stations=np.array(s_codes),
                        poles=np.array(pole_ids), **legs)

    t2 = time.time()
    out = velib_times(legs["walk_o_s"], legs["bike_s_s"], legs["walk_s_p"])  # O x P
    ret = velib_times(legs["walk_p_s"], legs["bike_s_s"], legs["walk_s_o"])  # P x O
    watch.write({"step": "combine", "seconds": round(time.time() - t2, 1)})
    out_t, ret_t = cap_minutes(out["time"], MAX_TRIP_MIN), cap_minutes(ret["time"], MAX_TRIP_MIN).T
    sid = np.array(s_codes + [None], dtype=object)  # index -1 -> None
    rows = []
    for i, o in enumerate(o_ids):
        for j, pid in enumerate(pole_ids):
            ok_o, ok_r = not np.isnan(out_t[i, j]), not np.isnan(ret_t[i, j])
            rows.append({"from_id": o, "to_id": pid, "out": int(out_t[i, j]) if ok_o else None, "dep": None,
                         "ret": int(ret_t[i, j]) if ok_r else None,
                         "reason": None if ok_o and ok_r else REASON_NO_TRIP,
                         "out_s1": sid[out["s1"][i, j]] if ok_o else None, "out_s2": sid[out["s2"][i, j]] if ok_o else None,
                         "ret_s1": sid[ret["s1"][j, i]] if ok_r else None, "ret_s2": sid[ret["s2"][j, i]] if ok_r else None})
    for o in o_uns:
        rows += [{"from_id": o, "to_id": pid, "out": None, "dep": None, "ret": None, "reason": REASON_NOT_SNAPPED}
                 for pid in pole_ids]
    m = pd.DataFrame(rows)
    m["out"], m["ret"] = m["out"].astype("Int64"), m["ret"].astype("Int64")
    m.sort_values(["from_id", "to_id"]).to_csv(args.out_dir / "velib_any.csv", index=False)
    mats = {("velib", "any"): m}
    for insee in origin_codes:
        write_json(args.access_dir / f"{insee}.json", build_access(insee, pole_ids, mats))
    watch.write({"step": "done", "seconds_total": round(time.time() - t0, 1), "pairs": len(m),
                 "pairs_both_legs": int((m["out"].notna() & m["ret"].notna()).sum())})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
