"""Tracks 8 and 7: does everyone reach the same number of jobs, and how far can the search radius widen?

All jobs (not only hubs) reachable by public transport within 30 / 45 / 60 min, weekday morning peak.
Income: median disposable income per consumption unit (INSEE Filosofi 2021, via data.gouv.fr).

Outputs: outputs/tables/equal_access_*.csv, outputs/figures/09-11_*.png, data/processed/equal_access.json
"""
import json

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import BoundaryNorm, ListedColormap

from analysis import UNREACHABLE, SURFACE, INK_2, SERIES, SEQ, DEP_NAMES
from config import RAW, PROCESSED, FIGURES, TABLES

T = (30, 45, 60)


def gini(x, w):
    o = np.argsort(x)
    x, w = x[o], w[o]
    cw = np.cumsum(w) / w.sum()
    cx = np.cumsum(x * w) / (x * w).sum()
    return 1 - np.sum((cx[1:] + cx[:-1]) * np.diff(cw)) - cx[0] * cw[0]


def load_income():
    df  = pd.read_csv(RAW / "revenu_commune.csv", sep=";", dtype=str)
    col = [c for c in df.columns if c.startswith("[DISP] M")][0]
    df  = df.rename(columns={"Code géographique": "code", col: "income"})
    df["income"] = pd.to_numeric(df.income.str.replace(",", "."), errors="coerce")
    return df.set_index("code").income


