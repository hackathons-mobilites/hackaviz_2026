"""Accidents corporels de la route en Île-de-France selon la météo de l'heure (BAAC 2021-2024, ONISR)."""
from __future__ import annotations

import duckdb

from sources import RAW

YEARS = (2021, 2022, 2023, 2024)
IDF = ("75", "77", "78", "91", "92", "93", "94", "95")
# Codes WW (temps présent) de l'Organisation météorologique mondiale
HOURS = {
    "pluie_forte": ("Pluie forte (≥ 2 mm en une heure)", "rr >= 2"),
    "pluie": ("Pluie (0,2 à 2 mm)", "rr >= 0.2 and rr < 2"),
    "neige": ("Neige ou grésil", "ww between 70 and 79 or ww between 83 and 88"),
    "brouillard": ("Brouillard", "ww between 40 and 49"),
    "orage": ("Orage", "ww between 91 and 99 or ww = 17"),
    "vent_fort": ("Rafales ≥ 16 m/s (≈ 58 km/h)", "fxi >= 16"),
    "chaleur": ("Chaleur (≥ 30 °C)", "t >= 30"),
}
CALM = "rr = 0 and coalesce(ww, 0) < 40 and fxi < 10 and t between 0 and 28"


def compute() -> dict:
    con = duckdb.connect()
    r = RAW.as_posix()
    files = ", ".join(f"'{r}/baac/caract_{y}.csv'" for y in YEARS)
    con.sql(f"""create table acc as select (make_date(an::int, mois::int, jour::int)
            + to_hours(split_part(hrmn, ':', 1)::int)) h, atm
        from read_csv([{files}], delim=';', header=true, all_varchar=true, union_by_name=true)
        where lpad(dep, 2, '0') in {IDF}""")
    # Heures Météo-France en UTC → heure de Paris (comme l'heure des accidents)
    con.sql(f"""create table meteo as select
            timezone('Europe/Paris', strptime(AAAAMMJJHH, '%Y%m%d%H')::timestamp at time zone 'UTC')::timestamp h,
            coalesce(try_cast(RR1 as double), 0) rr, coalesce(try_cast(FXI as double), 0) fxi,
            try_cast(T as double) t, try_cast(WW as int) ww
        from read_csv('{r}/meteo_75_horaire_previous.csv.gz', delim=';', header=true, all_varchar=true)
        where NUM_POSTE = '75114001' and AAAAMMJJHH between '{YEARS[0] - 1}123100' and '{YEARS[-1]}123123'""")
    con.sql(f"""create table heures as select m.*, month(m.h) mois, hour(m.h) heure,
            case dayofweek(m.h) when 0 then 'dim' when 6 then 'sam' else 'sem' end typ,
            count(a.h) n
        from meteo m left join acc a on a.h = m.h where year(m.h) between {YEARS[0]} and {YEARS[-1]} and m.t is not null group by all""")
    con.sql(f"create table attendu as select mois, typ, heure, avg(n) n from heures where {CALM} group by all")
    out = {"years": list(YEARS), "total": con.sql("select count(*) from acc").fetchone()[0], "hours": []}
    for key, (label, cond) in HOURS.items():
        hours, obs, exp = con.sql(f"""select count(*), sum(h.n), sum(a.n) from heures h join attendu a using (mois, typ, heure)
            where {cond}""").fetchone()
        if not hours:  # aléa jamais relevé par la station (ex. orages à Montsouris) : pas de ligne vide
            continue
        out["hours"].append({"key": key, "label": label, "hours": hours, "accidents": int(obs or 0),
                             "ratio": round(obs / exp, 2) if exp else None,
                             "reliability": "solide" if hours >= 200 else "moyenne" if hours >= 50 else "indicatif"})
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(compute(), ensure_ascii=False, indent=1))
