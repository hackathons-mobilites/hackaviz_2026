"""07h - Correspondances des itinéraires TC publiés contre les temps minimaux officiels (GTFS IDFM `transfers.txt`).

CONTRÔLE seulement : lecture seule de `frontend/public/data/` et des lots de 04h ; ni r5py ni Java ; aucune durée
publiée n'est modifiée. Logique dans `starway/transfer_times.py` (tests : tests/test_transfer_times.py).

Pour chaque itinéraire détaillé publié (réglage « normal », `meta.itineraries_communes`), chaque correspondance entre
deux tronçons en TC est comparée au `min_transfer_time` du couple exact de quais (descente, montée). Un itinéraire dont
au moins une correspondance est plus courte que le minimum est ensuite **recalé sur les mêmes lignes** (mêmes quais,
courses suivantes du GTFS du jour) en respectant les minimums : on obtient une borne haute de la durée qui les
respecte, pas un nouveau calcul (un autre itinéraire peut être plus rapide). Les verdicts (allumé à 30, 45, 60 min)
qui ne tiennent plus avec cette borne sont dits « à risque » : seul un nouveau calcul du moteur peut trancher.

Deux règles, jamais mélangées dans un même chiffre :
- `gtfs` : le seul `transfers.txt` (minimum officiel publié en open data) ;
- `reference` : `transfers.txt`, puis, pour les couples sans ligne (même arrêt surtout), la durée de correspondance de
  Navitia (calculateur officiel, API « connections », relevée par 07i dans `data/processed/navitia_connections.csv`).

Sorties :
- `data/processed/transfer_check_walk3000_summary.json` : comptes par journée-type, pôle, statut ; verdicts à
  risque ; trajets du récit et des découvertes concernés ;
- `data/interim/transfer_check/transfer_check_walk3000_short.csv.gz` : un trajet (commune, pôle, journée, sens) par ligne, pour ceux
  qui ont au moins une correspondance trop courte (détail, borne recalée) ;
- `data/interim/transfer_check/transfers_all.csv.gz` : toutes les correspondances contrôlées, et `trips_all.csv.gz` :
  tous les itinéraires et leur statut (lu par 07j) ; non versionnés.

Usage : python scripts/07h_transfer_times_check.py
        python scripts/07h_transfer_times_check.py --walk-setting comfort
Réglage « confort » (D-024, 04/11) : itinéraires publiés de `itineraries_walk1000/`, lots `itineraries_walk1000`,
séries `variants.comfort.transit` ; sorties `transfer_check_walk1000_summary.json` et
`data/interim/transfer_check_walk1000/` ; pas de bloc des découvertes (elles portent sur le réglage par défaut).
        python scripts/07h_transfer_times_check.py --src <lots de 04h des itinéraires publiés>   (défaut itineraries_walk3000)
        python scripts/07h_transfer_times_check.py --itineraries-dir <lots de 04h> <étiquette>
La seconde forme (D-031, 04/11) contrôle un recalcul avant publication : correspondances des lots seulement, écrit
`data/processed/transfer_check_<étiquette>_summary.json` (aucun fichier publié lu).
"""

from __future__ import annotations

import gzip
import json
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from starway import flux
from starway import itin_sets as iss
from starway import night_network as nn
from starway import transfer_times as tx
from starway.config import (
    DAY_TYPES,
    DAY_TYPES_BY_ID,
    FRONT_DATA_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    PROCESSED_DIR,
    REPO_ROOT,
    SERVICE_DATE,
    SKY_DEFAULT,
    WALK_SETTING_DEFAULT,
    manifest_rel,
    sky_front_dir,
)
from starway.gtfs import active_trip_ids
from starway.itineraries import s_to_hhmm
from starway.gold import CommuneTransit
from starway.navitia import insight_trips

GTFS = flux.gtfs_path("TRA01")  # fichier du manifeste (starway.flux), jamais un nom écrit en dur
SKY = SKY_DEFAULT  # ciel contrôlé (`--astres`) : 44 astres
FRONT = sky_front_dir(SKY)  # dossier publié du ciel : meta.json, access/, itineraries*/, poles.json
ITIN = iss.itin_set(WALK_SETTING_DEFAULT, sky=SKY)  # jeu contrôlé (--walk-setting)
SRC = ITIN.src
OUT_SUMMARY = ITIN.summary
OUT_SHORT = ITIN.short_csv  # 5 Mo : non versionné
OUT_ALL = ITIN.transfers_csv
OUT_TRIPS = ITIN.trips_csv
NAV_CONNECTIONS = PROCESSED_DIR / "navitia_connections.csv"
RULES = ("gtfs", "reference")
STORY = {"78358": "Maisons-Laffitte (Léa)", "78418": "Montesson (acte 3)"}


