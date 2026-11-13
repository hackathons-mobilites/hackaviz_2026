"""04g - Distances routières voiture : chaque commune (point D-017) <-> chacun des 15 pôles (point d'ancrage), aller et
retour, avec r5py `DetailedItineraries` (mêmes réglages que la matrice voiture publiée : jar r5py d'origine, même OSM,
même GTFS, voiture R5 sans trafic, points accrochés comme 04).

Correctif du 03/11 (méthodologie § 5 decies) : r5py ne fixe pas `ProfileRequest.carSpeed` (défaut R5 2,22 m/s), qui
sert d'heuristique A* au routage point à point : les chemins trouvés n'étaient pas les plus rapides (durées 2,15 fois
la matrice). On fixe `carSpeed` à la vitesse voiture maximale des arêtes du réseau (heuristique minorante), comme
`starway.transit_planner.Planner.max_car_speed_mps`. Les sorties vont dans `car_dist_carspeed/` (l'ancien dossier
`car_dist/`, faux, n'est jamais relu par 06).
Correctif du 04/11 : le relevé des péages de `car_dist_carspeed/` comparait des coordonnées arrondies alors que R5
les tronque (28 nœuds de péage sur 152 jamais reconnus, dont Montesson) ; recalcul dans `car_dist_carspeed_v2/`
(mêmes chemins, mêmes distances : vérifié par 07 contre `car_dist_carspeed/`), seul dossier relu par 06.

Péages (demande de Nicolas du 03/11 au soir, aucun tarif) : si `data/processed/osm_toll_points.json` (04i) existe,
chaque chemin garde les identifiants OSM des nœuds de péage traversés et des chemins `toll=yes` empruntés
(`starway/tolls.py`, coordonnées exactes, sans seuil de distance).

But : ingrédient « distance » d'un coût carburant (distance x consommation SDES x prix du carburant, proposition du
03/11, docs/proposition-cout.md) ; rien n'est publié par ce script.

Usage :
    python scripts/04g_car_distances.py --dry-run
    python scripts/04g_car_distances.py --bench 100 --threads 8 --max-memory 16G      # banc d'essai, écrit bench.json
    python scripts/04g_car_distances.py --threads 4 --max-memory 16G --min-free-gb 15 # calcul complet, reprenable

Sorties (data/interim/car_dist_carspeed/, ignoré par git) :
    batches/batch_NNNN.csv  insee, pole_id, direction (out / ret), distance_m, duration_s, reason (null si trajet),
                            toll_checked, toll_nodes, toll_ways (identifiants OSM séparés par « ; », vide si aucun)
    run_params.json         empreintes (GTFS, OSM, jar, points), départ, lots ; une reprise différente est refusée
    run_log.jsonl           une ligne par lot ; bench.json : banc d'essai (débit, heure sans effet, écart à la matrice)
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import socket
import threading
import time
from datetime import UTC, datetime
from datetime import time as dtime
from pathlib import Path

import pandas as pd
import psutil

from starway import car_dist as cd
from starway import od_variant as ov
from starway import r5_transfers
from starway import tolls
from starway.config import (
    INTERIM_DIR,
    PIPELINE_DIR,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    SERVICE_DATE,
)
from starway.origin_points import ORIGIN_LAT, ORIGIN_LON, origin_points_sha256
from starway.r5jar import check_not_inside, low_memory
from starway.sources import read_manifest

OUT_DIR = INTERIM_DIR / cd.CORRECTED_DIR_NAME  # car_dist_carspeed_v2 : péages relevés avec la troncature de R5
TOLLS = PROCESSED_DIR / "osm_toll_points.json"  # 04i ; absent : péages non relevés (toll_checked = False)
MATRIX_CAR = INTERIM_DIR / "matrix" / "car_any.csv"  # matrice voiture publiée (lecture seule, recoupement)
DEPARTURE = "09:00"  # départ de référence des modes sans horaire de 04 (début de d09)
PROTECTED = [INTERIM_DIR / d for d in ("matrix", "access", "matrix_story", "access_story", "od", "od_walk1000",
                                       "od_walk3000", "matrix_walk1000", "matrix_walk3000", "matrix_velib",
                                       "car_dist", "car_dist_carspeed")]


def load_04():
    spec = importlib.util.spec_from_file_location("compute_matrix_04", PIPELINE_DIR / "scripts" / "04_compute_matrix.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def hhmm(text: str) -> dtime:
    h, m = text.split(":")
    return dtime(int(h), int(m))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.part")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def load_inputs(poles_file: Path | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    communes = communes[communes["is_origin"]].sort_values("insee").reset_index(drop=True)
    poles = json.loads((poles_file or r5_transfers.default_poles_file()).read_text(encoding="utf-8"))
    poles_df = pd.DataFrame([{"id": x["id"], "lon": x["point"]["lon"], "lat": x["point"]["lat"]} for x in poles])
    return communes, poles_df


def run_params(args: argparse.Namespace, communes: pd.DataFrame, poles: pd.DataFrame, jar: Path | None,
               car_speed_mps: float) -> dict:
    sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "CYC01")}
    import importlib.metadata

    return {"run": "04g_car_distances", "processing_version": PROCESSING_VERSION,
            "service_date": SERVICE_DATE.isoformat(), "departure": args.departure,
            "gtfs_sha256": sha.get("TRA01"), "osm_sha256": sha.get("CYC01"),
            "r5py_version": importlib.metadata.version("r5py"),
            "r5_jar": None if jar is None else jar.name, "r5_jar_sha256": None if jar is None else sha256_file(jar),
            "mode": "CAR (voiture R5, sans trafic)", "tool": "r5py.DetailedItineraries, routage un pour un",
            "batch_size": args.batch_size, "n_origins": len(communes), "n_poles": len(poles),
            "origin_point_rule": "D-017 : origin_lon/origin_lat de communes_idf_2026.csv",
            "origin_points_sha256": origin_points_sha256(communes),
            "pole_points_sha256": hashlib.sha256(json.dumps(poles.to_dict("records"), sort_keys=True).encode())
            .hexdigest(),
            "snap": "points accrochés une fois par routing.snap_points (rayon R5 par défaut), comme 04",
            "distance_rule": "StreetPath.getDistance() de R5 (mm, convertis en m par r5py), somme des segments de "
                             "l'option 0 ; durée = getDuration() (s)",
            "car_speed_mps": car_speed_mps,
            "car_speed_rule": "ProfileRequest.carSpeed = vitesse voiture maximale des arêtes du réseau "
                              "(EdgeStore.speeds, cm/s) : heuristique A* minorante (correctif du 03/11, § 5 decies)",
            "tolls_sha256": sha256_file(TOLLS) if TOLLS.exists() else None,
            "toll_rule": "nœuds barrier=toll_booth / highway=toll_gantry sommets du chemin, chemins toll=yes dont un "
                         "segment est un segment du chemin, coordonnées entières en 1e-7 degré avec la troncature de "
                         "R5 ((int)(d x 1e7), VertexStore.floatingDegreesToFixed) (starway/tolls.py)",
            "toll_key_rule": tolls.KEY_RULE}


def r5_jar_path() -> Path | None:
    from r5py.util.classpath import R5_CLASSPATH

    p = Path(R5_CLASSPATH)
    return p if p.is_file() else None


def max_car_speed_mps(network) -> float:
    """Vitesse voiture maximale des arêtes (m/s), lue dans le réseau R5 (même règle que transit_planner)."""
    import numpy as np

    speeds = np.asarray(network._transport_network.streetLayer.edgeStore.speeds.toArray(), dtype=np.int64)
    return float(speeds.max()) / 100.0  # EdgeStore : vitesses voiture en cm/s


def car_itineraries_class(car_speed_mps: float):
    """`DetailedItineraries` dont la requête fixe `carSpeed` avant le calcul (r5py copie la requête Java par
    `clone()` pour chaque couple : le réglage est donc repris par tous les couples)."""
    import r5py

    class CarItineraries(r5py.DetailedItineraries):
        def _compute(self):
            self.request._regional_task.carSpeed = float(car_speed_mps)
            return super()._compute()

    return CarItineraries


def toll_columns(res: pd.DataFrame, index: tolls.TollIndex | None) -> dict[str, tuple[list[int], list[int]]]:
    """Identifiant du couple -> (nœuds de péage, chemins toll=yes) du chemin de l'option 0."""
    if index is None or not len(res) or "geometry" not in res:
        return {}
    out: dict[str, tuple[list[int], list[int]]] = {}
    d = res[res["option"] == 0]
    for pid, grp in d.groupby("from_id"):
        lines = [c for g in grp["geometry"] for c in tolls.geometry_lines(g)]
        out[str(pid)] = index.match(lines)
    return out


