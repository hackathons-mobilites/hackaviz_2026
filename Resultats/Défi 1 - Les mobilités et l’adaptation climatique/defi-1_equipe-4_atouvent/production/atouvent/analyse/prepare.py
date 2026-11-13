"""Aléas climatiques et transports franciliens : préparation des données des écrans 09 à 11.
Lancer : python analyse/prepare.py   (télécharge les données la première fois)"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb

import accidents
import air_quais
import ascenseurs_chaleur
import projections
import social
from sources import PERIOD, RAW, fetch_all, fetch_history, holidays

OUT = Path(__file__).resolve().parents[1] / "backend" / "data" / "chaleur.json"
# Gares et lignes (avec la climatisation) pour l'application : « Autour de moi » et « Itinéraires »
OUT_GARES = Path(__file__).resolve().parents[1] / "frontend" / "public" / "data" / "gares.json"
THRESHOLDS = [30, 33, 35, 38]
DEFAULT_THRESHOLD = 33
ORDINARY = {"tx": 28.0, "rr": 10.0, "fxi": 16.0}  # sous les seuils d'aléa
# Vacances scolaires zone C 2025-2026 et pont de l'Ascension (calendrier scolaire, data.education.gouv.fr) L'été est coupé en juillet et août : la fréquentation d'août (semaine du 15) n'a rien à voir avec celle de juillet
NO_SCHOOL = [("2025-07-05", "2025-07-31"), ("2025-08-01", "2025-08-31"), ("2025-10-18", "2025-11-02"),
             ("2025-12-20", "2026-01-04"), ("2026-02-21", "2026-03-08"), ("2026-04-18", "2026-05-03"), ("2026-05-14", "2026-05-17")]
WINDOW_DAYS = 42   # référence cherchée jusqu'à 6 semaines autour du jour…
NEAREST = 4        # …en gardant les 4 jours ordinaires les plus proches
# Aléas : condition sur la météo du jour (Paris-Montsouris)
HAZARD_DEFS = {
    "chaleur": ("Tmax ≥ 33 °C", "tx >= 33"),
    "orages_pluie": ("Pluie ≥ 10 mm dans la journée", "rr >= 10"),
    "neige_verglas": ("Neige au sol ou pluie avec gel (Tmin ≤ 0 °C)", "neige or (tn <= 0 and rr > 0)"),
    "grand_froid": ("Tmin ≤ −5 °C", "tn <= -5"),
    "vent_fort": ("Rafales ≥ 16 m/s (≈ 58 km/h)", "fxi >= 16"),
}
# Correspondance avec les heures d'aléa de l'analyse des accidents
ACCIDENT_KEY = {"chaleur": "chaleur", "orages_pluie": "pluie_forte", "neige_verglas": "neige", "vent_fort": "vent_fort"}
SERIES_FROM = "2026-04-01"  # courbe des gares : printemps 2026 et canicule de juin
ANOMALY = 0.07   # écart au-delà duquel un jour ordinaire est jugé perturbé (grève, incident)
MIN_REF = 500  # gares à moins de 500 validations par jour : trop peu pour un écart fiable
TITLES = {  # catégories de titres IDFM → libellés de l'écran
    "Forfait Navigo": "Abonnés Navigo (annuel et mensuel)",
    "Imagine R": "Étudiants et scolaires (Imagine R)",
    "Forfaits courts": "Forfaits courts (jour, semaine)",
    "Contrat Solidarité Transport": "Tarification solidarité",
    "Amethyste": "Seniors et handicap (Améthyste)",
    "Autres titres": "Tickets et autres titres",
}


def pct(x: float | None) -> float | None:
    return None if x is None else round(100 * x, 1)


def load(con: duckdb.DuckDBPyConnection) -> None:
    r = RAW.as_posix()
    csv = "delim=';', header=true, all_varchar=true"
    # Certaines lignes notent l'identifiant de gare « 71370.0 » : on retire le « .0 ».
    con.sql(f"""create table vald as select strptime(jour, '%Y-%m-%d')::date jour,
        regexp_replace(coalesce(id_zdc, ida), '[.]0$', '') zdc, libelle_arret, categorie_titre titre, nb_vald::bigint n
        from read_csv('{r}/validations_20*.csv', {csv}, union_by_name=true)""")
    con.sql(f"""create table meteo as select strptime(a.AAAAMMJJ, '%Y%m%d')::date jour, try_cast(a.TX as double) tx,
        try_cast(a.TN as double) tn, coalesce(try_cast(a.RR as double), 0) rr, coalesce(try_cast(a.FXI as double), 0) fxi,
        coalesce(b.NEIG = '1' or try_cast(b.NEIGETOTX as double) > 0, false) neige
        from read_csv('{r}/meteo_75.csv.gz', {csv}) a
        left join read_csv('{r}/meteo_75_autres.csv.gz', {csv}) b on b.NUM_POSTE = a.NUM_POSTE and b.AAAAMMJJ = a.AAAAMMJJ
        where a.NUM_POSTE = '75114001'""")
    con.sql(f"create table lignes as select * from read_csv('{r}/lignes.csv', {csv})")
    con.sql(f"create table al as select * from read_csv('{r}/arrets_lignes.csv', {csv})")
    con.sql(f"create table arrets as select arrid, zdaid, arrtype, arraccessibility from read_csv('{r}/arrets.csv', {csv})")
    con.sql(f"create table zones as select zdaid, zdcid from read_csv('{r}/zones_arret.csv', {csv})")
    # Gare de validation (zone de correspondance) → lignes qui la desservent.
    con.sql("""create table gare_ligne as
        with s as (select al.*, coalesce(nullif(regexp_extract(stop_id, 'monomodalStopPlace:(\\d+)', 1), ''), a.zdaid) zdaid
                   from al left join arrets a on a.arrid = replace(al.stop_id, 'IDFM:', ''))
        select distinct z.zdcid zdc, replace(s.id, 'IDFM:', '') id_line, s.mode, s.shortname,
               mode(s.stop_name) over (partition by z.zdcid) nom,
               avg(s.stop_lat::double) over (partition by z.zdcid) lat, avg(s.stop_lon::double) over (partition by z.zdcid) lon,
               l.air_conditioning ac, l.colourweb_hexa couleur, l.textcolourweb_hexa texte
        from s join zones z on z.zdaid = s.zdaid left join lignes l on l.id_line = replace(s.id, 'IDFM:', '')""")


def calendar(con: duckdb.DuckDBPyConnection) -> None:
    off = holidays(RAW / "feries_2025.json") | holidays(RAW / "feries_2026.json")
    rows = []
    d, end = date.fromisoformat(PERIOD[0]), date.fromisoformat(PERIOD[1])
    while d <= end:
        iso = d.isoformat()
        # Segment : période scolaire (0) ou numéro de la période de vacances (1, 2…)
        seg = next((i + 1 for i, (a, b) in enumerate(NO_SCHOOL) if a <= iso <= b), 0)
        rows.append((d, d.weekday(), d.weekday() < 5 and iso not in off, seg))
        d += timedelta(days=1)
    con.sql("create table cal (jour date, dow int, ouvre bool, scolaire int)")
    con.executemany("insert into cal values (?, ?, ?, ?)", rows)
    hazard = " or ".join(f"({c})" for _, c in HAZARD_DEFS.values())
    con.sql(f"""create table jours as select c.jour, c.dow, c.scolaire, m.tx, m.tn, m.rr, m.fxi, m.neige,
        m.tx < {ORDINARY['tx']} and not ({hazard}) ordinaire
        from cal c join meteo m using (jour) where c.ouvre and m.tx is not null""")


def _pairs(con) -> None:
    """Jours de référence de chaque jour : les 4 jours ordinaires les plus proches, même jour de la semaine, même période (scolaire, ou même période de vacances), à 6 semaines au plus."""
    con.sql(f"""create or replace table pairs as select jour, rjour from (
        select a.jour, b.jour rjour, row_number() over (partition by a.jour order by abs(datediff('day', a.jour, b.jour))) k
        from jours a join jours b on b.dow = a.dow and b.scolaire = a.scolaire and b.ordinaire and b.jour <> a.jour
        and abs(datediff('day', a.jour, b.jour)) <= {WINDOW_DAYS}) where k <= {NEAREST}""")


def window(con, table: str, key: str, value: str) -> str:
    """Requête : chaque ligne (clé, jour) avec la moyenne de la même clé sur ses jours de référence (au moins 2)."""
    k = f"t.{key}, " if key else ""
    on = f"r.{key} = t.{key} and " if key else ""
    return f"""select {k}t.jour, t.{value} n, avg(r.{value}) base from {table} t join pairs p on p.jour = t.jour
        join {table} r on {on}r.jour = p.rjour group by all having count(*) >= 2"""


def reference(con: duckdb.DuckDBPyConnection) -> None:
    con.sql("create table gj as select zdc, jour, sum(n) n from vald where jour in (select jour from jours) group by all")
    con.sql("create table tot as select jour, sum(n) n from gj group by 1")
    # Jours ordinaires perturbés (grève, incident) : écart à leur propre référence > 7 % (deux passes)
    con.sql("create table perturbes (jour date, ecart double)")
    for _ in range(2):
        _pairs(con)
        con.sql(f"""insert into perturbes select jour, round(100 * (n / base - 1), 1) from ({window(con, 'tot', '', 'n')})
            where abs(n / base - 1) > {ANOMALY} and jour in (select jour from jours where ordinaire)""")
        con.sql("update jours set ordinaire = false where jour in (select jour from perturbes)")
    _pairs(con)
    con.sql(f"""create table ecart as select e.zdc, e.jour, j.tx, j.tn, j.rr, j.fxi, j.neige, e.n, e.base
        from ({window(con, 'gj', 'zdc', 'n')}) e join jours j using (jour)""")


def stations(con: duckdb.DuckDBPyConnection) -> list[dict]:
    lines = {}
    for zdc, id_line, mode, short, nom, lat, lon, ac, color, text in con.sql("select * from gare_ligne").fetchall():
        s = lines.setdefault(zdc, {"lat": lat, "lon": lon, "name": nom, "lines": {}})
        s["lines"][id_line] = {"id": id_line, "line": short, "mode": mode, "ac": ac or "unknown", "color": f"#{color}" if color else None,
                                   "text": f"#{text}" if text else None}
    names = dict(con.sql("select zdc, any_value(libelle_arret) from vald group by 1").fetchall())
    write_gares(con, lines)
    refs = dict(con.sql("select zdc, avg(n) from ecart where jour in (select jour from jours where ordinaire) group by 1").fetchall())
    # Écart de chaque gare sur les jours de chaque aléa (et de chaque seuil de chaleur), en une requête
    conds = {f"t{t}": f"tx >= {t}" for t in THRESHOLDS} | {k: c for k, (_, c) in HAZARD_DEFS.items()}
    hz = {}
    for key, cond in conds.items():
        for z, n, b in con.sql(f"select zdc, sum(n), sum(base) from ecart where {cond} group by 1").fetchall():
            hz[(z, key)] = pct(n / b - 1) if b else None
    out = []
    for zdc, info in lines.items():
        if zdc not in refs:
            continue
        acs = {l["ac"] for l in info["lines"].values()}
        status = ("equipee" if acs == {"true"} else "non" if acs <= {"false", "unknown"} and "false" in acs
                  else "inconnu" if acs == {"unknown"} else "partielle")
        changes = {str(t): hz.get((zdc, f"t{t}")) for t in THRESHOLDS}
        # Nom officiel de l'arrêt (« Opéra ») plutôt que le libellé abrégé des validations (« OPERA »)
        out.append({"id": zdc, "name": info["name"] or names.get(zdc, "").title(), "lat": round(info["lat"], 5), "lon": round(info["lon"], 5),
                    "lines": sorted(info["lines"].values(), key=lambda l: (l["mode"], l["line"] or "")),
                    "ac": status, "ref": round(refs[zdc]), "change": changes, "reliable": refs[zdc] >= MIN_REF,
                    "hazard": {k: hz.get((zdc, k)) for k in HAZARD_DEFS}})
    return out


def write_gares(con, lines: dict) -> None:
    # Gare accessible si tous ses quais (métro, RER, train, tram) sont déclarés accessibles par IDFM ; inconnu sinon
    acc = {z: (ok == n if unknown == 0 else None) for z, ok, n, unknown in con.sql("""select z.zdcid,
        count(*) filter (where arraccessibility = 'true'), count(*), count(*) filter (where arraccessibility = 'unknown')
        from arrets a join zones z using (zdaid) where arrtype in ('rail', 'metro', 'tram') group by 1""").fetchall()}
    gares = [{"id": z, "name": i["name"], "lat": round(i["lat"], 5), "lon": round(i["lon"], 5), "accessible": acc.get(z),
              "lines": sorted(i["lines"].values(), key=lambda l: (l["mode"], l["line"] or ""))} for z, i in lines.items() if i["name"]]
    OUT_GARES.parent.mkdir(parents=True, exist_ok=True)
    OUT_GARES.write_text(json.dumps(gares, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def series(con: duckdb.DuckDBPyConnection, ids: set[str]) -> dict:
    # Validations jour par jour de chaque gare (pour le graphique du panneau « gare sélectionnée »)
    days = [d.isoformat() for (d,) in con.sql(f"select jour from jours where jour >= '{SERIES_FROM}' order by 1").fetchall()]
    out: dict[str, list] = {}
    for zdc, jour, n in con.sql("select zdc, jour, n from gj order by jour").fetchall():
        if zdc in ids:
            out.setdefault(zdc, {})[jour.isoformat()] = n
    return {"days": days, "values": {z: [v.get(d) for d in days] for z, v in out.items()}}


# Indice d'exposition (sur 10) : chaleur du quartier, lignes non climatisées, ménages modestes
INDEX_WEIGHTS = {"heat": 0.4, "no_ac": 0.3, "poverty": 0.3}
NO_AC = {"non": 1.0, "partielle": 0.5, "equipee": 0.0, "inconnu": 0.5}


def add_social(stations_: list[dict]) -> None:
    """Ajoute revenus (Filosofi) et vulnérabilité chaleur (Institut Paris Region), puis l'indice d'exposition."""
    inc, icu = social.income(stations_), social.heat_vulnerability(stations_)
    poor = sorted(v["poor"] for v in inc.values() if v["poor"] is not None)
    living = sorted(v["living"] for v in inc.values() if v["living"])
    rank = lambda xs, x: sum(1 for y in xs if y <= x) / len(xs)
    for s in stations_:
        s.update(inc.get(s["id"]) or {"population": None, "living": None, "poor": None, "seniors": None})
        s.update(icu.get(s["id"]) or {"vuln_day": None, "vuln_night": None})
        # Quartile de niveau de vie : 1 = quartiers les plus modestes
        s["income_q"] = min(4, int(rank(living, s["living"]) * 4 - 1e-9) + 1) if s["living"] else None
        if s["vuln_day"] is None or s["poor"] is None:
            s["index"] = None
            continue
        parts = {"heat": (s["vuln_day"] - 1) / 8, "no_ac": NO_AC[s["ac"]], "poverty": rank(poor, s["poor"])}
        s["index"] = round(10 * sum(INDEX_WEIGHTS[k] * v for k, v in parts.items()), 1)


def by_income(stations_: list[dict], t: int) -> list[dict]:
    """Par quartile de niveau de vie : part des voyageurs sans clim, vulnérabilité chaleur, baisse les jours chauds."""
    out = []
    for q in (1, 2, 3, 4):
        st = [s for s in stations_ if s["income_q"] == q and s["reliable"]]
        ref = sum(s["ref"] for s in st)
        chg = [(s["change"][str(t)], s["ref"]) for s in st if s["change"][str(t)] is not None]
        out.append({"q": q, "stations": len(st),
                    "living_max": max((s["living"] for s in st), default=None),
                    "no_ac": round(100 * sum(s["ref"] for s in st if s["ac"] == "non") / ref, 1) if ref else None,
                    "vuln_day": round(sum(s["vuln_day"] * s["ref"] for s in st if s["vuln_day"]) / ref, 1) if ref else None,
                    "change": round(sum(c * r for c, r in chg) / sum(r for _, r in chg), 1) if chg else None})
    return out


def lines_summary(stations_: list[dict]) -> list[dict]:
    """Par ligne : voyageurs de ses gares un jour ordinaire et écart moyen pondéré les jours de chaleur."""
    acc: dict[str, dict] = {}
    for s in stations_:
        if not s["reliable"]:
            continue
        for l in s["lines"]:
            a = acc.setdefault(l["id"], {**{k: l[k] for k in ("id", "line", "mode", "ac", "color", "text")}, "ref": 0, "w": {}})
            a["ref"] += s["ref"]
            for t, c in s["change"].items():
                if c is not None:
                    w = a["w"].setdefault(t, [0, 0])
                    w[0] += c * s["ref"]
                    w[1] += s["ref"]
    out = []
    for a in acc.values():
        out.append({**{k: a[k] for k in ("id", "line", "mode", "ac", "color", "text")}, "ref": round(a["ref"]),
                    "change": {t: round(v[0] / v[1], 1) for t, v in a.pop("w").items() if v[1]}})
    return sorted(out, key=lambda x: x["ref"], reverse=True)


def by_ac(con, stations_: list[dict], t: int) -> list[dict]:
    con.sql("create or replace temp table st (zdc varchar, ac varchar)")
    con.executemany("insert into st values (?, ?)", [(s["id"], s["ac"]) for s in stations_])
    rows = con.sql(f"""select st.ac, sum(e.n) filter (where e.tx >= {t}) n, sum(e.base) filter (where e.tx >= {t}) base,
        sum(e.base) filter (where e.tx >= {t}) / sum(sum(e.base) filter (where e.tx >= {t})) over () part, count(distinct st.zdc) gares
        from ecart e join st using (zdc) group by 1""").fetchall()
    return [{"ac": ac, "change": pct(n / ref - 1) if ref else None, "share": pct(part), "stations": g}
            for ac, n, ref, part, g in rows if ac != "inconnu"]


def by_title(con, cond: str) -> list[dict]:
    con.sql("create or replace table td as select titre, jour, sum(n) n from vald where jour in (select jour from jours) group by all")
    rows = con.sql(f"""select e.titre, sum(e.n), sum(e.base) from ({window(con, 'td', 'titre', 'n')}) e join jours j using (jour)
        where {cond} group by 1""").fetchall()
    # Une catégorie qui varie de plus de 50 % a changé de contenu sur la période (nouveau titre) : écartée
    out = [{"title": TITLES[k], "change": pct(n / ref - 1)} for k, n, ref in rows if k in TITLES and ref]
    return sorted((x for x in out if abs(x["change"]) <= 50), key=lambda x: x["change"], reverse=True)


def daily_total(con) -> list[dict]:
    """Un point par jour ouvré : température et écart du réseau ferré à la référence."""
    rows = con.sql("""select jour, any_value(tx), sum(n) / sum(base) - 1 from ecart group by 1 order by 1""").fetchall()
    return [{"date": d.isoformat(), "tx": tx, "rail": pct(x)} for d, tx, x in rows]


def bikes(con) -> dict:
    con.sql(f"create table velo as select * from read_json('{(RAW / 'velo_annee.json').as_posix()}')")
    # Compteurs présents tous les jours disponibles (sinon l'écart mesure l'arrivée ou la panne d'un compteur)
    con.sql("""create table cpt as select id_compteur from velo group by 1
        having count(distinct jour) >= 0.95 * (select count(distinct jour) from velo)""")
    # Somme sur les compteurs retenus ; un jour où un compteur manque compte un peu moins (au plus 5 % des jours)
    con.sql("""create table vj as select v.jour::date jour, sum(v.n) n from velo v
        where v.jour::date in (select jour from jours) and id_compteur in (select id_compteur from cpt) group by all""")
    con.sql(f"create table vjr as select e.*, j.tx, j.tn, j.rr, j.fxi, j.neige from ({window(con, 'vj', '', 'n')}) e join jours j using (jour)")
    out = {"daily": {d.isoformat(): pct(n / b - 1) for d, n, b in con.sql("select jour, n, base from vjr").fetchall()},
           "counters": con.sql("select count(*) from cpt").fetchone()[0],
           "first_day": str(con.sql("select min(jour) from vj").fetchone()[0])}
    for t in THRESHOLDS:
        out[str(t)] = change(con, "vjr", f"tx >= {t}")
    # Profil horaire : part de chaque heure dans la journée, jours de chaleur et jours ordinaires
    prof = con.sql(f"""select v.heure::int h, sum(v.n) filter (where j.tx >= {DEFAULT_THRESHOLD}) chaud, sum(v.n) filter (where j.ordinaire) ord
        from velo v join jours j on j.jour = v.jour::date where id_compteur in (select id_compteur from cpt) group by 1 order by 1""").fetchall()
    tc, to = sum(r[1] or 0 for r in prof), sum(r[2] or 0 for r in prof)
    out["hourly"] = [{"h": h, "heat": round(100 * (c or 0) / tc, 2), "ordinary": round(100 * (o or 0) / to, 2)} for h, c, o in prof]
    return out


def change(con, table: str, cond: str) -> float | None:
    n, b = con.sql(f"select sum(n), sum(base) from {table} where {cond}").fetchone()
    return pct(n / b - 1) if b else None


def roads(con) -> dict:
    con.sql(f"create table rt as select * from read_json('{(RAW / 'routier_annee.json').as_posix()}')")
    con.sql("create table rt_days as select distinct jour::date jour from rt where jour::date in (select jour from jours)")
    # Tronçons mesurés au moins 20 h par jour sur 95 % des jours ouvrés disponibles
    con.sql("""create table arcs as select iu_ac from rt where jour::date in (select jour from rt_days) group by 1
        having count(*) filter (where h >= 20) >= 0.95 * (select count(*) from rt_days)""")
    con.sql("""create table rj as select rt.jour::date jour, sum(q) n from rt
        where h >= 20 and iu_ac in (select iu_ac from arcs) and rt.jour::date in (select jour from rt_days) group by all""")
    con.sql(f"create table rjr as select e.*, j.tx, j.tn, j.rr, j.fxi, j.neige from ({window(con, 'rj', '', 'n')}) e join jours j using (jour)")
    out = {"arcs": con.sql("select count(*) from arcs").fetchone()[0],
           "daily": {d.isoformat(): pct(n / b - 1) for d, n, b in con.sql("select jour, n, base from rjr").fetchall()}}
    for t in THRESHOLDS:
        out[str(t)] = change(con, "rjr", f"tx >= {t}")
    return out


def hazards(con, acc: dict) -> list[dict]:
    """Tous les aléas côte à côte : jours observés, transports, vélo, voiture, accidents, titres, liste des jours."""
    acc_by = {h["key"]: h for h in acc["hours"]}
    out = []
    for key, (label, cond) in HAZARD_DEFS.items():
        days = con.sql(f"""select j.jour, j.tx, j.tn, j.rr, j.fxi, j.neige, t.n / t.base - 1 from jours j
            join (select jour, sum(n) n, sum(base) base from ecart group by 1) t using (jour) where {cond} order by 1""").fetchall()
        a = acc_by.get(ACCIDENT_KEY.get(key))
        out.append({"hazard": key, "definition": label, "days": len(days),
                    "rail": change(con, "ecart", cond), "bike": change(con, "vjr", cond), "road": change(con, "rjr", cond),
                    "accidents": a["ratio"] if a else None, "accident_hours": a["hours"] if a else None,
                    "titles": by_title(con, cond) if days else [],
                    "reliability": "solide" if len(days) >= 8 else "moyenne" if len(days) >= 4 else "indicatif",
                    "list": [{"date": d.isoformat(), "tx": tx, "tn": tn, "rr": rr, "fxi": fx, "snow": sn, "rail": pct(x)}
                             for d, tx, tn, rr, fx, sn, x in days]})
    return out


def main() -> None:
    fetch_all()
    fetch_history()
    con = duckdb.connect()
    load(con)
    calendar(con)
    reference(con)
    st = stations(con)
    add_social(st)
    t = DEFAULT_THRESHOLD
    episode = con.sql("select jour, tx from jours where tx >= 30 and jour >= '2026-06-15' order by 1").fetchall()
    hot = con.sql("select max(tx), arg_max(jour, tx) from meteo where jour between '2026-06-01' and '2026-06-30'").fetchone()
    bike, road = bikes(con), roads(con)
    acs = {str(th): by_ac(con, st, th) for th in THRESHOLDS}
    titles = {str(th): by_title(con, f"tx >= {th}") for th in THRESHOLDS}
    acc = accidents.compute()
    # Où agir : gares les plus exposées (indice), parmi celles qui ont au moins une ligne non climatisée
    priority = sorted((s for s in st if s["ac"] in ("non", "partielle") and s["reliable"] and s["index"] is not None),
                      key=lambda s: s["index"], reverse=True)[:12]
    no_ac = next((a["share"] for a in acs[str(t)] if a["ac"] == "non"), None)
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period": {"start": PERIOD[0], "end": PERIOD[1], "weekdays": con.sql("select count(*) from jours").fetchone()[0],
                   "reference_days": con.sql("select count(*) from jours where ordinaire").fetchone()[0]},
        "episode": {"start": "2026-06-17", "end": "2026-06-27", "tmax": hot[0], "tmax_date": hot[1].isoformat(),
                    "days": [{"date": d.isoformat(), "tx": tx} for d, tx in episode]},
        "thresholds": THRESHOLDS, "default_threshold": t, "ordinary": ORDINARY, "window_days": WINDOW_DAYS,
        "disrupted_days": [{"date": d.isoformat(), "change": e} for d, e in con.sql("select * from perturbes order by 1").fetchall()],
        "kpis": {str(th): {"rail": change(con, "ecart", f"tx >= {th}"), "bike": bike[str(th)], "road": road[str(th)],
                           "heat_days": con.sql(f"select count(*) from jours where tx >= {th}").fetchone()[0]} for th in THRESHOLDS},
        "no_ac_share": no_ac,
        "by_ac": acs, "by_title": titles, "daily": daily_total(con),
        "by_income": {str(th): by_income(st, th) for th in THRESHOLDS}, "index_weights": INDEX_WEIGHTS,
        "bike": {"counters": bike["counters"], "hourly": bike["hourly"], "daily": bike["daily"], "first_day": bike["first_day"]},
        "road": {"arcs": road["arcs"], "daily": road["daily"]},
        "hazards": hazards(con, acc), "accidents": acc,
        "elevators_heat": ascenseurs_chaleur.compute(), "platforms": air_quais.compute(),
        "stations": st, "priority": [s["id"] for s in priority], "lines": lines_summary(st),
        "series": series(con, {s["id"] for s in st if s["reliable"]}),
        "sources": ["Validations par jour et par gare, réseau ferré (IDFM, juillet 2025 à juin 2026)",
                    "Référentiel des lignes, champ climatisation (IDFM)", "Arrêts et lignes associées, zones d'arrêts (IDFM)",
                    "Données climatologiques quotidiennes et horaires, Paris-Montsouris (Météo-France)",
                    "Accidents corporels de la circulation 2021-2024 (ONISR, fichiers BAAC)",
                    "Historique de disponibilité des ascenseurs 2013-2023 (Dispotrains)",
                    "Qualité de l'air et température sur les quais (mesures en continu RATP)",
                    "Comptages vélo et comptages routiers permanents (Ville de Paris)",
                    "Revenus carroyés 200 m, Filosofi 2021 (INSEE)",
                    "Îlots de chaleur urbains et vulnérabilité à la chaleur 2022 (Institut Paris Region)",
                    "Jours fériés (calendrier.api.gouv.fr), calendrier scolaire zone C (Éducation nationale)",
                    *projections.SOURCES],
    }
    # Chaleur à venir (TRACC +2,7 °C et +4 °C) et effet attendu gare par gare
    data["projections"] = projections.build(st, data["series"], {d["date"] for d in data["daily"] if d["tx"] >= 33})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT} ({OUT.stat().st_size // 1024} Ko) · {len(st)} gares · réseau ferré {data['kpis'][str(t)]['rail']} % "
          f"· vélo {bike[str(t)]} % · voiture {road[str(t)]} % · sans clim {no_ac} % des voyageurs")


if __name__ == "__main__":
    main()
