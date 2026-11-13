"""08c - Cas de la visite qui font ressortir le défi n° 2 « Les mobilités et l'emploi » (lecture seule).

Demande de Nicolas du 04/11/2026 : prendre dans la narration des cas précis qui font ressortir les points du défi
(horaires décalés, aller possible mais retour impossible, voisines aux sorts opposés, vélo + TC qui rallume des
astres, voiture, transport à la demande, bassin où l'on recrute). Chaque cas est TROUVÉ dans les données publiées,
jamais inventé, et noté avec sa marge par rapport au temps de trajet par sens (robustesse si les durées bougent de
quelques minutes, par exemple après D-031).

Lit uniquement :
  - frontend/public/data/ : meta.json, poles.json, communes.json, access/{insee}.json, context/{insee}.json,
    itineraries/{insee}.json (D-028), od_walk3000/ (index.json et o/{insee}.bin : table commune x commune, la base du
    compteur et du ciel du SITE) ;
  - data/processed/adjacency_2026.csv (communes limitrophes) ;
  - data/raw/EMP03/Base-open-data-BMO-2026.xlsx (France Travail, BMO 2026, Licence Ouverte) et
    data/raw/GEO04/ (commune -> bassin d'emploi 2026, starway.sky_groups.read_bassins).
N'écrit que data/processed/tour_challenge_cases.json (aucun export vers le front, aucun calcul r5py).

BASE DE CALCUL (décision de Nicolas du 06/11 : la visite dit les chiffres du site et de la slide) : pour les transports en
commun et la voiture, chaque candidat porte un bloc `od` calculé comme `computeOd` du front dans la table commune x commune
(journées-types 9h-17h et 14h-22h seulement, jamais le 6h-14h) : étoiles allumées (astres dont au moins une commune est
atteinte aller ET retour), postes atteints (commune de départ hors total), stabilité quand le temps de trajet bouge de
quelques minutes, temps de l'astre suivi. Les blocs `days` (access/) ne servent plus qu'au vélo + TC, seul calcul de ce
mode (il n'est pas dans la table), et aux indices d'itinéraires (bus de remplacement, transport à la demande).

Règles de lecture (identiques au front, src/data/accessibility.ts et src/data/od/compute.ts) : un pôle est allumé si l'aller
ET le retour existent et tiennent chacun dans le temps de trajet par sens ; « aller seul » si l'aller tient et pas le retour.
Voiture avec trafic : règle de starway.congestion (DiRIF, D-029). Marge d'un pôle allumé = budget - max(aller,
retour) ; marge d'un pôle éteint = max(aller, retour) - budget (None si un sens n'existe pas : éteint sûr).

Usage : python scripts/08c_tour_challenge_cases.py [--budget 60] [--origin 78358] [--fragile 5]
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from starway import od_export as ox
from starway import sky_groups as sg
from starway.config import FRONT_DATA_DIR, PROCESSED_DIR, RAW_DIR
from starway.congestion import PERIODS, STATUS_OK, attach
from starway.gold import NO_COMMUNE_TRANSIT, CommuneTransit, gold_delta
from starway.insights_astres import read_swod
from starway.sky_groups import read_bassins

OUT = PROCESSED_DIR / "tour_challenge_cases.json"
BMO_XLSX = RAW_DIR / "EMP03" / "Base-open-data-BMO-2026.xlsx"
GTFS_ZIP = RAW_DIR / "TRA01" / "IDFM-gtfs.zip"
DAYS = ("d06", "d09", "d14")
OD_DAYS = ("d09", "d14")  # jamais le 6h-14h : ses valeurs attendent la correction (PR 53 / data/publication-6h14)
MODES = ("transit", "bike_transit", "car", "car_traffic", "bike", "walk")
OD_MODES = ("transit", "car_traffic")  # servis par la table commune x commune (le vélo + TC n'y est pas)
OD_WINDOW = 6  # minutes de part et d'autre du temps de trajet pour mesurer la stabilité d'un cas
OD_DIR = FRONT_DATA_DIR / "od_walk3000"


def load(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def load_gz(p: Path):
    """Fichier publié compressé (`{insee}.json.gz`, itinéraires) ; None s'il n'existe pas."""
    gz = p.with_name(p.name + ".gz")
    if not gz.exists():
        return None
    import gzip
    return json.loads(gzip.decompress(gz.read_bytes()).decode("utf-8"))


def clock(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def series(acc: dict, mode: str, day: str, meta: dict) -> dict | None:
    """Série out/ret d'un mode pour une journée-type ; car_traffic déduit de car (D-029)."""
    modes = acc.get("modes", {})
    if mode == "car_traffic":
        base = modes.get("car", {}).get("any")
        if not base:
            return None
        dt = next(d for d in meta["day_types"] if d["id"] == day)
        s, e = clock(dt["start"]), clock(dt["end"])

        def used(leg: str, c: int, t):
            _, status, traffic = attach(leg, c, t, PERIODS)
            return traffic if status == STATUS_OK else t

        return {"out": [used("out", s, t) for t in base["out"]], "ret": [used("ret", e, t) for t in base["ret"]]}
    m = modes.get(mode)
    if not m:
        return None
    return m.get(day) or m.get("any")