def main():
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    st    = pd.read_parquet(PROCESSED / "zone_stats.parquet").set_index("code").reindex(zones.code)
    z     = np.load(PROCESSED / "tt_pt_peak.npz")
    tt    = z["tt"].astype(float)
    tt[tt < 0] = UNREACHABLE
    jobs, res = st.jobs.values, st.residents.values
    tot   = jobs.sum()

    d = zones[["code", "nom", "dep"]].copy()
    d["residents"] = res
    for t in T:
        d[f"jobs{t}"]  = (tt <= t) @ jobs
        d[f"share{t}"] = d[f"jobs{t}"] / tot
    d["gain_45_60"] = d.jobs60 - d.jobs45
    d["mult_45_60"] = d.jobs60 / d.jobs45.clip(lower=1)
    inc = load_income()
    d["income"] = d.code.map(inc)
    w = d.residents.values

    # income quintiles of employed residents (towns with income known)
    m = d.income.notna() & (d.residents > 0)
    q = d[m].sort_values("income")
    cw = np.cumsum(q.residents) / q.residents.sum()
    q["quintile"] = np.minimum((cw * 5).clip(upper=4.9999).astype(int) + 1, 5)
    d = d.merge(q[["code", "quintile"]], on="code", how="left")
    qt = q.groupby("quintile").apply(lambda g: pd.Series({
        "income_min": g.income.min(), "income_max": g.income.max(), "workers": g.residents.sum(),
        **{f"jobs{t}": np.average(g[f"jobs{t}"], weights=g.residents) for t in T}}), include_groups=False)
    qt.to_csv(TABLES / "equal_access_income_quintiles.csv")

    dep = d.groupby("dep").apply(lambda g: pd.Series({
        "workers": g.residents.sum(), **{f"jobs{t}": np.average(g[f"jobs{t}"], weights=g.residents) for t in T}}),
        include_groups=False)
    dep.to_csv(TABLES / "equal_access_department.csv")
    d.to_csv(TABLES / "equal_access_zones.csv", index=False)

    lines = []
    for t in T:
        lines.append(f"avg jobs within {t} min: {np.average(d[f'jobs{t}'], weights=w):,.0f} "
                     f"({np.average(d[f'share{t}'], weights=w):.0%} of all jobs); "
                     f"Gini across workers {gini(d[f'jobs{t}'].values, w):.2f}")
    p10, p50, p90 = [np.interp(p, np.cumsum(w[np.argsort(d.jobs45)]) / w.sum(), np.sort(d.jobs45)) for p in (.1, .5, .9)]
    lines.append(f"jobs within 45 min, workers' P10 / median / P90: {p10:,.0f} / {p50:,.0f} / {p90:,.0f}")
    lines.append("by income quintile (jobs within 45 min): " +
                 ", ".join(f"Q{i}: {v:,.0f}" for i, v in qt.jobs45.items()))
    for ring, codes in (("Paris", ["75"]), ("Inner ring", ["92", "93", "94"]), ("Outer ring", ["77", "78", "91", "95"])):
        g = d[d.dep.isin(codes)]
        lines.append(f"{ring}: jobs 30/45/60 = " + " / ".join(f"{np.average(g[f'jobs{t}'], weights=g.residents):,.0f}" for t in T) +
                     f"; +15 min (45->60) multiplies reach by "
                     f"{np.average(g.jobs60, weights=g.residents) / np.average(g.jobs45, weights=g.residents):.1f}")
    rq = d[(d.residents >= 10000)]
    lines.append(f"corr(income, jobs45) over towns >=10k workers: {np.corrcoef(rq.income.fillna(rq.income.median()), rq.jobs45)[0, 1]:.2f}")
    (TABLES / "equal_access_headlines.txt").write_text("\n".join(lines))
    print("\n".join(lines))
    print(qt.round(0))

    # 09 map: all jobs within 45 min
    fig, ax = plt.subplots(figsize=(9, 8))
    bins = [0, 10e3, 50e3, 200e3, 500e3, 1e6, 2e6, 1e9]
    cmap = ListedColormap(SEQ[::-1])
    zones.assign(v=d.jobs45.values).plot(column="v", cmap=cmap, norm=BoundaryNorm(bins, cmap.N), ax=ax,
                                         edgecolor=SURFACE, linewidth=0.15)
    ax.set_axis_off()
    ax.set_title("Jobs reachable within 45 min by public transport (all jobs, morning peak)", loc="left", fontsize=12)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=BoundaryNorm(bins, cmap.N))
    cb = fig.colorbar(sm, ax=ax, shrink=0.5, ticks=bins[:-1])
    cb.ax.set_yticklabels(["0", "10k", "50k", "200k", "500k", "1 M", "2 M+"])
    fig.savefig(FIGURES / "09_jobs_within_45min_map.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    # 10 income quintiles
    fig, ax = plt.subplots(figsize=(8, 4.2))
    x = np.arange(5)
    for k, t in enumerate(T):
        ax.bar(x + (k - 1) * 0.26, qt[f"jobs{t}"] / 1e6, width=0.24, color=SERIES[0], alpha=[0.45, 0.75, 1][k],
               label=f"within {t} min")
    ax.set_xticks(x, [f"Q{i}\n{int(a / 1000)}-{int(b / 1000)}k€" for i, a, b in zip(qt.index, qt.income_min, qt.income_max)])
    ax.set_ylabel("jobs reachable (millions)")
    ax.legend(frameon=False, fontsize=8)
    ax.set_title("Jobs reachable by income quintile of the home town", loc="left", fontsize=12)
    fig.text(0.02, -0.04, "Quintiles of employed residents by median disposable income of their commune (Filosofi 2021).",
             fontsize=7, color=INK_2)
    fig.savefig(FIGURES / "10_jobs_by_income_quintile.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    # 11 search radius: jobs at 30/45/60 by department
    g = dep.sort_values("jobs45")
    fig, ax = plt.subplots(figsize=(8, 4))
    y = np.arange(len(g))
    for k, t in enumerate(T[::-1]):
        ax.barh(y, g[f"jobs{t}"] / 1e6, color=SERIES[0], alpha=[0.3, 0.6, 1][k], height=0.6, label=f"within {t} min")
    ax.set_yticks(y, [DEP_NAMES[i] for i in g.index])
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("average jobs reachable (millions)")
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    ax.set_title("How far can the job search widen? Jobs reachable at 30, 45 and 60 min", loc="left", fontsize=12)
    fig.savefig(FIGURES / "11_search_radius_by_department.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    (PROCESSED / "equal_access.json").write_text(json.dumps({
        "zones": d[["code", "jobs30", "jobs45", "jobs60", "income", "quintile"]]
                   .assign(income=lambda x: x.income.round(0)).round(0).to_dict(orient="records"),
        "quintiles": qt.round(0).reset_index().to_dict(orient="records"),
        "deps": dep.round(0).reset_index().to_dict(orient="records"),
        "headlines": lines,
        "totalJobs": float(tot),
    }, ensure_ascii=False, default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else o))


if __name__ == "__main__":
    main()
