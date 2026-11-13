"""Tracks 4, 5, 6: car-captive towns, and where cycling or on-demand links would widen job access.

Per commune (morning peak):
    captive        : car share of out-of-commune commuters >= 70 % and < 10 % of hub jobs within 60 min by PT
    (bike rules apply only where PT reaches < 30 % of hub jobs within 45 min)
    bike_direct    : a hub within cycling range (<= 30 min at 16 km/h, x1.25 detour) while PT to it takes > 40 min,
                     or cycling reaches at least twice the jobs PT reaches in 30 min (and >= 20k)
    bike_rail      : biking to a rail / metro / tram stop (<= 4 km) adds >= 5 pts of hub jobs within 45 min
    on_demand      : captive and none of the above (no cycling answer): demand-responsive transport / express bus
Outputs: outputs/tables/solutions_*.csv, outputs/figures/15-16_*.png, data/processed/solutions.json
"""
import json

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Patch

from analysis import UNREACHABLE, SURFACE, INK_2, SERIES
from config import PROCESSED, FIGURES, TABLES

BIKE_SPEED, BIKE_DETOUR = 16 / 3.6, 1.25
BIKE_30 = 30 * 60 * BIKE_SPEED / BIKE_DETOUR      # straight-line metres reachable in 30 min
WEAK_PT = 0.30                                      # only towns reaching < 30 % of hub jobs in 45 min by PT
CLASSES = {"bike_direct": ("Bike lane to a nearby hub", SERIES[0]),
           "bike_rail":   ("Bike + train (park at the station)", SERIES[2]),
           "on_demand":   ("On-demand transport / express bus", SERIES[1])}


def load(name):
    tt = np.load(PROCESSED / name)["tt"].astype(float)
    tt[tt < 0] = UNREACHABLE
    return tt


def main():
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    hubs  = gpd.read_file(PROCESSED / "hubs.gpkg")
    rv    = pd.read_csv(TABLES / "residential_zones_access.csv", dtype={"code": str, "dep": str}).set_index("code").reindex(zones.code)
    st    = pd.read_parquet(PROCESSED / "zone_stats.parquet").set_index("code").reindex(zones.code)
    tt, ttb = load("tt_pt_peak.npz"), load("tt_pt_bike_peak.npz")
    idx  = {c: i for i, c in enumerate(zones.code)}
    pts  = np.c_[zones.px.values, zones.py.values]
    dist = np.hypot(pts[:, None, 0] - pts[None, :, 0], pts[:, None, 1] - pts[None, :, 1])
    jobs = st.jobs.values

    hub_cols = np.array([idx[c] for c in hubs.code])
    hj       = hubs.jobs.values
    d = zones[["code", "nom", "dep"]].copy()
    d["residents"]    = st.residents.values
    d["car_out"]      = rv.share_car_out.values
    d["hub60"]        = rv.hub_share_60.values
    d["hub45_pt"]     = (tt[:, hub_cols] <= 45) @ hj / hj.sum()
    d["hub45_bikept"] = (np.minimum(tt, ttb)[:, hub_cols] <= 45) @ hj / hj.sum()
    d["jobs30_pt"]    = (tt <= 30) @ jobs
    d["jobs30_bike"]  = (dist <= BIKE_30) @ jobs
    near = (dist[:, hub_cols] <= BIKE_30) & (tt[:, hub_cols] > 40)
    d["bike_hub"]     = [", ".join(sorted(set(hubs.hub.values[row]))) for row in near]

    d["captive"]     = (d.car_out >= 0.70) & (d.hub60 < 0.10)
    weak = d.hub45_pt < WEAK_PT
    d["bike_direct"] = weak & (near.any(axis=1) | ((d.jobs30_bike >= 2 * d.jobs30_pt) & (d.jobs30_bike >= 20_000)))
    d["bike_rail"]   = weak & ((d.hub45_bikept - d.hub45_pt) >= 0.05)
    cls = np.where(d.bike_direct, "bike_direct", np.where(d.bike_rail, "bike_rail",
                   np.where(d.captive, "on_demand", "none")))
    d["solution"] = np.where(d.residents >= 500, cls, "none")
    d.to_csv(TABLES / "solutions_zones.csv", index=False)

    w = d.residents
    summ = d.groupby("solution").agg(towns=("code", "size"), workers=("residents", "sum"))
    summ.to_csv(TABLES / "solutions_summary.csv")
    lines = [f"car-captive towns: {d.captive.sum()} towns, {w[d.captive].sum():,.0f} employed residents "
             f"({w[d.captive].sum() / w.sum():.0%} of the region's workers)"]
    for k, (lab, _) in CLASSES.items():
        g = d[d.solution == k]
        lines.append(f"{lab}: {len(g)} towns, {g.residents.sum():,.0f} workers; top: " +
                     ", ".join(g.sort_values("residents", ascending=False).nom.head(6)))
    lines.append(f"bike + train: avg hub jobs within 45 min {np.average(d.hub45_pt, weights=w):.1%} -> "
                 f"{np.average(d.hub45_bikept, weights=w):.1%}; outer ring "
                 f"{np.average(d.hub45_pt[d.dep.isin(['77','78','91','95'])], weights=w[d.dep.isin(['77','78','91','95'])]):.1%} -> "
                 f"{np.average(d.hub45_bikept[d.dep.isin(['77','78','91','95'])], weights=w[d.dep.isin(['77','78','91','95'])]):.1%}")
    (TABLES / "solutions_headlines.txt").write_text("\n".join(lines))
    print("\n".join(lines))
    print(summ)

    # 15 map of candidate solutions (colour + hatch, not colour alone)
    fig, ax = plt.subplots(figsize=(9, 8))
    zones.plot(ax=ax, color="#efeeea", edgecolor=SURFACE, linewidth=0.15)
    hatch = {"bike_direct": "", "bike_rail": "////", "on_demand": "...."}
    for k, (lab, col) in CLASSES.items():
        sub = zones[d.solution.values == k]
        if len(sub):
            sub.plot(ax=ax, color=col, edgecolor=SURFACE, linewidth=0.2, hatch=hatch[k], alpha=0.9)
    hubs.dissolve("hub").boundary.plot(ax=ax, color="#0b0b0b", linewidth=0.6)
    ax.set_axis_off()
    ax.legend(handles=[Patch(facecolor=c, hatch=hatch[k], label=l, edgecolor=SURFACE) for k, (l, c) in CLASSES.items()],
              frameon=False, fontsize=8, loc="lower left")
    ax.set_title("Where complementary solutions would widen job access without a car", loc="left", fontsize=12)
    fig.text(0.02, 0.02, "Black outlines: job hubs. Rules in src/solutions.py.", fontsize=7, color=INK_2)
    fig.savefig(FIGURES / "15_solutions_map.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    (PROCESSED / "solutions.json").write_text(json.dumps({
        "zones": d[["code", "car_out", "hub45_pt", "hub45_bikept", "jobs30_pt", "jobs30_bike", "solution", "bike_hub"]]
                   .round(3).to_dict(orient="records"),
        "summary": summ.reset_index().to_dict(orient="records"),
        "headlines": lines,
    }, ensure_ascii=False, default=float))


if __name__ == "__main__":
    main()
