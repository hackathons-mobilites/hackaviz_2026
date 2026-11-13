"""Export des itinéraires TC détaillés (D-028, adoptée le 03/11/2026) : contrat `itineraries/{insee}.json`.

Un fichier par commune, publié dans frontend/public/data/itineraries/ pour les seules communes complètes (06h
--publish), annoncées par `meta.itineraries_communes`. Logique pure (sans Java), testée dans tests/test_itin_export.py.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path
from typing import Any

from starway import fares_carbon as fc
from starway import itin_sets as iss
from starway import itineraries as it
from starway import line_facts as lf

CONTRACT_VERSION = "itineraries-1"
CONTRACT_PREFIX = "itineraries-"  # préfixe lu par le front (isItinerariesFile)


# Tirets cadratin et demi-cadratin (CLAUDE.md, règle 8) : certains noms d'arrêts du GTFS en contiennent ; ils sont
# publiés avec un tiret simple (seule transformation des libellés).
_LONG_DASHES = {0x2013: "-", 0x2014: "-"}
EARTH_RADIUS_M = 6_371_000.0  # rayon moyen de la Terre (sphère), formule de haversine
DIST_METHOD_STOPS = ("somme des distances à vol d'oiseau entre arrêts successifs de la course (GTFS stop_times et "
                     "stops), de l'arrêt de montée à l'arrêt de descente")
REASON_ON_DEMAND = ("transport à la demande ({line}) : réservation obligatoire, le trajet du véhicule n'est pas publié "
                    "dans le GTFS")
REASON_STOPS_NOT_FOUND = "arrêts du tronçon {line} non retrouvés dans la course GTFS"
DEGENERATE_LEG_REASON = "tronçon en TC qui monte et descend au même arrêt (retrouvé par R5) : détail non publié"


def typo(v: Any) -> Any:
    """Libellé publié sans tiret long (les autres valeurs sont rendues telles quelles)."""
    return v.translate(_LONG_DASHES) if isinstance(v, str) else v


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


@dataclass(frozen=True)
class TripStops:
    """Courses GTFS utilisées par les itinéraires : suite des arrêts (ordre de `stop_sequence`), coordonnées des
    arrêts, et courses à la demande (un arrêt au moins avec `pickup_type` ou `drop_off_type` = 2, une règle de
    réservation ou une fenêtre de prise en charge : spécification GTFS)."""
    seqs: Mapping[str, Sequence[str]]
    coords: Mapping[str, tuple[float, float]]
    on_demand: frozenset[str] = field(default_factory=frozenset)


def stop_hop_distance(seq: Sequence[str], from_stop: str, to_stop: str, n_hops: int | None,
                      coords: Mapping[str, tuple[float, float]]) -> float | None:
    """Distance d'un tronçon = somme des distances à vol d'oiseau entre arrêts successifs de la course, de la montée à
    la descente. Avec `n_hops` (R5), la descente est exactement `n_hops` arrêts après la montée ; sinon la première
    occurrence de l'arrêt de descente après la montée. None si les arrêts ne sont pas retrouvés."""
    for i, sid in enumerate(seq):
        if sid != from_stop:
            continue
        j = i + n_hops if n_hops else next((k for k in range(i + 1, len(seq)) if seq[k] == to_stop), None)
        if j is None or j >= len(seq) or seq[j] != to_stop:
            continue
        pts = [coords.get(x) for x in seq[i:j + 1]]
        if any(pt is None for pt in pts):
            return None
        return sum(haversine_m(*a, *b) for a, b in pairwise(pts))  # type: ignore[misc]
    return None


def apply_stop_distances(legs: list[dict[str, Any]], raw: Sequence[Mapping[str, Any]], ts: TripStops) -> None:
    """Remplace la distance R5 des tronçons en TC (découpage de shapes.txt, parfois impossible : longueur supérieure au
    tracé entier, ou inférieure à la ligne droite entre les deux arrêts) par `stop_hop_distance`. Course à la demande :
    distance `None`, `on_demand` vrai et raison. Arrêts non retrouvés : distance `None` et raison."""
    for e, r in zip(legs, raw, strict=True):
        if e.get("route_type") is None:
            continue
        line = e.get("line") or "?"
        if e.get("trip_id") in ts.on_demand:
            e["dist_m"], e["on_demand"], e["dist_reason"] = None, True, REASON_ON_DEMAND.format(line=line)
            continue
        seq = ts.seqs.get(e.get("trip_id") or "")
        d = stop_hop_distance(seq, e["from_stop"], e["to_stop"], r.get("n_hops"), ts.coords) if seq else None
        e["dist_m"] = None if d is None else round(d)
        if d is None:
            e["dist_reason"] = REASON_STOPS_NOT_FOUND.format(line=line)


