"""Commuting mode by commune of residence (INSEE RP 2023, NAV2 table) from the Melodi API.

Dataset DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP, employed people aged 15+, all sexes.
WORK_AREA: 10 = works in the commune of residence, other codes = works elsewhere.
TRANS: 1 none, 2 walk, 3 bike, 4 motorised two-wheeler, 5 car/van, 6 public transport.

Output: data/processed/modes_by_zone.parquet
    code, workers, out_workers (work outside their commune),
    share_pt_out, share_car_out (among those working outside), share_pt, share_car (all)
"""
import time

import geopandas as gpd
import pandas as pd
import requests

from config import PROCESSED, RAW

API   = "https://api.insee.fr/melodi/data/DS_RP_TD_NAVETTES_SEXTRANSPORT_COMP"
MODES = {"1": "none", "2": "walk", "3": "bike", "4": "2rm", "5": "car", "6": "pt"}


def geo_id(code):
    return f"2026-ARM-{code}" if code.startswith("751") else f"2026-COM-{code}"


def fetch(codes, batch=50):
    rows = []
    for i in range(0, len(codes), batch):
        params = [("GEO", geo_id(c)) for c in codes[i:i + batch]]
        params += [("SEX", "_T"), ("WORK_URBAN_AREA", "_T"), ("maxResult", "10000")]
        for attempt in range(5):
            try:
                r = requests.get(API, params=params, timeout=120)
                r.raise_for_status()
                break
            except requests.RequestException as e:
                print("retry", i, e)
                time.sleep(3 * (attempt + 1))
        for o in r.json()["observations"]:
            d = o["dimensions"]
            rows.append((d["GEO"].split("-")[-1], d["WORK_AREA"], d["TRANS"], d["TIME_PERIOD"],
                         o["measures"]["OBS_VALUE_NIVEAU"]["value"]))
        print(f"{min(i + batch, len(codes))}/{len(codes)}", flush=True)
    return pd.DataFrame(rows, columns=["code", "work_area", "trans", "year", "n"])


def main():
    codes = gpd.read_file(PROCESSED / "zones.gpkg").code.tolist()
    raw   = fetch(codes)
    raw.to_parquet(RAW / "nav2_melodi.parquet", index=False)

    t     = raw[raw.trans != "_T"]
    out   = t[t.work_area.isin(["21", "22", "23", "24T30"])]
    allw  = t[t.work_area == "_T"]
    piv_o = out.groupby(["code", "trans"]).n.sum().unstack(fill_value=0)
    piv_a = allw.groupby(["code", "trans"]).n.sum().unstack(fill_value=0)
    m = pd.DataFrame({
        "workers":       piv_a.sum(axis=1),
        "out_workers":   piv_o.sum(axis=1),
        "share_pt":      piv_a["6"] / piv_a.sum(axis=1),
        "share_car":     piv_a["5"] / piv_a.sum(axis=1),
        "share_pt_out":  piv_o["6"] / piv_o.sum(axis=1),
        "share_car_out": piv_o["5"] / piv_o.sum(axis=1),
    }).reset_index()
    m["year"] = raw.year.iloc[0]
    m.to_parquet(PROCESSED / "modes_by_zone.parquet", index=False)
    print(m.describe().round(3))
    missing = set(codes) - set(m.code)
    print("missing zones:", len(missing), sorted(missing)[:10])


if __name__ == "__main__":
    main()