def itineraries(network, o: pd.DataFrame, d: pd.DataFrame, when: datetime, threads: int,
                car_speed_mps: float) -> pd.DataFrame:
    import geopandas as gpd
    import r5py
    from shapely.geometry import Point

    def gdf(df: pd.DataFrame) -> gpd.GeoDataFrame:
        return gpd.GeoDataFrame({"id": df["id"].tolist()}, geometry=[Point(x, y) for x, y in zip(df["lon"], df["lat"],
                                                                                                strict=True)],
                                crs="EPSG:4326")
    cls = car_itineraries_class(car_speed_mps)
    cls.NUM_THREADS = max(1, threads)  # fils joblib de r5py (défaut : la moitié des cœurs)
    res = cls(network, origins=gdf(o), destinations=gdf(d), departure=when,
              transport_modes=[r5py.TransportMode.CAR], snap_to_network=False, force_all_to_all=False)
    return pd.DataFrame(res)


def snapped_frames(network, m04, communes: pd.DataFrame, poles: pd.DataFrame):
    from starway.routing import snap_points

    o_s, o_un, _ = snap_points(network, m04.points_gdf(communes, "insee", ORIGIN_LON, ORIGIN_LAT))
    p_s, p_un, _ = snap_points(network, m04.points_gdf(poles, "id"))
    if p_un:
        raise SystemExit(f"pôles non accrochés au réseau : {p_un}")
    c = pd.DataFrame({"insee": o_s["id"], "slon": o_s.geometry.x, "slat": o_s.geometry.y})
    p = pd.DataFrame({"id": p_s["id"], "lon": p_s.geometry.x, "lat": p_s.geometry.y})
    return c, p, o_un


