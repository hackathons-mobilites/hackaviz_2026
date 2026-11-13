"""Itinéraires TC détaillés (04h) : logique pure, testable sans Java.

- choix, parmi les options McRAPTOR d'un trajet, de celle dont la durée est celle de la matrice publiée ;
- tâches à calculer à partir de la matrice publiée (aller au départ publié `dep`, retour à la fin du poste) ;
- enrichissement GTFS des tronçons (ligne, couleur, type, arrêts, accessibilité fauteuil) ;
- résumé par trajet (heures, durées, attente, distances par mode).

Règle de vérité : une valeur absente reste `None` avec une raison ; rien n'est deviné (accessibilité fauteuil : code
GTFS 1 ou 2 seulement, 0 ou vide = `None`).
"""

from __future__ import annotations

import math
from collections.abc import Container, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import pandas as pd

DIRECTIONS = ("out", "ret")
STATUS_OK = "ok"
STATUS_NOT_IN_MATRIX = "no_trip_in_matrix"  # la matrice publiée n'a pas de trajet : rien à détailler
STATUS_NO_OPTION = "no_itinerary_found"  # la matrice a une durée, R5 point à point ne trouve aucune option
STATUS_NOT_SNAPPED = "point_not_snapped"

# GTFS route_type (référence GTFS Schedule, routes.txt) -> famille affichable. Le rail (2) est distingué par
# l'exploitant du GTFS IDFM (agency_name « RER », « Transilien », « TER », lu dans agency.txt, pas deviné).
ROUTE_TYPE_KIND = {0: "tram", 1: "metro", 2: "rail", 3: "bus", 4: "ferry", 5: "cable_tram", 6: "cable", 7: "funicular",
                   11: "trolleybus", 12: "monorail"}
RAIL_AGENCY_KIND = {"RER": "rer", "Transilien": "train", "TER": "ter"}

# accessibilité fauteuil (GTFS Schedule) : trips.wheelchair_accessible et stops.wheelchair_boarding
WHEELCHAIR_CODES = {"1": True, "2": False}  # 0 ou vide : aucune information -> None


def trip_minutes(arr_s: int, departure_s: int) -> int:
    """Minute de la matrice : R5 rend floor(secondes / 60) (TravelTimeReducer : timeSeconds / SECONDS_PER_MINUTE)."""
    return (int(arr_s) - int(departure_s)) // 60


def _n_transit(opt: Mapping[str, Any]) -> int:
    return sum(1 for lg in opt["legs"] if lg["kind"] == "transit")


def _walk_s(opt: Mapping[str, Any]) -> int:
    return sum(lg["arr_s"] - lg["dep_s"] for lg in opt["legs"] if lg["kind"] == "walk")


def select_option(options: Sequence[Mapping[str, Any]], departure_s: int, target_min: int
                  ) -> tuple[Mapping[str, Any] | None, int | None]:
    """Option retenue et écart (minutes de l'option - minute de la matrice).

    Ordre : écart absolu à la minute de la matrice, puis arrivée la plus tôt, puis moins de montées, puis moins de
    marche (critères d'égalité seulement : ils ne changent jamais la durée retenue)."""
    if not options:
        return None, None
    def key(o: Mapping[str, Any]) -> tuple[int, int, int, int]:
        m = trip_minutes(o["arr_s"], departure_s)
        return abs(m - target_min), o["arr_s"], _n_transit(o), _walk_s(o)
    best = min(options, key=key)
    return best, trip_minutes(best["arr_s"], departure_s) - int(target_min)


def walk_only_option(departure_s: int, duration_s: int, dist_m: float) -> dict[str, Any]:
    return {"dep_s": departure_s, "arr_s": departure_s + duration_s,
            "legs": [{"kind": "walk", "role": "direct", "from_stop": None, "to_stop": None, "dep_s": departure_s,
                      "arr_s": departure_s + duration_s, "dist_m": dist_m}]}


def hhmm_to_s(text: str) -> int:
    """« HH:MM » ou « AAAA-MM-JJ HH:MM:SS » -> secondes depuis minuit."""
    t = str(text).strip().split(" ")[-1]
    parts = [int(x) for x in t.split(":")]
    return parts[0] * 3600 + parts[1] * 60 + (parts[2] if len(parts) > 2 else 0)