def states(ser: dict | None, poles: list[dict], budget: int) -> list[dict] | None:
    if ser is None:
        return None
    out = []
    for i, p in enumerate(poles):
        o, r = ser["out"][i], ser["ret"][i]
        lit = o is not None and r is not None and o <= budget and r <= budget
        out_only = o is not None and o <= budget and not lit
        if lit:
            margin = budget - max(o, r)
        elif o is None or r is None:
            margin = None
        else:
            margin = max(o, r) - budget
        out.append({"id": p["id"], "jobs": p["jobs"], "out": o, "ret": r, "lit": lit, "out_only": out_only,
                    "margin": margin, "dep": (ser.get("dep") or [None] * len(poles))[i]})
    return out


def summary(st: list[dict] | None) -> dict | None:
    if st is None:
        return None
    lit = [x for x in st if x["lit"]]
    return {"stars": len(lit), "jobs": sum(x["jobs"] for x in lit), "lit": [x["id"] for x in lit],
            "min_margin_lit": min((x["margin"] for x in lit), default=None)}


# --------------------------------------------------------------------------- table commune x commune (D-019)
# Depuis le 06/11 la visite dit les chiffres du SITE : le compteur et le ciel du site, pour les transports en commun et
# la voiture, se calculent dans la table commune x commune (od_walk3000/o/{insee}.bin, `computeOd` du front), pas dans
# access/. Une commune de destination est atteinte si l'aller ET le retour tiennent chacun dans le temps de trajet ; un
# astre est « éclairé » dès qu'une de ses communes l'est ; les postes de la commune de départ sont hors du total.
# Le vélo + TC n'est pas dans cette table : il reste calculé sur access/ (blocs `days` ci-dessous).
def od_setup(poles: list[dict]) -> dict | None:
    index = load(OD_DIR / "index.json")
    if index is None:
        return None
    return {"index": index, "group_of": ox.pole_of(index["communes"], poles),
            "codes": {m["id"]: m["code"] for m in index["modes"]}, "pole_ids": [p["id"] for p in poles]}


def traffic_leg(which: str, clock_min: int, leg: ox.Leg) -> ox.Leg:
    """Trafic moyen DiRIF (D-029) sur un sens : minutes avec trafic si la tranche le permet, route vide sinon."""
    if leg.minutes is None:
        return leg
    _, status, traffic = attach(which, clock_min, leg.minutes, PERIODS)
    return ox.Leg(traffic if status == STATUS_OK else leg.minutes, None)


def od_statuses(od: dict, pf: ox.ParsedFile, mode: str, day: dict, budget: int) -> list[str]:
    """État de chaque commune de destination pour un mode, une journée-type et un temps de trajet (portage de computeOd)."""
    index = od["index"]
    n = len(index["communes"])
    start, end = clock(day["start"]), clock(day["end"])
    if mode == "transit":
        return sg.od_states(pf, n, od["codes"]["transit"], start, end, budget, index["outbound_lookback_min"])
    rec = pf.scalars.get(od["codes"]["car"], {})
    states: list[str] = []
    for y in range(n):
        if y in rec:
            o, r = rec[y]
            out = traffic_leg("out", start, ox.scalar_leg(o, pf.max_trip))
            ret = traffic_leg("ret", end, ox.scalar_leg(r, pf.max_trip))
            states.append(sg.dest_status(out, ret, budget))
        elif y == pf.origin:
            states.append("self")
        else:
            none = ox.Leg(None, "no_trip_within_120")
            states.append(sg.dest_status(none, none, budget))
    return states


def od_totals(od: dict, pf: ox.ParsedFile, states: list[str]) -> dict:
    jobs, group_of = od["index"]["jobs"], od["group_of"]
    reached = sum(jobs[y] for y, s in enumerate(states) if s == "accessible")
    measurable = sum(jobs) - jobs[pf.origin]
    lit = sorted({group_of[y] for y, s in enumerate(states) if s == "accessible" and group_of[y] is not None})
    return {"stars": len(lit), "reached": reached, "measurable": measurable,
            "share_pct": round(100 * reached / measurable, 1) if measurable else None,
            "lit": [od["pole_ids"][g] for g in lit]}


def contiguous_range(by_budget: dict, budget: int, same) -> tuple[int, int]:
    """Plus grande plage de temps de trajet, contiguë et contenant `budget`, où `same(valeur)` reste vrai."""
    lo = hi = budget
    while (lo - 1) in by_budget and same(by_budget[lo - 1]):
        lo -= 1
    while (hi + 1) in by_budget and same(by_budget[hi + 1]):
        hi += 1
    return lo, hi


