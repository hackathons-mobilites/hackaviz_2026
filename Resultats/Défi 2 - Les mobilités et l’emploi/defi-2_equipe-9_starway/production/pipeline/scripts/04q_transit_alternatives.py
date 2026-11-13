"""04q - Trajets alternatifs TC + marche (D-055, phase F du plan) : A le plus rapide, B le moins cher, C le moins de montées.

Moteur et réglages du calcul publié (04h : R5 v7.5.1 recompilé, McRAPTOR, marche, règles de correspondance D-031), réseau de jour
(9h-17h, 14h-22h) ou de nuit (6h-14h) ; seule la largeur de recherche change (`alternatives.SUBOPTIMAL_MIN`, réglage de l'équipe).
Lit la file `priorite.csv` (palier, insee ; relue à chaque commune : on peut y remettre des communes en tête). Une commune à la fois,
réservée par un dossier (création exclusive, reprise si le processus est mort), écrite d'un bloc par renommage. Refuse de reconstruire
le réseau. S'arrête seul si la mémoire ou le disque passent sous leurs seuils : relancer la même commande reprend.

Usage (sur la VM, par tools/vm/f06/alternatifs_lance.sh, dans ~/b44/f06/alternatifs) :
    PYTHONPATH=repo/pipeline python repo/pipeline/scripts/04q_transit_alternatives.py --network jour --priority priorite.csv \\
        --out-dir sorties_f --cache-home cache --env01 env01.csv --max-memory 16G
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import psutil

from starway import alternatives as alt
from starway import fares_carbon as fc
from starway import itineraries as it
from starway import r5_transfers, routing
from starway.config import DAY_TYPES, MAX_TRIP_MIN, PIPELINE_DIR, PROCESSED_DIR, SERVICE_DATE, SPEED_WALKING_KMH

HOME = Path.home()
F = HOME / "b44/f06"
POLES = HOME / "b44/poles_d030.json"
JAR = HOME / "r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar"
SAME_STOP = HOME / "d031/navitia_same_stop_min.csv"
NETWORKS: dict[str, dict[str, Any]] = {
    "jour": {"days": ("d09", "d14"), "matrix": F / "interim/matrix_walk3000_d031_b44", "gtfs_prefix": "e990deba"},
    "nuit": {"days": ("d06",), "matrix": F / "interim/matrix_walk3000_d031_nuit_b44", "gtfs_prefix": "3e38b797"},
}


def load_04h() -> Any:
    import importlib.util

    spec = importlib.util.spec_from_file_location("transit_04h", PIPELINE_DIR / "scripts" / "04h_transit_itineraries.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def options_wide(planner: Any, o: tuple[float, float], d: tuple[float, float], dep: int, acc: Any, egr: Any, sub: int) -> list[dict]:
    """`Planner.transit_options` avec `suboptimalMinutes` choisi, le reste à l'identique."""
    import java.util  # type: ignore[import-not-found]

    r5 = planner.r5
    if not acc.times or not egr.times:
        return []
    req = planner._task()
    req.fromLat, req.fromLon = float(o[0]), float(o[1])
    req.toLat, req.toLon = float(d[0]), float(d[1])
    req.fromTime = int(dep)
    req.toTime = int(dep) + 2
    req.monteCarloDraws = 1
    req.suboptimalMinutes = int(sub)
    walk = r5.api.util.LegMode.WALK
    ja, je = java.util.HashMap(), java.util.HashMap()
    ja.put(walk, acc.jmap)
    je.put(walk, egr.jmap)

    def supplier(_d: Any) -> Any:
        return r5.profile.SuboptimalDominatingList(int(sub))

    router = r5.profile.McRaptorSuboptimalPathProfileRouter(planner.jnet, req, ja, je, supplier, None, True)
    out: list[dict] = []
    seen: set[tuple] = set()
    for final in router.route():
        legs = planner._legs_from_state(final, dep, acc, egr)
        key = tuple((g["kind"], g.get("trip"), g.get("from_stop"), g.get("to_stop"), g["dep_s"], g["arr_s"]) for g in legs)
        if key not in seen:
            seen.add(key)
            out.append({"dep_s": dep, "arr_s": int(final.time), "legs": legs})
    return out