def s_to_hhmm(seconds: int) -> str:
    """Heure d'horloge tronquée à la minute (« 08:05 ») ; au-delà de minuit : « 24:10 » (convention GTFS)."""
    m = int(seconds) // 60
    return f"{m // 60:02d}:{m % 60:02d}"


@dataclass(frozen=True)
class Task:
    insee: str
    pole: str
    day: str
    direction: str  # out : commune -> pôle ; ret : pôle -> commune
    departure_s: int
    target_min: int | None
    reason: str | None  # raison publiée quand target_min est None


def tasks_from_matrix(day: str, df: pd.DataFrame, end_s: int, max_min: int) -> list[Task]:
    """Tâches d'une journée-type depuis la matrice publiée (colonnes from_id, to_id, out, dep, ret, reason).

    Aller : départ publié `dep`, cible `out`. Retour : départ à la fin du poste `end_s`, cible `ret`. Toute durée
    nulle, absente ou > `max_min` (règle `cap_to_max_trip` de l'export) donne une tâche sans cible (rien à calculer)."""
    tasks: list[Task] = []
    for r in df.itertuples(index=False):
        reason = r.reason if isinstance(r.reason, str) and r.reason else None
        out = None if pd.isna(r.out) or float(r.out) > max_min else int(r.out)
        ret = None if pd.isna(r.ret) or float(r.ret) > max_min else int(r.ret)
        dep = None if out is None or pd.isna(r.dep) else hhmm_to_s(r.dep)
        tasks.append(Task(str(r.from_id), str(r.to_id), day, "out", dep if dep is not None else -1, out,
                          None if out is not None else (reason or "no_trip_within_120")))
        tasks.append(Task(str(r.from_id), str(r.to_id), day, "ret", end_s, ret,
                          None if ret is not None else (reason or "no_trip_within_120")))
    return tasks


def record(task: Task, status: str, option: Mapping[str, Any] | None = None, delta: int | None = None,
           n_options: int = 0, seconds: float | None = None) -> dict[str, Any]:
    """Ligne de sortie de 04h (JSON) : la tâche, le statut et, si trouvé, l'itinéraire brut (identifiants R5/GTFS)."""
    return {"insee": task.insee, "pole": task.pole, "day": task.day, "dir": task.direction,
            "dep_s": task.departure_s if task.departure_s >= 0 else None, "target_min": task.target_min,
            "status": status, "reason": task.reason, "delta_min": delta, "n_options": n_options,
            "option": None if option is None else {"dep_s": option["dep_s"], "arr_s": option["arr_s"],
                                                   "legs": [dict(lg) for lg in option["legs"]]},
            "secs": None if seconds is None else round(seconds, 3)}