def od_sky(od: dict, insee: str, meta: dict, budget: int, focus: dict | None, window: int = OD_WINDOW,
           modes: tuple[str, ...] = OD_MODES, days_wanted: tuple[str, ...] = OD_DAYS) -> dict | None:
    """Ciel du site pour une commune : étoiles allumées et postes atteints (compteur), par mode et journée-type ;
    stabilité du chiffre quand le temps de trajet bouge de quelques minutes (`window` de part et d'autre, 0 : aucune) ;
    temps de l'astre suivi (ligne du panneau de preuve)."""
    path = OD_DIR / "o" / f"{insee}.bin"
    if not path.exists():
        return None
    pf = read_swod(path)
    days = {d["id"]: d for d in meta["day_types"]}
    res: dict = {}
    for mode in modes:
        for day in days_wanted:
            st = od_statuses(od, pf, mode, days[day], budget)
            row = od_totals(od, pf, st)
            row["by_budget"] = {budget: {"stars": row["stars"], "reached": row["reached"]}}
            for b in range(budget - window, budget + window + 1):
                if b != budget:
                    t = od_totals(od, pf, od_statuses(od, pf, mode, days[day], b))
                    row["by_budget"][b] = {"stars": t["stars"], "reached": t["reached"]}
            # fragilité : plage de temps de trajet (contiguë autour du budget) où le nombre d'étoiles, puis le nombre exact de postes, ne change pas
            row["stars_stable_from"], row["stars_stable_to"] = contiguous_range(row["by_budget"], budget, lambda v, r=row: v["stars"] == r["stars"])
            row["stable_from"], row["stable_to"] = contiguous_range(
                row["by_budget"], budget, lambda v, r=row: (v["stars"], v["reached"]) == (r["stars"], r["reached"]))
            if focus and mode == "transit":
                y = od["index"]["communes"].index(focus["insee"])
                if y in pf.series.get(od["codes"]["transit"], {}):
                    o, r = pf.series[od["codes"]["transit"]][y]
                    out = ox.outbound(o, pf.first, clock(days[day]["start"]), pf.step, od["index"]["outbound_lookback_min"], pf.max_trip)
                    ret = ox.inbound(r, pf.first, clock(days[day]["end"]), pf.step, pf.max_trip)
                    row["focus_pole"] = {"id": focus["id"], "insee": focus["insee"], "out": out.minutes, "departure_min": out.departure,
                                         "ret": ret.minutes, "status": sg.dest_status(out, ret, budget)}
            res[f"{mode}_{day}"] = row
    return res


def anchor_legs(od: dict, pf: ox.ParsedFile, insee: str, day: dict) -> dict | None:
    """Aller et retour (table commune x commune, transports en commun) vers UNE commune de destination, pour une journée-type :
    ce que la ligne de cette commune du panneau de preuve affiche."""
    y = od["index"]["communes"].index(insee)
    code = od["codes"]["transit"]
    if y not in pf.series.get(code, {}):
        return None
    o, r = pf.series[code][y]
    out = ox.outbound(o, pf.first, clock(day["start"]), pf.step, od["index"]["outbound_lookback_min"], pf.max_trip)
    ret = ox.inbound(r, pf.first, clock(day["end"]), pf.step, pf.max_trip)
    return {"out": out.minutes, "departure_min": out.departure, "ret": ret.minutes, "out_leg": out, "ret_leg": ret}


def evening_case(od: dict, origin: str, meta: dict, poles: list[dict], pole_id: str, budget: int, window: int = OD_WINDOW) -> dict | None:
    """Cas du soir de la visite (étapes 6 et 7) : commune d'ancrage de l'astre (`name_short_insee`, Poissy pour Seine-Aval), ses temps
    aller et retour en 9h-17h et 14h-22h, son statut, et la plage de temps de trajet où ce statut ne change pas. À confronter au
    recoupement Navitia (`navitia_recoupement_6h14_visite_06_11.csv`) : le cas ne tient que si aller ET retour y sont à 5 minutes près."""
    pole = next((p for p in poles if p["id"] == pole_id), None)
    path = OD_DIR / "o" / f"{origin}.bin"
    if not pole or not pole.get("name_short_insee") or not path.exists():
        return None
    insee = pole["name_short_insee"]
    pf = read_swod(path)
    days = {d["id"]: d for d in meta["day_types"]}
    res: dict = {"pole": pole_id, "name": pole.get("name"), "anchor_insee": insee, "anchor_name": pole.get("name_short")}
    for day in ("d09", "d14"):
        legs = anchor_legs(od, pf, insee, days[day])
        if legs is None:
            continue
        by_budget = {b: sg.dest_status(legs["out_leg"], legs["ret_leg"], b) for b in range(budget - window, budget + window + 1)}
        lo, hi = contiguous_range(by_budget, budget, lambda s, bb=by_budget: s == bb[budget])
        res[day] = {"out": legs["out"], "departure_min": legs["departure_min"], "ret": legs["ret"], "status": by_budget[budget],
                    "status_stable_from": lo, "status_stable_to": hi}
        # étoiles allumées dans cette journée : l'astre l'est-il, et seul ? (même règle que le compteur)
        st = od_statuses(od, pf, "transit", days[day], budget)
        res[day]["pole_lit"] = pole_id in od_totals(od, pf, st)["lit"]
    return res


