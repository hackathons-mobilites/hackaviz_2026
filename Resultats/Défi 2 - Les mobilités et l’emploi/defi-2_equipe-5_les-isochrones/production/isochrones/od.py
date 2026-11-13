"""Home -> work flows (INSEE MOBPRO 2022) aggregated to analysis zones.

Output: data/processed/od.parquet with columns
    o, d          zone codes (Paris = arrondissements)
    n             weighted number of employed people (IPONDI)
    n_pt, n_car, n_walk, n_bike, n_2rm, n_none   by main transport mode (TRANS)

Falls back to the "base flux" file (no transport mode) when the detail file is missing.
"""
import duckdb
import geopandas as gpd
import pandas as pd

from config import RAW, PROCESSED, MOBPRO

# TRANS coding in RP 2022
TRANS = {"1": "none", "2": "walk", "3": "bike", "4": "2rm", "5": "car", "6": "pt"}


def from_detail(codes):
    con = duckdb.connect()
    con.register("zones", pd.DataFrame({"code": codes}))
    cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM '{MOBPRO}'").fetchall()]
    arm  = "ARM" if "ARM" in cols else None
    home = f"CASE WHEN COMMUNE = '75056' AND {arm} IS NOT NULL THEN {arm} ELSE COMMUNE END" if arm else "COMMUNE"
    q = f"""
        SELECT {home} AS o, DCLT AS d, CAST(TRANS AS VARCHAR) AS mode,
               SUM(CAST(IPONDI AS DOUBLE)) AS n
        FROM '{MOBPRO}'
        WHERE ({home} IN (SELECT code FROM zones) OR DCLT IN (SELECT code FROM zones))
        GROUP BY ALL
    """
    df = con.execute(q).df()
    if (df.d == "75056").any():
        print("warning: work place in Paris not split by arrondissement in DCLT")
    wide = df.pivot_table(index=["o", "d"], columns="mode", values="n", aggfunc="sum", fill_value=0)
    wide.columns = [f"n_{TRANS.get(str(c), str(c))}" for c in wide.columns]
    wide["n"] = wide.sum(axis=1)
    return wide.reset_index()


def from_flux(codes):
    import glob
    path = sorted(glob.glob(str(RAW / "flux2022" / "*.csv")))[0]
    df = pd.read_csv(path, sep=";", dtype=str)
    val = [c for c in df.columns if c.startswith("NBFLUX")][0]
    df = df.rename(columns={"CODGEO": "o", "DCLT": "d", val: "n"})
    df["n"] = df.n.str.replace(",", ".").astype(float)
    return df[["o", "d", "n"]]


def main():
    codes = gpd.read_file(PROCESSED / "zones.gpkg").code.tolist()
    try:
        od = from_detail(codes)
        src = "detail"
    except Exception as e:                       # noqa: BLE001
        print("detail file unavailable:", e)
        od, src = from_flux(codes), "flux"
    od.to_parquet(PROCESSED / "od.parquet", index=False)
    print(src, len(od), "OD pairs,", round(od.n.sum()), "workers")


if __name__ == "__main__":
    main()
