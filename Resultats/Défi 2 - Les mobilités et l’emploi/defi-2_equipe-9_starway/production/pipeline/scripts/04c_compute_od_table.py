"""04c - Table origine-destination de la proposition D-019 (PROPOSÉE, non adoptée) : communes -> communes.

Origines = destinations = les 1 285 communes et arrondissements (`is_origin`), points de `starway.od_table.
destination_points` (aujourd'hui le point D-017 ; point ouvert de D-019). TC : TT(x vers y, t) pour chaque départ t
d'une grille de OUTBOUND_STEP_MIN min sur une plage DONNÉE PAR L'UTILISATEUR (aucune plage par défaut). L'aller d'un
début de poste S et le retour d'une fin de poste E se lisent ensuite dans la même table (`od_table.outbound_at`,
`od_table.inbound_at`). Marche, vélo, voiture : un temps par couple orienté.

Usage :
    python scripts/04c_compute_od_table.py --first-departure 03:00 --last-departure 22:00 --dry-run
    python scripts/04c_compute_od_table.py --first-departure 03:00 --last-departure 22:00 --bench   # 1 lot, 3 départs
    python scripts/04c_compute_od_table.py --first-departure 03:00 --last-departure 22:00 --modes transit walk bike car
    python scripts/04c_compute_od_table.py --first-departure 03:00 --last-departure 22:00 --volume  # table complète
    (relancer la même commande après une coupure : les lots déjà écrits sont sautés)

--dry-run et --volume n'importent ni r5py ni Java. --bench et le calcul demandent environ 10 Go de mémoire libre
(heap JVM `--max-memory`) et refusent de démarrer si un autre calcul r5py (04, 04b, 04c) tourne.

Sorties (data/interim/od/, ignoré par git) :
    {mode}/batch_NNNN.npz   tt uint8 (origines du lot, destinations, départs), from_ids, to_ids, departures_min
    run_params.json         paramètres figés ; une reprise avec d'autres paramètres est refusée (--fresh)
    run_log.jsonl           une ligne par (lot, mode) : durée, durée par départ, mémoire, volume
    bench.json              mesures du banc d'essai (--bench) ; bench/ : tables du banc d'essai
    volume.json             volume mesuré du format d'export candidat (--volume)
Entrées lues seulement : data/processed/communes_idf_2026.csv, poles.json ; data/interim/matrix/run_log.jsonl et
run_params.json (estimation de durée) ; data/raw/CYC01, TRA01 (calcul).

Variante de marche D-024 (choix de l'équipe, pas une donnée) : --walk-setting normal|comfort --r5-jar JAR.
    TC seulement (marche, vélo, voiture ne dépendent pas du réglage : lus dans od/), sortie data/interim/od_walk{L}/,
    jar vérifié (constantes du .class puis dans la JVM), cache r5py séparé (celui de 04e), empreinte et réglage dans
    run_params.json ; même règle que 04e (accès : max_time_walking = L / 3,6 km/h ; sortie : constante du jar).
    python scripts/04c_compute_od_table.py --first-departure 03:00 --last-departure 22:00 --walk-setting normal         --r5-jar ~/r5build/r5-v7.5.1-r5py-walk3000-all.jar --max-memory 32G --threads 8 --allow-concurrent
Parallélisme et reprise (tools/vm/queue.sh) :
    --threads N        N départs calculés en même temps dans la même JVM (réseau partagé en mémoire) ;
    --threads-file F   relu avant chaque lot : monte ou baisse N sans recharger le réseau ;
    verrou par lot     {mode}/batch_NNNN.lock (création exclusive) : plusieurs processus se partagent les lots sans
                       recouvrement ; un verrou orphelin (processus disparu, VM arrêtée) est repris ;
    --min-free-gb G    arrêt propre (code 3) sous G Go de mémoire libre ; les lots écrits restent, la même commande
                       reprend au premier lot manquant.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from datetime import time as dtime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import psutil

from starway import od_table as od
from starway import od_variant as ov
from starway import r5_transfers
from starway.config import (
    DEPARTURE_WINDOW_MIN,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    PIPELINE_DIR,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    R5_MAX_MEMORY,
    RAW_DIR,
    SERVICE_DATE,
    SPEED_CYCLING_KMH,
    SPEED_WALKING_KMH,
    WALK_SETTINGS_M,
)
from starway.origin_points import ORIGIN_LAT, ORIGIN_LON, origin_points_sha256
from starway.r5jar import check_not_inside, jar_info, low_memory, walk_time_limit_min
from starway.routing import MODE_LEGS
from starway.runs import check_separate_dirs
from starway.sources import read_manifest

OSM = RAW_DIR / "CYC01" / "ile-de-france-latest.osm.pbf"
GTFS = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"
MATRIX_DIR = INTERIM_DIR / "matrix"  # lu seulement (estimation de durée)
OTHER_R5_SCRIPTS = ("04_compute_matrix.py", "04b_compute_story_matrix.py", "04c_compute_od_table.py")
# Modes acceptés par --bench seulement (mesure de coût) : allers et retours avec des modes r5py différents, donc deux
# tables par mode ; pas dans le format de la table D-019 (od.OD_MODES).
BENCH_ONLY_MODES = ("bike_transit",)
DIRECT_REF = "09:00"  # départ de référence des modes sans horaire : celui de 04 (début de d09), sans effet sur eux
PLAGE_MISSING = (
    "Plage de départs absente : --first-departure HH:MM et --last-departure HH:MM sont obligatoires pour les TC.\n"
    "Aucune plage par défaut n'est fixée : c'est un point ouvert de D-019 (débuts de poste 5h-14h ou 5h-22h).\n"
    f"Rappel : un début de poste S demande les départs S-{OUTBOUND_LOOKBACK_MIN} à S-{OUTBOUND_STEP_MIN} ; une fin "
    "de poste E demande le départ E. Exemple : --first-departure 03:00 --last-departure 22:00 couvre les débuts de "
    "poste de 05:00 à 22:05 et les fins de poste de 03:00 à 22:00.")


# --------------------------------------------------------------------------- utilitaires
def load_script(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, PIPELINE_DIR / "scripts" / filename)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_04():
    """Charge scripts/04_compute_matrix.py comme module (MemoryWatch, check_service_date, points_gdf), comme 04b."""
    return load_script("compute_matrix_04", "04_compute_matrix.py")


def other_r5_runs() -> list[tuple[int, str]]:
    found = []
    for p in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmd = " ".join(p.info["cmdline"] or [])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if p.info["pid"] != os.getpid() and any(s in cmd for s in OTHER_R5_SCRIPTS):
            found.append((p.info["pid"], next(s for s in OTHER_R5_SCRIPTS if s in cmd)))
    return found


def heap_bytes(spec: str) -> int:
    units = {"K": 1 << 10, "M": 1 << 20, "G": 1 << 30}
    return int(float(spec[:-1]) * units[spec[-1].upper()]) if spec[-1].upper() in units else int(spec)


def write_json_atomic(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.part")  # nom propre au processus : plusieurs 04c sur le même dossier
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def gb(n: float) -> str:
    return f"{n / 1e9:.2f} Go"


def hours(s: float) -> str:
    return f"{s / 3600:.1f} h" if s >= 3600 else f"{s / 60:.0f} min"


def num(n: float) -> str:
    """Entier avec espace comme séparateur de milliers (12 345 678)."""
    return f"{n:,.0f}".replace(",", " ")


def load_inputs() -> tuple[pd.DataFrame, pd.DataFrame]:
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    communes = communes[communes["is_origin"]].sort_values("insee").reset_index(drop=True)
    if ORIGIN_LON not in communes or communes[[ORIGIN_LON, ORIGIN_LAT]].isna().any().any():
        raise SystemExit("points d'origine absents (origin_lon/origin_lat) : relancer 02_build_geo.py (D-017)")
    return communes, od.destination_points(communes)


def build_grid(args: argparse.Namespace) -> np.ndarray | None:
    needs = any(m in od.TIME_DEPENDENT for m in args.modes)
    given = args.first_departure is not None and args.last_departure is not None
    if args.first_departure is None and args.last_departure is None and not needs:
        return None
    if not given:
        raise SystemExit(PLAGE_MISSING)
    try:
        return od.departure_grid(od.parse_hhmm(args.first_departure), od.parse_hhmm(args.last_departure))
    except ValueError as e:
        raise SystemExit(f"plage de départs invalide : {e}") from e


def mode_departures(mode: str, grid: np.ndarray | None) -> list[int]:
    if mode in od.TIME_DEPENDENT:
        assert grid is not None
        return [int(x) for x in grid]
    return [od.parse_hhmm(DIRECT_REF)]


def run_params(args: argparse.Namespace, communes: pd.DataFrame, dests: pd.DataFrame,
               grid: np.ndarray | None) -> dict[str, Any]:
    sha = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] in ("TRA01", "CYC01")}
    base = {
        "run": "04c_od_table (D-019 proposée)", "processing_version": PROCESSING_VERSION,
        "service_date": SERVICE_DATE.isoformat(), "gtfs_sha256": sha.get("TRA01"), "osm_sha256": sha.get("CYC01"),
        "departure_step_min": OUTBOUND_STEP_MIN, "outbound_lookback_min": OUTBOUND_LOOKBACK_MIN,
        "departure_window_min": DEPARTURE_WINDOW_MIN, "max_trip_min": MAX_TRIP_MIN,
        "speed_walking_kmh": SPEED_WALKING_KMH, "speed_cycling_kmh": SPEED_CYCLING_KMH,
        "batch_size": args.batch_size, "modes": sorted(args.modes),
        "mode_legs": {m: MODE_LEGS[m] for m in sorted(args.modes)},
        "r5py_defaults": {"max_public_transport_rides": 8, "max_bicycle_traffic_stress": 3},
        "departures": None if grid is None else {"first": od.format_hhmm(int(grid[0])),
                                                  "last": od.format_hhmm(int(grid[-1])), "count": len(grid)},
        "direct_reference_departure": DIRECT_REF,
        "origins_sha256": hashlib.sha256(",".join(sorted(communes["insee"])).encode()).hexdigest(),
        "n_origins": len(communes),
        "origin_point_rule": "D-017 : origin_lon/origin_lat de communes_idf_2026.csv",
        "origin_points_sha256": origin_points_sha256(communes),
        "dest_point_rule": od.DEST_POINT_RULE, "dest_points_sha256": od.points_sha256(dests),
        "n_destinations": len(dests),
        "storage": {"format": "npz (numpy savez_compressed)", "dtype": "uint8",
                    "no_trip": od.SENTINEL_NO_TRIP, "not_snapped": od.SENTINEL_NOT_SNAPPED,
                    "over_max_trip": "stocké tel quel, traité comme no_trip_within_120 à la lecture"},
    }
    if getattr(args, "variant", None) is None:
        return base  # table de base (réglage R5 d'origine) : clés inchangées, une reprise de od/ reste possible
    return {**ov.variant_params(base, args.variant["jar"], args.walk_setting, args.variant["walk_min"]),
            **args.variant["transfer_rules"]}


# --------------------------------------------------------------------------- variante de marche (D-024)
def setup_variant(args: argparse.Namespace) -> None:
    """Fixe args.variant (None pour la table de base), le dossier de sortie par défaut et, pour une variante, le cache
    r5py séparé (à fixer AVANT tout import de r5py). Refuse tout dossier d'un autre calcul."""
    args.variant = None
    variant_roots = [ov.variant_dir(lim) for lim in WALK_SETTINGS_M.values()]
    if (args.walk_setting is None) != (args.r5_jar is None):
        raise SystemExit("--walk-setting et --r5-jar vont ensemble (variante de marche D-024)")
    if args.walk_setting is None and args.transfer_rules != "r5":
        raise SystemExit("--transfer-rules (D-031) : seulement avec un réglage de marche (--walk-setting, --r5-jar)")
    if args.walk_setting is None:
        args.out_dir = args.out_dir or od.OD_DIR
        check_not_inside([args.out_dir], variant_roots)
        return
    limit_m = ov.setting_limit_m(args.walk_setting)
    m04e = load_script("walk_variant_04e", "04e_compute_walk_variant.py")
    jar = args.r5_jar.expanduser().resolve()
    info = jar_info(jar)
    if info["walk_distance_limit_meters"] != limit_m:
        raise SystemExit(f"{jar.name} : WALK_DISTANCE_LIMIT_METERS = {info['walk_distance_limit_meters']}, "
                         f"attendu {limit_m} (réglage {args.walk_setting}, D-024)")
    limits = (info["transfer_distance_limit_meters"], info["parkride_distance_limit_meters"])
    if limits != (m04e.UPSTREAM_TRANSFER_M, m04e.UPSTREAM_PARKRIDE_M):
        raise SystemExit(f"{jar.name} : limites de correspondance ou de P+R modifiées {limits}, refus")
    allowed = set(ov.VARIANT_MODES) | ((set(od.OD_MODES) | set(BENCH_ONLY_MODES)) if args.bench else set())
    extra = sorted(set(args.modes) - allowed)
    if extra:
        raise SystemExit(f"modes {extra} : ne dépendent pas du réglage de marche, lus dans od/ (seul --bench les "
                         "accepte, pour vérification)")
    walk_min = walk_time_limit_min(limit_m, SPEED_WALKING_KMH)
    rules = args.transfer_rules
    sfx = r5_transfers.DIR_SUFFIX[rules]
    tr_params = r5_transfers.run_params(rules, jar, args.same_stop_csv.expanduser().resolve())
    args.out_dir = (args.out_dir or Path(f"{ov.variant_dir(limit_m)}{sfx}")).expanduser().resolve()
    # dossiers des autres calculs (matrices, autres réglages, autres règles de correspondance) : jamais écrits ici
    others = [d for lim in WALK_SETTINGS_M.values() for r in r5_transfers.RULE_SETS
              for d in m04e.setting_dirs(lim, r)[:2]]
    others += [Path(f"{ov.variant_dir(lim)}{r5_transfers.DIR_SUFFIX[r]}") for lim in WALK_SETTINGS_M.values()
               for r in r5_transfers.RULE_SETS if (lim, r) != (limit_m, rules)]
    check_not_inside([args.out_dir], m04e.PROTECTED + others)
    cache_home = (args.cache_home or m04e.setting_dirs(limit_m, rules)[2]).expanduser().resolve()
    default_cache = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME")
                         or Path.home() / ".cache") / "r5py"
    check_not_inside([cache_home / "r5py"], [default_cache])
    cache_home.mkdir(parents=True, exist_ok=True)
    os.environ["XDG_CACHE_HOME"] = str(cache_home)
    if "LOCALAPPDATA" in os.environ:
        os.environ["LOCALAPPDATA"] = str(cache_home)
    args.variant = {"jar": info, "jar_path": jar, "walk_min": walk_min, "limit_m": limit_m, "cache_home": cache_home,
                    "transfer_rules": tr_params}
    r5_transfers.configure(rules, GTFS, args.same_stop_csv.expanduser().resolve(),
                           args.out_dir / "transfer_rules_log.jsonl")
    if rules != "r5":
        print(f"règles de correspondance D-031 : {rules} ; {tr_params}", flush=True)
    print(f"réglage {args.walk_setting} ({ov.WALK_SETTING_NATURE}) : {limit_m} m ; accès max {walk_min} min à "
          f"{SPEED_WALKING_KMH} km/h ; jar {info['r5_jar']} ({info['r5_version']}), sha256 "
          f"{info['r5_jar_sha256'][:12]} ; sortie {args.out_dir} ; cache r5py {cache_home / 'r5py'}", flush=True)