def lost_stars_via_rer_a(cand: dict, itin: dict | None) -> dict | None:
    """Étoiles allumées en 9h-17h et éteintes en 14h-22h (table commune x commune) : combien ont un retour de 22h calculé par le
    RER A (train ou son bus du soir) ? Mesure, sans aucune requête, de la part de l'éclipse qui dépend du plan de travaux du
    RER A du GTFS du 02/11 (recoupement Navitia du 06/11 : plan périmé, Paris 8e et Puteaux à 46 minutes au lieu de 76)."""
    od = (cand or {}).get("od") or {}
    if not itin or "transit_d09" not in od or "transit_d14" not in od:
        return None
    lost = sorted(set(od["transit_d09"]["lit"]) - set(od["transit_d14"]["lit"]))
    trips = itin.get("days", {}).get("d14", {}).get("ret", [])
    ids = itin.get("poles", [])
    via, no_detail = [], []
    for pid in lost:
        t = trips[ids.index(pid)] if pid in ids and ids.index(pid) < len(trips) else None
        if not t or t.get("status") != "ok":
            no_detail.append(pid)
        elif any(g.get("agency") == "RER" and g.get("line") == "A" for g in t.get("legs", [])):
            via.append(pid)
    return {"lost": len(lost), "return_via_rer_a": len(via), "without_detail": len(no_detail), "lost_ids": lost,
            "note": "retour de 22h (itineraries/{insee}.json, journée d14) par le RER A ; non confirmé par Navitia pour ces astres sauf Paris 8e et Puteaux"}


def itinerary_flags(itin: dict | None, day: str, leg: str, idx: int) -> dict | None:
    """Indices tirés de l'itinéraire détaillé (D-028) : transport à la demande, bus de remplacement d'un RER ou
    d'un train (ligne ferrée exploitée en bus ce jour-là), correspondance la plus courte (attente à la montée)."""
    if not itin:
        return None
    trips = itin.get("days", {}).get(day, {}).get(leg)
    if not trips or idx >= len(trips) or not trips[idx] or trips[idx].get("status") != "ok":
        return None
    t = trips[idx]
    rides = [g for g in t["legs"] if g["m"] != "walk"]
    on_demand = [g.get("line") for g in rides if g.get("on_demand")]
    substitution = [g.get("line") for g in rides if g.get("route_type") == 3 and g.get("agency") in ("RER", "Transilien")]
    waits = [g.get("wait_min") for g in rides[1:] if g.get("wait_min") is not None]
    return {"min": t.get("min"), "rides": t.get("rides"), "wait_min": t.get("wait_min"),
            "lines": [f"{g['m']} {g.get('line')}" for g in rides], "on_demand": on_demand,
            "substitution_bus": substitution, "min_transfer_wait": min(waits) if waits else None,
            "co2_g": (t.get("co2_g") or {}).get("value"), "tickets_eur": (t.get("tickets") or {}).get("cost_eur")}


def bike_gain_block(tc: list[dict], bt: list[dict], tc_series: dict, bt_series: dict, budget: int,
                    parts: list[dict] | None) -> dict:
    """Or du vélo + TC selon la règle du site (`starway.gold`, D-056). Sans part TC commune par commune : aucun or."""
    gold, lost = gold_delta(tc_series, bt_series, budget, parts)
    lost_ids = [tc[i]["id"] for i in lost]
    if gold is None:
        return {"gained": None, "lost": lost_ids, "jobs": None, "min_margin": None, "status": NO_COMMUNE_TRANSIT}
    gained = [bt[i] for i in gold]
    return {"gained": [{"id": bt[i]["id"], "jobs": bt[i]["jobs"], "margin": bt[i]["margin"], "tc_out": tc[i]["out"],
                        "tc_ret": tc[i]["ret"], "bt_out": bt[i]["out"], "bt_ret": bt[i]["ret"]} for i in gold],
            "lost": lost_ids, "jobs": sum(y["jobs"] for y in gained),
            "min_margin": min((y["margin"] for y in gained), default=None)}