def _min(seconds: int) -> int:
    """Durée publiée en minutes entières, tronquée comme la matrice (floor)."""
    return int(seconds) // 60


def leg_json(e: Mapping[str, Any], facts: lf.LineFacts | None = None) -> dict[str, Any]:
    """Tronçon publié (clés courtes, `null` explicites). Avec `facts` (06h) : climatisation et ponctualité de la
    ligne (TRA03, QS01) sur chaque tronçon en TC."""
    d: dict[str, Any] = {"m": e["kind"], "dep": it.s_to_hhmm(e["dep_s"]), "arr": it.s_to_hhmm(e["arr_s"]),
                         "min": round(e["min"], 1), "dist_m": e["dist_m"]}
    if e["kind"] == "walk" or e.get("route_type") is None:
        d["role"] = e.get("role")
        d["from"], d["to"] = typo(e.get("from_name")), typo(e.get("to_name"))
        return d
    d.update({"line": typo(e.get("line")), "color": e.get("color"), "text_color": e.get("text_color"),
              "route_type": e.get("route_type"), "agency": typo(e.get("agency")),
              "from": typo(e.get("from_name")), "to": typo(e.get("to_name")), "wait_min": round(e["wait_s"] / 60, 1),
              "wc_trip": e.get("wheelchair_trip"), "wc_from": e.get("wheelchair_from"), "wc_to": e.get("wheelchair_to")})
    if e.get("on_demand"):
        d["on_demand"] = True
    if facts is not None:
        d.update(facts.leg_fields(e["kind"], e.get("route_id"), e.get("line")))
    return d