def jvm_heap() -> dict[str, float]:
    """Tas Java utilisé et réservé (Go), lu dans la JVM ; vide si la JVM n'est pas démarrée."""
    try:
        import jpype

        if not jpype.isJVMStarted():
            return {}
        rt = jpype.JClass("java.lang.Runtime").getRuntime()
        return {"jvm_heap_used_gb": round((rt.totalMemory() - rt.freeMemory()) / 1e9, 2),
                "jvm_heap_committed_gb": round(rt.totalMemory() / 1e9, 2)}
    except Exception:  # noqa: BLE001 (mesure d'exploitation, jamais bloquante)
        return {}


def start_memory_guard(args: argparse.Namespace, watch) -> None:
    """Arrêt propre (code 3) sous --min-free-gb de mémoire libre : les lots écrits sont complets (écriture atomique),
    les verrous orphelins sont repris à la relance."""
    if args.min_free_gb is None:
        return

    def guard() -> None:
        while True:
            avail = psutil.virtual_memory().available
            if low_memory(avail, args.min_free_gb):
                entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "event": "stopped_low_memory",
                         "pid": os.getpid(), "available_gb": round(avail / 1e9, 2), "min_free_gb": args.min_free_gb,
                         **watch.snapshot()}
                args.out_dir.mkdir(parents=True, exist_ok=True)
                with (args.out_dir / "run_log.jsonl").open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")
                print(f"ARRÊT : {entry}", flush=True)
                os._exit(3)
            time.sleep(2)
    threading.Thread(target=guard, daemon=True).start()


