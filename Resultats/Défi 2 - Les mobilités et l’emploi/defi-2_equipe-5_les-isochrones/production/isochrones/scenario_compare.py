"""Compare hub access today vs with the Grand Paris Express (lines 15, 16, 17, 18).

Outputs: outputs/tables/scenario_*.csv, outputs/figures/07-08_*.png, data/processed/scenario.json
"""
import json

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import BoundaryNorm, ListedColormap

from analysis import (UNREACHABLE, SURFACE, INK, INK_2, SERIES, SEQ, DEP_NAMES, hub_matrix)
from config import PROCESSED, FIGURES, TABLES

GAIN = ["#e9e8e4", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]


def load_tt(name):
    z  = np.load(PROCESSED / name)
    tt = z["tt"].astype(float)
    tt[tt < 0] = UNREACHABLE
    return tt


def share_within(tt, zones, hubs, t):
    idx  = {c: i for i, c in enumerate(zones.code)}
    cols = np.array([idx[c] for c in hubs.code])
    return (tt[:, cols] <= t) @ hubs.jobs.values / hubs.jobs.sum()


def main():
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    hubs  = gpd.read_file(PROCESSED / "hubs.gpkg")
    st    = pd.read_parquet(PROCESSED / "zone_stats.parquet").set_index("code").reindex(zones.code)
    res   = st.residents.values
    t0, t1 = load_tt("tt_pt_peak.npz"), load_tt("tt_pt_peak_gpe.npz")

    names, h0, hjobs = hub_matrix(zones, hubs, t0)
    _,     h1, _     = hub_matrix(zones, hubs, t1)

    # per hub
    rows = []
    for k, h in enumerate(names):
        r = {"hub": h, "jobs": hjobs[k]}
        for t in (45, 60):
            r[f"catch_{t}_today"] = res[h0[:, k] <= t].sum() / res.sum()
            r[f"catch_{t}_gpe"]   = res[h1[:, k] <= t].sum() / res.sum()
        r["avg_min_today"] = np.average(np.minimum(h0[:, k], 120), weights=res)
        r["avg_min_gpe"]   = np.average(np.minimum(h1[:, k], 120), weights=res)
        rows.append(r)
    hv = pd.DataFrame(rows)
    hv["gain_45_pts"] = (hv.catch_45_gpe - hv.catch_45_today) * 100
    hv.to_csv(TABLES / "scenario_hub_catchment.csv", index=False)

    # per zone
    z = zones[["code", "nom", "dep"]].copy()
    z["residents"] = res
    for t in (45, 60):
        z[f"s{t}_today"] = share_within(t0, zones, hubs, t)
        z[f"s{t}_gpe"]   = share_within(t1, zones, hubs, t)
    jobs = st.jobs.values
    for t in (45, 60):
        z[f"jobs{t}_today"] = (t0 <= t) @ jobs
        z[f"jobs{t}_gpe"]   = (t1 <= t) @ jobs
    z["gain45"] = z.s45_gpe - z.s45_today
    z["gain60"] = z.s60_gpe - z.s60_today
    z.to_csv(TABLES / "scenario_zone_change.csv", index=False)

    dep = z.groupby("dep").apply(lambda g: pd.Series({
        "s45_today": np.average(g.s45_today, weights=g.residents) * 100,
        "s45_gpe":   np.average(g.s45_gpe,   weights=g.residents) * 100,
        "s60_today": np.average(g.s60_today, weights=g.residents) * 100,
        "s60_gpe":   np.average(g.s60_gpe,   weights=g.residents) * 100}), include_groups=False)
    dep.to_csv(TABLES / "scenario_department.csv")

    lines = [
        f"avg share of hub jobs within 45 min: today {np.average(z.s45_today, weights=res):.1%}, "
        f"with GPE {np.average(z.s45_gpe, weights=res):.1%}",
        f"avg share within 60 min: today {np.average(z.s60_today, weights=res):.1%}, "
        f"with GPE {np.average(z.s60_gpe, weights=res):.1%}",
        f"workers whose zone gains >=10 pts (45 min): {res[z.gain45 >= .10].sum():,.0f}",
        f"avg number of all jobs within 45 min: today {np.average(z.jobs45_today, weights=res):,.0f}, "
        f"with GPE {np.average(z.jobs45_gpe, weights=res):,.0f} "
        f"(+{np.average(z.jobs45_gpe, weights=res) / np.average(z.jobs45_today, weights=res) - 1:.1%})",
        f"avg number of all jobs within 60 min: today {np.average(z.jobs60_today, weights=res):,.0f}, "
        f"with GPE {np.average(z.jobs60_gpe, weights=res):,.0f} "
        f"(+{np.average(z.jobs60_gpe, weights=res) / np.average(z.jobs60_today, weights=res) - 1:.1%})",
    ]
    ring = z.dep.map({"75": "Paris", "92": "Inner ring", "93": "Inner ring", "94": "Inner ring"}).fillna("Outer ring")
    for r, g in z.groupby(ring):
        a, b = np.average(g.jobs45_today, weights=g.residents), np.average(g.jobs45_gpe, weights=g.residents)
        lines.append(f"  {r}: all jobs within 45 min {a:,.0f} -> {b:,.0f} (+{b / a - 1:.1%})")
    (TABLES / "scenario_headlines.txt").write_text("\n".join(lines))
    print("\n".join(lines))
    print(hv.sort_values("gain_45_pts", ascending=False).round(3).to_string(index=False))
    print(dep.round(1))
    big = z[z.residents >= 10000].sort_values("gain45", ascending=False).head(15)
    print(big[["nom", "dep", "s45_today", "s45_gpe", "gain45"]].round(3).to_string(index=False))

    # figures
    fig, ax = plt.subplots(figsize=(9, 8))
    bins = [-1, 0.01, 0.05, 0.10, 0.20, 0.30, 0.45, 2]
    cmap = ListedColormap(GAIN)
    zones.assign(g=z.gain45.values).plot(column="g", cmap=cmap, norm=BoundaryNorm(bins, cmap.N),
                                         ax=ax, edgecolor=SURFACE, linewidth=0.15)
    hubs.dissolve("hub").boundary.plot(ax=ax, color=SERIES[1], linewidth=0.8)
    ax.set_axis_off()
    ax.set_title("Gain in hub jobs reachable within 45 min with lines 15, 16, 17 and 18\n"
                 "(percentage points of all hub jobs, morning peak)", loc="left", fontsize=12)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=BoundaryNorm(bins, cmap.N))
    cb = fig.colorbar(sm, ax=ax, shrink=0.5, ticks=bins[:-1])
    cb.ax.set_yticklabels(["none", "+1", "+5", "+10", "+20", "+30", "+45"])
    fig.text(0.02, 0.02, "Scenario: today's IDFM timetable + synthetic GPE timetables (stations: SGP; speeds and "
             "frequencies assumed).", fontsize=7, color=INK_2)
    fig.savefig(FIGURES / "07_gpe_gain_map.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    d = hv.sort_values("catch_45_gpe")
    fig, ax = plt.subplots(figsize=(8, 0.3 * len(d) + 1.2))
    y = np.arange(len(d))
    ax.hlines(y, d.catch_45_today * 100, d.catch_45_gpe * 100, color=INK_2, lw=1, alpha=0.5)
    ax.scatter(d.catch_45_today * 100, y, color=SERIES[0], s=28, zorder=3, label="today")
    ax.scatter(d.catch_45_gpe * 100, y, color=SERIES[1], s=28, zorder=3, label="with lines 15-18")
    ax.set_yticks(y, d.hub, fontsize=8)
    ax.set_xlim(0, 100)
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("% of the region's employed residents who reach the hub within 45 min")
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    ax.set_title("Which hubs the new metro lines open up", loc="left", fontsize=12)
    fig.savefig(FIGURES / "08_gpe_hub_catchment.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    (PROCESSED / "scenario.json").write_text(json.dumps({
        "hubs": hv.round(4).to_dict(orient="records"),
        "zones": z[["code", "s45_today", "s45_gpe", "s60_today", "s60_gpe"]].round(3).to_dict(orient="records"),
        "deps": dep.round(1).reset_index().to_dict(orient="records"),
        "toHubGpe": np.minimum(h1, 121).round().astype(int).tolist(),
        "headlines": lines,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