def degenerate_legs(legs: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Tronçons en TC « x vers x » : montée et descente au même arrêt (même nom, distance entre arrêts nulle) ; deux
    arrêts différents peuvent porter le même nom (distance > 0)."""
    return [lg for lg in legs if lg["m"] != "walk" and lg.get("from") == lg.get("to") and lg.get("dist_m") == 0]


def trip_json(rec: Mapping[str, Any], gtfs: it.GtfsLookup, parents: Mapping[str, str],
              transfers: frozenset[tuple[str, str]], co2f: fc.Co2Factors,
              trip_stops: TripStops | None = None, facts: lf.LineFacts | None = None) -> dict[str, Any]:
    """Un sens d'un couple (commune, pôle, journée) : itinéraire, tickets, carbone ; ou statut + raison.
    `trip_stops` (06h) : distance des tronçons en TC entre arrêts successifs (`apply_stop_distances`) ; sans lui,
    distance R5 (bancs et tests)."""
    if rec["status"] != it.STATUS_OK:
        return {"status": rec["status"], "reason": rec.get("reason")}
    o = rec["option"]
    legs = [it.enrich_leg(lg, gtfs) for lg in o["legs"]]
    if trip_stops is not None:
        apply_stop_distances(legs, o["legs"], trip_stops)
    transit = [e for e in legs if e.get("route_type") is not None]
    walk_m = [e["dist_m"] for e in legs if e["kind"] == "walk"]
    legs_json = [leg_json(e, facts) for e in legs]
    if degenerate_legs(legs_json):
        # R5 a rendu un tronçon en TC qui monte et descend au même arrêt (distance nulle) : l'afficher serait montrer
        # un trajet absurde. Le détail n'est pas publié (la durée de la matrice, elle, reste celle du calcul).
        return {"status": it.STATUS_NO_OPTION, "reason": DEGENERATE_LEG_REASON}
    first_dep = rec["dep_s"]
    tickets = fc.count_tickets(legs, parents, transfers)
    co2 = fc.trip_co2(legs, co2f)
    no_dist = next((e["dist_reason"] for e in transit if e.get("dist_m") is None and e.get("dist_reason")), None)
    if co2["status"] != "ok" and no_dist and co2.get("reason") == "distance inconnue":
        co2 = {**co2, "reason": no_dist}
    return {"status": it.STATUS_OK, "dep": it.s_to_hhmm(first_dep), "arr": it.s_to_hhmm(o["arr_s"]),
            "min": _min(o["arr_s"] - first_dep), "matrix_min": rec["target_min"], "delta_min": rec["delta_min"],
            "rides": len(transit),
            "wait_min": round(sum(e["wait_s"] for e in transit) / 60, 1),
            "walk_m": None if any(x is None for x in walk_m) else int(sum(walk_m)),
            "legs": legs_json,
            "tickets": {k: tickets[k] for k in ("metro_train_rer", "bus_tram", "airport", "cost_eur", "status")}
            | ({"reasons": tickets["reasons"]} if tickets.get("reasons") else {}),
            "co2_g": {"value": co2["g"], "status": co2["status"]}
            | ({"reason": co2["reason"]} if co2.get("reason") else {})}


def commune_file(insee: str, records: Iterable[Mapping[str, Any]], pole_ids: Sequence[str], day_ids: Sequence[str],
                 gtfs: it.GtfsLookup, parents: Mapping[str, str], transfers: frozenset[tuple[str, str]],
                 offpeak: Mapping[tuple[str, str], Mapping[str, Any]] | None, offpeak_dep: str | None,
                 meta: Mapping[str, Any], co2f: fc.Co2Factors,
                 trip_stops: TripStops | None = None, facts: lf.LineFacts | None = None) -> dict[str, Any]:
    """`itineraries/{insee}.json` : `days.{d}.out[i]` et `.ret[i]` pour le pôle `poles[i]` (ordre de poles.json).
    Avec `facts` : faits par ligne sur chaque tronçon en TC et bloc `line_facts_meta` (sources, mois)."""
    by_key = {(r["pole"], r["day"], r["dir"]): r for r in records if r["insee"] == insee}
    days: dict[str, Any] = {}
    for d in day_ids:
        days[d] = {}
        for direction in it.DIRECTIONS:
            row = []
            for p in pole_ids:
                rec = by_key.get((p, d, direction))
                row.append({"status": "not_computed", "reason": "not_computed"} if rec is None
                           else trip_json(rec, gtfs, parents, transfers, co2f, trip_stops, facts))
            days[d][direction] = row
    out: dict[str, Any] = {"insee": insee, "contract": CONTRACT_VERSION, **meta, "poles": list(pole_ids)}
    if facts is not None:
        out["line_facts_meta"] = facts.file_meta()
    out["days"] = days
    if offpeak is not None:
        out["offpeak"] = {"dep": offpeak_dep,
                          "out": [_opt_int(offpeak.get((insee, p), {}).get("out")) for p in pole_ids],
                          "ret": [_opt_int(offpeak.get((insee, p), {}).get("ret")) for p in pole_ids],
                          "reason": [offpeak.get((insee, p), {}).get("reason") for p in pole_ids]}
    return out


def _opt_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else int(f)


def check_file(doc: Mapping[str, Any], max_min: int) -> list[str]:
    """Contrôles de cohérence d'un fichier (utilisés par 06h et 07) : chaque trajet a une valeur ou un statut, les
    tronçons s'enchaînent dans le temps, la durée de la matrice est publiée (120 min au plus ; celle de l'itinéraire peut
    la dépasser de `delta_min`), aucun prix ni carbone n'est
    publié sans statut, et l'aller arrive avant le début du poste quand la matrice le dit (dep + matrix_min)."""
    errs: list[str] = []
    n = len(doc["poles"])
    for d, dirs in doc["days"].items():
        for direction, row in dirs.items():
            if len(row) != n:
                errs.append(f"{doc['insee']} {d} {direction} : {len(row)} trajets pour {n} pôles")
            for i, t in enumerate(row):
                where = f"{doc['insee']} {d} {direction} {doc['poles'][i]}"
                if t["status"] != it.STATUS_OK:
                    if not t.get("reason") and t["status"] != it.STATUS_NO_OPTION:
                        errs.append(f"{where} : statut {t['status']} sans raison")
                    continue
                legs = t["legs"]
                if not legs:
                    errs.append(f"{where} : aucun tronçon")
                    continue
                if t["matrix_min"] is None or t["matrix_min"] > max_min:
                    errs.append(f"{where} : durée de la matrice {t['matrix_min']} hors de 0 à {max_min} min")
                prev = None
                for lg in legs:
                    if lg["arr"] < lg["dep"]:
                        errs.append(f"{where} : tronçon qui finit avant de commencer")
                    if prev is not None and lg["dep"] < prev:
                        errs.append(f"{where} : tronçons qui se chevauchent")
                    prev = lg["arr"]
                if t["tickets"]["cost_eur"] is None and t["tickets"]["status"] == "ok":
                    errs.append(f"{where} : prix nul sans statut")
                errs += [f"{where} : {e}" for e in _ticket_errors(t["tickets"], any(lg["m"] != "walk" for lg in legs))]
                if t["co2_g"]["value"] is None and t["co2_g"]["status"] == "ok":
                    errs.append(f"{where} : carbone nul sans statut")
                if t["co2_g"]["status"] == "ok" and (not isinstance(t["co2_g"]["value"], int) or t["co2_g"]["value"] < 0):
                    errs.append(f"{where} : carbone {t['co2_g']['value']} (entier positif attendu)")
                if t["co2_g"]["status"] != "ok" and (t["co2_g"]["value"] is not None or not t["co2_g"].get("reason")):
                    errs.append(f"{where} : carbone {t['co2_g']['status']} avec valeur ou sans raison")
                errs += [f"{where} : {e}" for e in _line_fact_errors(legs, "line_facts_meta" in doc)]
                for lg in legs:
                    if any(isinstance(lg.get(k), str) and (chr(0x2013) in lg[k] or chr(0x2014) in lg[k])
                           for k in ("from", "to", "line", "agency")):
                        errs.append(f"{where} : tiret long dans un libellé")
                    # « x vers x » : montée et descente au même arrêt (voir degenerate_legs, jamais publié)
                    if degenerate_legs([lg]):
                        errs.append(f"{where} : tronçon {lg.get('line')} de {lg.get('from')} vers lui-même")
    return errs