# --------------------------------------------------------------------------- dry-run
def matrix_rates(n_poles: int) -> tuple[dict[str, dict[int, float]], dict[str, Any] | None, int]:
    params_path = MATRIX_DIR / "run_params.json"
    mp = json.loads(params_path.read_text(encoding="utf-8")) if params_path.exists() else None
    n_out = (mp["outbound_lookback_min"] // mp["outbound_step_min"]) if mp else OUTBOUND_LOOKBACK_MIN // OUTBOUND_STEP_MIN
    entries = od.read_jsonl(MATRIX_DIR / "run_log.jsonl")
    return od.rates_from_04(entries, n_poles, n_out), mp, len(entries)


def bench_ratios(out_dir: Path, params: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any] | None, list[str]]:
    """Rapport (s/recherche mesurées par le banc d'essai vers 1 285 communes) / (s/recherche de 04 vers 15 pôles),
    même lot, par mode. Vide si bench.json est absent ou calculé avec d'autres entrées."""
    path = out_dir / "bench.json"
    if not path.exists():
        return {}, None, []
    b = json.loads(path.read_text(encoding="utf-8"))
    keys = ("gtfs_sha256", "osm_sha256", "origin_points_sha256", "dest_points_sha256", "service_date")
    diff = [k for k in keys if b.get("params", {}).get(k) != params.get(k)]
    if diff:
        return {}, b, diff
    return {m: r["ratio_vs_04_same_lot"] for m, r in b["modes"].items() if r.get("ratio_vs_04_same_lot")}, b, []


