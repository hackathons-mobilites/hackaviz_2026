"""04l - Banc fauteuil (calcul n° 10 de docs/etat-calculs-vm.md) : le routage fauteuil de R5 s'applique-t-il, et à quoi ?

NE PAS LANCER SANS L'ACCORD DE NICOLAS : il construit un réseau R5 (11 à 28 Go de mémoire) ; sur la VM il se met derrière les
calculs en cours. `--dry-run` ne charge rien (lit seulement la matrice cible et tire l'échantillon).

Ce que le code installé permet (lu le 04/11/2026, jar R5 v7.5.1 des calculs de la VM, r5py 1.1.7) :
- r5py 1.1.7 n'expose AUCUNE option fauteuil dans son interface Python ;
- le jar R5 a un champ public `ProfileRequest.wheelchair` (RegionalTask en hérite) : `Planner(wheelchair=True)` le fixe sur la
  tâche de base, copiée par `clone()` dans chaque recherche ;
- appliqué par McRAPTOR (`McRaptorSuboptimalPathProfileRouter`, itinéraires de 04h, `r5py.DetailedItineraries`) : arrêts sans
  `wheelchair_boarding` = 1 écartés (`TransitLayer.stopsWheelchair`), courses sans `wheelchair_accessible` = 1 écartées
  (`TripFlag.WHEELCHAIR`) ; et par la marche : `EdgeStore.Edge` refuse les arêtes sans `ALLOWS_WHEELCHAIR` (étiquetage OSM de
  `TraversalPermissionLabeler`) ;
- PAS appliqué par `FastRaptorWorker` (matrices, `TravelTimeMatrix`) : aucune référence au fauteuil dans cette classe. Une
  matrice « fauteuil » n'existe donc pas ; seul un calcul d'itinéraires (04h) peut l'approcher.
Limites à écrire : un arrêt à `wheelchair_boarding` 0 (inconnu : 19 240 arrêts du GTFS IDFM) est traité comme inaccessible, il
n'y a ni ascenseurs ni escaliers dans `pathways.txt`, les trottoirs d'OSM sont peu fiables : jamais « trajet faisable en
fauteuil » ; c'est « trajet possible avec les arrêts et courses déclarés accessibles par IDFM » (D-034).

Le banc rejoue N trajets (échantillon à graine fixe, comme 04h --bench) deux fois sur le MÊME réseau : sans puis avec
`wheelchair`, et écrit `bench_wheelchair.json` : part d'arrêts et de courses déclarés accessibles vus par R5, trajets trouvés
dans les deux cas, trouvés seulement sans fauteuil, durées comparées, temps de calcul par trajet (pour chiffrer un calcul
complet : voir `estimate` dans le fichier).

Usage (sur la VM, dans un dossier de code neuf, quand Nicolas l'autorise) :
    python scripts/04l_wheelchair_bench.py --r5-jar ~/r5build/r5-v7.5.1-r5py-walk3000-d031-all.jar \\
        --transfer-rules gtfs_navitia --same-stop-csv ~/d031/navitia_same_stop_min.csv \\
        --poles ~/b44/poles_d030.json --matrix-dir data/interim/matrix_walk3000_d031_b44 \\
        --out-dir data/interim/bench_wheelchair_b44 --sample 60 --max-memory 28G --min-free-gb 26
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psutil

from starway import itineraries as it
from starway import r5_transfers
from starway.config import INTERIM_DIR, MAX_TRIP_MIN, PIPELINE_DIR, SERVICE_DATE, SPEED_WALKING_KMH, WALK_SETTINGS_M
from starway.r5jar import low_memory

BENCH_SEED = 20261117  # celle de 04h --bench : mêmes trajets que le banc d'itinéraires


def load_04h():
    spec = importlib.util.spec_from_file_location("transit_04h", PIPELINE_DIR / "scripts" / "04h_transit_itineraries.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def duration_min(rec: dict[str, Any]) -> float | None:
    o = rec.get("option")
    return None if not o else (o["arr_s"] - o["dep_s"]) / 60.0


def compare_runs(base: list[dict[str, Any]], wheel: list[dict[str, Any]]) -> dict[str, Any]:
    """Comparaison trajet par trajet (mêmes tâches, même ordre) : sans fauteuil / avec. Aucune moyenne inventée : des
    effectifs et la médiane des écarts de durée des trajets trouvés dans les deux cas."""
    assert len(base) == len(wheel)
    both = only_base = only_wheel = neither = 0
    deltas: list[float] = []
    for a, b in zip(base, wheel, strict=True):
        da, db = duration_min(a), duration_min(b)
        if da is not None and db is not None:
            both += 1
            deltas.append(db - da)
        elif da is not None:
            only_base += 1
        elif db is not None:
            only_wheel += 1
        else:
            neither += 1
    deltas.sort()
    n = len(deltas)
    med = None if not n else (deltas[n // 2] if n % 2 else (deltas[n // 2 - 1] + deltas[n // 2]) / 2)
    return {"trips": len(base), "found_both": both, "found_without_wheelchair_only": only_base,
            "found_with_wheelchair_only": only_wheel, "found_neither": neither,
            "median_delta_min_when_both": med, "identical_duration_when_both": sum(1 for d in deltas if d == 0),
            "longer_with_wheelchair": sum(1 for d in deltas if d > 0), "shorter_with_wheelchair": sum(1 for d in deltas if d < 0)}


def estimate(trips_per_s: float, n_trips: int) -> dict[str, Any]:
    """Durée d'un calcul complet fauteuil (04h sur tous les trajets) au débit mesuré ; vide si le banc est vide."""
    if trips_per_s <= 0:
        return {"hours_one_process": None, "note": "banc vide"}
    return {"hours_one_process": round(n_trips / trips_per_s / 3600, 1), "trips": n_trips,
            "note": "au débit du banc, mêmes fils et même charge ; non garanti sur une VM chargée"}