def load_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


NIGHT_APPLIED = False  # D-040 : le 6h-14h des lots vient du recalcul sur le réseau de nuit (courses NUIT_ à relire dans TRA01B)


def read_records() -> dict[tuple[str, str, str, str], dict]:
    """Lots de 04h, comme 06h : le dernier enregistrement d'une clé l'emporte. D-040 : pour les 44 astres, le 6h-14h est
    remplacé par celui du recalcul sur le réseau de nuit (même règle et mêmes contrôles que 06h) s'il est complet."""
    global NIGHT_APPLIED
    recs: dict[tuple[str, str, str, str], dict] = {}
    for f in sorted((SRC / "batches").glob("batch_*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                recs[(r["insee"], r["pole"], r["day"], r["dir"])] = r
    nsrc = nn.night_dir(SRC) if (SKY == "44" and "_d031" in SRC.name and "_nuit" not in SRC.name) else None
    if nsrc is not None and (nsrc / "run_params.json").exists():
        from starway.sources import read_manifest

        man = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] == "TRA01B"}
        bad = nn.itineraries_engine_problems(load_json(SRC / "run_params.json"), load_json(nsrc / "run_params.json"), man)
        if bad:
            sys.exit(f"{nsrc.name} : moteur ou GTFS différent de {SRC.name} : {bad[:3]}")
        night: list[dict] = []
        for f in sorted((nsrc / "batches").glob("batch_*.jsonl.gz")):
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                night += [json.loads(line) for line in fh]
        pole_ids = [p["id"] for p in load_json(FRONT / "poles.json")]
        merged, info, why = nn.merge_itinerary_records(list(recs.values()), night, pole_ids)
        print(f"6h-14h : {why}")
        NIGHT_APPLIED = info is not None
        recs = {(r["insee"], r["pole"], r["day"], r["dir"]): r for r in merged}
    return recs


def load_official() -> tuple[tx.OfficialTransfers, dict[str, str], dict[str, int]]:
    with zipfile.ZipFile(GTFS) as z:
        t = pd.read_csv(z.open("transfers.txt"), dtype=str)
        s = pd.read_csv(z.open("stops.txt"), dtype=str, usecols=["stop_id", "stop_name", "parent_station",
                                                                  "location_type"])
    parents = {a: b for a, b in zip(s["stop_id"], s["parent_station"], strict=True) if isinstance(b, str) and b}
    names = dict(zip(s["stop_id"], s["stop_name"], strict=True))
    official = tx.OfficialTransfers.from_rows(
        zip(t["from_stop_id"], t["to_stop_id"], t["min_transfer_time"].astype(int), strict=True), parents)
    lt = dict(zip(s["stop_id"], s["location_type"], strict=True))
    m = t["min_transfer_time"].astype(int)
    facts = {"rows": len(t), "transfer_type_values": sorted(t["transfer_type"].unique().tolist()),
             "min_s": int(m.min()), "median_s": float(m.median()), "max_s": int(m.max()),
             "over_3600_s": int((m > 3600).sum()),
             "self_pairs": int((t["from_stop_id"] == t["to_stop_id"]).sum()),
             "from_location_types": dict(Counter(t["from_stop_id"].map(lt).fillna("absent"))),
             "to_location_types": dict(Counter(t["to_stop_id"].map(lt).fillna("absent"))),
             "duplicate_pairs": int(t.duplicated(["from_stop_id", "to_stop_id"]).sum())}
    return official, names, facts