def dry_run(args: argparse.Namespace, communes: pd.DataFrame, dests: pd.DataFrame, grid: np.ndarray | None) -> None:
    params = run_params(args, communes, dests, grid)
    lots = od.batches_of(communes["insee"].tolist(), args.batch_size)
    sizes = [len(x) for x in lots]
    n_o, n_d = len(communes), len(dests)
    print(f"origines : {n_o} ; destinations : {n_d} ({od.DEST_POINT_RULE})")
    print(f"empreintes des points : origines {params['origin_points_sha256'][:12]}, "
          f"destinations {params['dest_points_sha256'][:12]}")
    print(f"lots : {len(lots)} de {args.batch_size} origines au plus (dernier : {sizes[-1]})")

    starts: list[int] = []
    ends: list[int] = []
    if grid is not None:
        starts, ends = od.servable_starts(grid), od.servable_ends(grid)
        print(f"départs TC : {od.format_hhmm(int(grid[0]))} à {od.format_hhmm(int(grid[-1]))}, "
              f"pas de {OUTBOUND_STEP_MIN} min : {len(grid)} départs")
        print("  débuts de poste S calculables : "
              + (f"{od.format_hhmm(starts[0])} à {od.format_hhmm(starts[-1])} ({len(starts)})" if starts
                 else "aucun (plage plus courte que la fenêtre aller)"))
        print(f"  fins de poste E calculables : {od.format_hhmm(ends[0])} à {od.format_hhmm(ends[-1])} ({len(ends)})")
    for m in args.modes:
        if not od.symmetric_legs(m):
            raise SystemExit(f"mode {m} : modes r5py différents à l'aller et au retour, une seule table ne suffit pas")
    print("une seule table par mode couvre l'aller et le retour (MODE_LEGS identiques dans les deux sens) : "
          + ", ".join(args.modes))

    # plan des requêtes
    print("\nplan r5py (TravelTimeMatrix, une recherche par origine et par appel) :")
    total_calls = 0
    todo_by_mode: dict[str, list[int]] = {}
    for m in args.modes:
        deps = mode_departures(m, grid)
        todo = [k for k in range(len(lots)) if not od.lot_path(args.out_dir, m, k).exists()]
        todo_by_mode[m] = todo
        calls = len(todo) * len(deps)
        total_calls += calls
        cells = sum(sizes[k] for k in todo) * n_d * len(deps)
        print(f"  {m:8s} : {len(todo)}/{len(lots)} lots restants x {len(deps)} départ(s) = {num(calls)} appels, "
              f"{num(sum(sizes[k] for k in todo) * len(deps))} recherches, {num(cells)} couples x départ")
    print(f"  total : {num(total_calls)} appels r5py")

    # estimation de durée
    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    rates, mp, n_entries = matrix_rates(len(poles))
    same_lots = bool(mp and mp.get("batch_size") == args.batch_size
                     and mp.get("origins_sha256") == params["origins_sha256"])
    ratios, bench, bench_diff = bench_ratios(args.out_dir, params)
    print(f"\nestimation de durée, tirée de {MATRIX_DIR / 'run_log.jsonl'} ({n_entries} lignes, dernière ligne par "
          f"(lot, mode, journée) retenue ; {len(poles)} pôles ; découpage identique à 04 : "
          f"{'oui' if same_lots else 'non'}) :")
    grand = 0.0
    grand_b = 0.0
    for m in args.modes:
        if m not in rates:
            print(f"  {m:8s} : aucune mesure dans run_log de 04, pas d'estimation")
            continue
        deps = mode_departures(m, grid)
        todo = todo_by_mode[m]
        est = od.estimate_mode(m, sizes, len(deps), rates[m], same_lots)
        remaining = sum(est.seconds_per_departure_by_lot[k] for k in todo) * len(deps)
        grand += remaining
        pdep = est.seconds_per_departure_by_lot
        line = (f"  {m:8s} : {hours(remaining)} pour les lots restants ; un appel (un départ) = "
                f"{statistics.median(pdep):.0f} s par lot en médiane, de {min(pdep):.0f} à {max(pdep):.0f} s "
                f"({est.method})")
        if m in ratios:
            grand_b += remaining * ratios[m]
            line += f" ; corrigé par le banc d'essai (x{ratios[m]:.2f}) : {hours(remaining * ratios[m])}"
        print(line)
    print(f"  total : {hours(grand)} si une recherche vers {len(dests)} communes coûte autant qu'une recherche vers "
          f"{len(poles)} pôles (hypothèse NON vérifiée ; c'est ce que mesure --bench)")
    if ratios:
        print(f"  total corrigé par le banc d'essai : {hours(grand_b)} (modes mesurés seulement)")
    elif bench is not None:
        print(f"  bench.json ignoré : calculé avec d'autres entrées ({bench_diff})")
    else:
        print("  pas de bench.json : lancer --bench (1 lot, quelques départs) pour mesurer l'effet des destinations")
    peaks = [e.get("peak_rss_gb") for e in od.read_jsonl(MATRIX_DIR / "run_log.jsonl") if e.get("peak_rss_gb")]
    if peaks:
        print(f"  mémoire observée par 04 (15 pôles) : pic du processus {min(peaks)} à {max(peaks)} Go ; "
              "avec 1 285 destinations : non mesurée (--bench)")

    # stockage
    print("\nstockage de la table (uint8, 1 octet par couple x départ) :")
    for m in args.modes:
        deps = mode_departures(m, grid)
        raw = n_o * n_d * len(deps)
        line = f"  {m:8s} : {num(raw)} octets non compressés ({gb(raw)})"
        if bench and not bench_diff and m in bench.get("modes", {}):
            bpc = bench["modes"][m]["npz_bytes_per_cell"]
            line += f" ; npz compressé mesuré au banc d'essai : {bpc:.3f} octet par cellule, soit {gb(raw * bpc)}"
        print(line)

    # volume d'export
    if grid is not None and starts:
        pub_s = starts
        pub_e = ends
        if args.publish_starts:
            a, b_ = (od.parse_hhmm(x) for x in args.publish_starts)
            pub_s = [s for s in starts if a <= s <= b_]
        if args.publish_ends:
            a, b_ = (od.parse_hhmm(x) for x in args.publish_ends)
            pub_e = [e for e in ends if a <= e <= b_]
        print(f"\nvolume d'export TC (format candidat od_table.export_payload, un fichier par commune ; débuts "
              f"publiés {od.format_hhmm(pub_s[0]) if pub_s else '-'} à {od.format_hhmm(pub_s[-1]) if pub_s else '-'}, "
              f"fins {od.format_hhmm(pub_e[0]) if pub_e else '-'} à {od.format_hhmm(pub_e[-1]) if pub_e else '-'}) :")
        bpv = bench["modes"]["transit"].get("json_bytes_per_value") if (bench and not bench_diff and
                                                                       "transit" in bench.get("modes", {})) else None
        for step in args.publish_steps:
            ns = len(od.publication_times(pub_s, step))
            ne = len(od.publication_times(pub_e, step))
            nv = n_d * (ns + ne)
            ub = od.json_upper_bound(nv)
            line = (f"  pas {step:2d} min : {ns} débuts + {ne} fins = {num(nv)} valeurs par commune ; borne haute "
                    f"JSON {ub / 1e6:.2f} Mo par commune, {num(ub * n_o / 1e6)} Mo pour {n_o} communes")
            if bpv:
                line += f" ; extrapolé du banc d'essai ({bpv:.2f} o/valeur) : {nv * bpv * n_o / 1e6:.0f} Mo"
            print(line)
        vol = args.out_dir / "volume.json"
        print("  mesure réelle : " + (f"voir {vol}" if vol.exists()
                                       else "lancer --volume quand la table TC est complète"))
        print("  rappel : plan Free de Static Web Apps limité à 250 Mo et 15 000 fichiers (D-019)")

    old = args.out_dir / "run_params.json"
    if old.exists():
        diff = od.params_diff(json.loads(old.read_text(encoding="utf-8")), params)
        print("\nreprise possible sans --fresh" if not diff else f"\n--fresh nécessaire (paramètres : {sorted(diff)})")
    else:
        print(f"\naucun calcul en cours dans {args.out_dir}")
    loaded = [m for m in ("r5py", "jpype", "_jpype") if m in sys.modules]
    print(f"modules Java importés pendant l'essai à blanc : {loaded or 'aucun (ni r5py, ni jpype)'}")


