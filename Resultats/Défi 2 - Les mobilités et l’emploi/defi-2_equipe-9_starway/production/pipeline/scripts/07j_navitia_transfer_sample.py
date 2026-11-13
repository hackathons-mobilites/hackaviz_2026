"""07j - Tirage stratifié par statut de correspondance, recoupé avec Navitia (calculateur officiel, API PRIM).

CONTRÔLE seulement. Population : les itinéraires TC détaillés publiés (sortie de 07h, `trips_all.csv.gz`), un trajet
par (commune, pôle, journée, sens). Strates = statut des correspondances de l'itinéraire x journée-type :
- `short_gtfs` : au moins une correspondance plus courte que le `min_transfer_time` de `transfers.txt` ;
- `short_navitia_only` : aucune sous le GTFS, mais au moins une sous la durée Navitia d'un couple sans ligne GTFS
  (même arrêt surtout, 07i) ;
- `verified` : toutes les correspondances ont un minimum (GTFS ou Navitia) et le respectent ;
- `unverified` : aucune trop courte, au moins une sans minimum connu ;
- `no_transfer` : 0 ou 1 tronçon en TC.
`--per-stratum` trajets par strate (graine `--seed`), requêtes et définitions de 07d (mêmes paramètres que le 03/11),
cache partagé, une requête par seconde au plus, `--max-requests` au plus.

Mesures par strate : écart STARWAY (durée publiée) moins Navitia ; pour les strates « trop court », écart entre la
borne recalée de 07h (mêmes lignes, minimums respectés) et Navitia ; sens classés de part et d'autre d'un budget
publié (30, 45, 60 min) différemment par STARWAY et Navitia. Totaux pondérés par l'effectif des strates.

Sorties : `data/processed/navitia_transfer_sample.csv`, `data/processed/navitia_transfer_sample_summary.json`.

Usage : python scripts/07j_navitia_transfer_sample.py [--per-stratum 40] [--max-requests 620] [--offline] [--dry-run]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from starway.config import (
    DAY_TYPES_BY_ID,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    PIPELINE_DIR,
    PROCESSED_DIR,
    SERVICE_DATE,
    SPEED_WALKING_KMH,
    WALK_SETTING_DEFAULT,
    WALK_SETTINGS_M,
)
from starway.navitia import (
    Trip,
    aligned_settings,
    cache_key,
    coord,
    day_bounds,
    inbound_value,
    navitia_error,
    outbound_value,
    parse_journeys,
    request_params,
    weighted_quantile,
)
from starway.r5jar import walk_time_limit_min

TRIPS_ALL = INTERIM_DIR / "transfer_check" / "trips_all.csv.gz"
OUT_CSV = PROCESSED_DIR / "navitia_transfer_sample.csv"
OUT_SUMMARY = PROCESSED_DIR / "navitia_transfer_sample_summary.json"
DEFAULT_SEED = 20261117  # date de service, comme 07d (aucun effet sur les durées)
STRATA = ("short_gtfs", "short_navitia_only", "verified", "unverified", "no_transfer")


class MatrixValues:
    """Durées STARWAY lues dans une matrice brute (`transit_{journée}.csv` de 04 / 04e : from_id, to_id, out, ret),
    pour rejouer le tirage sur un recalcul (D-031) avant toute publication. Couple absent ou durée vide : None."""

    def __init__(self, matrix_dir) -> None:
        self.by_day = {}
        for d in DAY_TYPES_BY_ID:
            f = matrix_dir / f"transit_{d}.csv"
            if f.exists():
                m = pd.read_csv(f, dtype={"from_id": str, "to_id": str})
                self.by_day[d] = {(r.from_id, r.to_id): (r.out, r.ret) for r in m.itertuples(index=False)}

    def value(self, trip: Trip) -> int | None:
        day = self.by_day.get(trip.day)
        if day is None or (trip.insee, trip.pole_id) not in day:
            return None
        v = day[(trip.insee, trip.pole_id)][0 if trip.leg == "out" else 1]
        return None if pd.isna(v) else int(v)


def load_07d():
    spec = importlib.util.spec_from_file_location("m07d", PIPELINE_DIR / "scripts" / "07d_navitia_crosscheck.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stratum_of(status_gtfs: str, status_ref: str) -> str:
    if status_gtfs == "short":
        return "short_gtfs"
    if status_ref == "short":
        return "short_navitia_only"
    if status_ref == "verified":
        return "verified"
    if status_ref == "partly_unverified":
        return "unverified"
    return "no_transfer"


def weighted_share(flags: pd.Series, weights: pd.Series) -> float | None:
    if flags.empty or weights.sum() == 0:
        return None
    return float((flags.astype(float) * weights).sum() / weights.sum())


def describe(sub: pd.DataFrame, col: str) -> dict[str, Any]:
    d = sub[col].dropna()
    if d.empty:
        return {"n": 0}
    a = d.abs()
    return {"n": len(d), "median_signed_min": float(d.median()), "median_abs_min": float(a.median()),
            "p90_abs_min": float(a.quantile(0.9)), "share_within_5_min": float((a <= 5).mean()),
            "share_starway_shorter_by_more_than_5": float((d < -5).mean())}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--per-stratum", type=int, default=40)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--max-requests", type=int, default=620)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--starway-matrix-dir", type=Path, default=None,
                    help="durées STARWAY lues dans cette matrice brute (transit_{journée}.csv) au lieu des fichiers "
                         "publiés : rejouer le tirage sur un recalcul D-031 (avec --offline)")
    ap.add_argument("--out-suffix", default="", help="suffixe des fichiers de sortie (ex. _d031)")
    args = ap.parse_args()
    out_csv = OUT_CSV.with_name(OUT_CSV.stem + args.out_suffix + OUT_CSV.suffix)
    out_summary = OUT_SUMMARY.with_name(OUT_SUMMARY.stem + args.out_suffix + OUT_SUMMARY.suffix)
    if args.starway_matrix_dir is not None and not args.out_suffix:
        raise SystemExit("--starway-matrix-dir : donner --out-suffix (le tirage publié n'est jamais écrasé)")

    m07d = load_07d()
    sw = m07d.Starway(WALK_SETTING_DEFAULT)
    mv = None if args.starway_matrix_dir is None else MatrixValues(args.starway_matrix_dir.expanduser().resolve())
    pop = pd.read_csv(TRIPS_ALL, dtype={"insee": str})
    pop["stratum"] = [f"{stratum_of(g, r)}|{d}" for g, r, d in
                      zip(pop["status_gtfs"], pop["status_reference"], pop["day"], strict=True)]
    rng = np.random.default_rng(args.seed)
    sizes = pop["stratum"].value_counts().to_dict()
    picked = []
    for s in sorted(sizes):
        sub = pop[pop["stratum"] == s].sort_values(["insee", "pole", "day", "dir"]).reset_index(drop=True)
        k = min(args.per_stratum, len(sub))
        picked.append(sub.iloc[sorted(rng.choice(len(sub), size=k, replace=False))])
    sample = pd.concat(picked, ignore_index=True)
    print(f"Population {len(pop)} trajets, {len(sizes)} strates, échantillon {len(sample)} trajets")
    if args.dry_run:
        print(sample["stratum"].value_counts().sort_index().to_dict())
        return 0

    lim = WALK_SETTINGS_M[WALK_SETTING_DEFAULT]
    settings = aligned_settings(SPEED_WALKING_KMH, MAX_TRIP_MIN, lim, m07d.R5_MAX_PUBLIC_TRANSPORT_RIDES,
                                walk_time_limit_min(lim, SPEED_WALKING_KMH))
    client = m07d.Client(args.offline, args.max_requests)
    rows = []
    for k, r in enumerate(sample.itertuples(index=False), 1):
        t = Trip(r.insee, r.pole, r.day, r.dir)
        dt = DAY_TYPES_BY_ID[t.day]
        start, end = day_bounds(SERVICE_DATE, dt.start, dt.end)
        c, p = sw.communes[t.insee], sw.pole_by_id[t.pole_id]
        here, there = coord(c["origin"]["lon"], c["origin"]["lat"]), coord(p["point"]["lon"], p["point"]["lat"])
        params = (request_params(here, there, start, "arrival", "out", settings) if t.leg == "out"
                  else request_params(there, here, end, "departure", "ret", settings))
        rec = client.get(cache_key(t, params), "/journeys", params)
        sw_min = sw.value(t)[0] if mv is None else mv.value(t)
        row = {"insee": t.insee, "pole": t.pole_id, "day": t.day, "dir": t.leg, "stratum": r.stratum,
               "starway_min": sw_min, "itinerary_min": r.itinerary_min,
               "retimed_gtfs_min": r.retimed_gtfs_min, "retimed_reference_min": r.retimed_reference_min}
        if rec is None:
            row.update({"navitia_min": None, "status": "not_requested", "reason": client.stopped})
        else:
            err = navitia_error(rec.get("body"), rec.get("status_code"))
            js = parse_journeys(rec["body"]) if rec.get("body") and not err else []
            nv = (outbound_value(js, start, OUTBOUND_STEP_MIN, OUTBOUND_LOOKBACK_MIN, MAX_TRIP_MIN) if t.leg == "out"
                  else inbound_value(js, end, MAX_TRIP_MIN))
            row.update({"navitia_min": nv.minutes, "status": "ok" if nv.minutes is not None else "navitia_none",
                        "reason": err or nv.reason})
        rows.append(row)
        if k % 50 == 0:
            print(f"  {k}/{len(sample)} trajets, {client.sent} requêtes envoyées")
    df = pd.DataFrame(rows)
    df["diff_min"] = df["starway_min"] - df["navitia_min"]
    for rule in ("gtfs", "reference"):
        df[f"diff_retimed_{rule}_min"] = df[f"retimed_{rule}_min"] - df["navitia_min"]
    df["weight"] = [sizes[s] / int((df["stratum"] == s).sum()) for s in df["stratum"]]
    df.to_csv(out_csv, index=False, encoding="utf-8")

    budgets = sorted(int(b) for b in sw.meta["budgets"])
    ok = df[df["status"] != "not_requested"]

    def flips(sub: pd.DataFrame, b: int) -> dict[str, Any]:
        s_in = sub["starway_min"].notna() & (sub["starway_min"] <= b)
        n_in = sub["navitia_min"].notna() & (sub["navitia_min"] <= b)
        return {"starway_in_navitia_out": int((s_in & ~n_in).sum()), "starway_out_navitia_in": int((~s_in & n_in).sum()),
                "starway_in": int(s_in.sum()),
                "share_of_starway_in": None if not s_in.sum() else float((s_in & ~n_in).sum() / s_in.sum()),
                "weighted_share_starway_in_navitia_out": weighted_share(s_in & ~n_in, sub["weight"])}

    by_class: dict[str, Any] = {}
    for cls in STRATA:
        sub = ok[ok["stratum"].str.startswith(cls + "|")]
        both = sub[sub["navitia_min"].notna()]
        by_class[cls] = {"population": int(sum(v for s, v in sizes.items() if s.startswith(cls + "|"))),
                         "sampled": len(sub), "navitia_none": int(sub["navitia_min"].isna().sum()),
                         "starway_vs_navitia": describe(both, "diff_min"),
                         "retimed_gtfs_vs_navitia": describe(both, "diff_retimed_gtfs_min"),
                         "retimed_reference_vs_navitia": describe(both, "diff_retimed_reference_min"),
                         "flips": {str(b): flips(sub, b) for b in budgets}}
    allb = ok[ok["navitia_min"].notna()]
    summary = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "service_date": SERVICE_DATE.isoformat(), "walk_setting": WALK_SETTING_DEFAULT,
        "seed": args.seed, "per_stratum": args.per_stratum, "strata_sizes": sizes,
        "starway_source": "fichiers publiés (access)" if mv is None else f"matrice brute {args.starway_matrix_dir}",
        "sampled": len(df), "requested_or_cached": len(ok),
        "by_class": by_class,
        "weighted_all": {"median_abs_diff_min": None if allb.empty else float(
                             weighted_quantile(list(allb["diff_min"].abs()), list(allb["weight"]), 0.5)),
                         "share_within_5_min": weighted_share(allb["diff_min"].abs() <= 5, allb["weight"]),
                         "flips": {str(b): flips(ok, b) for b in budgets}},
        "requests_sent_this_run": client.sent, "x_ratelimit_remaining_day": client.remaining_day,
        "stopped": client.stopped,
        "note": "contrôle : la borne recalée est une borne haute sur les mêmes lignes, pas un nouveau calcul",
    }
    out_summary.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    for cls, v in by_class.items():
        print(cls, v["sampled"], v["starway_vs_navitia"], {b: x["starway_in_navitia_out"] for b, x in v["flips"].items()})
    print(f"Requêtes envoyées : {client.sent} ; restant du jour : {client.remaining_day} ; arrêt : {client.stopped}")
    print(f"Écrit : {out_csv} ({len(df)} lignes), {out_summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
