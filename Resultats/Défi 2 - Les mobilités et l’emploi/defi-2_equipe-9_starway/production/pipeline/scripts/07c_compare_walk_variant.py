"""07c - Compare la matrice TC publiée (04) et une matrice « réglage de marche » (04e, D-024).

Lecture seule (aucun r5py) : data/interim/matrix/transit_{day}.csv et data/interim/matrix_walk{L}/transit_{day}.csv,
passées par la règle d'export de 06 (durée > MAX_TRIP_MIN -> null). Contrôle d'abord que les deux calculs ont les
mêmes paramètres (GTFS, OSM, date, points D-017, grille, vitesses, modes) ; seuls le jar R5 et la marche diffèrent.
Les réglages (1 000 m, 3 000 m) sont des CHOIX DE L'ÉQUIPE (D-024), pas des données.

Sorties (data/processed/, petites, versionnables), {tag} = walk{L} :
    compare_{tag}_summary.csv    une ligne par journée-type : trajets trouvés en plus, perdus (dont tout à pied),
                                 plus courts, plus longs ; communes sans aucun retour ; retours D-023 retrouvés
    compare_{tag}_verdicts.csv   journée-type x budget (pas OUTBOUND_STEP_MIN, de 5 à MAX_TRIP_MIN) : verdicts changés
    compare_{tag}_communes.csv   communes qui gagnent un premier retour ou perdent tous leurs retours (catégorie 07b)
    compare_{tag}_focus.csv      détail par pôle des communes de --focus, pour chaque journée
Usage :
    python scripts/07c_compare_walk_variant.py --setting normal
    python scripts/07c_compare_walk_variant.py --setting comfort
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from starway.config import (
    FRONT_DATA_DIR,
    INTERIM_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_STEP_MIN,
    PROCESSED_DIR,
    REPO_ROOT,
    SERVICE_DATE,
    WALK_SETTINGS_M,
)
from starway.matrix_io import cap_to_max_trip
from starway.routing import day_bounds
from starway.variant_compare import (
    day_summary,
    lost_walk_only,
    matrix_errors,
    no_return_communes,
    paired,
    verdict_changes,
)

# paramètres qui doivent être identiques entre la matrice publiée et la variante
SAME_PARAMS = ("processing_version", "service_date", "gtfs_sha256", "osm_sha256", "outbound_step_min",
               "outbound_lookback_min", "max_trip_min", "speed_walking_kmh", "speed_cycling_kmh", "batch_size",
               "r5py_defaults", "origins_sha256", "n_origins", "origin_point_rule", "origin_points_sha256")
WALK_LIMIT_REASON = "no_stop_within_walk_limit"


def check_params(pub: dict, var: dict) -> list[str]:
    errs = [f"{k} : publié {pub.get(k)!r}, variante {var.get(k)!r}" for k in SAME_PARAMS if pub.get(k) != var.get(k)]
    if pub.get("mode_legs", {}).get("transit") != var.get("mode_legs", {}).get("transit"):
        errs.append("mode_legs.transit différent")
    if var.get("walk_distance_limit_meters") != var.get("walk_leg_limit_m"):
        errs.append("limite du jar différente du réglage")
    return errs


def load(run_dir: Path, name: str) -> pd.DataFrame:
    df = pd.read_csv(run_dir / f"{name}.csv", dtype={"from_id": str, "to_id": str, "reason": str})
    return cap_to_max_trip(df)


def published_marks(access_dir: Path, pole_ids: list[str], day: str) -> pd.DataFrame:
    """Couples TC publiés dont le retour est « non mesuré » (D-023) : raison du pôle ou clé de série walk_limit."""
    rows = []
    for f in sorted(access_dir.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        s = d.get("modes", {}).get("transit", {}).get(day)
        if not s:
            continue
        for i, pid in enumerate(pole_ids):
            if s["ret"][i] is None and (s["reason"][i] == WALK_LIMIT_REASON or s.get("walk_limit")):
                rows.append({"from_id": d["insee"], "to_id": pid, "pole_reason": s["reason"][i] == WALK_LIMIT_REASON})
    return pd.DataFrame(rows, columns=["from_id", "to_id", "pole_reason"])


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--setting", required=True, choices=list(WALK_SETTINGS_M))
    p.add_argument("--pub-dir", type=Path, default=INTERIM_DIR / "matrix")
    p.add_argument("--var-dir", type=Path, default=None, help="défaut : data/interim/matrix_walk{L}")
    p.add_argument("--published-access", type=Path, default=FRONT_DATA_DIR / "access",
                   help="export publié, pour retrouver les retours marqués D-023")
    p.add_argument("--days", nargs="*", default=["d06", "d09", "d14"])
    p.add_argument("--focus", nargs="*", default=["78396", "78358"], help="communes détaillées pôle par pôle")
    p.add_argument("--out-dir", type=Path, default=PROCESSED_DIR)
    args = p.parse_args()
    limit_m = WALK_SETTINGS_M[args.setting]
    tag = f"walk{limit_m}"
    pub_dir, var_dir, out_dir, acc_dir = (x if x.is_absolute() else REPO_ROOT / x for x in (
        args.pub_dir, args.var_dir or INTERIM_DIR / f"matrix_{tag}", args.out_dir, args.published_access))

    var_params = json.loads((var_dir / "run_params.json").read_text(encoding="utf-8"))
    errs = check_params(json.loads((pub_dir / "run_params.json").read_text(encoding="utf-8")), var_params)
    if var_params.get("walk_leg_limit_m") != limit_m:
        errs.append(f"réglage du calcul {var_params.get('walk_leg_limit_m')} m, attendu {limit_m} m")
    if errs:
        print("Paramètres incompatibles :\n- " + "\n- ".join(errs), file=sys.stderr)
        return 1
    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    pole_ids = [x["id"] for x in poles]
    jobs = pd.Series({x["id"]: x["jobs"] for x in poles})
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    names = communes.set_index("insee")["name"]
    egress_path = PROCESSED_DIR / "egress_limit_2026.csv"
    egress = pd.read_csv(egress_path, dtype={"insee": str}) if egress_path.exists() else None
    walk = load(pub_dir, "walk_any")

    out_dir.mkdir(parents=True, exist_ok=True)
    budgets = list(range(OUTBOUND_STEP_MIN, MAX_TRIP_MIN + 1, OUTBOUND_STEP_MIN))
    summaries, verdicts, changed, focus = [], [], [], []
    failed = False
    for day in args.days:
        var_raw = pd.read_csv(var_dir / f"transit_{day}.csv", dtype={"from_id": str, "to_id": str, "reason": str})
        start, _ = day_bounds(SERVICE_DATE, day)
        errs = matrix_errors(var_raw, pd.Timestamp(start))
        print(f"{day} contrôles de la variante : {'OK' if not errs else errs}")
        failed |= bool(errs)
        m = paired(load(pub_dir, f"transit_{day}"), load(var_dir, f"transit_{day}"))
        s = {"setting": args.setting, "limit_m": limit_m, "day": day, **day_summary(m),
             "out_lost_walk_only": lost_walk_only(m, walk, "out"), "ret_lost_walk_only": lost_walk_only(m, walk, "ret")}
        marks = published_marks(acc_dir, pole_ids, day) if acc_dir.exists() else pd.DataFrame(columns=["from_id", "to_id",
                                                                                                         "pole_reason"])
        mk = m.merge(marks, on=["from_id", "to_id"], how="inner")
        s.update({"d023_unmeasured_ret": len(mk), "d023_ret_found_var": int(mk["ret_var"].notna().sum()),
                  "d023_pole_reason": int(mk["pole_reason"].sum()),
                  "d023_pole_reason_ret_found_var": int((mk["pole_reason"] & mk["ret_var"].notna()).sum())})
        summaries.append(s)
        v = verdict_changes(m, budgets, jobs)
        v.insert(0, "day", day)
        verdicts.append(v)
        none_pub, none_var = no_return_communes(m, "ret_pub"), no_return_communes(m, "ret_var")
        for kind, codes in (("first_return", none_pub - none_var), ("lost_all_returns", none_var - none_pub)):
            for insee in sorted(codes):
                sub = m[m["from_id"] == insee]
                row = {"day": day, "change": kind, "insee": insee, "name": names.get(insee),
                       "poles_ret_pub": int(sub["ret_pub"].notna().sum()), "poles_ret_var": int(sub["ret_var"].notna().sum())}
                if egress is not None:
                    e = egress[(egress["insee"] == insee) & (egress["day"] == day)]
                    row["category_07b"] = e["category"].iloc[0] if len(e) else None
                    row["nearest_m_07b"] = (int(e["nearest_m"].iloc[0])
                                            if len(e) and pd.notna(e["nearest_m"].iloc[0]) else None)
                changed.append(row)
        f = m[m["from_id"].isin(args.focus)].copy()
        f.insert(0, "day", day)
        f["pole_jobs"] = f["to_id"].map(jobs)
        focus.append(f)
        print(f"{day} : {s}")

    pd.DataFrame(summaries).to_csv(out_dir / f"compare_{tag}_summary.csv", index=False)
    vv = pd.concat(verdicts)
    vv.to_csv(out_dir / f"compare_{tag}_verdicts.csv", index=False)
    cc = pd.DataFrame(changed)
    cc.to_csv(out_dir / f"compare_{tag}_communes.csv", index=False)
    pd.concat(focus).to_csv(out_dir / f"compare_{tag}_focus.csv", index=False)
    print(vv[vv["budget"].isin([30, 45, 60, 90, 120])].to_string(index=False))
    if len(cc) and "category_07b" in cc:
        print(cc.groupby(["day", "change", "category_07b"]).size().to_string())
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