# --------------------------------------------------------------------------- calcul r5py (bench et complet)
def guard_resources(args: argparse.Namespace) -> None:
    others = other_r5_runs()
    if others and not args.allow_concurrent:
        raise SystemExit(f"autre calcul r5py en cours {others} : deux JVM R5 ne tiennent pas en mémoire (D-014)")
    avail = psutil.virtual_memory().available
    need = heap_bytes(args.max_memory) + (args.min_free_gb or 0) * 1e9
    if avail < need:
        raise SystemExit(f"mémoire disponible {gb(avail)} < heap JVM demandée {args.max_memory} + seuil "
                         f"{args.min_free_gb or 0} Go : abandon")


def start_network(args: argparse.Namespace, m04):
    import warnings

    n_trips = m04.check_service_date()
    if n_trips == 0:
        raise SystemExit(f"Aucune course active le {SERVICE_DATE} dans le GTFS : changer SERVICE_DATE")
    from starway import routing
    from starway.routing import configure_java

    v = args.variant
    configure_java(max_memory=args.max_memory, r5_classpath=None if v is None else v["jar_path"])
    from starway.routing import load_network

    if v is not None:  # vérifie dans la JVM, avant le chargement du réseau, le jar et le cache réellement utilisés
        import r5py  # noqa: F401
        from r5py.util.classpath import R5_CLASSPATH
        from r5py.util.config import Config

        if Path(R5_CLASSPATH).resolve() != v["jar_path"]:
            raise SystemExit(f"r5py utilise {R5_CLASSPATH} au lieu de {v['jar_path']}")
        if Path(Config().CACHE_DIR).resolve() != (v["cache_home"] / "r5py").resolve():
            raise SystemExit(f"cache r5py {Config().CACHE_DIR} au lieu de {v['cache_home'] / 'r5py'}")
        from com.conveyal.r5.transit import TransitLayer  # type: ignore[import-not-found]

        jvm_limit = int(TransitLayer.WALK_DISTANCE_LIMIT_METERS)
        if jvm_limit != v["limit_m"]:
            raise SystemExit(f"constante chargée dans la JVM : {jvm_limit} m, attendu {v['limit_m']} m")
        routing.WALK_LEG_MAX_MIN = v["walk_min"]
        print(f"JVM : WALK_DISTANCE_LIMIT_METERS = {jvm_limit} m ; max_time_walking {routing.WALK_LEG_MAX_MIN} min "
              f"(modes TC seulement) ; cache r5py {Config().CACHE_DIR}", flush=True)

    t0 = time.time()
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        network = load_network(OSM, GTFS)
    return network, time.time() - t0, len(w), n_trips


