"""Marquage des correspondances trop courtes dans les itinéraires publiés (D-031, option c, 04/11/2026).

Aucun calcul de trajet : on reporte dans `itineraries/{insee}.json` le contrôle de `07h_transfer_times_check.py`
(statut de chaque itinéraire, correspondances plus courtes que le minimum officiel, borne recalée sur les mêmes
lignes). Le ciel et les durées publiées ne changent pas. Contrat : `contrats-donnees.md`, section
« Appliqué (04/11, D-031 c) ». Script : `scripts/06t_export_transfer_check.py`. Tests : tests/test_transfer_marks.py.

Règles (celles de `starway/transfer_times.py`, jamais mélangées dans un même fichier) :
- `gtfs` : minimum = ligne `transfers.txt` du GTFS IDFM (TRA01) pour le couple exact de quais ;
- `reference` : la ligne `transfers.txt`, sinon la durée de correspondance du calculateur officiel (Navitia, API PRIM
  « connections », TRA02B, relevée par 07i) ; sinon aucun minimum connu.

Un verdict allumé (aller et retour dans le budget, durées de la matrice) est dit « à risque » si un sens a une
correspondance trop courte et que sa borne recalée dépasse le budget, ou qu'il n'y a pas de borne : même règle que
07h (`verdicts`). C'est une borne haute (mêmes lignes, courses suivantes) : « à risque » n'est pas « faux ».
"""

from __future__ import annotations

import math
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from starway import transfer_times as tx
from starway.itin_export import CONTRACT_VERSION as BASE_CONTRACT
from starway.itin_export import typo

CONTRACT_VERSION = "itineraries-2"  # itineraries-1 + `transfer_check` par trajet et `transfer_check_meta`
RULES = ("gtfs", "reference")
DEFAULT_RULE = "reference"
SOURCE_GTFS = "gtfs"
SOURCE_NAVITIA = "navitia"
SOURCE_CODES = {SOURCE_GTFS: "TRA01", SOURCE_NAVITIA: "TRA02B"}  # codes de sources.json (TRA02B : réponses « connections », pas les trajets TRA02)
TRIP_STATUSES = (tx.TRIP_SHORT, tx.TRIP_VERIFIED, tx.TRIP_UNVERIFIED, tx.TRIP_NO_TRANSFER)
BOUND_METHODS = ("forward", "backward")  # borne trouvée (transfer_times.retime)
BOUND_REASONS = ("no_run", "over_max", "over_lookback")  # pas de borne : raison publiée
UNKNOWN_STATUSES = (tx.SAME_STOP, tx.NO_LINE)  # correspondance sans minimum connu


@dataclass(frozen=True)
class TransferRow:
    """Une correspondance contrôlée par 07h (`transfers_all.csv.gz`), entre le tronçon TC `k` et le suivant."""

    k: int
    from_name: str | None  # quai de descente (nom GTFS)
    to_name: str | None  # quai de montée
    arr: str  # "HH:MM", arrivée du tronçon k
    dep: str  # "HH:MM", départ du tronçon k + 1
    available_s: int
    official_min_s: int | None  # transfers.txt
    navitia_min_s: int | None  # Navitia, seulement pour un couple sans ligne transfers.txt
    status: str  # règle gtfs : ok | short | same_stop | no_line
    reference_status: str  # règle reference
    from_stop: str | None = None  # identifiants GTFS (contrôle des sources par 07)
    to_stop: str | None = None


def row_status(r: TransferRow, rule: str) -> str:
    return r.status if rule == "gtfs" else r.reference_status


def row_minimum(r: TransferRow, rule: str) -> tuple[int, str] | None:
    """(minimum en s, source) selon la règle ; None si aucun minimum connu."""
    if r.official_min_s is not None:
        return r.official_min_s, SOURCE_GTFS
    if rule == "reference" and r.navitia_min_s is not None:
        return r.navitia_min_s, SOURCE_NAVITIA
    return None