def compute_pairs(network, c_s: pd.DataFrame, p_s: pd.DataFrame, lot: list[str], unsnapped: list[str],
                  when: datetime, threads: int, car_speed_mps: float, toll_index: tolls.TollIndex | None,
                  only: list[str] | None = None) -> tuple[pd.DataFrame, float, int]:
    """Un lot de communes ; `only` (banc d'essai) : seulement ces identifiants de couple."""
    ok = [x for x in lot if x not in unsnapped]
    o, d = cd.pair_frames(ok, c_s, p_s, "slon", "slat")
    if only is not None:
        keep = o["id"].isin(only)
        o, d = o[keep].reset_index(drop=True), d[keep].reset_index(drop=True)
    t0 = time.time()
    det = itineraries(network, o, d, when, threads, car_speed_mps) if len(o) else pd.DataFrame()
    secs = time.time() - t0
    ids = o["id"].tolist()
    if only is None:
        ids += [cd.pair_id(x, p, dr) for x in lot if x in unsnapped for p in p_s["id"] for dr in cd.DIRECTIONS]
    skip = [i for i in ids if cd.split_pair_id(i)[0] in unsnapped]
    return cd.summarize_itineraries(det.drop(columns="geometry", errors="ignore"), ids, skip,
                                    tolls_by_pair=toll_columns(det, toll_index),
                                    toll_checked=toll_index is not None), secs, len(o)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--departure", default=DEPARTURE, help="départ HH:MM (voiture sans trafic : sans effet, vérifié)")
    p.add_argument("--check-departure", default="03:00", help="second départ du banc d'essai (effet de l'heure)")
    p.add_argument("--batch-size", type=int, default=100)
    p.add_argument("--threads", type=int, default=8, help="fils joblib de DetailedItineraries")
    p.add_argument("--max-memory", default="16G")
    p.add_argument("--min-free-gb", type=float, default=15.0)
    p.add_argument("--out-dir", type=Path, default=OUT_DIR)
    p.add_argument("--matrix-csv", type=Path, default=MATRIX_CAR, help="matrice voiture publiée (recoupement)")
    p.add_argument("--bench", type=int, default=None,
                   help="banc d'essai : N couples tirés au hasard (graine fixe) + tous les couples de --bench-commune")
    p.add_argument("--bench-commune", default="78418", help="commune du banc dont tous les couples sont calculés "
                   "(Montesson : A14 à péage, pour éprouver le relevé des péages)")
    p.add_argument("--car-speed-mps", type=float, default=None,
                   help="forcer carSpeed (m/s) ; défaut : vitesse voiture maximale des arêtes du réseau")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--fresh", action="store_true")
    r5_transfers.add_poles_cli(p)
    args = p.parse_args()

    args.out_dir = args.out_dir.expanduser().resolve()
    if r5_transfers.poles_params(args.poles) and args.out_dir == OUT_DIR.resolve():
        raise SystemExit("--poles : donner --out-dir (dossier neuf, jamais celui des pôles publiés)")
    check_not_inside([args.out_dir], PROTECTED)
    communes, poles = load_inputs(args.poles.expanduser().resolve() if args.poles else None)
    lots = [communes["insee"].tolist()[i:i + args.batch_size] for i in range(0, len(communes), args.batch_size)]
    n_pairs = len(communes) * len(poles) * len(cd.DIRECTIONS)
    print(f"{len(communes)} communes x {len(poles)} pôles x 2 sens = {n_pairs} itinéraires ; {len(lots)} lots")
    done = [k for k in range(len(lots)) if (args.out_dir / "batches" / f"batch_{k:04d}.csv").exists()]
    print(f"lots déjà écrits : {len(done)}/{len(lots)}")
    if args.dry_run:
        return 0
    avail = psutil.virtual_memory().available
    heap = float(args.max_memory[:-1]) * (1 << 30) if args.max_memory[-1] in "Gg" else float(args.max_memory)
    if avail < heap + args.min_free_gb * 1e9:
        raise SystemExit(f"{avail / 1e9:.1f} Go disponibles < heap {args.max_memory} + {args.min_free_gb} Go")

    m04 = load_04()
    watch = m04.MemoryWatch()

    def guard() -> None:
        while True:
            if low_memory(psutil.virtual_memory().available, args.min_free_gb):
                print("ARRÊT : mémoire libre sous le seuil", flush=True)
                os._exit(3)
            time.sleep(2)
    threading.Thread(target=guard, daemon=True).start()

    from starway.routing import configure_java

    configure_java(max_memory=args.max_memory)  # jar r5py d'origine, cache r5py par défaut : comme la matrice publiée
    from starway.routing import load_network

    t0 = time.time()
    network = load_network(m04.OSM, m04.GTFS)
    jar = r5_jar_path()
    car_speed = args.car_speed_mps if args.car_speed_mps is not None else max_car_speed_mps(network)
    toll_index = None
    if TOLLS.exists():
        tj = json.loads(TOLLS.read_text(encoding="utf-8"))
        toll_index = tolls.TollIndex.build(tj["nodes"], tj["ways"])
        print(f"péages : {tj['n_nodes']} nœuds, {tj['n_ways']} chemins toll=yes ({TOLLS.name})", flush=True)
    params = run_params(args, communes, poles, jar, car_speed)
    print(f"réseau chargé en {time.time() - t0:.0f} s ; jar {params['r5_jar']} ({str(params['r5_jar_sha256'])[:12]}) ; "
          f"carSpeed {car_speed} m/s ; {watch.snapshot()}", flush=True)
    c_s, p_s, unsnapped = snapped_frames(network, m04, communes, poles)
    when = datetime.combine(SERVICE_DATE, hhmm(args.departure))

    if args.bench:
        ok = [x for x in communes["insee"] if x not in unsnapped]
        only = cd.bench_sample(ok, p_s["id"].tolist(), args.bench, args.bench_commune)
        lot = sorted({cd.split_pair_id(i)[0] for i in only})
        res, secs, n = compute_pairs(network, c_s, p_s, lot, unsnapped, when, args.threads, car_speed, toll_index,
                                     only)
        when2 = datetime.combine(SERVICE_DATE, hhmm(args.check_departure))
        sub = only[:20]  # effet de l'heure vérifié sur 20 couples (03/11 : aucun effet sur 100 couples)
        res2, secs2, _ = compute_pairs(network, c_s, p_s, sorted({cd.split_pair_id(i)[0] for i in sub}), unsnapped,
                                       when2, args.threads, car_speed, None, sub)
        k3 = ["insee", "pole_id", "direction"]
        b = res2.set_index(k3)
        a = res.set_index(k3).loc[b.index]
        same = a[["distance_m", "duration_s"]].fillna(-1).values == b[["distance_m", "duration_s"]].fillna(-1).values
        vs = (cd.compare_minutes(res, pd.read_csv(args.matrix_csv, dtype={"from_id": str}))
              if args.matrix_csv.exists() else {"status": f"{args.matrix_csv} absent"})
        bench = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "host": socket.gethostname(),
                 "pairs": n, "threads": args.threads, "seconds": round(secs, 1),
                 "seconds_per_pair": round(secs / n, 3), "pairs_per_hour": round(n / secs * 3600),
                 "estimate_hours_15_poles": round(cd.estimate_hours(secs, n, n_pairs), 2),
                 "estimate_hours_commune_x_commune": round(cd.estimate_hours(secs, n, len(communes) *
                                                                             (len(communes) - 1)), 1),
                 "estimate_rule": "débit mesuré ici (mêmes fils, même charge de la VM) x nombre d'itinéraires",
                 "second_departure": args.check_departure, "second_seconds": round(secs2, 1),
                 "identical_at_second_departure": bool(same.all()), "cells_compared": int(same.size),
                 "no_route": int(res["reason"].eq(cd.REASON_NO_ROUTE).sum()),
                 "distance_km_median": round(float(res["distance_m"].dropna().median()) / 1000, 1),
                 "car_speed_mps": car_speed, "bench_commune": args.bench_commune,
                 "pairs_with_toll_node": int(res["toll_nodes"].notna().sum()),
                 "pairs_with_toll_way": int(res["toll_ways"].notna().sum()),
                 "vs_published_car_matrix": vs, "load_avg_1min": round(os.getloadavg()[0], 2),
                 "params": params, **watch.snapshot()}
        write_atomic(args.out_dir / "bench.json", json.dumps(bench, indent=1, ensure_ascii=False))
        res.to_csv(args.out_dir / "bench_pairs.csv", index=False)
        print(json.dumps({k: v for k, v in bench.items() if k != "params"}, ensure_ascii=False), flush=True)
        return 0

    pp = args.out_dir / "run_params.json"
    if args.fresh:
        for f in (args.out_dir / "batches").glob("batch_*.csv"):
            f.unlink()
    elif pp.exists():
        old = json.loads(pp.read_text(encoding="utf-8"))
        diff = sorted(k for k in set(old) | set(params) if old.get(k) != params.get(k))
        if diff:
            raise SystemExit(f"paramètres différents du calcul en cours {diff} : relancer avec --fresh")
    write_atomic(pp, json.dumps(params, indent=1, ensure_ascii=False))
    for k, lot in enumerate(lots):
        dest = args.out_dir / "batches" / f"batch_{k:04d}.csv"
        if not ov.claim_lot(dest):
            continue
        try:
            res, secs, n = compute_pairs(network, c_s, p_s, lot, unsnapped, when, args.threads, car_speed,
                                         toll_index)
            write_atomic(dest, res.to_csv(index=False))
            entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "batch": k, "pairs": len(res),
                     "computed": n, "seconds": round(secs, 1), "threads": args.threads,
                     "no_route": int(res["reason"].eq(cd.REASON_NO_ROUTE).sum()),
                     "not_snapped": int(res["reason"].eq(cd.REASON_NOT_SNAPPED).sum()),
                     "with_toll_node": int(res["toll_nodes"].notna().sum()), **watch.snapshot(),
                     "load_avg_1min": round(os.getloadavg()[0], 2)}
            with (args.out_dir / "run_log.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
            print(f"lot {k + 1}/{len(lots)} : {n} itinéraires en {secs:.0f} s ; {watch.snapshot()}", flush=True)
        finally:
            ov.release_lot(dest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