def _line_fact_errors(legs: Sequence[Mapping[str, Any]], expected: bool) -> list[str]:
    """Faits par ligne (TRA03, QS01) : sur chaque tronçon en TC si le fichier porte `line_facts_meta`, sinon sur
    aucun ; climatisation dans les 4 valeurs du référentiel (ou null) ; ponctualité = valeur et mois ensemble, ou
    null et une raison, et seulement pour un RER ou un Transilien."""
    errs: list[str] = []
    for lg in legs:
        if lg["m"] == "walk":
            if "air_conditioning" in lg or "punctuality" in lg:
                errs.append("faits de ligne sur un tronçon à pied")
            continue
        if not expected:
            if "air_conditioning" in lg or "punctuality" in lg:
                errs.append("faits de ligne sans line_facts_meta")
            continue
        ac = lg.get("air_conditioning", "absent")
        if ac is not None and ac not in lf.AC_VALUES:
            errs.append(f"climatisation {ac!r} hors des valeurs du référentiel")
        p = lg.get("punctuality")
        if not isinstance(p, dict):
            errs.append("ponctualité absente")
        elif p.get("value_pct") is not None:
            v = p["value_pct"]
            if not isinstance(v, (int, float)) or not 0 <= v <= 100 or not p.get("month")                     or lg["m"] not in lf.PUNCTUALITY_KINDS:
                errs.append(f"ponctualité {p} invalide pour {lg['m']} {lg.get('line')}")
        elif p.get("month") is not None or p.get("reason") not in (lf.REASON_NO_OPEN_DATA, lf.REASON_MONTH_MISSING):
            errs.append(f"ponctualité nulle sans raison : {p}")
    return errs