class Rater:
    """Coût (D-028) et carbone (ENV01) d'une option, avec les fonctions de l'itinéraire publié."""

    def __init__(self, gtfs_zip: Path, env01: Path) -> None:
        with zipfile.ZipFile(gtfs_zip) as z:
            routes = pd.read_csv(z.open("routes.txt"), dtype=str)
            agency = pd.read_csv(z.open("agency.txt"), dtype=str)
            stops = pd.read_csv(z.open("stops.txt"), dtype=str, usecols=["stop_id", "stop_name", "parent_station", "wheelchair_boarding"])
            trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "wheelchair_accessible"])
            tr = pd.read_csv(z.open("transfers.txt"), dtype=str, usecols=["from_stop_id", "to_stop_id"])
        self.parents = {s: p for s, p in zip(stops["stop_id"], stops["parent_station"], strict=True) if isinstance(p, str) and p}
        self.transfers = frozenset(zip(tr["from_stop_id"], tr["to_stop_id"], strict=True))
        self.gtfs = it.GtfsLookup.from_frames(routes, agency, stops, trips)
        self.co2 = fc.co2_factors(pd.read_csv(env01, sep=";", encoding="utf-8-sig", dtype=str))

    def rate(self, opt: dict) -> dict[str, Any]:
        legs = [it.enrich_leg(g, self.gtfs) for g in opt["legs"]]
        k = fc.count_tickets(legs, self.parents, self.transfers)
        c = fc.trip_co2(legs, self.co2)
        transit = [e for e in legs if e.get("route_type") is not None]
        return {"min": alt.minutes(opt), "rides": len(transit), "lines": [e.get("line") for e in transit],
                "cost_eur": k.get("cost_eur"), "cost_status": k["status"], "co2_g": c["g"], "co2_status": c["status"],
                "walk_m": round(sum(e["dist_m"] or 0 for e in legs if e["kind"] == "walk"))}


def claim_path(root: Path, palier: int, insee: str) -> Path:
    return root / "claims" / f"p{palier}_{insee}"


def result_path(root: Path, palier: int, insee: str) -> Path:
    return root / f"p{palier}" / f"{insee}.jsonl.gz"


def take_claim(path: Path) -> bool:
    """Réservation exclusive d'une commune. Un dossier laissé par un processus mort est repris."""
    for _ in range(2):
        try:
            path.mkdir(parents=True, exist_ok=False)
            (path / "pid").write_text(str(os.getpid()), encoding="utf-8")
            return True
        except FileExistsError:
            pid_file = path / "pid"
            try:
                # un numéro de processus réutilisé par un autre programme ne bloque pas la commune
                if b"04q_transit" in Path(f"/proc/{int(pid_file.read_text(encoding='utf-8'))}/cmdline").read_bytes():
                    return False
                raise OSError
            except (OSError, ValueError):
                pid_file.unlink(missing_ok=True)
                try:
                    path.rmdir()
                except OSError:
                    return False
    return False


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def compute_task(task: it.Task, insee: str, palier: int, ctx: dict[str, Any]) -> dict[str, Any]:
    planner, searches, pts, rater = ctx["planner"], ctx["searches"], ctx["pts"], ctx["rater"]
    earlier = palier in alt.PALIERS_EARLIER
    base = {"insee": insee, "pole": task.pole, "day": task.day, "dir": task.direction, "palier": palier,
            "dep_s": task.departure_s if task.departure_s >= 0 else None, "target_min": task.target_min}
    if task.target_min is None:
        return {**base, "status": it.STATUS_NOT_IN_MATRIX, "A": None, "B": None, "C": None}
    if insee in ctx["unsnapped"]:
        return {**base, "status": it.STATUS_NOT_SNAPPED, "A": None, "B": None, "C": None}
    t0 = time.time()
    a_pt, b_pt = (insee, task.pole) if task.direction == "out" else (task.pole, insee)
    acc, egr = searches.get(a_pt, False), searches.get(b_pt, True)
    dep = task.departure_s
    start_s = ctx["start_s"][task.day]
    departures = [dep] + ([dep - alt.EARLIER_STEP_S * k for k in alt.EARLIER_DEPARTURE_STEPS] if earlier else [])
    options: list[dict] = []
    kept: list[dict] = []
    for t in departures:
        found = [] if acc is None or egr is None else [
            o for o in options_wide(planner, pts[a_pt], pts[b_pt], t, acc, egr, alt.SUBOPTIMAL_MIN) if not alt.is_degenerate(o)]
        if t == dep:
            options += found
            direct = planner.direct_walk(pts[a_pt], pts[b_pt])
            if direct is not None:
                walk_only = it.walk_only_option(t, *direct)
                options.append(walk_only)
                found = [*found, walk_only]
        kept += [o for o in found if alt.on_time(o, task.direction, start_s, dep) and alt.minutes(o) <= MAX_TRIP_MIN]
    res = alt.select_abc(options, kept, dep, task.target_min, rater.rate)
    status = it.STATUS_OK if res["A"] is not None else it.STATUS_NO_OPTION
    return {**base, "status": status, **res, "secs": round(time.time() - t0, 3)}


