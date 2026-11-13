"""04h - Itinéraires TC détaillés (tronçons) des trajets de la matrice publiée, et temps TC en heure creuse.

Pour chaque commune (point D-017) et chacun des 15 pôles (point d'ancrage de `poles.json`), chaque journée-type :
- aller au départ publié `dep` de la matrice (réglage de marche D-024 « normal » par défaut) ;
- retour au départ de la fin du poste ;
on garde l'itinéraire dont la durée est celle de la matrice (sinon le plus proche, écart consigné). Les trajets sans
durée dans la matrice ne sont pas calculés (statut `no_trip_in_matrix`).

Pourquoi pas `r5py.DetailedItineraries` tel quel : ses réglages d'accès, de sortie et de fenêtre de départ ne sont pas
ceux de la matrice (voir `starway/transit_planner.py`) ; on reprend sa logique (McRAPTOR de R5) avec ceux de la matrice.

Heure creuse (`--offpeak 11:00`) : matrice TC (r5py `TravelTimeMatrix`, mêmes réglages que la matrice publiée, fenêtre
1 min) au départ de 11:00, commune -> pôle et pôle -> commune. 11:00 est un choix de l'équipe (demande de Nicolas du
03/11), pas une donnée.

Usage (VM, docs/deploiement-azure.md) :
    python scripts/04h_transit_itineraries.py --dry-run
    python scripts/04h_transit_itineraries.py --bench 200 --threads 4 --offpeak 11:00 --car-check 100 \\
        --r5-jar ~/r5build/r5-v7.5.1-r5py-walk3000-all.jar --max-memory 32G
    python scripts/04h_transit_itineraries.py --threads 4 --threads-file ~/starway-q/ctl/threads_itin \\
        --r5-jar ~/r5build/r5-v7.5.1-r5py-walk3000-all.jar --max-memory 32G --min-free-gb 15   # reprenable

Sorties (data/interim/itineraries_walk3000/, ignoré par git) :
    batches/batch_NNNN.jsonl.gz  une ligne JSON par trajet (starway.itineraries.record)
    run_params.json              empreintes (GTFS, OSM, jar, points, matrice cible) ; reprise différente refusée
    run_log.jsonl, bench.json    journal par lot ; banc d'essai (débit, mémoire, accord avec la matrice)
    offpeak_HHMM.csv             heure creuse : insee, pole, out, ret, reason
    car_check.json               recoupement de la cause de l'écart voiture (04g), si --car-check
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
import random
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from datetime import time as dtime
from pathlib import Path
from typing import Any

import pandas as pd
import psutil

from starway import itineraries as it
from starway import r5_transfers
from starway.config import (
    DAY_TYPES,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    PIPELINE_DIR,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    SERVICE_DATE,
    SPEED_WALKING_KMH,
    WALK_SETTINGS_M,
)
from starway.origin_points import ORIGIN_LAT, ORIGIN_LON, origin_points_sha256
from starway.r5jar import check_not_inside, jar_info, low_memory, walk_time_limit_min
from starway.sources import read_manifest

# destinations : pôles publiés, ou --poles (D-030 : poles_d030.json, 44 astres)
POLES_FILE = PROCESSED_DIR / "poles.json"
MAX_RIDES = 8  # défaut r5py max_public_transport_rides, comme la matrice (run_params.r5py_defaults)
BENCH_SEED = 20261117


def load_script(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, PIPELINE_DIR / "scripts" / filename)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def write_json(path: Path, obj: Any) -> None:
    write_atomic(path, json.dumps(obj, indent=1, ensure_ascii=False).encode("utf-8"))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def heap_bytes(spec: str) -> float:
    return float(spec[:-1]) * (1 << 30) if spec[-1] in "Gg" else float(spec)


def load_inputs(matrix_dir: Path, origins: list[str] | None = None
                ) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, pd.DataFrame], dict]:
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    communes = communes[communes["is_origin"]]
    if origins is not None:  # banc : sous-ensemble de communes, comme `04 --origins` (même empreinte des points)
        unknown = set(origins) - set(communes["insee"])
        if unknown:
            raise SystemExit(f"origines inconnues : {sorted(unknown)[:5]}")
        communes = communes[communes["insee"].isin(origins)]
    communes = communes.sort_values("insee").reset_index(drop=True)
    poles = json.loads(POLES_FILE.read_text(encoding="utf-8"))
    poles_df = pd.DataFrame([{"id": x["id"], "lon": x["point"]["lon"], "lat": x["point"]["lat"]} for x in poles])
    mats = {d.id: pd.read_csv(matrix_dir / f"transit_{d.id}.csv", dtype={"from_id": str, "to_id": str})
            for d in DAY_TYPES}
    params = json.loads((matrix_dir / "run_params.json").read_text(encoding="utf-8"))
    return communes, poles_df, mats, params


def all_tasks(mats: dict[str, pd.DataFrame]) -> list[it.Task]:
    tasks: list[it.Task] = []
    for d in DAY_TYPES:
        end_s = d.end.hour * 3600 + d.end.minute * 60
        tasks += it.tasks_from_matrix(d.id, mats[d.id], end_s, MAX_TRIP_MIN)
    return tasks


def run_params(args, communes, poles, matrix_params: dict, jar: dict, walk_min: int) -> dict:
    sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "CYC01")}
    import importlib.metadata

    targets = {d.id: sha256_file(args.matrix_dir / f"transit_{d.id}.csv") for d in DAY_TYPES}
    return {"run": "04h_transit_itineraries", "processing_version": PROCESSING_VERSION,
            "service_date": SERVICE_DATE.isoformat(), "gtfs_sha256": sha.get("TRA01"), "osm_sha256": sha.get("CYC01"),
            "r5py_version": importlib.metadata.version("r5py"), "r5_jar": jar["r5_jar"],
            "r5_jar_sha256": jar["r5_jar_sha256"], "walk_setting": args.walk_setting,
            "walk_leg_limit_m": WALK_SETTINGS_M[args.walk_setting], "max_time_walking_min": walk_min,
            "speed_walking_kmh": SPEED_WALKING_KMH, "max_trip_min": MAX_TRIP_MIN, "max_rides": MAX_RIDES,
            "suboptimal_minutes": "défaut R5 (ProfileRequest.suboptimalMinutes = 5)",
            "departure_rule": "fromTime = départ, toTime = départ + 2 s, monteCarloDraws = 1 (départ à t ou t + 1 s) ; "
                              "durée comptée depuis t",
            "target_matrix_dir": str(args.matrix_dir.name), "target_matrix_sha256": targets,
            "target_matrix_points_sha256": matrix_params.get("origin_points_sha256"),
            "target_matrix_jar_sha256": matrix_params.get("r5_jar_sha256"),
            "origin_points_sha256": origin_points_sha256(communes),
            "pole_points_sha256": hashlib.sha256(json.dumps(poles.to_dict("records"), sort_keys=True).encode())
            .hexdigest(), "batch_size": args.batch_size, "n_origins": len(communes), "n_poles": len(poles),
            # moteur d'origine : aucune clé de plus (une reprise d'un calcul 04h publié reste possible)
            **r5_transfers.poles_params(POLES_FILE),
            **({} if args.transfer_rules == "r5" else
               {"target_matrix_transfer_rules": matrix_params.get("transfer_rules", "r5")}),
            **r5_transfers.run_params(args.transfer_rules, jar.get("jar_path"), args.same_stop_csv)}


def setup_cache(args) -> tuple[dict, int, Path]:
    """Jar du réglage, cache r5py du réglage (celui de 04e/04c : réseau déjà construit), à fixer avant r5py."""
    m04e = load_script("walk_variant_04e", "04e_compute_walk_variant.py")
    limit_m = WALK_SETTINGS_M[args.walk_setting]
    jar_path = args.r5_jar.expanduser().resolve()
    info = jar_info(jar_path)
    if info["walk_distance_limit_meters"] != limit_m:
        raise SystemExit(f"{jar_path.name} : WALK_DISTANCE_LIMIT_METERS = {info['walk_distance_limit_meters']}, "
                         f"attendu {limit_m} (réglage {args.walk_setting})")
    if (info["transfer_distance_limit_meters"], info["parkride_distance_limit_meters"]) != (
            m04e.UPSTREAM_TRANSFER_M, m04e.UPSTREAM_PARKRIDE_M):
        raise SystemExit(f"{jar_path.name} : limites de correspondance ou de P+R modifiées, refus")
    cache_home = (args.cache_home or m04e.setting_dirs(limit_m, args.transfer_rules)[2]).expanduser().resolve()
    cache_home.mkdir(parents=True, exist_ok=True)
    os.environ["XDG_CACHE_HOME"] = str(cache_home)
    if "LOCALAPPDATA" in os.environ:
        os.environ["LOCALAPPDATA"] = str(cache_home)
    info["jar_path"] = jar_path
    return info, walk_time_limit_min(limit_m, SPEED_WALKING_KMH), cache_home


def start_network(args, jar: dict, cache_home: Path, walk_min: int):
    from starway import routing

    routing.configure_java(max_memory=args.max_memory, r5_classpath=jar["jar_path"])
    import r5py  # noqa: F401
    from r5py.util.classpath import R5_CLASSPATH
    from r5py.util.config import Config

    if Path(R5_CLASSPATH).resolve() != jar["jar_path"]:
        raise SystemExit(f"r5py utilise {R5_CLASSPATH} au lieu de {jar['jar_path']}")
    if Path(Config().CACHE_DIR).resolve() != (cache_home / "r5py").resolve():
        raise SystemExit(f"cache r5py {Config().CACHE_DIR} au lieu de {cache_home / 'r5py'}")
    from com.conveyal.r5.transit import TransitLayer  # type: ignore[import-not-found]

    if int(TransitLayer.WALK_DISTANCE_LIMIT_METERS) != WALK_SETTINGS_M[args.walk_setting]:
        raise SystemExit("constante WALK_DISTANCE_LIMIT_METERS de la JVM différente du réglage")
    routing.WALK_LEG_MAX_MIN = walk_min  # heure creuse : max_time_walking comme la matrice publiée
    m04 = load_script("compute_matrix_04", "04_compute_matrix.py")
    t0 = time.time()
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        network = routing.load_network(m04.OSM, m04.GTFS)
    return network, m04, time.time() - t0


def snapped(network, m04, communes: pd.DataFrame, poles: pd.DataFrame):
    from starway.routing import snap_points

    o_s, o_un, _ = snap_points(network, m04.points_gdf(communes, "insee", ORIGIN_LON, ORIGIN_LAT))
    p_s, p_un, _ = snap_points(network, m04.points_gdf(poles, "id"))
    if p_un:
        raise SystemExit(f"pôles non accrochés : {p_un}")
    pts = {r.id: (float(r.geometry.y), float(r.geometry.x)) for r in o_s.itertuples()}
    pts.update({r.id: (float(r.geometry.y), float(r.geometry.x)) for r in p_s.itertuples()})
    return o_s, p_s, pts, set(o_un)


class Searches:
    """Recherches à pied par point, calculées une fois (accès : depuis le point ; sortie : vers le point)."""

    def __init__(self, planner, pts: dict[str, tuple[float, float]]) -> None:
        self.planner, self.pts = planner, pts
        self.cache: dict[tuple[str, bool], Any] = {}
        self.secs: list[float] = []
        self._locks: dict[tuple[str, bool], threading.Lock] = {}
        self._g = threading.Lock()

    def get(self, pid: str, reverse: bool):
        key = (pid, reverse)
        if key in self.cache:
            return self.cache[key]
        with self._g:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            if key not in self.cache:
                t0 = time.time()
                lat, lon = self.pts[pid]
                self.cache[key] = self.planner.stop_search(lat, lon, reverse)
                self.secs.append(time.time() - t0)
        return self.cache[key]

    def drop(self, pids: set[str]) -> None:
        for k in [k for k in self.cache if k[0] in pids]:
            del self.cache[k]


def solve(task: it.Task, planner, searches: Searches, pts, unsnapped: set[str]) -> dict[str, Any]:
    if task.target_min is None:
        return it.record(task, it.STATUS_NOT_IN_MATRIX)
    if task.insee in unsnapped:
        return it.record(task, it.STATUS_NOT_SNAPPED)
    t0 = time.time()
    a, b = (task.insee, task.pole) if task.direction == "out" else (task.pole, task.insee)
    acc, egr = searches.get(a, False), searches.get(b, True)
    options = [] if acc is None or egr is None else planner.transit_options(pts[a], pts[b], task.departure_s, acc, egr)
    direct = planner.direct_walk(pts[a], pts[b])
    if direct is not None:
        options.append(it.walk_only_option(task.departure_s, *direct))
    opt, delta = it.select_option(options, task.departure_s, task.target_min)
    status = it.STATUS_OK if opt is not None else it.STATUS_NO_OPTION
    return it.record(task, status, opt, delta, len(options), time.time() - t0)


def take_lock(lock: Path) -> bool:
    """Verrou de lot (création exclusive) ; un verrou dont le processus est mort (arrêt de la VM) est repris."""
    for _ in range(2):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, json.dumps({"pid": os.getpid()}).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                os.kill(int(json.loads(lock.read_text())["pid"]), 0)
                return False
            except (OSError, ValueError, KeyError):
                lock.unlink(missing_ok=True)
    return False


def thread_count(args) -> int:
    if args.threads_file and args.threads_file.exists():
        try:
            return max(1, int(args.threads_file.read_text().strip()))
        except ValueError:
            pass
    return args.threads


def run_tasks(tasks: list[it.Task], planner, searches, pts, unsnapped, threads: int) -> list[dict[str, Any]]:
    if threads <= 1:
        return [solve(t, planner, searches, pts, unsnapped) for t in tasks]
    with ThreadPoolExecutor(max_workers=threads, thread_name_prefix="itin") as ex:
        return list(ex.map(lambda t: solve(t, planner, searches, pts, unsnapped), tasks))


def offpeak(args, network, o_s, p_s, communes, out_dir: Path) -> dict[str, Any]:
    import r5py

    from starway.routing import travel_times

    hh, mm = (int(x) for x in args.offpeak.split(":"))
    when = datetime.combine(SERVICE_DATE, dtime(hh, mm))
    dest = out_dir / f"offpeak_{hh:02d}{mm:02d}.csv"
    if dest.exists():
        return {"status": "déjà calculé", "file": dest.name}
    r5py.TravelTimeMatrix.NUM_THREADS = max(1, args.threads)
    t0 = time.time()
    o = travel_times(network, o_s, p_s, when, "transit", "out")
    t1 = time.time()
    r = travel_times(network, p_s, o_s, when, "transit", "ret")
    t2 = time.time()
    rows = []
    for insee in communes["insee"]:
        for pole in p_s["id"]:
            ov = o.get((insee, pole))
            rv = r.get((pole, insee))
            ov = None if ov is None or pd.isna(ov) or ov > MAX_TRIP_MIN else int(ov)
            rv = None if rv is None or pd.isna(rv) or rv > MAX_TRIP_MIN else int(rv)
            reason = None if ov is not None and rv is not None else (
                "origin_not_snapped" if insee not in set(o_s["id"]) else "no_trip_within_120")
            rows.append({"insee": insee, "pole": pole, "out": ov, "ret": rv, "reason": reason})
    df = pd.DataFrame(rows)
    write_atomic(dest, df.to_csv(index=False).encode("utf-8"))
    return {"status": "calculé", "file": dest.name, "departure": args.offpeak, "seconds_out": round(t1 - t0, 1),
            "seconds_ret": round(t2 - t1, 1), "rows": len(df), "out_null": int(df["out"].isna().sum()),
            "ret_null": int(df["ret"].isna().sum())}


def car_check(args, planner, pts, communes, poles, n: int) -> dict[str, Any]:
    """Recoupe la cause de l'écart voiture de 04g : chemin point à point avec carSpeed par défaut (r5py) et avec
    carSpeed = vitesse voiture maximale des arêtes (heuristique A* minorante), contre la matrice voiture publiée."""
    ref = pd.read_csv(args.car_matrix, dtype={"from_id": str})
    rng = random.Random(BENCH_SEED)
    pairs = [(c, p) for c in communes["insee"] for p in poles["id"] if c in pts]
    sample = rng.sample(pairs, min(n, len(pairs)))
    vmax = planner.max_car_speed_mps()
    ref = ref.set_index(["from_id", "to_id"])
    rows = []
    for c, p in sample:
        mm = ref.loc[(c, p), "out"] if (c, p) in ref.index else None
        t0 = time.time()
        a = planner.car_path(pts[c], pts[p], None)
        t1 = time.time()
        b = planner.car_path(pts[c], pts[p], vmax)
        t2 = time.time()
        rows.append({"insee": c, "pole": p, "matrix_min": None if mm is None or pd.isna(mm) else int(mm),
                     "default_min": None if a is None else a[0] // 60, "default_km": None if a is None else a[1] / 1000,
                     "vmax_min": None if b is None else b[0] // 60, "vmax_km": None if b is None else b[1] / 1000,
                     "default_s": round(t1 - t0, 3), "vmax_s": round(t2 - t1, 3)})
    df = pd.DataFrame(rows)
    ok = df.dropna(subset=["matrix_min", "vmax_min", "default_min"])
    dv = ok["vmax_min"] - ok["matrix_min"]
    dd = ok["default_min"] - ok["matrix_min"]
    df.to_csv(args.out_dir / "car_check_pairs.csv", index=False)
    return {"pairs": len(df), "compared": len(ok), "max_edge_car_speed_mps": vmax,
            "max_edge_car_speed_kmh": round(vmax * 3.6, 1),
            "default_carSpeed": {"exact": int((dd == 0).sum()), "within_1": int((dd.abs() <= 1).sum()),
                                 "median_ratio": round(float((ok["default_min"] / ok["matrix_min"]).median()), 3),
                                 "seconds_per_path": round(float(df["default_s"].mean()), 3)},
            "carSpeed_vmax": {"exact": int((dv == 0).sum()), "within_1": int((dv.abs() <= 1).sum()),
                              "delta_min": int(dv.min()) if len(dv) else None,
                              "delta_max": int(dv.max()) if len(dv) else None,
                              "median_ratio": round(float((ok["vmax_min"] / ok["matrix_min"]).median()), 3),
                              "seconds_per_path": round(float(df["vmax_s"].mean()), 3)}}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--walk-setting", default="normal", choices=sorted(WALK_SETTINGS_M))
    p.add_argument("--r5-jar", type=Path, default=Path("~/r5build/r5-v7.5.1-r5py-walk3000-all.jar"))
    p.add_argument("--matrix-dir", type=Path, default=None, help="matrice cible (défaut matrix_walk{L})")
    p.add_argument("--out-dir", type=Path, default=None, help="défaut data/interim/itineraries_walk{L}")
    p.add_argument("--batch-size", type=int, default=25, help="communes par lot")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--threads-file", type=Path, default=None, help="nombre de fils relu à chaque lot")
    p.add_argument("--max-memory", default="32G")
    p.add_argument("--min-free-gb", type=float, default=15.0)
    p.add_argument("--bench", type=int, default=None, help="banc d'essai : N trajets tirés au hasard (graine fixe)")
    p.add_argument("--offpeak", default=None, help="heure creuse HH:MM (matrice TC aller et retour)")
    p.add_argument("--offpeak-only", action="store_true")
    p.add_argument("--car-check", type=int, default=0, help="N couples voiture pour recouper la cause de 04g")
    p.add_argument("--car-matrix", type=Path, default=INTERIM_DIR / "matrix" / "car_any.csv")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--origins-file", type=Path, default=None,
                   help="banc : codes INSEE (séparés par des blancs) ; la matrice cible doit porter les mêmes")
    p.add_argument("--cache-home", type=Path, default=None,
                   help="XDG_CACHE_HOME du réseau (défaut : celui de 04e pour le réglage et les règles)")
    r5_transfers.add_cli(p)
    r5_transfers.add_poles_cli(p)
    args = p.parse_args()
    global POLES_FILE
    r5_transfers.require_explicit_dir(args.poles, args.out_dir, "--out-dir")
    r5_transfers.require_explicit_dir(args.poles, args.matrix_dir, "--matrix-dir (matrice calculée vers ces pôles)")
    POLES_FILE = (args.poles or POLES_FILE).expanduser().resolve()

    limit_m = WALK_SETTINGS_M[args.walk_setting]
    sfx = r5_transfers.DIR_SUFFIX[args.transfer_rules]
    args.matrix_dir = (args.matrix_dir or INTERIM_DIR / f"matrix_walk{limit_m}{sfx}").expanduser().resolve()
    args.out_dir = (args.out_dir or INTERIM_DIR / f"itineraries_walk{limit_m}{sfx}").expanduser().resolve()
    args.same_stop_csv = args.same_stop_csv.expanduser().resolve()
    protected = ["matrix", "access", "matrix_walk1000", "matrix_walk3000", "od", "od_walk1000", "od_walk3000",
                 "car_dist", "matrix_velib", "matrix_story"]
    if args.transfer_rules != "r5":  # les itinéraires publiés (moteur d'origine) ne sont jamais réécrits
        protected += ["itineraries_walk1000", "itineraries_walk3000"]
    check_not_inside([args.out_dir], [INTERIM_DIR / d for d in protected])
    origins = None if args.origins_file is None else args.origins_file.read_text(encoding="utf-8").split()
    communes, poles, mats, mparams = load_inputs(args.matrix_dir, origins)
    if mparams.get("transfer_rules", "r5") != args.transfer_rules:
        raise SystemExit(f"matrice cible calculée avec les règles {mparams.get('transfer_rules', 'r5')}, "
                         f"demandé {args.transfer_rules}")
    tasks = all_tasks(mats)
    todo = [t for t in tasks if t.target_min is not None]
    lots = [communes["insee"].tolist()[i:i + args.batch_size] for i in range(0, len(communes), args.batch_size)]
    done = [k for k in range(len(lots)) if (args.out_dir / "batches" / f"batch_{k:04d}.jsonl.gz").exists()]
    print(f"{len(communes)} communes x {len(poles)} pôles x {len(DAY_TYPES)} journées x 2 sens = {len(tasks)} trajets ; "
          f"{len(todo)} avec une durée dans la matrice ({args.matrix_dir.name}) ; {len(lots)} lots, {len(done)} faits",
          flush=True)
    if args.dry_run:
        return 0
    avail = psutil.virtual_memory().available
    if avail < heap_bytes(args.max_memory) + args.min_free_gb * 1e9:
        raise SystemExit(f"{avail / 1e9:.1f} Go disponibles < heap {args.max_memory} + {args.min_free_gb} Go")

    jar, walk_min, cache_home = setup_cache(args)
    if mparams.get("r5_jar_sha256") != jar["r5_jar_sha256"]:
        raise SystemExit("le jar n'est pas celui de la matrice cible (r5_jar_sha256)")
    # empreinte des points sur les origines de la matrice cible (toutes, ou celles d'un banc), puis inclusion
    m_origins = sorted(set().union(*(set(m["from_id"]) for m in mats.values())))
    if mparams.get("origin_points_sha256") != origin_points_sha256(load_inputs(args.matrix_dir, m_origins)[0]):
        raise SystemExit("points d'origine différents de ceux de la matrice cible")
    if not set(communes["insee"]) <= set(m_origins):
        raise SystemExit("origines absentes de la matrice cible")
    m04 = load_script("compute_matrix_04", "04_compute_matrix.py")
    r5_transfers.configure(args.transfer_rules, m04.GTFS, args.same_stop_csv, args.out_dir / "transfer_rules_log.jsonl")
    watch = m04.MemoryWatch()

    def guard() -> None:
        while True:
            if low_memory(psutil.virtual_memory().available, args.min_free_gb):
                print("ARRÊT : mémoire libre sous le seuil", flush=True)
                os._exit(3)
            time.sleep(2)
    threading.Thread(target=guard, daemon=True).start()

    network, m04, load_s = start_network(args, jar, cache_home, walk_min)
    print(f"réseau chargé en {load_s:.0f} s ; {watch.snapshot()}", flush=True)
    o_s, p_s, pts, unsnapped = snapped(network, m04, communes, poles)
    params = run_params(args, communes, poles, mparams, jar, walk_min)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    from starway.transit_planner import Planner

    planner = Planner(network, walk_limit_s=walk_min * 60, speed_walking_kmh=SPEED_WALKING_KMH,
                      max_trip_min=MAX_TRIP_MIN, max_rides=MAX_RIDES, service_date=SERVICE_DATE)
    searches = Searches(planner, pts)
    pole_ids = set(poles["id"])

    if args.offpeak:
        info = offpeak(args, network, o_s, p_s, communes, args.out_dir)
        print(f"heure creuse : {info}", flush=True)
        with (args.out_dir / "run_log.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": datetime.now(UTC).isoformat(timespec="seconds"), "offpeak": info}) + "\n")
        if args.offpeak_only:
            return 0

    if args.car_check:
        t0 = time.time()
        cc = car_check(args, planner, pts, communes, poles, args.car_check)
        cc["seconds"] = round(time.time() - t0, 1)
        write_json(args.out_dir / "car_check.json", cc)
        print(f"voiture : {json.dumps(cc, ensure_ascii=False)}", flush=True)

    if args.bench:
        rng = random.Random(BENCH_SEED)
        sample = rng.sample(todo, min(args.bench, len(todo)))
        n_th = thread_count(args)
        t0 = time.time()
        # recherches à pied d'abord (comme le calcul complet, où elles sont partagées par les 90 trajets d'une commune)
        keys = {((t.insee if t.direction == "out" else t.pole), False) for t in sample}
        keys |= {((t.pole if t.direction == "out" else t.insee), True) for t in sample}
        with ThreadPoolExecutor(max_workers=n_th) as ex:
            list(ex.map(lambda k: searches.get(*k), sorted(keys)))
        t1 = time.time()
        recs = run_tasks(sample, planner, searches, pts, unsnapped, n_th)
        t2 = time.time()
        per_trip = [r["secs"] for r in recs if r["secs"] is not None]
        n_comm_searches = sum(1 for k in keys if k[0] not in pole_ids)
        search_mean = sum(searches.secs) / max(1, len(searches.secs))
        trip_wall = (t2 - t1) / max(1, len(recs))
        search_wall = (t1 - t0) / max(1, len(keys))
        est_s = len(todo) * trip_wall + 2 * len(communes) * search_wall
        ag = it.agreement(recs)
        bench = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "host": socket.gethostname(),
                 "threads": n_th, "trips": len(recs), "walk_searches": len(keys),
                 "walk_searches_communes": n_comm_searches, "walk_search_seconds_mean": round(search_mean, 3),
                 "walk_search_wall_per_search": round(search_wall, 3), "trip_seconds_mean": round(
                     sum(per_trip) / max(1, len(per_trip)), 3), "trip_wall_per_trip": round(trip_wall, 3),
                 "trips_total_with_target": len(todo), "trips_total": len(tasks),
                 "estimate_hours": round(est_s / 3600, 2),
                 "estimate_rule": "trajets avec cible x (durée murale par trajet) + 2 x communes x (durée murale par "
                                  "recherche à pied), mêmes fils, même charge",
                 "agreement": ag, "load_avg_1min": round(os.getloadavg()[0], 2), "network_load_s": round(load_s),
                 "params": params, **watch.snapshot()}
        write_json(args.out_dir / "bench.json", bench)
        with gzip.open(args.out_dir / "bench_records.jsonl.gz", "wt", encoding="utf-8") as f:
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(json.dumps({k: v for k, v in bench.items() if k != "params"}, ensure_ascii=False), flush=True)
        return 0

    pp = args.out_dir / "run_params.json"
    if pp.exists():
        old = r5_transfers.reconcile_poles_params(json.loads(pp.read_text(encoding="utf-8")), params)
        diff = sorted(k for k in set(old) | set(params) if old.get(k) != params.get(k))
        if diff:
            raise SystemExit(f"paramètres différents du calcul en cours {diff} : vider {args.out_dir / 'batches'}")
    write_json(pp, params)
    (args.out_dir / "batches").mkdir(parents=True, exist_ok=True)
    by_insee: dict[str, list[it.Task]] = {}
    for t in tasks:
        by_insee.setdefault(t.insee, []).append(t)
    for k, lot in enumerate(lots):
        dest = args.out_dir / "batches" / f"batch_{k:04d}.jsonl.gz"
        if dest.exists():
            continue
        lock = dest.with_suffix(".lock")
        if not take_lock(lock):
            continue  # un autre processus vivant calcule ce lot
        n_th = thread_count(args)
        t0 = time.time()
        lot_tasks = [t for c in lot for t in by_insee.get(c, [])]
        recs = run_tasks(lot_tasks, planner, searches, pts, unsnapped, n_th)
        searches.drop(set(lot))  # les recherches des pôles restent en cache
        buf = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs).encode("utf-8")
        write_atomic(dest, gzip.compress(buf))
        lock.unlink(missing_ok=True)
        ag = it.agreement(recs)
        entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "batch": k, "communes": len(lot),
                 "trips": len(recs), "seconds": round(time.time() - t0, 1), "threads": n_th, "pid": os.getpid(),
                 "agreement": ag, "load_avg_1min": round(os.getloadavg()[0], 2), **watch.snapshot()}
        with (args.out_dir / "run_log.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(json.dumps(entry, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