def _ticket_errors(k: Mapping[str, Any], has_transit: bool) -> list[str]:
    """Prix = nombre de tickets x prix unitaire publié (COST02) ; `unknown` : aucun nombre ni prix ; au moins un
    ticket dès qu'un tronçon est en TC (un trajet tout à pied n'en demande aucun : 0 ticket, 0 €)."""
    names = tuple(fc.TICKET_PRICES_EUR)
    if k["status"] == "unknown":
        return [] if all(k.get(n) is None for n in (*names, "cost_eur")) and k.get("reasons") else             ["tickets inconnus avec un nombre, un prix ou sans raison"]
    if any(not isinstance(k.get(n), int) or k[n] < 0 for n in names):
        return [f"nombres de tickets invalides {[k.get(n) for n in names]}"]
    want = round(sum(k[n] * fc.TICKET_PRICES_EUR[n] for n in names), 2)
    if k.get("cost_eur") is None or abs(k["cost_eur"] - want) > 0.005:
        return [f"prix {k.get('cost_eur')} différent de {want} (nombre x prix unitaire)"]
    if has_transit and sum(k[n] for n in names) == 0:
        return ["aucun ticket pour un trajet en transport en commun"]
    return []


def complete_communes(records: Iterable[Mapping[str, Any]], pole_ids: Sequence[str],
                      day_ids: Sequence[str]) -> list[str]:
    """Communes dont chaque couple (pôle, journée, sens) a un enregistrement de 04h : seules publiables."""
    want = {(p, d, s) for p in pole_ids for d in day_ids for s in it.DIRECTIONS}
    seen: dict[str, set[tuple[str, str, str]]] = {}
    for r in records:
        seen.setdefault(r["insee"], set()).add((r["pole"], r["day"], r["dir"]))
    return sorted(i for i, keys in seen.items() if want <= keys)


def check_against_access(doc: Mapping[str, Any], access: Mapping[str, Any], pole_ids: Sequence[str],
                         day_ids: Sequence[str], itin: iss.ItinSet | None = None) -> list[str]:
    """Le fichier publié reprend la matrice publiée (`access/{insee}.json`, `modes.transit` pour le réglage par
    défaut, `variants.{réglage}.transit` pour un autre jeu `itin`) :
    même ordre des pôles, `matrix_min` = durée du sens, départ de l'aller = `dep`, aucun itinéraire sans durée
    dans la matrice, aucun trajet de la matrice marqué absent, aucun `not_computed` publié."""
    insee = doc["insee"]
    if list(doc["poles"]) != list(pole_ids):
        return [f"{insee} : ordre des pôles différent de poles.json"]
    if not str(doc.get("contract", "")).startswith(CONTRACT_PREFIX):
        return [f"{insee} : contrat {doc.get('contract')}"]
    tr = iss.transit_series(access, itin) if itin is not None else (access.get("modes") or {}).get("transit")
    if not tr:
        return [f"{insee} : aucune série TC dans access/ pour ce réglage de marche"]
    errs: list[str] = []
    for d in day_ids:
        s = tr.get(d)
        if s is None or d not in doc["days"]:
            errs.append(f"{insee} {d} : journée absente de access/ ou du fichier")
            continue
        for direction in it.DIRECTIONS:
            for i, t in enumerate(doc["days"][d][direction]):
                where = f"{insee} {d} {direction} {pole_ids[i]}"
                m = s[direction][i]
                if t["status"] == it.STATUS_OK:
                    if t["matrix_min"] != m:
                        errs.append(f"{where} : matrix_min {t['matrix_min']} != access {m}")
                    if direction == "out" and t["dep"] != s["dep"][i]:
                        errs.append(f"{where} : départ {t['dep']} != access {s['dep'][i]}")
                elif t["status"] == it.STATUS_NOT_IN_MATRIX:
                    if m is not None:
                        errs.append(f"{where} : marqué sans trajet alors que access/ donne {m} min")
                elif t["status"] == "not_computed":
                    errs.append(f"{where} : non calculé (commune incomplète publiée)")
    return errs


def published_communes(directory: Path) -> list[str]:
    """Codes INSEE des fichiers `{insee}.json.gz` présents (annonce `meta.itineraries_communes`) ; voir itin_sets."""
    return iss.published_communes(directory)
