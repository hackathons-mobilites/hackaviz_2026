"""Track 1 - Access to job hubs.

Question: are the areas where jobs are concentrated really accessible by public
transport from the main residential areas?

Inputs : zones.gpkg, hubs.gpkg, zone_stats.parquet, od.parquet, tt_pt_peak.npz
Outputs: outputs/tables/*.csv, outputs/figures/*.png, data/processed/web_data.json
"""
import json

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import BoundaryNorm, ListedColormap

from config import PROCESSED, FIGURES, TABLES

THRESHOLDS   = (30, 45, 60)
UNREACHABLE  = 121          # minutes used for "not reachable within 2 h"

# Reference palette (dataviz skill, light mode)
SURFACE      = "#fcfcfb"
INK          = "#0b0b0b"
INK_2        = "#52514e"
GRID         = "#e4e3df"
SERIES       = ["#2a78d6", "#eb6834", "#1baf7a"]
SEQ          = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK_2, "xtick.color": INK_2, "ytick.color": INK_2,
    "text.color": INK, "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
})


def load():
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    hubs  = gpd.read_file(PROCESSED / "hubs.gpkg")
    st    = pd.read_parquet(PROCESSED / "zone_stats.parquet")
    od    = pd.read_parquet(PROCESSED / "od.parquet")
    z     = np.load(PROCESSED / "tt_pt_peak.npz")
    tt    = z["tt"].astype(float)
    tt[tt < 0] = UNREACHABLE
    codes = list(z["codes"])
    assert codes == zones.code.tolist()
    return zones, hubs, st, od, tt, z["poorly_served"]


def hub_matrix(zones, hubs, tt):
    """Origin zone x hub travel time: job-weighted mean over the hub's member zones."""
    idx   = {c: i for i, c in enumerate(zones.code)}
    names = hubs.sort_values("hub_rank").hub.unique()
    out   = np.zeros((len(zones), len(names)))
    jobs  = np.zeros(len(names))
    for k, h in enumerate(names):
        g      = hubs[hubs.hub == h]
        cols   = [idx[c] for c in g.code]
        w      = g.jobs.values / g.jobs.sum()
        out[:, k] = tt[:, cols] @ w
        jobs[k]   = g.jobs.sum()
    return names, out, jobs


def residential_view(zones, st, hubs, tt, names, htt, hjobs, poor):
    """Per home zone: hub jobs reachable, time to nearest hubs."""
    idx      = {c: i for i, c in enumerate(zones.code)}
    hub_cols = np.array([idx[c] for c in hubs.code])
    hub_jobs = hubs.jobs.values
    df = st.copy()
    for t in THRESHOLDS:
        reach = tt[:, hub_cols] <= t
        df[f"hub_jobs_{t}"]  = reach @ hub_jobs
        df[f"hub_share_{t}"] = df[f"hub_jobs_{t}"] / hub_jobs.sum()
        df[f"hubs_{t}"]      = (htt <= t).sum(axis=1)
    all_jobs = st.jobs.values
    for t in THRESHOLDS:
        df[f"all_jobs_{t}"] = (tt <= t) @ all_jobs
    order = np.argsort(htt, axis=1)
    df["nearest_hub"]      = names[order[:, 0]]
    df["nearest_hub_min"]  = np.take_along_axis(htt, order[:, :1], 1)[:, 0]
    df["min_to_main_cbd"]  = htt[:, 0]
    df["poorly_served"]    = poor
    return df


def hub_view(zones, st, od, names, htt, hjobs, hubs):
    """Per hub: catchment (share of IDF employed residents within T) and actual commuters."""
    res    = st.residents.values
    rows   = []
    zidx   = {c: i for i, c in enumerate(zones.code)}
    member = hubs.groupby("hub").code.apply(set)
    odz    = od[od.o.isin(zidx)].copy()
    has_mode = "n_pt" in od.columns
    for k, h in enumerate(names):
        r = {"hub": h, "jobs": hjobs[k], "zones": len(member[h])}
        for t in THRESHOLDS:
            r[f"catch_{t}"] = res[htt[:, k] <= t].sum() / res.sum()
        f    = odz[odz.d.isin(member[h]) & ~odz.o.isin(member[h])]   # commuters from outside the hub
        oi   = f.o.map(zidx).values
        tmin = htt[oi, k]
        w    = f.n.values
        r["commuters_in"]     = w.sum()
        r["median_pt_min"]    = weighted_quantile(tmin, w, 0.5)
        r["share_over_60"]    = w[tmin > 60].sum() / w.sum()
        r["share_over_90"]    = w[tmin > 90].sum() / w.sum()
        if has_mode:
            r["pt_share"]  = f.n_pt.sum() / w.sum()
            r["car_share"] = f.n_car.sum() / w.sum()
        rows.append(r)
    return pd.DataFrame(rows)


