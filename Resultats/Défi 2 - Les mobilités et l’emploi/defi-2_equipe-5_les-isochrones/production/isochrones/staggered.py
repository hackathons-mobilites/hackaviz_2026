"""Tracks 2, 3, 9: is the network usable for staggered hours (early morning, late evening, Sunday)?

Matrices (weekday = Tue 17 Nov 2026, Sunday = 22 Nov 2026, median of departures every 5 min):
    peak     weekday 07:00-09:00   outbound (home -> work)
    early    weekday 04:30-06:00   outbound, early shifts
    sunday   Sunday  07:00-09:00   outbound
    evening  weekday 17:00-19:00   return (work -> home), normal hours
    late     weekday 22:00-00:30   return after a late shift
Outputs: outputs/tables/staggered_*.csv, outputs/figures/12-14_*.png, data/processed/staggered.json
"""
import json

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import BoundaryNorm, ListedColormap

from analysis import UNREACHABLE, SURFACE, INK_2, SERIES, SEQ, weighted_quantile
from config import PROCESSED, FIGURES, TABLES

SCEN = {"peak": "tt_pt_peak.npz", "early": "tt_pt_early.npz", "sunday": "tt_pt_sunday.npz",
        "evening": "tt_pt_evening.npz", "late": "tt_pt_late.npz"}
OUT  = ["peak", "early", "sunday"]          # home -> hub
RET  = ["evening", "late"]                  # hub -> home
LABEL = {"peak": "weekday 7-9h", "early": "weekday 4h30-6h", "sunday": "Sunday 7-9h",
         "evening": "return 17-19h", "late": "return 22h-0h30"}
FOCUS = ["Roissy-CDG airport", "Orly / Rungis"]


def load(name):
    tt = np.load(PROCESSED / name)["tt"].astype(float)
    tt[tt < 0] = UNREACHABLE
    return tt