def commune_cases(insee: str, meta: dict, poles: list[dict], budget: int, fragile: int,
                  od: dict | None = None, focus: dict | None = None, table: CommuneTransit | None = None) -> dict:
    acc = load(FRONT_DATA_DIR / "access" / f"{insee}.json")
    itin = load(FRONT_DATA_DIR / "itineraries" / f"{insee}.json")
    res: dict = {"insee": insee, "days": {}, "od": od_sky(od, insee, meta, budget, focus) if od else None}
    if acc is None:
        return res
    for day in DAYS:
        d: dict = {}
        st = {m: states(series(acc, m, day, meta), poles, budget) for m in MODES}
        for m in MODES:
            d[m] = summary(st[m])
        tc = st["transit"]
        if tc is not None:
            d["out_only"] = [{"id": x["id"], "out": x["out"], "ret": x["ret"], "jobs": x["jobs"],
                              "ret_flags": itinerary_flags(itin, day, "ret", i)}
                             for i, x in enumerate(tc) if x["out_only"]]
            d["fragile_lit"] = [{"id": x["id"], "out": x["out"], "ret": x["ret"], "margin": x["margin"],
                                 "out_flags": itinerary_flags(itin, day, "out", i),
                                 "ret_flags": itinerary_flags(itin, day, "ret", i)}
                                for i, x in enumerate(tc) if x["lit"] and x["margin"] < fragile]
            d["near_miss"] = [{"id": x["id"], "out": x["out"], "ret": x["ret"], "margin": x["margin"]}
                              for x in tc if not x["lit"] and x["margin"] is not None and x["margin"] <= fragile]
            d["tad_lit"] = [x["id"] for i, x in enumerate(tc) if x["lit"] and any(
                (itinerary_flags(itin, day, leg, i) or {}).get("on_demand") for leg in ("out", "ret"))]
            d["substitution_lit_or_out_only"] = [x["id"] for i, x in enumerate(tc) if (x["lit"] or x["out_only"]) and any(
                (itinerary_flags(itin, day, leg, i) or {}).get("substitution_bus") for leg in ("out", "ret"))]
        bt = st["bike_transit"]
        if tc is not None and bt is not None:
            d["bike_gain"] = bike_gain_block(tc, bt, series(acc, "transit", day, meta), series(acc, "bike_transit", day, meta),
                                             budget, table.parts(insee, day, budget) if table is not None else None)
        res["days"][day] = d
    ref = res["days"].get("d09", {}).get("transit")
    for day in ("d06", "d14"):
        cur = res["days"].get(day, {}).get("transit")
        if ref and cur:
            res["days"][day]["eclipse_vs_d09"] = {"stars": cur["stars"] - ref["stars"], "jobs": cur["jobs"] - ref["jobs"],
                                                  "off": [p for p in ref["lit"] if p not in cur["lit"]],
                                                  "on": [p for p in cur["lit"] if p not in ref["lit"]]}
    return res


def regional(meta: dict, poles: list[dict], communes: list[dict], budget: int) -> dict:
    """Mesures sur les 1 285 origines (TC, temps de trajet par sens `budget`) : éclipses, allers sans retour,
    transport à la demande dans les itinéraires des pôles allumés."""
    eclipse = {"d06": [], "d14": []}
    out_only = Counter()
    tad_couples = Counter()
    tad_communes = defaultdict(list)
    n = 0
    for c in communes:
        acc = load(FRONT_DATA_DIR / "access" / f"{c['insee']}.json")
        if acc is None:
            continue
        n += 1
        st = {d: states(series(acc, "transit", d, meta), poles, budget) for d in DAYS}
        if any(v is None for v in st.values()):
            continue
        ref = sum(x["jobs"] for x in st["d09"] if x["lit"])
        for d in ("d06", "d14"):
            cur = sum(x["jobs"] for x in st[d] if x["lit"])
            if ref > 0:
                eclipse[d].append({"insee": c["insee"], "name": c["name"], "ref": ref, "cur": cur,
                                   "share_lost": round(100 * (ref - cur) / ref, 1)})
        for d in DAYS:
            out_only[d] += sum(1 for x in st[d] if x["out_only"])
        itin = load(FRONT_DATA_DIR / "itineraries" / f"{c['insee']}.json")
        if itin:
            for d in DAYS:
                for i, x in enumerate(st[d]):
                    if x["lit"] and any((itinerary_flags(itin, d, leg, i) or {}).get("on_demand") for leg in ("out", "ret")):
                        tad_couples[d] += 1
                        tad_communes[d].append((c["insee"], c["name"], x["id"]))
    out = {"origins": n, "budget": budget, "out_only_couples": dict(out_only),
           "tad_lit_couples": dict(tad_couples),
           "tad_examples": {d: v[:15] for d, v in tad_communes.items()}}
    for d, rows in eclipse.items():
        shares = [r["share_lost"] for r in rows]
        out[f"eclipse_{d}"] = {
            "origins_with_d09_access": len(rows),
            "median_share_lost_pct": statistics.median(shares) if shares else None,
            "origins_losing_half_or_more": sum(1 for s in shares if s >= 50),
            "top": sorted(rows, key=lambda r: -(r["ref"] - r["cur"]))[:10],
        }
    return out