def compute_commune(insee: str, palier: int, ctx: dict[str, Any], threads: int) -> list[dict[str, Any]]:
    earlier = palier in alt.PALIERS_EARLIER
    tasks = [t for t in ctx["tasks"][insee] if not (earlier and t.direction != "out")]
    if threads <= 1:
        return [compute_task(t, insee, palier, ctx) for t in tasks]
    with ThreadPoolExecutor(max_workers=threads, thread_name_prefix="alt") as ex:
        return list(ex.map(lambda t: compute_task(t, insee, palier, ctx), tasks))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--network", choices=sorted(NETWORKS), required=True)
    p.add_argument("--priority", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--cache-home", type=Path, required=True)
    p.add_argument("--env01", type=Path, required=True)
    p.add_argument("--max-memory", default="16G")
    p.add_argument("--min-avail-gb", type=float, default=34.0, help="26 Go de garde de la file + 8 Go de marge")
    p.add_argument("--min-disk-gb", type=float, default=8.0)
    p.add_argument("--max-communes", type=int, default=None, help="essai court : s'arrête après N communes")
    p.add_argument("--max-palier", type=int, default=None, help="ne prend pas les paliers au-delà")
    p.add_argument("--threads", type=int, default=1, help="trajets calculés en même temps dans la JVM")
    args = p.parse_args()
    net = NETWORKS[args.network]
    root = args.out_dir.resolve() / args.network
    root.mkdir(parents=True, exist_ok=True)

    def guard() -> None:
        while True:
            if psutil.virtual_memory().available / 2**30 < args.min_avail_gb:
                print("ARRET : memoire disponible sous le seuil", flush=True)
                os._exit(3)
            if shutil.disk_usage(HOME).free / 2**30 < args.min_disk_gb:
                print("ARRET : disque libre sous le seuil", flush=True)
                os._exit(6)
            time.sleep(2)

    threading.Thread(target=guard, daemon=True).start()
    h = load_04h()
    h.POLES_FILE = POLES
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    communes = communes[communes["is_origin"]].sort_values("insee").reset_index(drop=True)
    poles_raw = json.loads(POLES.read_text(encoding="utf-8"))
    poles = pd.DataFrame([{"id": x["id"], "lon": x["point"]["lon"], "lat": x["point"]["lat"]} for x in poles_raw])
    days = {d.id: d for d in DAY_TYPES}
    mats = {d: pd.read_csv(net["matrix"] / f"transit_{d}.csv", dtype={"from_id": str, "to_id": str}) for d in net["days"]}
    mparams = json.loads((net["matrix"] / "run_params.json").read_text(encoding="utf-8"))
    ns = argparse.Namespace(walk_setting="normal", r5_jar=JAR, cache_home=args.cache_home.resolve(), transfer_rules="gtfs_navitia",
                            max_memory=args.max_memory)
    jar, walk_min, cache_home = h.setup_cache(ns)
    if mparams.get("r5_jar_sha256") != jar["r5_jar_sha256"]:
        raise SystemExit("le jar n'est pas celui de la matrice cible")
    m04 = h.load_script("compute_matrix_04", "04_compute_matrix.py")
    gtfs_sha = sha256_file(Path(m04.GTFS))
    if not gtfs_sha.startswith(net["gtfs_prefix"]):
        raise SystemExit(f"GTFS {gtfs_sha[:8]} : attendu {net['gtfs_prefix']} pour le réseau {args.network}")
    params = {"run": "04q_transit_alternatives", "network": args.network, "days": list(net["days"]), "service_date": SERVICE_DATE.isoformat(),
              "gtfs_sha256": gtfs_sha, "r5_jar_sha256": jar["r5_jar_sha256"], "walk_setting": "normal",
              "suboptimal_min": alt.SUBOPTIMAL_MIN, "max_trip_min": MAX_TRIP_MIN, "earlier_steps_min": [5 * k for k in alt.EARLIER_DEPARTURE_STEPS],
              "matrix": net["matrix"].name}
    pp = root / "run_params.json"
    if pp.exists() and json.loads(pp.read_text(encoding="utf-8")) != params:
        raise SystemExit("paramètres différents du calcul en cours : refus")
    write_atomic(pp, json.dumps(params, indent=1, ensure_ascii=False).encode("utf-8"))

    # r5py rattrape une lecture de cache ratée (KryoException, y compris pour manque de mémoire) et reconstruit tout : refusé ici.
    orig_load = routing.load_network

    def strict_load(osm: Path, gtfs: Path) -> Any:
        import r5py.r5.transport_network as tn

        orig_read = tn.TransportNetwork._load_pickled_transport_network

        def read(self: Any, path: Path) -> Any:
            try:
                return orig_read(self, path)
            except BaseException as e:  # noqa: BLE001
                print(f"ARRET : cache reseau illisible, reconstruction refusee : {e!r}"[:600], flush=True)
                os._exit(5)

        tn.TransportNetwork._load_pickled_transport_network = read
        return orig_load(osm, gtfs)

    routing.load_network = strict_load
    r5_transfers.configure("gtfs_navitia", m04.GTFS, SAME_STOP, root / "transfer_rules_log.jsonl")
    network, m04, load_s = h.start_network(ns, jar, cache_home, walk_min)
    print(f"reseau {args.network} charge en {load_s:.0f} s", flush=True)
    _, _, pts, unsnapped = h.snapped(network, m04, communes, poles)
    from starway.transit_planner import Planner

    planner = Planner(network, walk_limit_s=walk_min * 60, speed_walking_kmh=SPEED_WALKING_KMH, max_trip_min=MAX_TRIP_MIN,
                      max_rides=h.MAX_RIDES, service_date=SERVICE_DATE)
    by_insee: dict[str, list[it.Task]] = {}
    for day in net["days"]:
        end_s = days[day].end.hour * 3600 + days[day].end.minute * 60
        for t in it.tasks_from_matrix(day, mats[day], end_s, MAX_TRIP_MIN):
            by_insee.setdefault(t.insee, []).append(t)
    ctx = {"planner": planner, "searches": h.Searches(planner, pts), "pts": pts, "rater": Rater(Path(m04.GTFS), args.env01),
           "tasks": by_insee, "unsnapped": set(unsnapped),
           "start_s": {d: days[d].start.hour * 3600 + days[d].start.minute * 60 for d in net["days"]}}

    done = 0
    while True:
        rows = pd.read_csv(args.priority, dtype={"insee": str})
        next_row = None
        for r in rows.itertuples(index=False):
            palier, insee = int(r.palier), str(r.insee)
            if args.max_palier is not None and palier > args.max_palier:
                continue
            if result_path(root, palier, insee).exists():
                continue
            if take_claim(claim_path(root, palier, insee)):
                next_row = (palier, insee)
                break
        if next_row is None:
            print("FILE VIDE", flush=True)
            return 0
        palier, insee = next_row
        t0 = time.time()
        recs = compute_commune(insee, palier, ctx, args.threads)
        ctx["searches"].drop({insee})
        buf = "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in recs).encode("utf-8")
        write_atomic(result_path(root, palier, insee), gzip.compress(buf))
        entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "palier": palier, "insee": insee, "records": len(recs),
                 "with_trip": sum(1 for x in recs if x.get("A")), "seconds": round(time.time() - t0, 1), "pid": os.getpid(),
                 "bytes": len(buf)}
        with (root / "run_log.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(json.dumps(entry, ensure_ascii=False), flush=True)
        done += 1
        if args.max_communes is not None and done >= args.max_communes:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
