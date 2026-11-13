"""Couche sociale et climatique autour de chaque gare."""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

import duckdb
import httpx
from pyproj import Transformer

from sources import RAW

ICU_URL = "https://geoweb.iau-idf.fr/agsmap1/rest/services/OPENDATA/OpendataIAU4/MapServer/13/query"
FILOSOFI = RAW / "filosofi_2021.parquet"
FILOSOFI_URL = ("https://static.data.gouv.fr/resources/revenus-pauvrete-et-niveau-de-vie-donnees-carroyees-dispositif-"
                "fichier-localise-social-et-fiscal-filosofi/20260309-120901/carreaux-200m-met-3035-2021.parquet")
ICU_RADIUS_M, INCOME_RADIUS_M = 300, 500


def _icu(client: httpx.Client, lat: float, lon: float) -> dict | None:
    r = client.get(ICU_URL, params={
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326, "distance": ICU_RADIUS_M,
        "units": "esriSRUnit_Meter", "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "false", "f": "json",
        "outFields": "vulnj_note,vulnn_note,st_area(shape)"}, timeout=60)
    r.raise_for_status()
    rows = [f["attributes"] for f in r.json().get("features", [])]
    area = sum(a["st_area(shape)"] for a in rows if a["vulnj_note"])
    if not area:
        return None
    w = lambda k: round(sum(a[k] * a["st_area(shape)"] for a in rows if a[k]) / area, 1)
    return {"vuln_day": w("vulnj_note"), "vuln_night": w("vulnn_note")}


def heat_vulnerability(stations: list[dict]) -> dict[str, dict]:
    """Une requête par gare (mise en cache dans raw/icu_gares.json)."""
    cache_path = RAW / "icu_gares.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    todo = [s for s in stations if s["id"] not in cache]
    if todo:
        print(f"Vulnérabilité chaleur : {len(todo)} gares à interroger…")
        with httpx.Client() as client, ThreadPoolExecutor(max_workers=6) as pool:
            for s, res in zip(todo, pool.map(lambda s: _icu(client, s["lat"], s["lon"]), todo)):
                cache[s["id"]] = res
        cache_path.write_text(json.dumps(cache), encoding="utf-8")
    return cache


def income(stations: list[dict]) -> dict[str, dict]:
    if not FILOSOFI.exists():
        print("Téléchargement Filosofi 2021…")
        with httpx.stream("GET", FILOSOFI_URL, timeout=600, follow_redirects=True) as r, open(FILOSOFI, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    to3035 = Transformer.from_crs(4326, 3035, always_xy=True)
    con = duckdb.connect()
    con.sql("create table gares (id varchar, x double, y double)")
    con.executemany("insert into gares values (?, ?, ?)", [(s["id"], *to3035.transform(s["lon"], s["lat"])) for s in stations])
    xs, ys = zip(*con.sql("select x, y from gares").fetchall())
    r = INCOME_RADIUS_M
    # Carreaux de la zone des gares seulement, centre du carreau = coin + 100 m
    con.sql(f"""create table car as select bbox.xmin + 100 cx, bbox.ymin + 100 cy, ind, men, men_pauv, ind_snv, ind_65_79 + ind_80p seniors
        from read_parquet('{FILOSOFI.as_posix()}')
        where bbox.xmin between {min(xs) - r - 200} and {max(xs) + r} and bbox.ymin between {min(ys) - r - 200} and {max(ys) + r}""")
    rows = con.sql(f"""select g.id, sum(c.ind), sum(c.ind_snv) / nullif(sum(c.ind), 0), sum(c.men_pauv) / nullif(sum(c.men), 0), sum(c.seniors)
        from gares g join car c on c.cx between g.x - {r} and g.x + {r} and c.cy between g.y - {r} and g.y + {r}
        where (c.cx - g.x) ** 2 + (c.cy - g.y) ** 2 <= {r} ** 2 group by 1""").fetchall()
    return {i: {"population": round(p or 0), "living": round(lv) if lv else None,
                "poor": round(100 * pv, 1) if pv is not None else None, "seniors": round(sn or 0)} for i, p, lv, pv, sn in rows}
