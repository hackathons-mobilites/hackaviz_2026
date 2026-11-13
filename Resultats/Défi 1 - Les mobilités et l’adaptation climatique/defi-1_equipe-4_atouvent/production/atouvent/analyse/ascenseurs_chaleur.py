"""Pannes d'ascenseurs selon la température du jour (historique Dispotrains 2013-2023, Météo-France)."""
from __future__ import annotations

import duckdb

from sources import RAW

BINS = [(None, 20, "< 20 °C"), (20, 25, "20 à 25 °C"), (25, 30, "25 à 30 °C"), (30, 33, "30 à 33 °C"), (33, None, "≥ 33 °C")]


def compute() -> dict:
    r = RAW.as_posix()
    con = duckdb.connect()
    con.sql(f"""create table iv as select elevator, state, (begin['$date'])::timestamptz b, ("end"['$date'])::timestamptz e
        from read_json('{r}/dispotrains/x/statistics.json', format='newline_delimited')
        where begin is not null and "end" is not null""")
    first, last = con.sql("select min(b)::date, max(e)::date from iv").fetchone()
    # Temps de service de chaque jour, de 6 h à 22 h heure de Paris
    con.sql(f"""create table jours as select d::date jour,
            timezone('Europe/Paris', d::timestamp + interval 6 hour) s, timezone('Europe/Paris', d::timestamp + interval 22 hour) f
        from range(date '{first}', date '{last}', interval 1 day) t(d)""")
    con.sql("""create table part as select j.jour,
            sum(epoch(least(iv.e, j.f) - greatest(iv.b, j.s))) filter (where iv.state <> 'Disponible') panne,
            sum(epoch(least(iv.e, j.f) - greatest(iv.b, j.s))) total, count(distinct iv.elevator) ascenseurs
        from jours j join iv on iv.b < j.f and iv.e > j.s group by 1""")
    csv = "delim=';', header=true, all_varchar=true"
    con.sql(f"""create table meteo as select strptime(AAAAMMJJ, '%Y%m%d')::date jour, try_cast(TX as double) tx
        from read_csv('{r}/meteo_75_previous.csv.gz', {csv}) where NUM_POSTE = '75114001'""")
    rows = con.sql("""select p.jour, m.tx, coalesce(p.panne, 0) / p.total part_panne, p.ascenseurs from part p join meteo m using (jour)
        where p.total > 0 and p.ascenseurs >= 100 and m.tx is not null""").fetchall()
    out = {"period": [str(first), str(last)], "days": len(rows), "elevators": max(r[3] for r in rows), "bins": []}
    for lo, hi, label in BINS:
        sel = [s for _, tx, s, _ in rows if (lo is None or tx >= lo) and (hi is None or tx < hi)]
        out["bins"].append({"label": label, "days": len(sel), "share": round(100 * sum(sel) / len(sel), 2) if sel else None})
    base = next(b for b in out["bins"] if b["label"] == "20 à 25 °C")["share"]
    hot = [s for _, tx, s, _ in rows if tx >= 30]
    out["ratio_hot"] = round(100 * sum(hot) / len(hot) / base, 2) if hot and base else None
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(compute(), ensure_ascii=False, indent=1))