def compute_lot(network, origins_s, o_unsnapped, lot: list[str], dests_s, d_unsnapped, dest_ids: list[str],
                mode: str, deps: list[int], threads: int = 1, direction: str = "out") -> tuple[np.ndarray, list[float]]:
    """Un appel r5py par départ. Avec threads > 1, les départs sont calculés en même temps dans la même JVM (réseau
    partagé ; JPype libère le verrou global de Python pendant les appels Java). Le premier départ est calculé seul :
    les tables paresseuses de R5 (liaison des points) sont remplies avant les appels parallèles. Chaque départ écrit
    sa propre tranche tt[:, :, j] : le résultat ne dépend pas de l'ordre d'exécution."""
    from starway.routing import travel_times

    tt = np.full((len(lot), len(dest_ids), len(deps)), od.SENTINEL_NO_TRIP, dtype=np.uint8)
    per_dep: list[float] = [0.0] * len(deps)

    def one(j: int) -> None:
        t1 = time.time()
        if not origins_s.empty:
            dep = deps[j]
            when = datetime.combine(SERVICE_DATE, dtime(dep // 60, dep % 60))
            s = travel_times(network, origins_s, dests_s, when, mode, direction)
            tt[:, :, j] = od.encode_pairs(s, lot, dest_ids)
        per_dep[j] = round(time.time() - t1, 1)

    if threads <= 1 or len(deps) <= 1:
        for j in range(len(deps)):
            one(j)
    else:
        one(0)
        with ThreadPoolExecutor(max_workers=threads, thread_name_prefix="r5") as ex:
            list(ex.map(one, range(1, len(deps))))  # list() : remonte la première exception
    return od.mark_unsnapped(tt, lot, dest_ids, o_unsnapped, d_unsnapped), per_dep


def compute(args: argparse.Namespace, communes: pd.DataFrame, dests: pd.DataFrame, grid: np.ndarray | None,
            bench: bool) -> None:
    from starway.routing import snap_points

    guard_resources(args)
    params = run_params(args, communes, dests, grid)
    lots = od.batches_of(communes["insee"].tolist(), args.batch_size)
    if not bench:
        path = args.out_dir / "run_params.json"
        if args.fresh:
            for f in args.out_dir.glob("*/batch_*.npz"):
                f.unlink()
        elif path.exists():
            diff = od.params_diff(json.loads(path.read_text(encoding="utf-8")), params)
            if diff:
                raise SystemExit(f"Paramètres différents du calcul en cours {diff} : relancer avec --fresh")
        write_json_atomic(path, params)
    elif not 0 <= args.bench_lot < len(lots):
        raise SystemExit(f"--bench-lot hors limites (0 à {len(lots) - 1})")

    m04 = load_04()
    watch = m04.MemoryWatch()
    start_memory_guard(args, watch)
    network, load_s, n_warn, n_trips = start_network(args, m04)
    print(f"date de service {SERVICE_DATE} : {n_trips} courses ; réseau chargé en {load_s:.0f} s "
          f"({n_warn} avertissements R5) ; {watch.snapshot()}")
    dest_ids = dests["id"].tolist()
    t0 = time.time()
    dests_s, d_unsnapped, d_dist = snap_points(network, m04.points_gdf(dests, "id"))
    snap_s = time.time() - t0
    print(f"{len(dest_ids)} destinations accrochées en {snap_s:.0f} s ; non accrochées : {d_unsnapped}")

    if bench:
        run_bench(args, communes, lots, network, dests_s, d_unsnapped, d_dist, dest_ids, grid, params, watch,
                  load_s, snap_s, m04)
        return

    log_path = args.out_dir / "run_log.jsonl"
    for k, lot in enumerate(lots):
        pending = [m for m in args.modes if not od.lot_path(args.out_dir, m, k).exists()]
        claimed = [m for m in pending if ov.claim_lot(od.lot_path(args.out_dir, m, k))]
        if not claimed:  # lot écrit, ou réservé par un autre processus vivant
            continue
        try:
            origins_s, o_unsnapped, o_dist = snap_points(
                network, m04.points_gdf(communes[communes["insee"].isin(lot)], "insee", ORIGIN_LON, ORIGIN_LAT))
            for mode in claimed:
                deps = mode_departures(mode, grid)
                n_thr = ov.read_threads(args.threads, args.threads_file)
                t1 = time.time()
                tt, per_dep = compute_lot(network, origins_s, o_unsnapped, lot, dests_s, d_unsnapped, dest_ids, mode,
                                          deps, threads=n_thr)
                dest = od.lot_path(args.out_dir, mode, k)
                od.write_lot(dest, tt, lot, dest_ids, deps)
                entry = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "batch": k, "origins": len(lot),
                         "destinations": len(dest_ids), "mode": mode, "departures": len(deps),
                         "seconds": round(time.time() - t1, 1), "threads": n_thr, "pid": os.getpid(),
                         "seconds_per_departure": per_dep,
                         "no_trip_cells": int((tt == od.SENTINEL_NO_TRIP).sum()), "cells": int(tt.size),
                         "unsnapped_origins": o_unsnapped, "unsnapped_destinations": d_unsnapped,
                         "snap_m_max": round(max(o_dist.values())) if o_dist else None,
                         "npz_bytes": dest.stat().st_size, **watch.snapshot(), **jvm_heap(),
                         "load_avg_1min": round(os.getloadavg()[0], 2) if hasattr(os, "getloadavg") else None}
                with log_path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                print(f"lot {k + 1}/{len(lots)} {mode} : {len(deps)} départs en {entry['seconds']} s avec {n_thr} "
                      f"fils ; {watch.snapshot()} {jvm_heap()}", flush=True)
        finally:
            for mode in claimed:
                ov.release_lot(od.lot_path(args.out_dir, mode, k))
    missing = [(m, k) for m in args.modes for k in range(len(lots)) if not od.lot_path(args.out_dir, m, k).exists()]
    print(f"terminé pour ce processus ; lots manquants (en cours ailleurs ou à reprendre) : {len(missing)} ; "
          f"{watch.snapshot()}", flush=True)


def run_bench(args, communes, lots, network, dests_s, d_unsnapped, d_dist, dest_ids, grid, params, watch,
              load_s, snap_s, m04) -> None:
    from starway.routing import snap_points

    k = args.bench_lot
    lot = lots[k][:args.bench_origins] if args.bench_origins else lots[k]
    origins_s, o_unsnapped, o_dist = snap_points(
        network, m04.points_gdf(communes[communes["insee"].isin(lot)], "insee", ORIGIN_LON, ORIGIN_LAT))
    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    rates, _, _ = matrix_rates(len(poles))
    bench_dir = args.out_dir / "bench"
    out: dict[str, Any] = {}
    for mode in args.modes:
        timed = mode in od.TIME_DEPENDENT or mode in BENCH_ONLY_MODES
        deps = od.bench_departures(grid, args.bench_departures) if timed else mode_departures(mode, grid)
        for direction in (("out",) if od.symmetric_legs(mode) else ("out", "ret")):
            key = mode if od.symmetric_legs(mode) else f"{mode}_{direction}"
            t1 = time.time()
            tt, per_dep = compute_lot(network, origins_s, o_unsnapped, lot, dests_s, d_unsnapped, dest_ids, mode,
                                      deps, threads=args.threads, direction=direction)
            wall = time.time() - t1
            path = bench_dir / f"bench_{key}_lot{k:04d}.npz"
            od.write_lot(path, tt, lot, dest_ids, deps)
            n_search = max(len(origins_s), 1)
            s_per_search = statistics.fmean(per_dep) / n_search
            ref = rates.get(mode, {}).get(k)
            raw, _ = od.payload_bytes({"v": [od.decode_minutes(int(v))[0] for v in tt.ravel()]})
            out[key] = {"departures": [od.format_hhmm(d) for d in deps], "direction": direction,
                        "threads": args.threads, "seconds": round(wall, 1),
                        "wall_seconds_per_departure": round(wall / len(deps), 2),
                        "seconds_per_departure": per_dep, "seconds_per_search": round(s_per_search, 4),
                        "seconds_per_search_04_same_lot": None if ref is None else round(ref, 4),
                        "ratio_vs_04_same_lot": None if ref is None else round(s_per_search / ref, 3),
                        "cells": int(tt.size), "no_trip_cells": int((tt == od.SENTINEL_NO_TRIP).sum()),
                        "npz_bytes": path.stat().st_size,
                        "npz_bytes_per_cell": round(path.stat().st_size / tt.size, 4),
                        "json_bytes_per_value": round(raw / tt.size, 3), **watch.snapshot(), **jvm_heap()}
            if args.variant is not None and mode in od.OD_MODES and mode not in ov.VARIANT_MODES:
                out[key]["vs_base_od"] = compare_with_base(tt, lot, dest_ids, deps, mode, k)
            print(f"banc d'essai {key} : {per_dep} s par départ ({args.threads} fils) ; {watch.snapshot()} "
                  f"{out[key].get('vs_base_od', '')}", flush=True)
    bench = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "lot": k, "origins": len(lot),
             "destinations": len(dest_ids), "unsnapped_origins": o_unsnapped, "unsnapped_destinations": d_unsnapped,
             "snap_m_max_origins": round(max(o_dist.values())) if o_dist else None,
             "snap_m_max_destinations": round(max(d_dist.values())) if d_dist else None,
             "network_load_seconds": round(load_s, 1), "destination_snap_seconds": round(snap_s, 1),
             "max_memory": args.max_memory, "params": params, "modes": out,
             "notes": ("ratio_vs_04_same_lot = secondes par recherche vers les communes / secondes par recherche "
                       "de 04 vers les pôles, même lot ; json_bytes_per_value mesuré sur les durées du banc "
                       "d'essai (TT à des départs fixes, pas des allers retenus)")}
    write_json_atomic(args.out_dir / "bench.json", bench)
    print(f"mesures écrites dans {args.out_dir / 'bench.json'}")