def load_timetable(keys: set[tuple[str, str, str]]) -> tx.Timetable:
    """Courses du jour de service des lignes concernées, entre les quais demandés (stop_times.txt lu par morceaux).
    Montée seulement si `pickup_type` != 1, descente si `drop_off_type` != 1 (règle de R5 : PickDropType.NONE)."""
    stops = {k[1] for k in keys} | {k[2] for k in keys}
    routes = {k[0] for k in keys}
    gtfs_zip = nn.NIGHT_GTFS if NIGHT_APPLIED else GTFS  # le GTFS de nuit contient TRA01 en entier + les courses NUIT_
    active = active_trip_ids(gtfs_zip, SERVICE_DATE)
    with zipfile.ZipFile(gtfs_zip) as z:
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "route_id"])
        trips = trips[trips["route_id"].isin(routes) & trips["trip_id"].isin(active)]
        route_of = dict(zip(trips["trip_id"], trips["route_id"], strict=True))
        parts = []
        cols = ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time", "pickup_type",
                "drop_off_type"]
        for ch in pd.read_csv(z.open("stop_times.txt"), dtype=str, usecols=cols, chunksize=2_000_000):
            parts.append(ch[ch["trip_id"].isin(route_of) & ch["stop_id"].isin(stops)])
    st = pd.concat(parts)

    def secs(v: str) -> int:
        h, m, s = (int(x) for x in v.split(":"))
        return h * 3600 + m * 60 + s

    st["seq"] = st["stop_sequence"].astype(int)
    st = st.sort_values(["trip_id", "seq"])
    by_route_keys: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for r, a, b in keys:
        by_route_keys[r].append((a, b))
    runs: dict[tuple[str, str, str], list[tx.Run]] = defaultdict(list)
    for trip_id, g in st.groupby("trip_id", sort=False):
        route = route_of[trip_id]
        rows = list(zip(g["stop_id"], g["departure_time"], g["arrival_time"], g["pickup_type"].fillna("0"),
                        g["drop_off_type"].fillna("0"), strict=True))
        for a, b in by_route_keys[route]:
            for i, (sid, dep, _arr, pick, _drop) in enumerate(rows):
                if sid != a or pick == "1":
                    continue
                for sid2, _dep2, arr2, _pick2, drop2 in rows[i + 1:]:
                    if sid2 == b and drop2 != "1":
                        runs[(route, a, b)].append(tx.Run(secs(dep), secs(arr2), trip_id))
                        break
    return tx.Timetable(runs)


def published_index(insee: str) -> dict[tuple[str, str, str], dict]:
    doc = iss.read_doc(iss.doc_path(ITIN.out_dir, insee))
    out = {}
    for d, by_dir in doc["days"].items():
        for direction, row in by_dir.items():
            for pid, trip in zip(doc["poles"], row, strict=True):
                out[(pid, d, direction)] = trip
    return out


def check_all(published, poles, recs, official, names) -> tuple[list[dict], list[dict]]:
    """Contrôle de chaque correspondance, et accord lots de 04h / fichiers publiés (arrêt sinon)."""
    rows: list[dict[str, Any]] = []
    trips: list[dict[str, Any]] = []
    mismatch = 0
    for insee in published:
        pub = published_index(insee)
        for pid in poles:
            for dt in DAY_TYPES:
                for direction in ("out", "ret"):
                    p = pub[(pid, dt.id, direction)]
                    r = recs.get((insee, pid, dt.id, direction))
                    if p.get("status") != "ok":
                        continue
                    o = (r or {}).get("option")
                    if (r is None or r["status"] != "ok" or s_to_hhmm(int(r["dep_s"])) != p["dep"]
                            or s_to_hhmm(int(o["arr_s"])) != p["arr"] or len(tx.transit_legs(o)) != p["rides"]):
                        mismatch += 1
                        continue
                    tl = [x for x in p["legs"] if x.get("route_type") is not None]
                    on_demand = {i for i, lg in enumerate(tl) if lg.get("on_demand")}
                    checks = tx.check_option(o, official)
                    for k, c in enumerate(checks):
                        rows.append(transfer_row(insee, pid, dt.id, direction, k, c, official, names, on_demand))
                    trips.append({"insee": insee, "pole": pid, "day": dt.id, "dir": direction, "rec": r,
                                  "status": {"gtfs": tx.trip_status(checks),
                                             "reference": tx.trip_status(checks, reference=True)},
                                  "checks": checks, "matrix_min": int(r["target_min"]), "itin_min": int(p["min"]),
                                  "on_demand": bool(on_demand), "retimed": {}})
    if mismatch:
        sys.exit(f"{mismatch} itinéraires publiés sans enregistrement identique dans les lots de 04h")
    return rows, trips