def bmo(origins: list[str], poles: list[dict]) -> dict:
    """Projets de recrutement BMO 2026 (France Travail) par bassin d'emploi et famille de métiers, pour les bassins
    des communes données et des communes des pôles. Libellé : « projets de recrutement », jamais « offres »."""
    if not BMO_XLSX.exists():
        return {"status": "absent", "path": str(BMO_XLSX)}
    b = read_bassins()
    bassin_of = dict(zip(b["insee"], b["bassin_code"]))
    names = dict(zip(b["bassin_code"], b["bassin_name"]))
    raw = pd.read_excel(BMO_XLSX, sheet_name="BMO_2026_open_data", dtype=str)
    raw = raw[raw["REG"].str.strip() == "11"].copy()
    for col in ("met", "xmet", "smet"):
        raw[col] = pd.to_numeric(raw[col], errors="coerce")  # cases non publiées (« * ») -> NaN, non comptées
    raw["BE26"] = raw["BE26"].str.strip()
    fam = raw.groupby(["BE26", "Famille_met", "Lbl_fam_met"], as_index=False)[["met", "xmet"]].sum(min_count=1)
    top_met = raw.sort_values("met", ascending=False)
    wanted: dict[str, list[str]] = defaultdict(list)
    for o in origins:
        wanted[str(bassin_of.get(o))].append(f"origine {o}")
    for p in poles:
        for c in p["communes"]:
            code = str(bassin_of.get(c))
            if p["id"] not in wanted[code]:
                wanted[code].append(p["id"])
    out = {"status": "ok", "source": "EMP03 France Travail BMO 2026, somme des cases publiées (cases « * » exclues)",
           "region_by_family": fam.groupby(["Famille_met", "Lbl_fam_met"])["met"].sum().sort_values(ascending=False)
           .reset_index().to_dict("records"),
           "bassins": {}}
    for code, why in wanted.items():
        f = fam[fam["BE26"] == code].sort_values("met", ascending=False)
        t = top_met[top_met["BE26"] == code].head(8)
        out["bassins"][code] = {"name": names.get(code), "for": why,
                                "total_met": float(f["met"].sum()),
                                "families": f[["Famille_met", "Lbl_fam_met", "met", "xmet"]].to_dict("records"),
                                "top_metiers": t[["Nom métier BMO", "Famille_met", "met", "xmet"]].to_dict("records")}
    return out


