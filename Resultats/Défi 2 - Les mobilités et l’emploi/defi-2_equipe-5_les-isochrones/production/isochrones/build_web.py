"""Build the self-contained explorer app/static/explorer.html (served at /explorer) from the analysis outputs."""
import json

import geopandas as gpd
import numpy as np
import pandas as pd

from config import ROOT, PROCESSED, TABLES, STATIC

WEB      = ROOT                          # template.html and ui_kit.html sit next to this script
TEMPLATE = WEB / "template.html"
OUT      = STATIC / "explorer.html"


def make_data():
    zones = gpd.read_file(PROCESSED / "zones.gpkg")
    rv    = pd.read_csv(TABLES / "residential_zones_access.csv", dtype={"code": str, "dep": str})
    hv    = pd.read_csv(TABLES / "hub_catchment.csv")
    zh    = pd.read_csv(TABLES / "zone_to_hub_minutes.csv", dtype={"code": str}).set_index("code")
    dep   = pd.read_csv(TABLES / "access_by_department.csv", dtype={"dep": str})
    car   = pd.read_csv(TABLES / "car_share_by_hub_access.csv")
    hubs  = gpd.read_file(PROCESSED / "hubs.gpkg")

    g = zones[["code", "geometry"]].copy()
    g["geometry"] = g.geometry.simplify(120, preserve_topology=True)
    g = g.to_crs(4326).merge(rv, on="code", how="left")
    g["hub"] = g.code.map(hubs.set_index("code").hub)

    keep = {"code": "c", "nom": "n", "dep": "d", "residents": "r", "jobs": "j",
            "hub_share_30": "s30", "hub_share_45": "s45", "hub_share_60": "s60",
            "share_car_out": "car", "nearest_hub": "nh", "nearest_hub_min": "nm", "hub": "h"}
    g = g[list(keep) + ["geometry"]].rename(columns=keep)
    for c in ("r", "j"):
        g[c] = g[c].round().astype(int)
    for c in ("s30", "s45", "s60", "car"):
        g[c] = g[c].round(3)
    g["nm"] = g["nm"].round().astype(int)
    geo = json.loads(g.to_json(drop_id=True))

    def rnd(o):
        if isinstance(o, list):
            return [rnd(v) for v in o]
        return round(o, 4) if isinstance(o, float) else o
    for f in geo["features"]:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])

    names = list(hv.hub)
    zh    = zh.reindex(columns=names).reindex(g.c)
    mat   = zh.fillna(121).clip(upper=121).astype(int).values.tolist()

    data = {
        "zones": geo,
        "hubs":  hv.round(4).to_dict(orient="records"),
        "hubNames": names,
        "toHub": mat,
        "deps":  dep.rename(columns={"s45": "s45", "s60": "s60"})[["dep", "s45", "s60", "residents"]]
                    .round(2).to_dict(orient="records"),
        "car":   car.rename(columns={car.columns[0]: "bin"}).round(2).to_dict(orient="records"),
        "headlines": (TABLES / "headlines.txt").read_text().splitlines(),
    }
    return data


def main():
    data = make_data()
    html = TEMPLATE.read_text().replace("<!--__UI__-->", (WEB / "ui_kit.html").read_text()).replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False,
                                                                      separators=(",", ":")))
    OUT.write_text(html)
    print("wrote", OUT, f"{OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