def transfer_row(insee, pid, day, direction, k, c: tx.TransferCheck, official, names, on_demand) -> dict[str, Any]:
    pp = c.parent_pairs
    return {"insee": insee, "pole": pid, "day": day, "dir": direction, "k": k,
            "from_stop": c.from_stop, "to_stop": c.to_stop, "from_name": names.get(c.from_stop),
            "to_name": names.get(c.to_stop), "from_parent": official.parent.get(c.from_stop),
            "to_parent": official.parent.get(c.to_stop), "arr": s_to_hhmm(c.arr_s), "dep": s_to_hhmm(c.dep_s),
            "available_s": c.available_s, "walk_s": c.walk_s, "official_min_s": c.official_min_s,
            "missing_s": c.missing_s, "status": c.status, "navitia_min_s": c.navitia_min_s,
            "reference_status": c.reference_status, "same_parent": c.same_parent,
            "parent_pairs_n": None if pp is None else pp[0], "parent_pairs_min_s": None if pp is None else pp[1],
            "parent_pairs_max_s": None if pp is None else pp[2],
            "on_demand_side": (k in on_demand) or (k + 1 in on_demand)}


def verdicts(published, poles, budgets, series, short_rule: list[dict], rule: str) -> tuple[list[dict], Counter]:
    """Verdicts publiés allumés dont un sens a une correspondance trop courte (règle `rule`) : gardés ou à risque."""
    bound = {(t["insee"], t["pole"], t["day"], t["dir"]): t["retimed"][rule].minutes for t in short_rule}
    out: list[dict] = []
    lit: Counter = Counter()
    for insee in published:
        for dt in DAY_TYPES:
            s = series(insee, dt.id)
            for i, pid in enumerate(poles):
                o, r = s["out"][i], s["ret"][i]
                for b in budgets:
                    lit[(dt.id, b)] += tx.verdict(o, r, b)
                ko, kr = (insee, pid, dt.id, "out"), (insee, pid, dt.id, "ret")
                if ko not in bound and kr not in bound:
                    continue
                o2, r2 = bound.get(ko, o), bound.get(kr, r)
                for b in budgets:
                    if tx.verdict(o, r, b):
                        out.append({"insee": insee, "pole": pid, "day": dt.id, "budget": b,
                                    "kept": tx.verdict(o2, r2, b), "out": o, "ret": r,
                                    "out_bound": o2 if ko in bound else None, "ret_bound": r2 if kr in bound else None})
    return out, lit


def use_walk_setting() -> None:
    """`--walk-setting <réglage>` et `--astres <44|15>` (retirés de sys.argv) : chemins du jeu d'itinéraires contrôlé
    (starway.itin_sets) et dossier publié du ciel."""
    global ITIN, SRC, OUT_SUMMARY, OUT_SHORT, OUT_ALL, OUT_TRIPS, SKY, FRONT
    walk = WALK_SETTING_DEFAULT
    for flag in ("--walk-setting", "--astres"):
        if flag in sys.argv:
            i = sys.argv.index(flag)
            value = sys.argv[i + 1]
            del sys.argv[i:i + 2]
            if flag == "--astres":
                if value != "44":
                    sys.exit("--astres : 44")
                SKY = value
            else:
                walk = value
    FRONT = sky_front_dir(SKY)
    ITIN = iss.itin_set(walk, sky=SKY)
    SRC, OUT_SUMMARY, OUT_SHORT = ITIN.src, ITIN.summary, ITIN.short_csv
    OUT_ALL, OUT_TRIPS = ITIN.transfers_csv, ITIN.trips_csv