def gtfs_replacements(stop_part: str, service_day: str) -> dict:
    """Bus de remplacement (travaux) d'un RER ou d'un Transilien dans le GTFS IDFM publié (TRA01), à un arrêt :
    dates de circulation sur toute la validité du fichier, passages par heure le jour de référence, et passages des
    trains de la même ligne. Vérifie aussi la règle du front (variables.ts, replacementOf) : toutes les lignes de
    type bus des exploitants « RER » et « Transilien » sont des lignes « Remplacement ... »."""
    import datetime as dt
    import zipfile

    if not GTFS_ZIP.exists():
        return {"status": "absent", "path": str(GTFS_ZIP)}
    z = zipfile.ZipFile(GTFS_ZIP)
    rd = lambda n, **kw: pd.read_csv(z.open(n), dtype=str, **kw)
    agency, routes, trips = rd("agency.txt"), rd("routes.txt"), rd("trips.txt")
    cal, cdates, stops = rd("calendar.txt"), rd("calendar_dates.txt"), rd("stops.txt")
    ag = agency[agency.agency_name.isin(["RER", "Transilien"])].agency_id
    rail_bus = routes[routes.agency_id.isin(ag) & (routes.route_type == "3")]
    rule_ok = bool(rail_bus.route_long_name.fillna("").str.startswith("Remplacement").all())
    stop_ids = set(stops[stops.stop_name.str.contains(stop_part, na=False, regex=False)].stop_id)
    names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

    def dates(service: str) -> set[str]:
        out: set[str] = set()
        for _, r in cal[cal.service_id == service].iterrows():
            d = dt.date(int(r.start_date[:4]), int(r.start_date[4:6]), int(r.start_date[6:]))
            e = dt.date(int(r.end_date[:4]), int(r.end_date[4:6]), int(r.end_date[6:]))
            while d <= e:
                if r[names[d.weekday()]] == "1":
                    out.add(d.strftime("%Y%m%d"))
                d += dt.timedelta(days=1)
        for _, r in cdates[cdates.service_id == service].iterrows():
            (out.add if r.exception_type == "1" else out.discard)(r.date)
        return out

    wanted = trips[trips.route_id.isin(set(rail_bus.route_id))]
    rail = routes[routes.agency_id.isin(ag) & (routes.route_type == "2")]
    rail_trips = trips[trips.route_id.isin(set(rail.route_id))]
    ids = set(wanted.trip_id) | set(rail_trips.trip_id)
    parts = [ch[ch.trip_id.isin(ids) & ch.stop_id.isin(stop_ids)]
             for ch in pd.read_csv(z.open("stop_times.txt"), dtype=str, chunksize=2_000_000,
                                   usecols=["trip_id", "departure_time", "stop_id"])]
    st = pd.concat(parts).merge(trips[["trip_id", "route_id", "service_id"]], on="trip_id")
    st = st.merge(routes[["route_id", "route_short_name", "route_long_name", "route_type"]], on="route_id")
    svc_dates = {s: dates(s) for s in st.service_id.unique()}
    st["on_day"] = st.service_id.map(lambda s: service_day in svc_dates[s])
    st["hour"] = st.departure_time.str[:2].astype(int)
    out = {"status": "ok", "stop": stop_part, "service_day": service_day,
           "rule_rail_bus_are_replacements": rule_ok, "rail_bus_routes": len(rail_bus), "lines": {}}
    for (name, rtype), g in st.groupby(["route_long_name", "route_type"]):
        all_dates = sorted(set().union(*(svc_dates[s] for s in g.service_id.unique())))
        day = g[g.on_day]
        out["lines"][f"{name} (type {rtype})"] = {
            "dates": all_dates if rtype == "3" else f"{len(all_dates)} dates",
            "passes_by_hour_on_day": {int(k): int(v) for k, v in day.hour.value_counts().sort_index().items()},
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--budget", type=int, default=60)
    ap.add_argument("--origin", default="78358", help="commune de Léa (D-020)")
    ap.add_argument("--fragile", type=int, default=5, help="marge (min) en dessous de laquelle un verdict est fragile")
    ap.add_argument("--no-regional", action="store_true")
    ap.add_argument("--focus", default="BE_1107_75108", help="astre suivi par la visite (Paris 8e) : ses temps dans la table commune x commune")
    ap.add_argument("--evening", default="BE_1125", help="astre du soir de la visite (Seine-Aval, ancré à Poissy) : cas confirmé par Navitia")
    ap.add_argument("--gtfs", action="store_true", help="lit aussi le GTFS (TRA01) : bus de remplacement à la gare de Léa")
    ap.add_argument("--stop", default="Maisons-Laffitte", help="nom d'arrêt (partie) pour --gtfs")
    args = ap.parse_args()

    meta = load(FRONT_DATA_DIR / "meta.json")
    poles = load(FRONT_DATA_DIR / "poles.json")
    communes = load(FRONT_DATA_DIR / "communes.json")
    adj = pd.read_csv(PROCESSED_DIR / "adjacency_2026.csv", dtype=str)
    name = {c["insee"]: c["name"] for c in communes}
    od = od_setup(poles)
    if od is None:
        raise SystemExit(f"{OD_DIR / 'index.json'} introuvable : la visite dit les chiffres du site (table commune x commune), "
                         "08c ne peut pas les relever.")
    focus_pole = next((p for p in poles if p["id"] == args.focus), None)
    focus = {"id": focus_pole["id"], "insee": focus_pole["communes"][0]} if focus_pole and len(focus_pole["communes"]) == 1 else None

    # Communes étudiées : celles du vélo + TC partiel (D-014, D-020 : le récit et ses voisines) ; depuis le flux du 06/11
    # le vélo + TC est calculé partout (plus de liste) : mêmes communes, relues dans meta.story_communes et les limitrophes
    bike_list = (meta.get("mode_coverage") or {}).get("bike_transit")
    if bike_list:
        story = sorted(set(bike_list) | {args.origin})
    else:
        base = set(meta.get("story_communes") or []) | {args.origin}
        near = set(adj.loc[adj.insee_a.isin(base), "insee_b"]) | set(adj.loc[adj.insee_b.isin(base), "insee_a"])
        story = sorted((base | near) & set(meta.get("access_communes") or []))
    table = CommuneTransit.from_front(FRONT_DATA_DIR)  # part TC commune par commune de la règle de l'or (D-056)
    cand = {o: commune_cases(o, meta, poles, args.budget, args.fragile, od, focus, table) for o in story}
    for o, r in cand.items():
        r["name"] = name.get(o)
        nb = sorted(set(adj.loc[adj.insee_a == o, "insee_b"]) | set(adj.loc[adj.insee_b == o, "insee_a"]))
        rows = []
        rows_od = []
        for v in nb:
            acc = load(FRONT_DATA_DIR / "access" / f"{v}.json")
            if acc is None:
                continue
            s = summary(states(series(acc, "transit", "d09", meta), poles, args.budget))
            rows.append({"insee": v, "name": name.get(v), "stars": s["stars"], "jobs": s["jobs"],
                         "min_margin_lit": s["min_margin_lit"]})
            sky = od_sky(od, v, meta, args.budget, None, window=0, modes=("transit",), days_wanted=("d09",))
            if sky:
                t = sky["transit_d09"]
                rows_od.append({"insee": v, "name": name.get(v), "stars": t["stars"], "reached": t["reached"]})
        r["neighbours_d09_transit"] = sorted(rows, key=lambda x: x["stars"])
        r["neighbours_d09_transit_od"] = sorted(rows_od, key=lambda x: x["stars"])

    result = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%MZ"),
        "dataset_id": meta.get("dataset_id"), "processing_version": meta.get("processing_version"),
        "budget": args.budget, "fragile_margin_min": args.fragile,
        "rule": "allumé = aller ET retour <= budget (journée-type) ; marge = budget - max(aller, retour). Base du SITE (compteur, "
                "ciel de la visite) : table commune x commune, bloc `od` de chaque candidat (étoiles = astres dont au moins une "
                "commune est atteinte ; postes = communes atteintes, commune de départ hors total). Blocs `days` : access/ "
                "(vélo + TC, seul calcul de ce mode ; indices d'itinéraires).",
        "od_basis": "od_walk3000 (index.json + o/{insee}.bin)",
        "evening_case": evening_case(od, args.origin, meta, poles, args.evening, args.budget),
        "eclipse_exposure_rer_a": lost_stars_via_rer_a(cand.get(args.origin), load_gz(FRONT_DATA_DIR / "itineraries" / f"{args.origin}.json")),
        "candidates": cand,
        "regional": None if args.no_regional else regional(meta, poles, communes, args.budget),
        "bmo": bmo(story, poles),
        "gtfs_replacements": gtfs_replacements(args.stop, meta["service_date"].replace("-", "")) if args.gtfs else None,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")

    # Résumé lisible
    print(f"Jeu {result['dataset_id']}, temps de trajet {args.budget} min par sens, marge fragile < {args.fragile} min")
    for o, r in cand.items():
        print(f"\n== {o} {r['name']}")
        for key, t in (r.get("od") or {}).items():
            fp = t.get("focus_pole")
            fps = f" | {fp['id']} aller {fp['out']} (départ {fp['departure_min']}) retour {fp['ret']} : {fp['status']}" if fp else ""
            print(f"  SITE {key}: {t['stars']} étoiles, {t['reached']:,} postes ({t['share_pct']} %), étoiles stables pour un temps de trajet de "
                  f"{t['stars_stable_from']} à {t['stars_stable_to']} min, nombre exact de postes de {t['stable_from']} à {t['stable_to']} min{fps}")
        for day, d in r["days"].items():
            parts = [f"{m}={d[m]['stars']}" for m in MODES if d.get(m)]
            g = d.get("bike_gain")
            gain = ""
            if g and g["gained"] is None:
                gain = f" | or non calculable ({g['status']}), perdus {len(g['lost'])}"
            elif g:
                gain = f" | or +{len(g['gained'])} ({g['jobs']:,} postes, perdus {len(g['lost'])}, marge min {g['min_margin']})"
            ecl = d.get("eclipse_vs_d09")
            ecl_s = f" | vs 9h-17h {ecl['stars']:+d} étoiles {ecl['jobs']:+,} postes" if ecl else ""
            print(f"  {day}: {' '.join(parts)}{gain}{ecl_s}")
            if d.get("out_only"):
                print("     aller seul : " + "; ".join(
                    f"{x['id']} {x['out']}/{x['ret']}" + (" subst" if (x['ret_flags'] or {}).get('substitution_bus') else "")
                    for x in d["out_only"]))
            if d.get("fragile_lit"):
                print("     fragiles : " + "; ".join(f"{x['id']} {x['out']}/{x['ret']} marge {x['margin']}" for x in d["fragile_lit"]))
            if d.get("tad_lit"):
                print(f"     transport à la demande dans un pôle allumé : {d['tad_lit']}")
            if d.get("substitution_lit_or_out_only"):
                print(f"     bus de remplacement RER/train : {d['substitution_lit_or_out_only']}")
        nbs = r["neighbours_d09_transit"]
        if nbs:
            print("  voisines 9h-17h TC (access/, ancien calcul) : " + ", ".join(f"{x['name']} {x['stars']}" for x in nbs))
        nbo = r["neighbours_d09_transit_od"]
        if nbo:
            print("  voisines 9h-17h TC (SITE) : " + ", ".join(f"{x['name']} {x['stars']} étoiles, {x['reached']:,} postes" for x in nbo))
    if result["regional"]:
        g = result["regional"]
        print(f"\nRégion ({g['origins']} origines) : allers sans retour {g['out_only_couples']} ; "
              f"pôles allumés via transport à la demande {g['tad_lit_couples']}")
        for d in ("d06", "d14"):
            e = g[f"eclipse_{d}"]
            print(f"  éclipse {d} : médiane {e['median_share_lost_pct']} % des postes de 9h-17h perdus, "
                  f"{e['origins_losing_half_or_more']} origines sur {e['origins_with_d09_access']} en perdent la moitié ou plus")
    g = result["gtfs_replacements"]
    if g and g.get("status") == "ok":
        print(f"\nGTFS, arrêts « {g['stop']} », jour {g['service_day']} "
              f"(règle « bus RER/Transilien = remplacement » : {g['rule_rail_bus_are_replacements']})")
        for k, v in g["lines"].items():
            d = v["dates"]
            n = f"{len(d)} dates ({d[0]} au {d[-1]})" if isinstance(d, list) else d
            print(f"  {k} : {n} ; passages le jour de référence, par heure : {v['passes_by_hour_on_day']}")
    ev = result["evening_case"]
    if ev:
        print(f"\nCas du soir de la visite : {ev['name']}, ancré à {ev['anchor_name']} ({ev['anchor_insee']})")
        for d in ("d09", "d14"):
            if d in ev:
                e = ev[d]
                print(f"  {d} : aller {e['out']} (départ {e['departure_min']}) retour {e['ret']} : {e['status']} (statut stable de {e['status_stable_from']} "
                      f"à {e['status_stable_to']} min), astre allumé : {e['pole_lit']}")
    x = result["eclipse_exposure_rer_a"]
    if x:
        print(f"\nÉclipse 14h-22h : {x['lost']} étoiles éteintes, dont {x['return_via_rer_a']} avec un retour de 22h par le RER A "
              f"({x['without_detail']} sans itinéraire détaillé)")
    print(f"\nÉcrit {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