def agreement(records: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Accord avec la matrice publiée sur les trajets calculés : écart (min) de l'option retenue."""
    deltas = [r["delta_min"] for r in records if r["status"] == STATUS_OK]
    statuses: dict[str, int] = {}
    for r in records:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    n = len(deltas)
    if not n:
        return {"n_ok": 0, "statuses": statuses}
    s = pd.Series(deltas)
    return {"n_ok": n, "statuses": statuses, "exact": int((s == 0).sum()), "exact_share": round(float((s == 0).mean()), 4),
            "within_1": int((s.abs() <= 1).sum()), "longer": int((s > 0).sum()), "shorter": int((s < 0).sum()),
            "delta_min": int(s.min()), "delta_max": int(s.max()), "delta_median": float(s.median())}


# ----------------------------------------------------------------------------- GTFS
def strip_feed(gtfs_id: str | None, known: Container[str]) -> str | None:
    """R5 préfixe les identifiants par l'identifiant du flux (« feed:IDFM:... ») : on retire le préfixe s'il n'est pas
    déjà un identifiant GTFS connu. Renvoie None si l'identifiant est inconnu après retrait (jamais deviné)."""
    if gtfs_id is None:
        return None
    if gtfs_id in known:
        return gtfs_id
    if ":" in gtfs_id:
        tail = gtfs_id.split(":", 1)[1]
        if tail in known:
            return tail
    return None


@dataclass
class GtfsLookup:
    """Tables GTFS en dictionnaires (recherche en temps constant ; l'export lit des dizaines de milliers de tronçons)."""

    routes: dict[str, dict[str, Any]]  # route_id -> route_short_name, route_long_name, route_type, couleurs, agency_name
    stops: dict[str, dict[str, Any]]  # stop_id -> stop_name, parent_station, wheelchair_boarding
    trips: dict[str, Any]  # trip_id -> wheelchair_accessible

    @classmethod
    def from_frames(cls, routes: pd.DataFrame, agency: pd.DataFrame, stops: pd.DataFrame, trips: pd.DataFrame
                    ) -> GtfsLookup:
        r = routes.merge(agency[["agency_id", "agency_name"]], on="agency_id", how="left")
        return cls({row["route_id"]: row for row in r.to_dict("records")},
                   {row["stop_id"]: row for row in stops.to_dict("records")},
                   dict(zip(trips["trip_id"], trips["wheelchair_accessible"], strict=True)))

    def kind(self, route_id: str) -> str | None:
        row = self.routes.get(route_id)
        if row is None:
            return None
        k = ROUTE_TYPE_KIND.get(int(row["route_type"]))
        if k == "rail":
            return RAIL_AGENCY_KIND.get(str(row.get("agency_name")), "rail")
        return k

    def stop_wheelchair(self, stop_id: str | None) -> bool | None:
        """wheelchair_boarding de l'arrêt ; 0 ou vide sur un quai = hérité de la station parente (spécification GTFS)."""
        row = self.stops.get(stop_id) if stop_id is not None else None
        if row is None:
            return None
        code = _code(row.get("wheelchair_boarding"))
        if code in WHEELCHAIR_CODES:
            return WHEELCHAIR_CODES[code]
        parent = row.get("parent_station")
        if isinstance(parent, str) and parent and parent in self.stops:
            return WHEELCHAIR_CODES.get(_code(self.stops[parent].get("wheelchair_boarding")))
        return None

    def trip_wheelchair(self, trip_id: str | None) -> bool | None:
        if trip_id is None or trip_id not in self.trips:
            return None
        return WHEELCHAIR_CODES.get(_code(self.trips[trip_id]))

    def stop_name(self, stop_id: str | None) -> str | None:
        row = self.stops.get(stop_id) if stop_id is not None else None
        v = None if row is None else row.get("stop_name")
        return v if isinstance(v, str) and v else None


def _code(v: Any) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    s = str(v).strip()
    return s.removesuffix(".0")


def enrich_leg(leg: Mapping[str, Any], gtfs: GtfsLookup) -> dict[str, Any]:
    """Tronçon publiable : identifiants GTFS sans préfixe de flux, noms, ligne, couleur, accessibilité."""
    stops_known = gtfs.stops
    out: dict[str, Any] = {"kind": leg["kind"] if leg["kind"] == "walk" else None, "role": leg.get("role"),
                           "dep_s": int(leg["dep_s"]), "arr_s": int(leg["arr_s"]),
                           "min": (int(leg["arr_s"]) - int(leg["dep_s"])) / 60.0,
                           "dist_m": None if leg.get("dist_m") is None or (isinstance(leg["dist_m"], float)
                                                                          and math.isnan(leg["dist_m"]))
                           else round(float(leg["dist_m"]))}
    fs = strip_feed(leg.get("from_stop"), stops_known)
    ts = strip_feed(leg.get("to_stop"), stops_known)
    out["from_stop"], out["to_stop"] = fs, ts
    out["from_name"], out["to_name"] = gtfs.stop_name(fs), gtfs.stop_name(ts)
    if leg["kind"] == "transit":
        rid = strip_feed(leg.get("route_id"), gtfs.routes)
        tid = strip_feed(leg.get("trip"), gtfs.trips)
        out["kind"] = gtfs.kind(rid) if rid else None
        out["route_id"], out["trip_id"] = rid, tid
        if rid is not None:
            row = gtfs.routes[rid]
            out["line"] = _str(row.get("route_short_name"))
            out["line_long"] = _str(row.get("route_long_name"))
            out["color"] = _str(row.get("route_color"))
            out["text_color"] = _str(row.get("route_text_color"))
            out["route_type"] = int(row["route_type"])
            out["agency"] = _str(row.get("agency_name"))
        out["wait_s"] = int(leg["dep_s"]) - int(leg["ready_s"])
        out["wheelchair_trip"] = gtfs.trip_wheelchair(tid)
        out["wheelchair_from"] = gtfs.stop_wheelchair(fs)
        out["wheelchair_to"] = gtfs.stop_wheelchair(ts)
        out["shape"] = bool(leg.get("shape"))
    return out


def _str(v: Any) -> str | None:
    return v if isinstance(v, str) and v else None