def main():
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    hubs  = gpd.read_file(PROCESSED / "hubs.gpkg")
    st    = pd.read_parquet(PROCESSED / "zone_stats.parquet").set_index("code").reindex(zones.code)
    od    = pd.read_parquet(PROCESSED / "od.parquet")
    res   = st.residents.values
    idx   = {c: i for i, c in enumerate(zones.code)}
    tts   = {k: load(v) for k, v in SCEN.items()}
    names = hubs.sort_values("hub_rank").hub.unique()

    def to_hub(tt, h):                      # zone -> hub, job-weighted over member zones
        g = hubs[hubs.hub == h]
        return tt[:, [idx[c] for c in g.code]] @ (g.jobs.values / g.jobs.sum())

    def from_hub(tt, h):                    # hub -> zone
        g = hubs[hubs.hub == h]
        return (g.jobs.values / g.jobs.sum()) @ tt[[idx[c] for c in g.code], :]

    rows, per_zone = [], {}
    for h in names:
        r = {"hub": h, "jobs": hubs[hubs.hub == h].jobs.sum()}
        for k in OUT:
            t = to_hub(tts[k], h)
            r[f"catch60_{k}"] = res[t <= 60].sum() / res.sum()
            r[f"unreach_{k}"] = res[t >= UNREACHABLE].sum() / res.sum()
        for k in RET:
            t = from_hub(tts[k], h)
            r[f"catch60_{k}"] = res[t <= 60].sum() / res.sum()
            r[f"unreach_{k}"] = res[t >= UNREACHABLE].sum() / res.sum()
        # actual commuters to this hub (from IDF, outside the hub)
        mem = set(hubs[hubs.hub == h].code)
        f   = od[od.o.isin(idx) & od.d.isin(mem) & ~od.o.isin(mem)]
        oi, w = f.o.map(idx).values, f.n.values
        for k in OUT:
            t = to_hub(tts[k], h)[oi]
            r[f"median_{k}"] = weighted_quantile(t, w, .5)
            r[f"over60_{k}"] = w[t > 60].sum() / w.sum()
        for k in RET:
            t = from_hub(tts[k], h)[oi]
            r[f"median_{k}"] = weighted_quantile(t, w, .5)
            r[f"over60_{k}"] = w[t > 60].sum() / w.sum()
        rows.append(r)
    hv = pd.DataFrame(rows)
    hv.to_csv(TABLES / "staggered_hubs.csv", index=False)

    # per zone: share of hub jobs reachable within 60 min, each outbound scenario
    hub_cols = np.array([idx[c] for c in hubs.code])
    hj = hubs.jobs.values
    zt = zones[["code", "nom", "dep"]].copy()
    zt["residents"] = res
    for k in OUT:
        zt[f"s60_{k}"] = (tts[k][:, hub_cols] <= 60) @ hj / hj.sum()
    for k in RET:
        zt[f"s60_{k}"] = (tts[k][hub_cols, :] <= 60).T @ hj / hj.sum()
    zt.to_csv(TABLES / "staggered_zones.csv", index=False)

    lines = []
    for k in OUT + RET:
        lines.append(f"{LABEL[k]}: avg share of hub jobs within 60 min {np.average(zt[f's60_{k}'], weights=res):.0%}")
    for h in FOCUS:
        r = hv[hv.hub == h].iloc[0]
        lines.append(f"{h}: commuters' median trip  peak {r.median_peak:.0f} | early {r.median_early:.0f} | "
                     f"sunday {r.median_sunday:.0f} | return evening {r.median_evening:.0f} | return late {r.median_late:.0f} min")
        lines.append(f"{h}: commuters over 60 min  peak {r.over60_peak:.0%} | early {r.over60_early:.0%} | "
                     f"sunday {r.over60_sunday:.0%} | return late {r.over60_late:.0%}; "
                     f"region's workers who cannot get home within 2 h after a late shift: {r.unreach_late:.0%}")
    (TABLES / "staggered_headlines.txt").write_text("\n".join(lines))
    print("\n".join(lines))
    print(hv[["hub", "catch60_peak", "catch60_early", "catch60_sunday", "catch60_evening", "catch60_late"]].round(3).to_string(index=False))

    # 12 hub catchment by time slot (dot plot)
    d = hv.sort_values("catch60_peak")
    fig, ax = plt.subplots(figsize=(8.5, 0.3 * len(d) + 1.4))
    y = np.arange(len(d))
    cols = {"peak": SERIES[0], "early": SERIES[1], "late": SERIES[2]}
    ax.hlines(y, d[["catch60_peak", "catch60_early", "catch60_late"]].min(axis=1) * 100,
              d[["catch60_peak", "catch60_early", "catch60_late"]].max(axis=1) * 100, color=INK_2, lw=0.8, alpha=0.4)
    mk = {"peak": "o", "early": "s", "late": "D"}
    for k in ("peak", "early", "late"):
        ax.scatter(d[f"catch60_{k}"] * 100, y, s=26, color=cols[k], marker=mk[k], zorder=3, label=LABEL[k])
    ax.set_yticks(y, d.hub, fontsize=8)
    ax.set_xlim(0, 100)
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("% of the region's employed residents within 60 min of the hub (outbound, or home for the return)")
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    ax.set_title("Outside rush hour, the hubs shrink", loc="left", fontsize=12)
    fig.savefig(FIGURES / "12_staggered_hub_catchment.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    # 13 CDG / Orly commuters: median trip by slot
    fig, ax = plt.subplots(figsize=(8, 3.6))
    slots = OUT + RET
    x = np.arange(len(slots))
    for j, h in enumerate(FOCUS):
        r = hv[hv.hub == h].iloc[0]
        ax.bar(x + (j - 0.5) * 0.38, [r[f"over60_{k}"] * 100 for k in slots], width=0.36, color=SERIES[j], label=h)
    ax.set_xticks(x, [LABEL[k] for k in slots], fontsize=8)
    ax.set_ylabel("% of the hub's workers")
    ax.set_ylim(0, 100)
    ax.legend(frameon=False, fontsize=8)
    ax.set_title("Airport workers whose public transport trip takes over an hour", loc="left", fontsize=12)
    fig.savefig(FIGURES / "13_airport_workers_over_60min.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    # 14 map: hub jobs within 60 min, early morning
    fig, ax = plt.subplots(figsize=(9, 8))
    bins = [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 1.01]
    cmap = ListedColormap(SEQ[::-1])
    zones.assign(v=zt.s60_early.values).plot(column="v", cmap=cmap, norm=BoundaryNorm(bins, cmap.N), ax=ax,
                                             edgecolor=SURFACE, linewidth=0.15)
    hubs.dissolve("hub").boundary.plot(ax=ax, color=SERIES[1], linewidth=0.8)
    ax.set_axis_off()
    ax.set_title("Share of hub jobs reachable within 60 min, leaving home 04:30-06:00", loc="left", fontsize=12)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=BoundaryNorm(bins, cmap.N))
    cb = fig.colorbar(sm, ax=ax, shrink=0.5, ticks=bins[:-1])
    cb.ax.set_yticklabels(["0%", "5%", "15%", "30%", "50%", "70%", "85%"])
    fig.savefig(FIGURES / "14_early_morning_hub_access.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    (PROCESSED / "staggered.json").write_text(json.dumps({
        "hubs": hv.round(4).to_dict(orient="records"),
        "zones": zt[["code"] + [f"s60_{k}" for k in OUT + RET]].round(3).to_dict(orient="records"),
        "labels": LABEL, "headlines": lines,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
