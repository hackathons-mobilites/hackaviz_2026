"""Two PRIM datasets explored by Veasna RA, brought into the story.

Port of this repo's notebooks ../notebooks/04_service_offer.ipynb and ../notebooks/05_cycling.ipynb
(same PRIM sources; dataset readers in ../scripts/datasets/service_offer.py and cycling.py).


1. Average weekly service outside school holidays (offre_hebdomadaire_moyenne_hors_vacances):
   vehicle passages at stops, summed per hour, for the whole region and for the airport communes.
   A sum of passages over stops is a service-intensity index, not a count of departures or trips.
2. Cycling facilities in Île-de-France (amenagements-velo-en-ile-de-france): km of dedicated cycling
   facilities per commune, joined to the bike candidates of solutions.py.

Downloads (IDFM open-data portal, aggregated server-side):
    data/raw/prim/service_all.json, service_cdg.json, service_orly.json, data/raw/prim/cycling.csv
Outputs: data/processed/prim.json, outputs/tables/prim_*.csv, outputs/figures/16_service_by_hour.png
"""
import json

import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from analysis import SERIES, INK_2
from config import RAW, PROCESSED, FIGURES, TABLES, CRS_M

PRIM = RAW / "prim"
DAYS = ["mardi", "samedi", "dimanche"]

# Facility types (ad / ag columns) counted as dedicated cycling infrastructure
DEDICATED = ("piste", "bande", "voie verte", "chemin dedie", "chemin service site propre",
             "autre chemin velo", "double sens cyclable", "chaucidou")


def service_profile(name):
    rows = json.loads((PRIM / f"service_{name}.json").read_text())["results"]
    df = pd.DataFrame(rows).rename(columns={"tranche_horaire": "hour"}).sort_values("hour")
    for d in DAYS:
        df[f"{d}_share"] = df[d] / df[d].sum()
    return df


def cycling_by_commune(zones):
    cy = pd.read_csv(PRIM / "cycling.csv", sep=";", dtype=str, encoding="utf-8-sig")
    cy["longueur"] = pd.to_numeric(cy.longueur, errors="coerce").fillna(0)
    fac = (cy.ad.fillna("") + " " + cy.ag.fillna("")).str.lower()
    cy["dedicated"] = fac.apply(lambda s: any(k in s for k in DEDICATED))
    km = cy[cy.dedicated].groupby("insee_com").longueur.sum() / 1000
    area = zones.set_index("code").geometry.area / 1e6
    out = pd.DataFrame({"code": zones.code})
    out["cycle_km"]   = out.code.map(km).fillna(0).round(1)
    out["cycle_dens"] = (out.cycle_km / out.code.map(area)).round(2)
    return out


def main():
    profiles = {k: service_profile(k) for k in ("all", "cdg", "orly")}
    for k, df in profiles.items():
        df.to_csv(TABLES / f"prim_service_by_hour_{k}.csv", index=False)

    zones = gpd.read_file(PROCESSED / "zones.gpkg").to_crs(CRS_M)
    cyc   = cycling_by_commune(zones)
    sol   = pd.read_csv(TABLES / "solutions_zones.csv", dtype={"code": str})
    cyc   = cyc.merge(sol[["code", "nom", "residents", "solution"]], on="code", how="left")
    cyc.to_csv(TABLES / "prim_cycling_by_commune.csv", index=False)

    lines = []
    a = profiles["all"]
    for k, lab in (("all", "region"), ("cdg", "CDG communes"), ("orly", "Orly-Rungis communes")):
        df = profiles[k]
        night = df[(df.hour < 6) | (df.hour >= 22)]
        lines.append(f"{lab}: share of Tuesday passages before 06:00 or after 22:00 = {night.mardi.sum() / df.mardi.sum():.1%}; "
                     f"Sunday volume = {df.dimanche.sum() / df.mardi.sum():.0%} of Tuesday")
    med = cyc[cyc.residents >= 2000].cycle_dens.median()
    bd  = cyc[(cyc.solution == "bike_direct")]
    lines.append(f"median dedicated cycling density (towns >= 2k workers): {med:.2f} km/km2; "
                 f"bike-lane candidates below that median: {(bd.cycle_dens < med).mean():.0%} of towns, "
                 f"{bd[bd.cycle_dens < med].residents.sum():,.0f} workers")
    (TABLES / "prim_headlines.txt").write_text("\n".join(lines))
    print("\n".join(lines))

    fig, ax = plt.subplots(figsize=(8, 4))
    for (k, lab), c in zip((("all", "all stops"), ("cdg", "Roissy-CDG communes"), ("orly", "Orly-Rungis communes")), SERIES):
        df = profiles[k]
        ax.plot(df.hour, df.mardi_share * 100, color=c, lw=2, label=lab)
    ax.set_xticks(range(4, 28, 2), [f"{h % 24}h" for h in range(4, 28, 2)])
    ax.set_ylabel("% of the day's passages (Tuesday)")
    ax.legend(frameon=False, fontsize=8)
    ax.set_title("When the buses and trains run: passages at stops by hour", loc="left", fontsize=12)
    fig.text(0.02, -0.03, "PRIM average weekly service outside school holidays. Dataset explored by Veasna RA.",
             fontsize=7, color=INK_2)
    fig.savefig(FIGURES / "16_service_by_hour.png", dpi=180, bbox_inches="tight")
    plt.close(fig)

    (PROCESSED / "prim.json").write_text(json.dumps({
        "service": {k: df[["hour"] + DAYS].round(1).to_dict(orient="records") for k, df in profiles.items()},
        "cycling": cyc[["code", "cycle_km", "cycle_dens"]].to_dict(orient="records"),
        "cycleMedian": float(med),
        "headlines": lines,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