def layer_stats(network) -> dict[str, Any]:
    """Part des arrêts et des courses que R5 considère accessibles en fauteuil (lecture du réseau chargé)."""
    jtl = network._transport_network.transitLayer
    n_stops = int(jtl.getStopCount())
    allowed = int(jtl.stopsWheelchair.cardinality())
    flag = total = 0
    from com.conveyal.r5.transit import TripFlag  # type: ignore[import-not-found]

    for pattern in jtl.tripPatterns:
        for ts in pattern.tripSchedules:
            total += 1
            flag += 1 if ts.getFlag(TripFlag.WHEELCHAIR) else 0
    return {"stops": n_stops, "stops_wheelchair_boarding_1": allowed,
            "stops_share": round(allowed / n_stops, 4) if n_stops else None,
            "trips": total, "trips_wheelchair_accessible_1": flag,
            "trips_share": round(flag / total, 4) if total else None}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--walk-setting", choices=sorted(WALK_SETTINGS_M), default="normal")
    p.add_argument("--r5-jar", type=Path, required=True)
    p.add_argument("--matrix-dir", type=Path, required=True, help="matrice TC cible (calculée vers les mêmes pôles)")
    p.add_argument("--out-dir", type=Path, required=True, help="dossier neuf du banc (jamais un dossier publié)")
    p.add_argument("--sample", type=int, default=60)
    p.add_argument("--threads", type=int, default=2)
    p.add_argument("--max-memory", default="28G")
    p.add_argument("--min-free-gb", type=float, default=26.0)
    p.add_argument("--cache-home", type=Path, default=None)
    p.add_argument("--dry-run", action="store_true", help="tire l'échantillon, ne charge ni Java ni réseau")
    r5_transfers.add_cli(p)
    r5_transfers.add_poles_cli(p)
    args = p.parse_args()
    h = load_04h()
    h.POLES_FILE = (args.poles or h.POLES_FILE).expanduser().resolve()
    args.matrix_dir = args.matrix_dir.expanduser().resolve()
    args.out_dir = args.out_dir.expanduser().resolve()
    args.same_stop_csv = args.same_stop_csv.expanduser().resolve()
    for d in (INTERIM_DIR / "itineraries_walk1000", INTERIM_DIR / "itineraries_walk3000", INTERIM_DIR / "matrix"):
        if args.out_dir == d.resolve():
            raise SystemExit("--out-dir : jamais un dossier publié")
    communes, poles, mats, mparams = h.load_inputs(args.matrix_dir, None)
    todo = [t for t in h.all_tasks(mats) if t.target_min is not None]
    sample = random.Random(BENCH_SEED).sample(todo, min(args.sample, len(todo)))
    print(f"{len(todo)} trajets avec une durée dans la matrice ; échantillon {len(sample)}", flush=True)
    if args.dry_run:
        return 0
    avail = psutil.virtual_memory().available
    if avail < h.heap_bytes(args.max_memory) + args.min_free_gb * 1e9:
        raise SystemExit(f"{avail / 1e9:.1f} Go disponibles < heap {args.max_memory} + {args.min_free_gb} Go")
    args.offpeak = None
    jar, walk_min, cache_home = h.setup_cache(args)
    if mparams.get("r5_jar_sha256") != jar["r5_jar_sha256"]:
        raise SystemExit("le jar n'est pas celui de la matrice cible (r5_jar_sha256)")
    m04 = h.load_script("compute_matrix_04", "04_compute_matrix.py")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    r5_transfers.configure(args.transfer_rules, m04.GTFS, args.same_stop_csv, args.out_dir / "transfer_rules_log.jsonl")

    def guard() -> None:
        while True:
            if low_memory(psutil.virtual_memory().available, args.min_free_gb):
                print("ARRÊT : mémoire libre sous le seuil", flush=True)
                os._exit(3)
            time.sleep(2)
    threading.Thread(target=guard, daemon=True).start()
    network, m04, load_s = h.start_network(args, jar, cache_home, walk_min)
    print(f"réseau chargé en {load_s:.0f} s", flush=True)
    stats = layer_stats(network)
    print(f"réseau : {stats}", flush=True)
    o_s, p_s, pts, unsnapped = h.snapped(network, m04, communes, poles)
    from starway.transit_planner import Planner

    runs: dict[str, list[dict[str, Any]]] = {}
    secs: dict[str, float] = {}
    for label, wheel in (("without", False), ("with", True)):
        planner = Planner(network, walk_limit_s=walk_min * 60, speed_walking_kmh=SPEED_WALKING_KMH,
                          max_trip_min=MAX_TRIP_MIN, max_rides=h.MAX_RIDES, service_date=SERVICE_DATE, wheelchair=wheel)
        searches = h.Searches(planner, pts)
        t0 = time.time()
        runs[label] = h.run_tasks(sample, planner, searches, pts, unsnapped, args.threads)
        secs[label] = time.time() - t0
        print(f"{label} fauteuil : {len(sample)} trajets en {secs[label]:.0f} s", flush=True)
    cmp = compare_runs(runs["without"], runs["with"])
    rate = len(sample) / secs["with"] if secs["with"] else 0.0
    out = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "jar": jar["r5_jar"], "jar_sha256": jar["r5_jar_sha256"],
           "walk_setting": args.walk_setting, "matrix_dir": args.matrix_dir.name, "sample": len(sample), "seed": BENCH_SEED,
           "network": stats, "comparison": cmp, "seconds": {k: round(v, 1) for k, v in secs.items()},
           "estimate": estimate(rate, len(todo)),
           "agreement_without_with_matrix": it.agreement(runs["without"]),
           "limits": "arrêts à wheelchair_boarding 0 (inconnu) traités comme inaccessibles ; pas d'ascenseurs ni d'escaliers "
                     "dans pathways.txt ; trottoirs OSM peu fiables ; matrices (FastRaptorWorker) non concernées"}
    (args.out_dir / "bench_wheelchair.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(cmp, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