def lots_check(src: Path, label: str) -> int:
    """Contrôle d'un recalcul (D-031) avant toute publication : chaque correspondance des lots de 04h de `src`
    (enregistrements `status` ok), contre `transfers.txt` puis la durée Navitia (07i) ; aucun fichier publié n'est lu.
    Écrit `data/processed/transfer_check_{label}_summary.json`."""
    params = load_json(src / "run_params.json")
    official, _names, _facts = load_official()
    if NAV_CONNECTIONS.exists():
        nc = pd.read_csv(NAV_CONNECTIONS, dtype={"origin": str, "destination": str}).dropna(subset=["duration_s"])
        official = official.with_navitia(zip(nc["origin"], nc["destination"], nc["duration_s"].astype(int),
                                             strict=True))
    by_status: Counter = Counter()
    by_ref: Counter = Counter()
    trips: Counter = Counter()
    slack_gtfs: list[int] = []
    slack_nav: list[int] = []
    exact = Counter()
    n_ok = 0
    for f in sorted((src / "batches").glob("batch_*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                if r.get("status") != "ok" or not r.get("option"):
                    continue
                n_ok += 1
                checks = tx.check_option(r["option"], official)
                for c in checks:
                    by_status[c.status] += 1
                    by_ref[c.reference_status] += 1
                    if c.official_min_s is not None:
                        slack_gtfs.append(c.available_s - c.official_min_s)
                        exact["gtfs"] += c.available_s == c.official_min_s
                    elif c.navitia_min_s is not None:
                        slack_nav.append(c.available_s - c.navitia_min_s)
                        exact["navitia"] += c.available_s == c.navitia_min_s
                trips[(r["day"], tx.trip_status(checks), tx.trip_status(checks, reference=True))] += 1

    def dist(v: list[int]) -> dict[str, Any]:
        s = pd.Series(v, dtype=float)
        return {"n": len(v), "min_s": None if s.empty else int(s.min()), "negative": int((s < 0).sum()),
                "median_s": None if s.empty else float(s.median())}

    summary = {"generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": src.name,
               "transfer_rules": params.get("transfer_rules", "r5"), "r5_jar_sha256": params.get("r5_jar_sha256"),
               "itineraries_ok": n_ok, "transfers_by_gtfs_status": dict(by_status),
               "transfers_by_reference_status": dict(by_ref),
               "slack_vs_gtfs_min": dist(slack_gtfs), "slack_vs_navitia_same_stop_or_no_line": dist(slack_nav),
               "transfers_exactly_at_minimum": dict(exact),
               "trips_by_day_status": [{"day": d, "status_gtfs": g, "status_reference": ref, "n": n}
                                       for (d, g, ref), n in sorted(trips.items())],
               "rule": "disponible = départ du tronçon suivant - arrivée du précédent ; trop court si < minimum"}
    out = PROCESSED_DIR / f"transfer_check_{label}_summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "trips_by_day_status"}, ensure_ascii=False))
    print(f"Écrit : {out}")
    return 0


def main() -> int:
    global SRC
    use_walk_setting()
    if len(sys.argv) == 4 and sys.argv[1] == "--itineraries-dir":
        return lots_check(Path(sys.argv[2]).expanduser().resolve(), sys.argv[3])
    if len(sys.argv) == 3 and sys.argv[1] == "--src":  # lots de 04h des itinéraires publiés (D-031 : *_d031)
        SRC = Path(sys.argv[2]).expanduser().resolve()
    elif len(sys.argv) != 1:
        sys.exit("usage : 07h_transfer_times_check.py [--astres <44|15>] [--walk-setting <réglage>] [--src <lots de 04h>] | "
                 "--itineraries-dir <lots> <étiquette>")
    meta = load_json(FRONT / "meta.json")
    poles_json = load_json(FRONT / "poles.json")
    poles = [p["id"] for p in poles_json]
    pole_name = {p["id"]: p["name"] for p in poles_json}
    jobs = [int(p["jobs"]) for p in poles_json]
    communes = {c["insee"]: c for c in load_json(FRONT_DATA_DIR / "communes.json")}
    budgets = sorted(int(b) for b in meta["budgets"])
    published = sorted((meta.get("itineraries_communes") or []) if ITIN.is_default else
                       (((meta.get("itineraries_variants") or {}).get(ITIN.walk_setting) or {}).get("communes") or []))
    files = iss.published_communes(ITIN.out_dir)
    if published != files:
        sys.exit(f"communes annoncées ({len(published)}) != fichiers publiés ({len(files)}) dans {ITIN.dir_name}/")
    params = load_json(SRC / "run_params.json")
    if params.get("walk_setting") != ITIN.walk_setting or params.get("service_date") != SERVICE_DATE.isoformat():
        sys.exit(f"lots de 04h inattendus : {params.get('walk_setting')} {params.get('service_date')}")

    official, names, facts = load_official()
    nav_info = None
    if NAV_CONNECTIONS.exists():
        nc = pd.read_csv(NAV_CONNECTIONS, dtype={"origin": str, "destination": str}).dropna(subset=["duration_s"])
        official = official.with_navitia(zip(nc["origin"], nc["destination"], nc["duration_s"].astype(int),
                                             strict=True))
        nav_info = {"file": NAV_CONNECTIONS.relative_to(REPO_ROOT).as_posix(), "pairs_used": len(official.navitia_s)}
    recs = read_records()

    # 1. contrôle de chaque correspondance
    rows, trips = check_all(published, poles, recs, official, names)

    # 2. recalage sur les mêmes lignes, pour chaque règle
    short = {rule: [t for t in trips if t["status"][rule] == tx.TRIP_SHORT] for rule in RULES}
    keys = {tx.leg_key(lg) for rule in RULES for t in short[rule] for lg in tx.transit_legs(t["rec"]["option"])}
    print(f"{len(trips)} itinéraires, {len(rows)} correspondances ; trop courts : "
          + ", ".join(f"{r} {len(short[r])}" for r in RULES) + f" ; horaires de {len(keys)} tronçons à relire")
    tt = load_timetable(keys)
    for rule in RULES:
        for t in short[rule]:
            dt = DAY_TYPES_BY_ID[t["day"]]
            start_s = dt.start.hour * 3600 + dt.start.minute * 60
            t["retimed"][rule] = tx.retime(t["rec"], official, tt, start_s, OUTBOUND_LOOKBACK_MIN * 60, MAX_TRIP_MIN,
                                           reference=(rule == "reference"))

    # 3. verdicts
    access = {i: load_json(FRONT / "access" / f"{i}.json") for i in published}

    def series(insee: str, day: str) -> dict:
        return iss.transit_series(access[insee], ITIN)[day]  # type: ignore[index]

    vrows: dict[str, list[dict]] = {}
    lit_total: Counter = Counter()
    for rule in RULES:
        vrows[rule], lit_total = verdicts(published, poles, budgets, series, short[rule], rule)

    # 4. récit et découvertes
    def trip_detail(t: dict) -> dict:
        def rt(rule: str) -> dict | None:
            x = t["retimed"].get(rule)
            return None if x is None else {"minutes": x.minutes, "method": x.method}
        return {"insee": t["insee"], "commune": communes[t["insee"]]["name"], "pole": t["pole"],
                "pole_name": pole_name[t["pole"]], "day": t["day"], "dir": t["dir"], "matrix_min": t["matrix_min"],
                "itinerary_min": t["itin_min"], "status_gtfs": t["status"]["gtfs"],
                "status_reference": t["status"]["reference"], "retimed_gtfs": rt("gtfs"),
                "retimed_reference": rt("reference"),
                "short_transfers": [{"at": names.get(c.from_stop), "to": names.get(c.to_stop),
                                     "arr": s_to_hhmm(c.arr_s), "dep": s_to_hhmm(c.dep_s),
                                     "available_s": c.available_s, "official_min_s": c.official_min_s,
                                     "navitia_min_s": c.navitia_min_s}
                                    for c in t["checks"] if c.reference_status == tx.SHORT]}

    by_key = {(t["insee"], t["pole"], t["day"], t["dir"]): t for t in trips}
    any_short = [t for t in trips if tx.TRIP_SHORT in t["status"].values()]
    story = {}
    for insee, label in STORY.items():
        story[insee] = {"label": label, "short_trips": [trip_detail(t) for t in any_short if t["insee"] == insee],
                        "verdicts_at_risk": {rule: [v for v in vrows[rule] if v["insee"] == insee and not v["kept"]]
                                             for rule in RULES}}

    def series_of(insee: str, mode: str, day: str) -> dict | None:
        f = FRONT / "access" / f"{insee}.json"
        a = access.get(insee) or (load_json(f) if f.exists() else None)
        return ((a or {}).get("modes", {}).get(mode) or {}).get(day)

    ins_out = []
    table = CommuneTransit.from_front(FRONT)  # part TC commune par commune de la règle de l'or (D-056)
    commune_parts = table.parts if table is not None else None
    insights_path = FRONT / "insights.json"
    for ins in load_json(insights_path) if ITIN.is_default and insights_path.exists() else []:
        sc = ins["scenario"]
        decisive, why = insight_trips(ins, series_of, poles, jobs, commune_parts)
        dkeys = [(t.insee, t.pole_id, t.day, t.leg) for t in decisive]
        dshort = [trip_detail(by_key[k]) for k in dkeys
                  if k in by_key and tx.TRIP_SHORT in by_key[k]["status"].values()]
        scen = {(sc["o"], sc["d"])} | ({(sc["o"], sc["compare_day"])} if sc.get("compare_day") else set()) | (
            {(sc["vs"], sc["d"])} if sc.get("vs") else set())
        risk = {rule: [v for v in vrows[rule] if (v["insee"], v["day"]) in scen and v["budget"] == int(sc["b"])
                       and not v["kept"]] for rule in RULES}
        ins_out.append({"id": ins["id"], "kind": ins["kind"], "scenario": sc, "crosscheck": ins.get("crosscheck"),
                        "decisive_trips": [list(k) for k in dkeys], "decisive_reason": why,
                        "decisive_trips_with_short_transfer": dshort, "lit_verdicts_at_risk_in_scenario": risk})

    # 5. sorties
    df = pd.DataFrame(rows)
    OUT_ALL.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_ALL, index=False, encoding="utf-8", compression="gzip")

    def short_label(c: tx.TransferCheck) -> str:
        ref = f"{c.official_min_s} s (GTFS)" if c.official_min_s is not None else f"{c.navitia_min_s} s (Navitia)"
        return f"{names.get(c.from_stop)} -> {names.get(c.to_stop)} {c.available_s} s < {ref}"

    sdf = pd.DataFrame([{k: v for k, v in trip_detail(t).items()
                         if k not in ("short_transfers", "retimed_gtfs", "retimed_reference")}
                        | {f"retimed_{r}_min": (t["retimed"][r].minutes if r in t["retimed"] else None) for r in RULES}
                        | {f"retimed_{r}_method": (t["retimed"][r].method if r in t["retimed"] else None) for r in RULES}
                        | {"on_demand": t["on_demand"],
                           "short_at": " ; ".join(short_label(c) for c in t["checks"]
                                                  if c.reference_status == tx.SHORT)}
                        for t in any_short])
    sdf.to_csv(OUT_SHORT, index=False, encoding="utf-8", compression="gzip")
    pd.DataFrame([{"insee": t["insee"], "pole": t["pole"], "day": t["day"], "dir": t["dir"],
                   "matrix_min": t["matrix_min"], "itinerary_min": t["itin_min"],
                   "status_gtfs": t["status"]["gtfs"], "status_reference": t["status"]["reference"],
                   "n_transfers": len(t["checks"]), "on_demand": t["on_demand"]}
                  | {f"retimed_{r}_min": (t["retimed"][r].minutes if r in t["retimed"] else None) for r in RULES}
                  for t in trips]).to_csv(OUT_TRIPS, index=False, encoding="utf-8", compression="gzip")

    def by_day(rule: str) -> dict:
        res = {}
        at_risk = Counter((v["day"], v["budget"]) for v in vrows[rule] if not v["kept"])
        for dt in DAY_TYPES:
            sub = [t for t in trips if t["day"] == dt.id]
            res[dt.id] = {"itineraries": len(sub),
                          "with_transfer": sum(t["status"][rule] != tx.TRIP_NO_TRANSFER for t in sub),
                          "short": sum(t["status"][rule] == tx.TRIP_SHORT for t in sub),
                          "short_out": sum(t["status"][rule] == tx.TRIP_SHORT and t["dir"] == "out" for t in sub),
                          "short_ret": sum(t["status"][rule] == tx.TRIP_SHORT and t["dir"] == "ret" for t in sub),
                          "verdicts": {str(b): {"lit": lit_total[(dt.id, b)], "at_risk": at_risk[(dt.id, b)]}
                                       for b in budgets}}
        return res

    def by_pole(rule: str) -> dict:
        at_risk = Counter((v["pole"], v["budget"]) for v in vrows[rule] if not v["kept"])
        return {pid: {"name": pole_name[pid], "itineraries": sum(t["pole"] == pid for t in trips),
                      "short": sum(t["pole"] == pid and t["status"][rule] == tx.TRIP_SHORT for t in trips),
                      "at_risk": {str(b): at_risk[(pid, b)] for b in budgets}} for pid in poles}

    def retime_stats(rule: str) -> dict:
        sh_ = short[rule]
        gap = [t["retimed"][rule].minutes - t["itin_min"] for t in sh_ if t["retimed"][rule].minutes is not None]
        g = pd.Series(gap, dtype=float)
        return {"short_trips": len(sh_), "methods": dict(Counter(t["retimed"][rule].method for t in sh_)),
                "no_bound": sum(t["retimed"][rule].minutes is None for t in sh_),
                "minutes_added_vs_itinerary": {"median": float(g.median()) if gap else None,
                                               "p90": float(g.quantile(0.9)) if gap else None,
                                               "max": int(g.max()) if gap else None, "zero": int((g == 0).sum())}}

    sh = df[df["status"] == tx.SHORT]
    same = df[df["status"] == tx.SAME_STOP]
    top = (sh.assign(place=sh["from_name"].fillna("?") + " -> " + sh["to_name"].fillna("?"))
           .groupby("place").agg(n=("place", "size"), median_missing_s=("missing_s", "median"))
           .sort_values("n", ascending=False).head(15))
    nav_ref = df[df["official_min_s"].isna() & df["navitia_min_s"].notna()]
    summary = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "service_date": SERVICE_DATE.isoformat(), "walk_setting": ITIN.walk_setting,
        "source_itineraries": manifest_rel(SRC), "gtfs_sha256": params.get("gtfs_sha256"),
        "transfers_txt": facts, "navitia_connections": nav_info,
        "communes": len(published), "itineraries": len(trips), "transfers_checked": len(rows),
        "transfer_status_gtfs": dict(Counter(df["status"])),
        "transfer_status_reference": dict(Counter(df["reference_status"])),
        "transfer_same_parent_by_status": {k: int(v) for k, v in df.groupby("status")["same_parent"].sum().items()},
        "no_line_with_parent_pair_listed": int(((df["status"] == tx.NO_LINE) & df["parent_pairs_n"].notna()).sum()),
        "short_missing_s": ({"median": float(sh["missing_s"].median()), "p90": float(sh["missing_s"].quantile(0.9)),
                             "max": int(sh["missing_s"].max()), "le_60": int((sh["missing_s"] <= 60).sum()),
                             "le_120": int((sh["missing_s"] <= 120).sum())} if len(sh) else
                            {"median": None, "p90": None, "max": None, "le_60": 0, "le_120": 0}),  # aucune : D-031
        "short_on_demand_side": int(sh["on_demand_side"].sum()),
        "same_stop": {"transfers": len(same),
                      "monomodal_stop_place": int(same["from_stop"].str.contains("monomodalStopPlace").sum()),
                      "distinct_stops": int(same["from_stop"].nunique()),
                      "available_s_quantiles": {str(q): float(same["available_s"].quantile(q))
                                                for q in (0.1, 0.25, 0.5)},
                      "with_navitia_duration": int(same["navitia_min_s"].notna().sum()),
                      "short_vs_navitia": int((same["reference_status"] == tx.SHORT).sum()),
                      "note": "aucune ligne transfers.txt ne relie un arrêt à lui-même : pas de minimum dans le GTFS"},
        "navitia_reference_transfers": {"n": len(nav_ref),
                                        "short": int((nav_ref["reference_status"] == tx.SHORT).sum())},
        "trip_status": {rule: dict(Counter(t["status"][rule] for t in trips)) for rule in RULES},
        "by_day": {rule: by_day(rule) for rule in RULES},
        "by_pole": {rule: by_pole(rule) for rule in RULES},
        "retime": {rule: retime_stats(rule) for rule in RULES},
        "verdicts_rule": "verdict publié allumé (aller et retour <= budget, durées de la matrice) ; « à risque » si la "
                         "borne recalée d'un sens trop court dépasse le budget, ou s'il n'y en a pas",
        "top_places_short_gtfs": json.loads(top.reset_index().to_json(orient="records", force_ascii=False)),
        "story": story, "insights": ins_out,
        "outputs": {"short_csv": manifest_rel(OUT_SHORT),
                            "all_csv": manifest_rel(OUT_ALL)},
    }
    OUT_SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print("Correspondances (GTFS) :", summary["transfer_status_gtfs"])
    print("Correspondances (référence) :", summary["transfer_status_reference"])
    for rule in RULES:
        print(f"Règle {rule} : itinéraires", summary["trip_status"][rule])
        for d, v in summary["by_day"][rule].items():
            print(f"  {d} : {v['short']} / {v['with_transfer']} avec correspondance ; verdicts à risque",
                  {b: f"{x['at_risk']}/{x['lit']}" for b, x in v["verdicts"].items()})
        print("  recalage :", summary["retime"][rule])
    for v in story.values():
        print(f"  {v['label']} : {len(v['short_trips'])} trajets trop courts ; verdicts à risque",
              {r: len(x) for r, x in v["verdicts_at_risk"].items()})
    for rule in RULES:
        n = sum(1 for x in ins_out if x["lit_verdicts_at_risk_in_scenario"][rule])
        print(f"  découvertes avec un verdict à risque dans leur scénario ({rule}) : {n} sur {len(ins_out)}")
    print(f"Écrit : {OUT_SUMMARY}, {OUT_SHORT} ({len(sdf)} lignes), {OUT_ALL} ({len(df)} lignes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
