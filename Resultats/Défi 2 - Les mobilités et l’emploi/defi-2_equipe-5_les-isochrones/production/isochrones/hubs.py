"""Jobs and employed residents per zone, and the job hubs.

A zone is a hub zone when it has at least HUB_MIN_JOBS jobs and clearly more jobs
than employed residents (job ratio >= HUB_MIN_RATIO). Well-known clusters spread
over several zones (Paris sectors, La Défense, CDG, Saclay...) are grouped by hand.

Output: data/processed/zone_stats.parquet, data/processed/hubs.gpkg
"""
import geopandas as gpd
import numpy as np
import pandas as pd

from config import PROCESSED

HUB_MIN_JOBS  = 15_000
HUB_MIN_RATIO = 1.2

# Named job clusters. Members enter when they pass the thresholds above;
# "forced" clusters keep all members (well-known poles split over small communes).
HUB_GROUPS = {
    "Paris centre-ouest (QCA)":       (["75101", "75102", "75108", "75109", "75116", "75117"], False),
    "Paris centre-est":               (["75103", "75104", "75110", "75111", "75112", "75119"], False),
    "Paris rive gauche":              (["75105", "75106", "75107", "75113", "75114", "75115"], False),
    "La Défense":                     (["92026", "92062"], False),
    "Boulogne / Issy":                (["92012", "92040"], False),
    "Levallois / Neuilly":            (["92044", "92051"], False),
    "Plaine Saint-Denis / Saint-Ouen": (["93066", "93070"], False),
    "Roissy-CDG airport":             (["95527", "93073", "77291"], True),
    "Orly / Rungis":                  (["94054", "94065", "91479"], True),
    "Saint-Quentin-en-Yvelines":      (["78297", "78423", "78621"], False),
    "Paris-Saclay":                   (["91477", "91471", "91272", "91534"], True),
    "Val d'Europe (Marne-la-Vallée)": (["77111", "77449", "77018"], True),
}


def zone_stats(zones, od):
    jobs = od.groupby("d").n.sum()
    res  = od[od.o.isin(zones.code)].groupby("o").n.sum()
    st   = zones[["code", "nom", "dep"]].copy()
    st["jobs"]      = st.code.map(jobs).fillna(0)
    st["residents"] = st.code.map(res).fillna(0)
    st["job_ratio"] = st.jobs / st.residents.clip(lower=1)
    return st


def find_hubs(zones, st):
    hz   = zones.merge(st[["code", "jobs", "residents", "job_ratio"]], on="code")
    ok   = (hz.jobs >= HUB_MIN_JOBS) & (hz.job_ratio >= HUB_MIN_RATIO)
    hub  = pd.Series(np.where(ok, hz.nom, None), index=hz.index, dtype=object)
    for name, (codes, forced) in HUB_GROUPS.items():
        m = hz.code.isin(codes) & (ok | forced)
        hub[m] = name
    hz["hub"] = hub
    hz = hz[hz.hub.notna()].copy()
    size = hz.groupby("hub").jobs.sum()
    hz   = hz[hz.hub.map(size) >= HUB_MIN_JOBS]
    size = size[size >= HUB_MIN_JOBS].sort_values(ascending=False)
    hz["hub_rank"] = hz.hub.map({h: i + 1 for i, h in enumerate(size.index)})
    return hz


def main():
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    od    = pd.read_parquet(PROCESSED / "od.parquet")
    st    = zone_stats(zones, od)
    hz    = find_hubs(zones, st)
    st["hub"] = st.code.map(hz.set_index("code").hub)
    st.to_parquet(PROCESSED / "zone_stats.parquet", index=False)
    hz.to_file(PROCESSED / "hubs.gpkg", driver="GPKG")

    summary = (hz.groupby(["hub_rank", "hub"])
                 .agg(zones=("code", "size"), jobs=("jobs", "sum"))
                 .reset_index())
    print(summary.to_string(index=False))
    print(f"hub jobs {summary.jobs.sum():,.0f} of {st.jobs.sum():,.0f} "
          f"({summary.jobs.sum() / st.jobs.sum():.0%})")


if __name__ == "__main__":
    main()