def trip_status(rows: Sequence[TransferRow], rule: str) -> str:
    """Même règle que `transfer_times.trip_status`, recalculée depuis les lignes publiées par 07h."""
    sts = [row_status(r, rule) for r in rows]
    if not sts:
        return tx.TRIP_NO_TRANSFER
    if tx.SHORT in sts:
        return tx.TRIP_SHORT
    if all(s == tx.OK for s in sts):
        return tx.TRIP_VERIFIED
    return tx.TRIP_UNVERIFIED


def trip_mark(rows: Sequence[TransferRow], rule: str, bound_min: int | None, bound_method: str | None
              ) -> dict[str, Any]:
    """Champ `transfer_check` d'un trajet publié.

    `short` : correspondances plus courtes que le minimum, dans l'ordre du trajet (`at` quai de descente, `to` quai de
    montée, temps disponible, minimum, source) ; `unverified` : nombre de correspondances sans minimum connu (si > 0) ;
    `bound_min` : borne recalée sur les mêmes lignes (minutes), seulement pour un trajet `short`, `null` avec
    `bound_reason` si aucune borne."""
    rows = sorted(rows, key=lambda r: r.k)
    status = trip_status(rows, rule)
    out: dict[str, Any] = {"status": status}
    short = []
    for r in rows:
        if row_status(r, rule) != tx.SHORT:
            continue
        m = row_minimum(r, rule)
        if m is None:  # impossible : « short » suppose un minimum
            raise ValueError(f"correspondance trop courte sans minimum (k={r.k})")
        short.append({"at": typo(r.from_name), "to": typo(r.to_name), "available_s": int(r.available_s),
                      "min_s": int(m[0]), "source": m[1]})
    if short:
        out["short"] = short
    unknown = sum(row_status(r, rule) in UNKNOWN_STATUSES for r in rows)
    if unknown:
        out["unverified"] = unknown
    if status == tx.TRIP_SHORT:
        if bound_min is not None:
            if bound_method not in BOUND_METHODS:
                raise ValueError(f"borne {bound_min} avec la méthode {bound_method}")
            out["bound_min"] = int(bound_min)
        else:
            if bound_method not in BOUND_REASONS:
                raise ValueError(f"borne absente avec la méthode {bound_method}")
            out["bound_min"] = None
            out["bound_reason"] = bound_method
    return out