def compare_with_base(tt: np.ndarray, lot: list[str], dest_ids: list[str], deps: list[int], mode: str,
                      k: int) -> dict[str, Any]:
    """Vérification empirique : un mode sans TC calculé avec le jar de la variante est-il identique au même lot de
    od/ (jar R5 d'origine) ? Lecture seule de od/."""
    p = od.lot_path(od.OD_DIR, mode, k)
    if not p.exists():
        return {"status": "base_lot_absent", "path": str(p)}
    base = od.read_lot(p)
    if base.from_ids != lot or base.to_ids != dest_ids or [int(x) for x in base.departures] != deps:
        return {"status": "different_layout"}
    diff = int((base.tt != tt).sum())
    return {"status": "identical" if diff == 0 else "different", "cells": int(tt.size), "cells_different": diff}


# --------------------------------------------------------------------------- volume mesuré (sans r5py)
def measure_volume(args: argparse.Namespace, communes: pd.DataFrame, dests: pd.DataFrame, grid: np.ndarray) -> None:
    lots = od.batches_of(communes["insee"].tolist(), args.batch_size)
    paths = [od.lot_path(args.out_dir, "transit", k) for k in range(len(lots))]
    missing = [p.name for p in paths if not p.exists()]
    if missing:
        raise SystemExit(f"table TC incomplète ({len(missing)} lots manquants) : le retour de chaque commune "
                         "demande les lots de toutes les autres")
    dest_ids = dests["id"].tolist()
    parts = []
    for k, p in enumerate(paths):
        lot = od.read_lot(p)
        if lot.from_ids != lots[k] or lot.to_ids != dest_ids or not np.array_equal(lot.departures, grid):
            raise SystemExit(f"{p} : identifiants ou départs différents du découpage attendu")
        parts.append(lot.tt)
    full = np.concatenate(parts, axis=0)  # (origines, destinations, départs) ; origines = destinations, même ordre
    if communes["insee"].tolist() != dest_ids:
        raise SystemExit("origines et destinations dans un ordre différent : volume non mesurable tel quel")
    starts, ends = od.servable_starts(grid), od.servable_ends(grid)
    codes = args.volume_communes or dest_ids
    res: dict[str, Any] = {}
    for step in args.publish_steps:
        s_pub, e_pub = od.publication_times(starts, step), od.publication_times(ends, step)
        rows = []
        for code in codes:
            i = dest_ids.index(code)
            rows.append(od.commune_export_volume(full[i], full[:, i, :], grid, s_pub, e_pub) | {"insee": code})
        raw = [r["raw_bytes"] for r in rows]
        gz = [r["gzip_bytes"] for r in rows]
        res[str(step)] = {"communes": len(rows), "raw_bytes_total": sum(raw), "gzip_bytes_total": sum(gz),
                          "raw_bytes_median": statistics.median(raw), "raw_bytes_max": max(raw),
                          "n_starts": len(s_pub), "n_ends": len(e_pub)}
        print(f"pas {step} min : {len(rows)} communes, {sum(raw) / 1e6:.2f} Mo bruts ({sum(gz) / 1e6:.2f} Mo gzip) ; "
              f"par commune : médiane {statistics.median(raw) / 1e6:.2f} Mo, maximum {max(raw) / 1e6:.2f} Mo")
    write_json_atomic(args.out_dir / "volume.json", {"at": datetime.now(UTC).isoformat(timespec="seconds"),
                                                  "format": "od_table.export_payload (candidat)", "steps": res})


