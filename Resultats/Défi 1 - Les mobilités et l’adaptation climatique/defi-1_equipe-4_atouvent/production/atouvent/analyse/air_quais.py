"""Température et particules sur les quais (mesures en continu RATP, 7 stations souterraines)."""
from __future__ import annotations

import json

import duckdb
import httpx

from sources import PERIOD, RAW

RATP = "https://data.ratp.fr/api/explore/v2.1/catalog/datasets"
STATIONS = {
    "Châtelet (métro 4)": "qualite-de-lair-mesuree-dans-la-station-chatelet-2021-maintenant",
    "Auber (RER A)": "qualite-de-lair-mesuree-dans-la-station-auber-2021-a-nos-jours",
    "Franklin D. Roosevelt (métro 1)": "qualite-de-lair-mesuree-dans-la-station-franklin-d-roosevelt-2021-maintenant",
    "Saint-Germain-des-Prés (métro 4)": "qualite-de-lair-mesuree-dans-la-station-saint-germain-des-pres-de-2024-a-nos-jours-",
    "Iéna (métro 9)": "qualite-de-lair-mesuree-dans-la-station-iena-de-2025-a-nos-jours",
    "Nation (RER A)": "qualite-de-lair-mesuree-dans-la-station-nation-rer-a0",
    "Luxembourg (RER B)": "qualite-de-lair-mesuree-dans-la-gare-luxembourg",
}
OMS_PM10 = 45


def _num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def fetch(name: str, dataset: str) -> list[dict]:
    path = RAW / "air" / f"{dataset}.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = httpx.get(f"{RATP}/{dataset}/exports/json", params={
            "where": f"dateheure >= date'{PERIOD[0]}' and dateheure <= date'{PERIOD[1]}'", "timezone": "Europe/Paris"}, timeout=300)
        r.raise_for_status()
        path.write_text(r.text, encoding="utf-8")
    return json.loads(path.read_text(encoding="utf-8"))


def compute() -> dict:
    con = duckdb.connect()
    con.sql(f"""create table meteo as select strptime(AAAAMMJJ, '%Y%m%d')::date jour, try_cast(TX as double) tx
        from read_csv('{(RAW / "meteo_75.csv.gz").as_posix()}', delim=';', header=true, all_varchar=true) where NUM_POSTE = '75114001'""")
    con.sql("create table mesures (station varchar, h timestamp, t double, pm10 double)")
    for name, dataset in STATIONS.items():
        rows = fetch(name, dataset)
        if not rows:
            continue
        keys = rows[0].keys()
        tk = next((k for k in keys if k.startswith("t") and not k.startswith("tp")), None)
        pk = next((k for k in keys if k.startswith("10")), None)
        con.executemany("insert into mesures values (?, ?, ?, ?)",
                        [(name, r["dateheure"][:19], _num(r.get(tk)), _num(r.get(pk))) for r in rows])
    con.sql("""create table jours as select station, h::date jour, max(t) tmax_quai, avg(pm10) pm10, count(t) n_t
        from mesures group by all having count(*) >= 18""")
    out = []
    for name, in con.sql("select distinct station from jours order by 1").fetchall():
        hot, ordinary, n_hot, pm, oms, top = con.sql(f"""select avg(tmax_quai) filter (where m.tx >= 33),
                avg(tmax_quai) filter (where m.tx < 28 and month(j.jour) between 6 and 8),
                count(*) filter (where m.tx >= 33 and tmax_quai is not null), avg(pm10),
                avg(case when pm10 > {OMS_PM10} then 1.0 else 0 end) filter (where pm10 is not null), max(tmax_quai)
            from jours j join meteo m using (jour) where j.station = '{name}'""").fetchone()
        out.append({"station": name, "hot_days": n_hot, "quai_hot": round(hot, 1) if hot else None,
                    "quai_ordinary": round(ordinary, 1) if ordinary else None, "quai_max": round(top, 1) if top else None,
                    "pm10": round(pm, 1) if pm else None, "pm10_over_oms": round(100 * oms, 1) if oms is not None else None})
    return {"stations": out, "oms_pm10": OMS_PM10, "period": list(PERIOD)}


if __name__ == "__main__":
    print(json.dumps(compute(), ensure_ascii=False, indent=1))
