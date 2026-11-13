"""Points noirs pour les piétons et les cyclistes en Île-de-France (accidents corporels BAAC 2021-2024, ONISR)."""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

import duckdb
import httpx

DATA = Path(__file__).resolve().parents[2] / "data"
RAW = DATA / "raw" / "baac"
BASE = "https://static.data.gouv.fr/resources/bases-de-donnees-annuelles-des-accidents-corporels-de-la-circulation-routiere-annees-de-2005-a-"
FILES = {
    2021: {"caract": "2020/20221024-113743/carcteristiques-2021.csv", "usagers": "2022/20231009-140337/usagers-2021.csv",
           "vehicules": "2020/20221024-113925/vehicules-2021.csv"},
    2022: {"caract": "2021/20231005-093927/carcteristiques-2022.csv", "usagers": "2021/20231005-094229/usagers-2022.csv",
           "vehicules": "2021/20231005-094147/vehicules-2022.csv"},
    2023: {"caract": "2023/20241028-103125/caract-2023.csv", "usagers": "2023/20241023-153328/usagers-2023.csv",
           "vehicules": "2023/20241023-153253/vehicules-2023.csv"},
    2024: {"caract": "2024/20251021-115900/caract-2024.csv", "usagers": "2024/20251021-115506/usagers-2024.csv",
           "vehicules": "2024/20251107-100240/vehicules-2024.csv"},
}
IDF = ("75", "77", "78", "91", "92", "93", "94", "95")
DLAT, DLON = 0.001, 0.0015    # ≈ 110 m × 110 m
HOTSPOT = 4                   # accidents en 4 ans dans une case


def cell(lat: float, lon: float) -> str:
    return f"{math.floor(lat / DLAT)},{math.floor(lon / DLON)}"


def _get(year: int, kind: str) -> Path:
    p = RAW / f"{kind}_{year}.csv"
    analyse = Path(__file__).resolve().parents[3] / "analyse" / "raw" / "baac" / f"{kind}_{year}.csv"
    if analyse.exists():
        return analyse
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        r = httpx.get(BASE + FILES[year][kind], timeout=300, follow_redirects=True)
        r.raise_for_status()
        p.write_bytes(r.content)
    return p


def build() -> dict:
    con = duckdb.connect()
    opts = "delim=';', header=true, all_varchar=true, union_by_name=true"
    files = {k: ", ".join(f"'{_get(y, k).as_posix()}'" for y in FILES) for k in ("caract", "usagers", "vehicules")}
    con.sql(f"""create table acc as select coalesce(Num_Acc, Accident_Id) id, lat, long, dep from read_csv([{files['caract']}], {opts})""")
    con.sql(f"create table usa as select Num_Acc id, catu, grav from read_csv([{files['usagers']}], {opts})")
    con.sql(f"create table veh as select Num_Acc id, catv from read_csv([{files['vehicules']}], {opts})")
    rows = con.sql(f"""select replace(a.lat, ',', '.')::double, replace(a.long, ',', '.')::double,
            exists(select 1 from usa u where u.id = a.id and u.catu = '3') pieton,
            exists(select 1 from veh v where v.id = a.id and v.catv in ('1', '80')) velo,
            (select count(*) from usa u where u.id = a.id and u.grav in ('2', '3')) graves
        from acc a where lpad(a.dep, 2, '0') in {IDF}""").fetchall()
    grid: dict[str, list[int]] = {}
    n = 0
    for lat, lon, ped, bike, severe in rows:
        if not (ped or bike) or lat is None or not (48.0 < lat < 49.5 and 1.4 < lon < 3.6):
            continue
        n += 1
        g = grid.setdefault(cell(lat, lon), [0, 0, 0])
        g[0] += int(ped)
        g[1] += int(bike)
        g[2] += int(severe)
    (DATA / "hotspots.json").write_text(json.dumps({"years": list(FILES), "cells": grid}, separators=(",", ":")), encoding="utf-8")
    return {"accidents_pietons_velos": n, "cells": len(grid),
            "points_noirs": sum(1 for g in grid.values() if g[0] + g[1] >= HOTSPOT)}


@lru_cache(maxsize=1)
def _grid() -> dict | None:
    p = DATA / "hotspots.json"
    return json.loads(p.read_text(encoding="utf-8"))["cells"] if p.exists() else None


def along(points: list[tuple[float, float]], mode: str) -> list[dict]:
    """Points noirs traversés (piéton : mode « walk », vélo : « bike »), du plus accidentogène au moins."""
    g = _grid()
    if not g:
        return []
    k = 0 if mode == "walk" else 1
    seen, out = set(), []
    for lat, lon in points:
        c = cell(lat, lon)
        v = g.get(c)
        if c in seen or not v or v[k] < HOTSPOT:
            continue
        seen.add(c)
        out.append({"lat": round((math.floor(lat / DLAT) + 0.5) * DLAT, 5), "lon": round((math.floor(lon / DLON) + 0.5) * DLON, 5),
                    "accidents": v[k], "severe": v[2], "mode": mode})
    return sorted(out, key=lambda x: -x["accidents"])[:3]


if __name__ == "__main__":
    print(build())
