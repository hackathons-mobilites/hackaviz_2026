"""04f - Mesure de la mémoire des tables de distances de R5 selon la limite de marche (variante D-022).

Pourquoi : la construction du réseau avec `WALK_DISTANCE_LIMIT_METERS = 7200` (04e) a saturé une JVM de 48 puis
72 Go le 03/11/2026. Plutôt que de deviner la mémoire nécessaire, on la MESURE : on charge le réseau déjà construit
(limite 2 000 m, jar r5py d'origine), on compte exactement les entrées de ses tables de distances, puis, sur un
échantillon aléatoire d'arrêts, on refait la recherche à pied de R5 (`TransitLayer.buildOneDistanceTable` : même
routeur, même critère, distance en millimètres) avec chaque limite demandée, et on extrapole la taille totale.

Lecture seule : le réseau en cache est COPIÉ dans un cache temporaire (--cache-home), jamais réécrit ; aucun lot,
aucune matrice. Mémoire : environ 12 Go (réseau IDF à 2 km).

Taille d'une table = celle du `TIntIntHashMap` rendu par `StreetRouter.getReachedVertices()` : 2 tableaux d'int
et 1 tableau d'octets de longueur `capacity()` (bibliothèque Trove), soit 9 octets par case, plus les en-têtes.

Usage (VM) :
    python scripts/04f_probe_walk_tables.py --sample 400 --limits 2000 7200
Sortie : data/interim/walk_table_probe.json (et .csv, une ligne par arrêt échantillonné).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import sys
import time
from pathlib import Path

import pandas as pd

from starway.config import INTERIM_DIR, RAW_DIR
from starway.r5jar import estimate_total

OSM = RAW_DIR / "CYC01" / "ile-de-france-latest.osm.pbf"
GTFS = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"
BYTES_PER_SLOT = 9  # int clé + int valeur + octet d'état (Trove TIntIntHashMap)
ARRAY_HEADERS = 3 * 16 + 64  # en-têtes des 3 tableaux et de l'objet (ordre de grandeur JVM 64 bits)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sample", type=int, default=400, help="arrêts tirés au hasard (échantillon aléatoire simple)")
    p.add_argument("--seed", type=int, default=20261103, help="graine du tirage (choix de mesure, sans effet publié)")
    p.add_argument("--limits", type=int, nargs="+", default=[2000, 7200])
    p.add_argument("--max-memory", default="16G")
    p.add_argument("--source-cache", type=Path, default=Path.home() / ".cache" / "r5py")
    p.add_argument("--cache-home", type=Path, default=Path.home() / ".cache" / "starway-probe")
    p.add_argument("--out", type=Path, default=INTERIM_DIR / "walk_table_probe")
    args = p.parse_args()

    dst = args.cache_home / "r5py"
    dst.mkdir(parents=True, exist_ok=True)
    for f in args.source_cache.glob("*.transport_network"):
        if not (dst / f.name).exists():
            shutil.copy2(f, dst / f.name)
        w = f.with_suffix(".warnings")
        if w.exists() and not (dst / w.name).exists():
            shutil.copy2(w, dst / w.name)
    os.environ["XDG_CACHE_HOME"] = str(args.cache_home)
    sys.argv = [sys.argv[0], "--max-memory", args.max_memory]

    import r5py
    from r5py.util.classpath import R5_CLASSPATH

    t0 = time.time()
    net = r5py.TransportNetwork(OSM, [GTFS], allow_errors=True)
    jnet = net._transport_network
    from com.conveyal.r5.streets import StreetRouter  # type: ignore[import-not-found]
    from com.conveyal.r5.transit import TransitLayer  # type: ignore[import-not-found]

    tl = jnet.transitLayer
    n_stops = int(tl.getStopCount())
    print(f"réseau chargé en {time.time() - t0:.0f} s ; jar {Path(R5_CLASSPATH).name} ; "
          f"limite du jar {int(TransitLayer.WALK_DISTANCE_LIMIT_METERS)} m ; {n_stops} arrêts", flush=True)

    tables = tl.stopToVertexDistanceTables
    linked, stored_entries, stored_slots = [], 0, 0
    for i in range(n_stops):
        t = tables.get(i)
        if t is not None:
            linked.append(i)
            stored_entries += int(t.size())
            stored_slots += int(t.capacity())
    print(f"tables en mémoire (limite du réseau en cache) : {len(linked)} arrêts reliés, {stored_entries} entrées, "
          f"{stored_slots} cases", flush=True)

    rng = random.Random(args.seed)
    sample = sorted(rng.sample(linked, min(args.sample, len(linked))))
    routing_var = StreetRouter.State.RoutingVariable.DISTANCE_MILLIMETERS
    rows = []
    t1 = time.time()
    for k, stop in enumerate(sample):
        row = {"stop": stop, "stored_entries": int(tables.get(stop).size())}
        for lim in args.limits:
            r = StreetRouter(jnet.streetLayer)
            r.distanceLimitMeters = lim
            r.quantityToMinimize = routing_var
            r.setOrigin(int(tl.streetVertexForStop.get(stop)))
            ts = time.time()
            r.route()
            m = r.getReachedVertices()
            row[f"entries_{lim}"] = int(m.size())
            row[f"bytes_{lim}"] = int(m.capacity()) * BYTES_PER_SLOT + ARRAY_HEADERS
            row[f"seconds_{lim}"] = round(time.time() - ts, 3)
        rows.append(row)
        if (k + 1) % 50 == 0:
            print(f"{k + 1}/{len(sample)} arrêts en {time.time() - t1:.0f} s", flush=True)

    df = pd.DataFrame(rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out.with_suffix(".csv"), index=False)
    result = {"jar": Path(R5_CLASSPATH).name, "n_stops": n_stops, "n_linked": len(linked),
              "stored_entries_total": stored_entries, "stored_slots_total": stored_slots,
              "sample": len(sample), "seed": args.seed, "bytes_per_slot": BYTES_PER_SLOT,
              "array_headers_bytes": ARRAY_HEADERS, "estimates": {}}
    for lim in args.limits:
        e_bytes = estimate_total(df[f"bytes_{lim}"].astype(float).tolist(), len(linked))
        e_entries = estimate_total(df[f"entries_{lim}"].astype(float).tolist(), len(linked))
        e_secs = estimate_total(df[f"seconds_{lim}"].astype(float).tolist(), len(linked))
        result["estimates"][str(lim)] = {
            "entries_total": round(e_entries["total"]), "entries_low95": round(e_entries["low95"]),
            "entries_high95": round(e_entries["high95"]),
            "tables_gb": round(e_bytes["total"] / 1e9, 1), "tables_gb_low95": round(e_bytes["low95"] / 1e9, 1),
            "tables_gb_high95": round(e_bytes["high95"] / 1e9, 1),
            "single_thread_hours": round(e_secs["total"] / 3600, 2),
            "entries_per_stop_median": int(df[f"entries_{lim}"].median()),
            "entries_per_stop_max": int(df[f"entries_{lim}"].max()),
        }
    # contrôle : sur l'échantillon, la recherche refaite à la limite du réseau en cache retrouve les tables stockées
    jar_lim = int(TransitLayer.WALK_DISTANCE_LIMIT_METERS)
    if f"entries_{jar_lim}" in df:
        result["check_same_entries_as_stored"] = int((df[f"entries_{jar_lim}"] == df["stored_entries"]).sum())
    args.out.with_suffix(".json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