def weighted_quantile(x, w, q):
    o = np.argsort(x)
    c = np.cumsum(w[o]) / w.sum()
    return float(x[o][np.searchsorted(c, q)])


def od_view(zones, od, tt):
    """Actual home->work pairs inside IDF with their PT time (for mode-vs-time analysis)."""
    zidx = {c: i for i, c in enumerate(zones.code)}
    f    = od[od.o.isin(zidx) & od.d.isin(zidx)].copy()
    f["pt_min"] = tt[f.o.map(zidx).values, f.d.map(zidx).values]
    return f


# Figures

def fig_hub_map(zones, hubs, st):
    fig, ax = plt.subplots(figsize=(9, 8))
    dens = st.set_index("code").jobs.reindex(zones.code).values / (zones.geometry.area.values / 1e6)
    bins = [0, 100, 300, 1000, 3000, 10000, 30000, 1e9]
    cmap = ListedColormap(SEQ)
    zones.assign(d=dens).plot(column="d", cmap=cmap, norm=BoundaryNorm(bins, cmap.N), ax=ax,
                              edgecolor=SURFACE, linewidth=0.15)
    hd = hubs.dissolve("hub", aggfunc={"jobs": "sum", "hub_rank": "first"}).reset_index()
    hd.boundary.plot(ax=ax, color=SERIES[1], linewidth=1.2)
    for _, r in hd.sort_values("jobs", ascending=False).head(14).iterrows():
        p = r.geometry.representative_point()
        ax.annotate(f"{r.hub}\n{r.jobs / 1000:,.0f}k jobs", (p.x, p.y), fontsize=7, color=INK,
                    ha="center", xytext=(0, 8), textcoords="offset points",
                    bbox=dict(boxstyle="round,pad=0.2", fc=SURFACE, ec="none", alpha=0.8))
    ax.set_axis_off()
    ax.set_title("Where the jobs are: job density and the job hubs (outlined)", loc="left", fontsize=12)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=BoundaryNorm(bins, cmap.N))
    cb = fig.colorbar(sm, ax=ax, shrink=0.5, ticks=bins[:-1])
    cb.ax.set_yticklabels(["0", "100", "300", "1k", "3k", "10k", "30k+"])
    cb.set_label("jobs per km² (place of work, RP 2022)")
    fig.text(0.02, 0.02, "Sources: INSEE MOBPRO 2022, IGN/geo.api.gouv.fr", fontsize=7, color=INK_2)
    fig.savefig(FIGURES / "01_job_hubs_map.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def fig_access_map(zones, hubs, rv, t=45):
    fig, ax = plt.subplots(figsize=(9, 8))
    bins = [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 1.01]
    cmap = ListedColormap(SEQ)
    v = rv.set_index("code")[f"hub_share_{t}"].reindex(zones.code).values
    zones.assign(v=v).plot(column="v", cmap=cmap, norm=BoundaryNorm(bins, cmap.N), ax=ax,
                           edgecolor=SURFACE, linewidth=0.15)
    hubs.dissolve("hub").boundary.plot(ax=ax, color=SERIES[1], linewidth=0.9)
    ax.set_axis_off()
    ax.set_title(f"Share of all job-hub jobs reachable within {t} min by public transport\n"
                 "weekday, departures 07:00-09:00 (median), walk + transit", loc="left", fontsize=12)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=BoundaryNorm(bins, cmap.N))
    cb = fig.colorbar(sm, ax=ax, shrink=0.5, ticks=bins[:-1])
    cb.ax.set_yticklabels(["0%", "5%", "15%", "30%", "50%", "70%", "85%"])
    fig.text(0.02, 0.02, "Sources: IDFM GTFS (Nov 2026), INSEE MOBPRO 2022. Own routing (CSA).",
             fontsize=7, color=INK_2)
    fig.savefig(FIGURES / f"02_hub_jobs_within_{t}min.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def fig_hub_catchment(hv):
    d = hv.sort_values("catch_45")
    fig, ax = plt.subplots(figsize=(8, 0.32 * len(d) + 1.2))
    y = np.arange(len(d))
    ax.barh(y, d.catch_60 * 100, color=SERIES[0], alpha=0.35, height=0.62, label="within 60 min")
    ax.barh(y, d.catch_45 * 100, color=SERIES[0], height=0.62, label="within 45 min")
    ax.set_yticks(y, [f"{h}  ({j / 1000:,.0f}k jobs)" for h, j in zip(d.hub, d.jobs)], fontsize=8)
    ax.set_xlabel("% of Île-de-France employed residents who can reach the hub")
    ax.set_xlim(0, 100)
    ax.grid(axis="y", visible=False)
    for yi, v in zip(y, d.catch_45 * 100):
        ax.text(v + 1, yi, f"{v:.0f}%", va="center", fontsize=7, color=INK_2)
    ax.legend(loc="lower right", frameon=False, fontsize=8)
    ax.set_title("Catchment of each job hub by public transport (morning peak)", loc="left", fontsize=12)
    fig.savefig(FIGURES / "03_hub_catchment.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def fig_mode_vs_time(odv):
    if "n_pt" not in odv.columns:
        return
    f   = odv[odv.o != odv.d].copy()
    bins = np.arange(0, 125, 10)
    f["bin"] = pd.cut(f.pt_min.clip(upper=120), bins, right=False, include_lowest=True)
    g   = f.groupby("bin", observed=True)[["n", "n_pt", "n_car"]].sum()
    mid = [b.left + 5 for b in g.index]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.plot(mid, g.n_pt / g.n * 100, color=SERIES[0], lw=2, marker="o", ms=5, label="public transport")
    ax.plot(mid, g.n_car / g.n * 100, color=SERIES[1], lw=2, marker="o", ms=5, label="car")
    ax.text(mid[-1] + 2, (g.n_pt / g.n * 100).iloc[-1], "public transport", color=INK_2, fontsize=8, va="center")
    ax.text(mid[-1] + 2, (g.n_car / g.n * 100).iloc[-1], "car", color=INK_2, fontsize=8, va="center")
    ax.set_xlabel("public transport travel time for the home→work pair (min, '120' = 2 h or more)")
    ax.set_ylabel("% of commuters on the pair")
    ax.set_ylim(0, 100)
    ax.legend(frameon=False, fontsize=8, loc="upper center")
    ax.set_title("When public transport is slow, people drive", loc="left", fontsize=12)
    fig.text(0.02, -0.02, "Inter-commune commuters living and working in Île-de-France. INSEE MOBPRO 2022 x own routing.",
             fontsize=7, color=INK_2)
    fig.savefig(FIGURES / "04_mode_share_vs_pt_time.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


RING = {"75": "Paris", "92": "Inner ring", "93": "Inner ring", "94": "Inner ring"}
RING_ORDER = ["Paris", "Inner ring", "Outer ring"]
DEP_NAMES = {"75": "Paris", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne",
             "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne", "95": "Val-d'Oise"}


def fig_by_department(rv):
    g = (rv.assign(w45=rv.hub_share_45 * rv.residents, w60=rv.hub_share_60 * rv.residents)
           .groupby("dep")[["w45", "w60", "residents"]].sum())
    g["s45"] = g.w45 / g.residents * 100
    g["s60"] = g.w60 / g.residents * 100
    g = g.sort_values("s45")
    fig, ax = plt.subplots(figsize=(8, 4))
    y = np.arange(len(g))
    ax.barh(y, g.s60, color=SERIES[0], alpha=0.35, height=0.6, label="within 60 min")
    ax.barh(y, g.s45, color=SERIES[0], height=0.6, label="within 45 min")
    for yi, a, b in zip(y, g.s45, g.s60):
        ax.text(b + 1, yi, f"{a:.0f}% / {b:.0f}%", va="center", fontsize=7, color=INK_2)
    ax.set_yticks(y, [DEP_NAMES[d] for d in g.index], fontsize=9)
    ax.set_xlim(0, 100)
    ax.grid(axis="y", visible=False)
    ax.set_xlabel("average share of all hub jobs reachable by public transport (weighted by employed residents)")
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    ax.set_title("A resident of the outer ring reaches a small slice of the hubs", loc="left", fontsize=12)
    fig.savefig(FIGURES / "05_access_by_department.png", dpi=180, bbox_inches="tight")
    plt.close(fig)
    return g


def fig_residential_scatter(rv):
    d = rv[rv.residents >= 2000].copy()
    d["ring"] = d.dep.map(RING).fillna("Outer ring")
    fig, ax = plt.subplots(figsize=(8, 5))
    for k, ring in enumerate(RING_ORDER):
        g = d[d.ring == ring]
        ax.scatter(g.residents, g.hub_share_45 * 100, s=14, color=SERIES[k], alpha=0.75,
                   edgecolor=SURFACE, linewidth=0.5, label=ring)
    big = d[(d.residents >= 25_000)].sort_values("hub_share_45").head(6)
    for _, r in big.iterrows():
        ax.annotate(r.nom, (r.residents, r.hub_share_45 * 100), fontsize=7, color=INK_2,
                    xytext=(4, 3), textcoords="offset points")
    ax.set_xscale("log")
    ax.set_xlabel("employed residents in the commune (log scale)")
    ax.set_ylabel("% of hub jobs within 45 min")
    ax.set_ylim(0, 100)
    ax.legend(frameon=False, fontsize=8)
    ax.set_title("Large residential towns with weak access to the job hubs", loc="left", fontsize=12)
    fig.savefig(FIGURES / "06_residential_towns_scatter.png", dpi=180, bbox_inches="tight")
    plt.close(fig)


def fig_mode_vs_access(rv, modes):
    d = rv.merge(modes, on="code")
    d = d[d.out_workers >= 200].copy()
    d["bin"] = pd.cut(d.hub_share_60 * 100, [0, 1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101],
                      right=False, include_lowest=True)
    g = d.groupby("bin", observed=True).apply(
        lambda x: pd.Series({
            "car": np.average(x.share_car_out, weights=x.out_workers) * 100,
            "pt":  np.average(x.share_pt_out,  weights=x.out_workers) * 100,
            "workers": x.out_workers.sum()}), include_groups=False)
    mid = [(b.left + min(b.right, 100)) / 2 for b in g.index]
    fig, ax = plt.subplots(figsize=(8, 4.8))
    ax.scatter(d.hub_share_60 * 100, d.share_car_out * 100, s=np.sqrt(d.out_workers) / 3,
               color=SERIES[1], alpha=0.18, edgecolor="none")
    ax.plot(mid, g.car, color=SERIES[1], lw=2, marker="o", ms=5, label="car")
    ax.plot(mid, g.pt, color=SERIES[0], lw=2, marker="o", ms=5, label="public transport")
    ax.set_xlabel("% of hub jobs reachable within 60 min by public transport from the commune")
    ax.set_ylabel("% of out-of-commune commuters")
    ax.set_xlim(0, 100); ax.set_ylim(0, 100)
    ax.legend(frameon=False, fontsize=8, loc="center right")
    ax.set_title("Where the hubs are out of reach, people drive", loc="left", fontsize=12)
    fig.text(0.02, -0.03, "Dots: communes (size = commuters). Lines: commuter-weighted average per bin. "
             f"Mode: INSEE RP {modes.year.iloc[0]} (NAV2, Melodi API).", fontsize=7, color=INK_2)
    fig.savefig(FIGURES / "04_car_share_vs_hub_access.png", dpi=180, bbox_inches="tight")
    plt.close(fig)
    return d, g


def main():
    zones, hubs, st, od, tt, poor = load()
    names, htt, hjobs = hub_matrix(zones, hubs, tt)
    rv  = residential_view(zones, st, hubs, tt, names, htt, hjobs, poor)
    hv  = hub_view(zones, st, od, names, htt, hjobs, hubs)
    odv = od_view(zones, od, tt)

    rv.to_csv(TABLES / "residential_zones_access.csv", index=False)
    hv.to_csv(TABLES / "hub_catchment.csv", index=False)
    pd.DataFrame(htt, index=zones.code, columns=names).round(0).to_csv(TABLES / "zone_to_hub_minutes.csv")

    # Headline numbers, weighted by employed residents
    w = rv.residents
    lines = []
    for t in THRESHOLDS:
        lines.append(f"avg share of hub jobs reachable in {t} min: {np.average(rv[f'hub_share_{t}'], weights=w):.0%}")
    main_res = rv[(rv.job_ratio < 1) & (rv.residents >= 10_000)]
    lines.append(f"main residential zones (>=10k employed residents, job ratio <1): {len(main_res)}, "
                 f"{main_res.residents.sum():,.0f} workers")
    for t in (45, 60):
        lines.append(f"  of which reach >=50% of hub jobs in {t} min: "
                     f"{main_res[main_res[f'hub_share_{t}'] >= .5].residents.sum() / main_res.residents.sum():.0%} of workers")
    lines.append(f"  living >45 min from nearest hub: "
                 f"{main_res[main_res.nearest_hub_min > 45].residents.sum() / main_res.residents.sum():.0%}")
    if "n_pt" in odv.columns:
        f = odv[odv.o != odv.d]
        for lo, hi in ((0, 45), (45, 60), (60, 90), (90, 999)):
            g = f[(f.pt_min >= lo) & (f.pt_min < hi)]
            lines.append(f"pairs with PT {lo}-{hi} min: {g.n.sum():,.0f} commuters, PT {g.n_pt.sum() / g.n.sum():.0%}, "
                         f"car {g.n_car.sum() / g.n.sum():.0%}")
    (TABLES / "headlines.txt").write_text("\n".join(lines))
    print("\n".join(lines))
    print(hv.round(3).to_string(index=False))

    fig_hub_map(zones, hubs, st)
    for t in THRESHOLDS:
        fig_access_map(zones, hubs, rv, t)
    fig_hub_catchment(hv)
    dep = fig_by_department(rv)
    dep.to_csv(TABLES / "access_by_department.csv")
    fig_residential_scatter(rv)
    worst = (rv[(rv.residents >= 10_000) & (rv.job_ratio < 1)]
             .sort_values("hub_share_45")
             [["code", "nom", "dep", "residents", "hub_share_45", "hub_share_60", "nearest_hub", "nearest_hub_min"]])
    worst.to_csv(TABLES / "main_residential_zones_ranked.csv", index=False)
    print(worst.head(20).round(3).to_string(index=False))
    fig_mode_vs_time(odv)
    mp = PROCESSED / "modes_by_zone.parquet"
    if mp.exists():
        modes = pd.read_parquet(mp)
        d, g = fig_mode_vs_access(rv, modes)
        g.to_csv(TABLES / "car_share_by_hub_access.csv")
        rv = rv.merge(modes[["code", "share_car_out", "share_pt_out"]], on="code", how="left")
        rv.to_csv(TABLES / "residential_zones_access.csv", index=False)
        big = d[d.residents >= 10_000]
        r = np.corrcoef(big.hub_share_60, big.share_car_out)[0, 1]
        extra = [f"car share of out-commuters by hub-access bin (60 min): " +
                 ", ".join(f"{b}: {v:.0f}%" for b, v in zip(g.index.astype(str), g.car)),
                 f"corr(hub share 60, car share out) over towns >=10k workers: {r:.2f}"]
        lines += extra
        print("\n".join(extra))
        (TABLES / "headlines.txt").write_text("\n".join(lines))

    # compact data for the web page
    web = {
        "hubs": hv.round(4).to_dict(orient="records"),
        "zones": rv[["code", "nom", "dep", "residents", "jobs", "hub_share_30", "hub_share_45",
                     "hub_share_60", "nearest_hub", "nearest_hub_min", "hubs_45"]]
                 .round(4).to_dict(orient="records"),
        "headlines": lines,
    }
    (PROCESSED / "web_data.json").write_text(json.dumps(web, ensure_ascii=False))


if __name__ == "__main__":
    main()
