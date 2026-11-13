"""07k - Banc D-031 (a1, a2) : matrices TC « normal » du banc comparées entre elles, à la matrice d'origine et à Navitia.

CONTRÔLE seulement, sans Java ni requête : lit les matrices brutes (`transit_{journée}.csv` de 04e) du banc
(`data/interim/d031_bench/matrix_{r5,gtfs,gtfs_navitia}/`, voir tools/vm/d031_bench.sh) et la matrice « normal » du
moteur d'origine (`data/interim/matrix_walk3000/`, publiée), puis le recoupement Navitia de la visite et des
découvertes (07d, `data/processed/navitia_crosscheck_walk3000.csv`, réponses en cache).

Mesures :
- `noop` : le jar corrigé sans règle chargée (r5) redonne-t-il la matrice d'origine (mêmes couples, mêmes minutes) ?
- par règle (gtfs = a1, gtfs_navitia = a1 + a2), contre la matrice d'origine sur les communes du banc : sens dont la
  durée change, écart (médiane, 90e centile, maximum), plus courts (attendu : rares), durées perdues ;
  verdicts « allumé » (aller ET retour <= budget) gagnés ou perdus à 30, 45, 60 min ;
- recoupement 07d : écart STARWAY moins Navitia avant et après, à 5 min près, verdicts à 60 min contredits.

Sortie : `data/processed/d031_bench_summary.json`. Logique pure : `compare_values`, `verdict_changes` (tests).

Usage : python scripts/07k_d031_bench_compare.py [--bench-dir data/interim/d031_bench]
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from starway.config import DAY_TYPES_BY_ID, INTERIM_DIR, PROCESSED_DIR

BASE = INTERIM_DIR / "matrix_walk3000"
CROSSCHECK = PROCESSED_DIR / "navitia_crosscheck_walk3000.csv"
OUT = PROCESSED_DIR / "d031_bench_summary.json"
RULES = ("r5", "gtfs", "gtfs_navitia")
BUDGETS = (30, 45, 60)
LEG = {"aller": "out", "retour": "ret"}


def read_matrix(d: Path) -> pd.DataFrame | None:
    """Matrice brute de 04 / 04e en format long : insee, pole, day, out, ret (Int64, vide = aucune durée)."""
    parts = []
    for day in DAY_TYPES_BY_ID:
        f = d / f"transit_{day}.csv"
        if not f.exists():
            return None
        m = pd.read_csv(f, dtype={"from_id": str, "to_id": str})
        m = m.rename(columns={"from_id": "insee", "to_id": "pole"})[["insee", "pole", "out", "ret"]]
        m["day"] = day
        parts.append(m)
    out = pd.concat(parts, ignore_index=True)
    for c in ("out", "ret"):
        out[c] = out[c].astype("Int64")
    return out


def compare_values(base: pd.Series, new: pd.Series) -> dict[str, Any]:
    """Deux séries alignées de durées (Int64, NA = aucune durée) : comptes et écarts (nouvelle - base)."""
    both = base.notna() & new.notna()
    d = (new[both] - base[both]).astype(float)
    return {"n": len(base), "both": int(both.sum()), "changed": int((d != 0).sum()),
            "longer": int((d > 0).sum()), "shorter": int((d < 0).sum()),
            "lost": int((base.notna() & new.isna()).sum()), "gained": int((base.isna() & new.notna()).sum()),
            "delta_median_min": None if d[d != 0].empty else float(d[d != 0].median()),
            "delta_p90_min": None if d[d != 0].empty else float(d[d != 0].quantile(0.9)),
            "delta_max_min": None if d.empty else float(d.max()),
            "delta_min_min": None if d.empty else float(d.min())}


def lit(out: pd.Series, ret: pd.Series, budget: int) -> pd.Series:
    return (out.notna() & ret.notna() & (out.fillna(10**6) <= budget) & (ret.fillna(10**6) <= budget)).astype(bool)


def verdict_changes(m: pd.DataFrame, budgets=BUDGETS) -> dict[str, Any]:
    """`m` : colonnes out_base, ret_base, out_new, ret_new ; verdicts allumés avant / après par budget."""
    res = {}
    for b in budgets:
        before, after = lit(m["out_base"], m["ret_base"], b), lit(m["out_new"], m["ret_new"], b)
        res[str(b)] = {"lit_before": int(before.sum()), "lit_after": int(after.sum()),
                       "lost": int((before & ~after).sum()), "gained": int((~before & after).sum())}
    return res


def describe_diff(d: pd.Series) -> dict[str, Any]:
    d = d.dropna().astype(float)
    if d.empty:
        return {"n": 0}
    return {"n": len(d), "median_signed_min": float(d.median()), "median_abs_min": float(d.abs().median()),
            "share_within_5_min": float((d.abs() <= 5).mean()),
            "share_starway_shorter_by_more_than_5": float((d < -5).mean())}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bench-dir", type=Path, default=INTERIM_DIR / "d031_bench")
    args = ap.parse_args()
    base = read_matrix(BASE)
    if base is None:
        raise SystemExit(f"matrice d'origine absente : {BASE}")
    mats = {r: read_matrix(args.bench_dir / f"matrix_{r}") for r in RULES}
    summary: dict[str, Any] = {"generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                               "base": BASE.name, "bench_dir": args.bench_dir.name,
                               "available": [r for r, m in mats.items() if m is not None]}
    key = ["insee", "pole", "day"]
    for rule, m in mats.items():
        if m is None:
            continue
        j = base.merge(m, on=key, suffixes=("_base", "_new"), how="inner")
        params = json.loads((args.bench_dir / f"matrix_{rule}" / "run_params.json").read_text(encoding="utf-8"))
        entry: dict[str, Any] = {"communes": int(j["insee"].nunique()), "pairs": len(j),
                                 "transfer_rules": params.get("transfer_rules", "r5"),
                                 "r5_jar_sha256": params.get("r5_jar_sha256")}
        for leg in ("out", "ret"):
            entry[leg] = {d: compare_values(g[f"{leg}_base"], g[f"{leg}_new"]) for d, g in j.groupby("day")}
            entry[leg]["all"] = compare_values(j[f"{leg}_base"], j[f"{leg}_new"])
        entry["verdicts"] = {d: verdict_changes(g) for d, g in j.groupby("day")}
        entry["verdicts"]["all"] = verdict_changes(j)
        if rule == "r5":
            entry["noop_identical"] = bool(entry["out"]["all"]["changed"] == 0 and entry["ret"]["all"]["changed"] == 0
                                           and entry["out"]["all"]["lost"] == entry["out"]["all"]["gained"] == 0
                                           and entry["ret"]["all"]["lost"] == entry["ret"]["all"]["gained"] == 0)
        summary[rule] = entry

    if CROSSCHECK.exists():
        cc = pd.read_csv(CROSSCHECK, dtype={"insee": str})
        cc = cc[cc["leg"].isin(LEG)].copy()
        cc["dir"] = cc["leg"].map(LEG)
        rows = []
        for r in cc.itertuples(index=False):
            row = {"insee": r.insee, "pole": r.pole_id, "day": r.day, "dir": r.dir, "navitia_min": r.navitia_min,
                   "published_min": r.starway_min, "group": r.samples}
            for rule, m in mats.items():
                if m is None:
                    continue
                hit = m[(m["insee"] == r.insee) & (m["pole"] == r.pole_id) & (m["day"] == r.day)]
                row[f"{rule}_min"] = None if hit.empty or pd.isna(hit.iloc[0][r.dir]) else int(hit.iloc[0][r.dir])
            rows.append(row)
        x = pd.DataFrame(rows)
        x.to_csv(PROCESSED_DIR / "d031_bench_crosscheck.csv", index=False, encoding="utf-8")
        cmp = {"trips": len(x), "published_vs_navitia": describe_diff(x["published_min"] - x["navitia_min"])}
        for rule in RULES:
            col = f"{rule}_min"
            if col in x:
                # mêmes trajets des deux côtés : une durée chez Navitia et dans la matrice de la règle
                sub = x[x[col].notna() & x["navitia_min"].notna()]
                cmp[rule] = {"trips": len(sub),
                             "published_vs_navitia": describe_diff(sub["published_min"] - sub["navitia_min"]),
                             "rule_vs_navitia": describe_diff(pd.to_numeric(sub[col]) - sub["navitia_min"])}
        summary["crosscheck_07d"] = cmp
        story = x[(x["insee"].isin(["78358", "78418"]))]
        summary["story_trips"] = json.loads(story.to_json(orient="records"))
    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    for rule in RULES:
        if rule in summary:
            e = summary[rule]
            print(rule, e["communes"], "communes ;", "aller", e["out"]["all"], "; retour", e["ret"]["all"],
                  "; verdicts", e["verdicts"]["all"], "; identique" if e.get("noop_identical") else "")
    if "crosscheck_07d" in summary:
        print(json.dumps(summary["crosscheck_07d"], ensure_ascii=False))
    print(f"Écrit : {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