# --------------------------------------------------------------------------- main
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--first-departure", help="premier départ TC calculé, HH:MM sur la grille de 5 min (obligatoire)")
    p.add_argument("--last-departure", help="dernier départ TC calculé, HH:MM sur la grille de 5 min (obligatoire)")
    p.add_argument("--modes", nargs="*", default=["transit"], choices=list(od.OD_MODES) + list(BENCH_ONLY_MODES),
                   help="bike_transit : --bench seulement (mesure de coût, deux sens)")
    p.add_argument("--batch-size", type=int, default=100, help="origines par lot (même valeur que 04)")
    p.add_argument("--max-memory", default=R5_MAX_MEMORY, help="heap max de la JVM R5 (ex. 10G)")
    p.add_argument("--out-dir", type=Path, default=None,
                   help="défaut : data/interim/od/ (réglage R5 d'origine) ou data/interim/od_walk{L}/ (variante)")
    p.add_argument("--walk-setting", choices=list(WALK_SETTINGS_M),
                   help="réglage de marche D-024 (choix de l'équipe, pas une donnée) ; avec --r5-jar ; TC seulement")
    p.add_argument("--r5-jar", type=Path, help="jar R5 recompilé (WALK_DISTANCE_LIMIT_METERS = le réglage)")
    p.add_argument("--cache-home", type=Path, help="XDG_CACHE_HOME de la variante (défaut : celui de 04e)")
    p.add_argument("--threads", type=int, default=1, help="départs calculés en même temps dans la JVM (défaut 1)")
    p.add_argument("--threads-file", type=Path, help="fichier relu avant chaque lot : nombre de fils (montée en charge)")
    p.add_argument("--min-free-gb", type=float, default=None,
                   help="arrêt propre (code 3) si la machine descend sous ce seuil de mémoire libre")
    p.add_argument("--fresh", action="store_true", help="efface les lots existants")
    p.add_argument("--dry-run", action="store_true", help="plan et estimations, sans r5py ni Java")
    p.add_argument("--bench", action="store_true", help="un lot, quelques départs ; écrit bench.json")
    p.add_argument("--bench-lot", type=int, default=0, help="lot mesuré par --bench")
    p.add_argument("--bench-departures", type=int, default=3, help="départs TC mesurés par --bench")
    p.add_argument("--bench-origins", type=int, default=None,
                   help="--bench sur les N premières origines du lot seulement (part fixe et part par origine d'un appel)")
    p.add_argument("--volume", action="store_true", help="mesure le volume d'export sur la table TC complète")
    p.add_argument("--volume-communes", nargs="*", help="restreint --volume à ces codes INSEE")
    p.add_argument("--publish-steps", nargs="*", type=int, default=[5, 15, 30],
                   help="pas de publication des heures de début et de fin comparés (multiples de 5)")
    p.add_argument("--publish-starts", nargs=2, metavar=("HH:MM", "HH:MM"), help="débuts de poste publiés (bornes)")
    p.add_argument("--publish-ends", nargs=2, metavar=("HH:MM", "HH:MM"), help="fins de poste publiées (bornes)")
    p.add_argument("--allow-concurrent", action="store_true", help="déconseillé : mémoire (D-014)")
    r5_transfers.add_cli(p)
    args = p.parse_args()

    if sum([args.dry_run, args.bench, args.volume]) > 1:
        raise SystemExit("--dry-run, --bench et --volume s'excluent")
    if not args.bench and set(args.modes) & set(BENCH_ONLY_MODES):
        raise SystemExit(f"{sorted(set(args.modes) & set(BENCH_ONLY_MODES))} : --bench seulement (deux tables par mode)")
    if args.fresh and args.threads_file is not None:
        raise SystemExit("--fresh avec plusieurs processus possibles (--threads-file) : refusé, effacer à la main")
    setup_variant(args)
    check_separate_dirs(args.out_dir, args.out_dir)
    communes, dests = load_inputs()
    grid = build_grid(args)
    if args.dry_run:
        dry_run(args, communes, dests, grid)
        return 0
    if args.volume:
        if grid is None:
            raise SystemExit(PLAGE_MISSING)
        measure_volume(args, communes, dests, grid)
        return 0
    compute(args, communes, dests, grid, bench=args.bench)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