def transit_legs(trip: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Tronçons en TC d'un trajet publié (ceux qui ont un `route_type`, comme `rides`)."""
    return [lg for lg in trip.get("legs") or [] if lg.get("route_type") is not None]


def alignment_errors(trip: Mapping[str, Any], rows: Sequence[TransferRow], itinerary_min: int, matrix_min: int,
                     n_transfers: int) -> list[str]:
    """Le contrôle de 07h porte-t-il bien sur ce trajet publié ? Durées, nombre de correspondances, et pour chacune
    les heures et les noms des quais des tronçons publiés (sinon : relancer 07h sur les fichiers publiés)."""
    errs: list[str] = []
    if trip.get("min") != itinerary_min or trip.get("matrix_min") != matrix_min:
        errs.append(f"durées publiées {trip.get('min')}/{trip.get('matrix_min')} != 07h {itinerary_min}/{matrix_min}")
    tl = transit_legs(trip)
    if max(len(tl) - 1, 0) != n_transfers or len(rows) != n_transfers:
        errs.append(f"{len(tl)} tronçons TC publiés, {n_transfers} correspondances pour 07h, {len(rows)} lignes")
        return errs
    for r in sorted(rows, key=lambda r: r.k):
        if not 0 <= r.k < len(tl) - 1:
            errs.append(f"correspondance k={r.k} hors du trajet")
            continue
        a, b = tl[r.k], tl[r.k + 1]
        if a.get("arr") != r.arr or b.get("dep") != r.dep:
            errs.append(f"k={r.k} : heures {a.get('arr')}-{b.get('dep')} publiées, {r.arr}-{r.dep} pour 07h")
        if a.get("to") != typo(r.from_name) or b.get("from") != typo(r.to_name):
            errs.append(f"k={r.k} : quais {a.get('to')} / {b.get('from')} publiés, {r.from_name} / {r.to_name} pour 07h")
    return errs


def file_meta(rule: str, checked_at: str, service_date: str, walk_setting: str) -> dict[str, Any]:
    """Bloc `transfer_check_meta` de chaque fichier (et `meta.transfer_check`) : règle, date du contrôle 07h,
    codes des sources (sources.json)."""
    if rule not in RULES:
        raise ValueError(f"règle inconnue {rule}")
    sources = [SOURCE_CODES[SOURCE_GTFS]] + ([SOURCE_CODES[SOURCE_NAVITIA]] if rule == "reference" else [])
    return {"rule": rule, "checked_at": checked_at, "service_date": service_date, "walk_setting": walk_setting,
            "sources": sources}


def annotate(doc: Mapping[str, Any], marks: Mapping[tuple[str, str, str], dict[str, Any]],
             meta_block: Mapping[str, Any]) -> dict[str, Any]:
    """Copie de `itineraries/{insee}.json` avec `transfer_check` sur chaque trajet `ok` (clé (pôle, journée, sens)),
    `transfer_check_meta` et le contrat `itineraries-2`. Un trajet `ok` sans marque lève une erreur ; les autres
    trajets (aucun itinéraire) restent tels quels. Idempotent : une marque déjà présente est remplacée."""
    days: dict[str, Any] = {}
    for d, dirs in doc["days"].items():
        days[d] = {}
        for direction, row in dirs.items():
            new_row = []
            for pid, t in zip(doc["poles"], row, strict=True):
                t2 = {k: v for k, v in t.items() if k != "transfer_check"}
                if t.get("status") == "ok":
                    m = marks.get((pid, d, direction))
                    if m is None:
                        raise KeyError(f"{doc['insee']} {pid} {d} {direction} : trajet publié sans contrôle 07h")
                    t2["transfer_check"] = m
                new_row.append(t2)
            days[d][direction] = new_row
    # ordre des clés de 06h, le bloc D-031 juste avant `days`
    out: dict[str, Any] = {}
    for k, v in doc.items():
        if k == "transfer_check_meta":
            continue
        if k == "days":
            out["transfer_check_meta"] = dict(meta_block)
            out["days"] = days
        else:
            out[k] = CONTRACT_VERSION if k == "contract" else v
    return out


def side_at_risk(mark: Mapping[str, Any] | None, budget: int) -> bool:
    """Un sens met-il le verdict à risque au budget ? Oui s'il a une correspondance trop courte et que sa borne
    dépasse le budget ou n'existe pas."""
    if not mark or mark.get("status") != tx.TRIP_SHORT:
        return False
    b = mark.get("bound_min")
    return b is None or b > budget


def verdict_at_risk(out_min: int | None, ret_min: int | None, out_mark: Mapping[str, Any] | None,
                    ret_mark: Mapping[str, Any] | None, budget: int) -> bool:
    """Verdict publié allumé (durées de la matrice) dont un sens est à risque (règle de 07h `verdicts`)."""
    if not tx.verdict(out_min, ret_min, budget):
        return False
    return side_at_risk(out_mark, budget) or side_at_risk(ret_mark, budget)


def mark_errors(mark: Any) -> list[str]:
    """Contrat d'un champ `transfer_check` (07 et 06t) : statut connu, liste `short` non vide si et seulement si
    `short`, chaque correspondance avec un minimum entier sourcé et un temps disponible plus court, borne entière ou
    `null` avec raison."""
    if not isinstance(mark, dict):
        return ["transfer_check absent"]
    errs: list[str] = []
    st = mark.get("status")
    if st not in TRIP_STATUSES:
        errs.append(f"statut {st}")
    short = mark.get("short")
    if (st == tx.TRIP_SHORT) != bool(short):
        errs.append(f"statut {st} et {len(short or [])} correspondance(s) trop courte(s)")
    for s in short or []:
        if s.get("source") not in SOURCE_CODES:
            errs.append(f"source {s.get('source')}")
        m, a = s.get("min_s"), s.get("available_s")
        if not isinstance(m, int) or m <= 0 or not isinstance(a, int) or a >= m:
            errs.append(f"minimum {m} / disponible {a}")
        if not s.get("at") or not s.get("to"):
            errs.append("quai sans nom")
    u = mark.get("unverified")
    if u is not None and (not isinstance(u, int) or u <= 0):
        errs.append(f"unverified {u}")
    if st == tx.TRIP_UNVERIFIED and not u:
        errs.append("partly_unverified sans correspondance sans minimum")
    if st == tx.TRIP_VERIFIED and u:
        errs.append("verified avec des correspondances sans minimum")
    if st == tx.TRIP_SHORT:
        if "bound_min" not in mark:
            errs.append("borne absente")
        elif mark["bound_min"] is None:
            if mark.get("bound_reason") not in BOUND_REASONS:
                errs.append(f"borne nulle sans raison ({mark.get('bound_reason')})")
        elif not isinstance(mark["bound_min"], int) or mark["bound_min"] < 0 or "bound_reason" in mark:
            errs.append(f"borne {mark['bound_min']}")
    elif "bound_min" in mark or "bound_reason" in mark:
        errs.append(f"borne publiée pour un trajet {st}")
    return errs


def iter_marked_trips(doc: Mapping[str, Any]) -> Iterable[tuple[str, str, str, Mapping[str, Any]]]:
    """(pôle, journée, sens, trajet) pour chaque trajet `ok` d'un fichier."""
    for d, dirs in doc["days"].items():
        for direction, row in dirs.items():
            for pid, t in zip(doc["poles"], row, strict=True):
                if t.get("status") == "ok":
                    yield pid, d, direction, t


def strip_marks(doc: Mapping[str, Any]) -> dict[str, Any]:
    """Fichier sans le marquage D-031 (contrat `itineraries-1` de 06h) : mesure du poids ajouté, retour arrière."""
    days = {d: {direction: [{k: v for k, v in t.items() if k != "transfer_check"} for t in row]
                for direction, row in dirs.items()} for d, dirs in doc["days"].items()}
    return {k: (BASE_CONTRACT if k == "contract" else days if k == "days" else v)
            for k, v in doc.items() if k != "transfer_check_meta"}


def published_meta(docs: Iterable[Mapping[str, Any]]) -> dict[str, Any] | None:
    """`meta.transfer_check` (lu par le front sans charger d'itinéraire) : le bloc commun à tous les fichiers
    publiés, s'ils sont tous marqués avec le même ; None sinon (aucun marquage annoncé)."""
    blocks = [d.get("transfer_check_meta") for d in docs]
    if not blocks or any(b is None or b != blocks[0] for b in blocks):
        return None
    return {**blocks[0], "contract": CONTRACT_VERSION}


Key = tuple[str, str, str, str]  # (insee, pôle, journée, sens)


def _opt_int(v: Any) -> int | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return int(v)


def _opt_str(v: Any) -> str | None:
    return v if isinstance(v, str) and v else None


def load_check_outputs(trips_csv: Path, transfers_csv: Path, short_csv: Path, rule: str
                       ) -> tuple[dict[Key, dict[str, Any]], dict[Key, list[TransferRow]]]:
    """Sorties de 07h (`trips_all`, `transfers_all`, `transfer_check_walk3000_short`) : par trajet, durées, nombre
    de correspondances, statut, borne et méthode de la borne de la règle ; et ses correspondances."""
    trips = pd.read_csv(trips_csv, dtype={"insee": str})
    short = pd.read_csv(short_csv, dtype={"insee": str},
                        usecols=["insee", "pole", "day", "dir", f"retimed_{rule}_min", f"retimed_{rule}_method"])
    method = {(r.insee, r.pole, r.day, r.dir): _opt_str(getattr(r, f"retimed_{rule}_method"))
              for r in short.itertuples(index=False)}
    by_trip: dict[Key, dict[str, Any]] = {}
    for r in trips.itertuples(index=False):
        k = (r.insee, r.pole, r.day, r.dir)
        by_trip[k] = {"matrix_min": int(r.matrix_min), "itinerary_min": int(r.itinerary_min),
                      "n_transfers": int(r.n_transfers), "status": getattr(r, f"status_{rule}"),
                      "bound_min": _opt_int(getattr(r, f"retimed_{rule}_min")), "bound_method": method.get(k)}
    tr = pd.read_csv(transfers_csv, dtype={"insee": str, "arr": str, "dep": str})
    rows: dict[Key, list[TransferRow]] = defaultdict(list)
    for r in tr.itertuples(index=False):
        rows[(r.insee, r.pole, r.day, r.dir)].append(TransferRow(
            int(r.k), _opt_str(r.from_name), _opt_str(r.to_name), r.arr, r.dep, int(r.available_s),
            _opt_int(r.official_min_s), _opt_int(r.navitia_min_s), r.status, r.reference_status,
            _opt_str(r.from_stop), _opt_str(r.to_stop)))
    return by_trip, rows


def source_errors(rows: Iterable[TransferRow], rule: str, gtfs_min: Mapping[tuple[str, str], int],
                  navitia_min: Mapping[tuple[str, str], int]) -> list[str]:
    """Chaque minimum publié vient de sa source : `transfers.txt` (couple exact de quais) ou, pour un couple sans
    ligne, la durée Navitia relevée par 07i (`navitia_connections.csv`)."""
    errs: list[str] = []
    for r in rows:
        if row_status(r, rule) != tx.SHORT:
            continue
        m = row_minimum(r, rule)
        pair = (r.from_stop or "", r.to_stop or "")
        if m is None:
            errs.append(f"k={r.k} : trop courte sans minimum")
        elif m[1] == SOURCE_GTFS and gtfs_min.get(pair) != m[0]:
            errs.append(f"k={r.k} : minimum {m[0]} s absent de transfers.txt pour {pair}")
        elif m[1] == SOURCE_NAVITIA and (pair in gtfs_min or navitia_min.get(pair) != m[0]):
            errs.append(f"k={r.k} : durée Navitia {m[0]} s absente de navitia_connections.csv pour {pair}")
    return errs


def load_minimum_sources(gtfs_zip: Path, navitia_csv: Path
                         ) -> tuple[dict[tuple[str, str], int], dict[tuple[str, str], int]]:
    """Minimums d'origine : `transfers.txt` du GTFS IDFM (plus petit par couple de quais, comme 07h) et durées
    Navitia relevées par 07i (`origin`, `destination`, `duration_s`). Fichier Navitia absent : dictionnaire vide."""
    with zipfile.ZipFile(gtfs_zip) as z:
        t = pd.read_csv(z.open("transfers.txt"), dtype=str, usecols=["from_stop_id", "to_stop_id", "min_transfer_time"])
    gmin: dict[tuple[str, str], int] = {}
    for a, b, m in zip(t["from_stop_id"], t["to_stop_id"], t["min_transfer_time"].astype(int), strict=True):
        gmin[(a, b)] = min(int(m), gmin.get((a, b), int(m)))
    nmin: dict[tuple[str, str], int] = {}
    if navitia_csv.exists():
        nc = pd.read_csv(navitia_csv, dtype=str).dropna(subset=["duration_s"])
        nmin = {(a, b): int(d) for a, b, d in zip(nc["origin"], nc["destination"], nc["duration_s"], strict=True)}
    return gmin, nmin
