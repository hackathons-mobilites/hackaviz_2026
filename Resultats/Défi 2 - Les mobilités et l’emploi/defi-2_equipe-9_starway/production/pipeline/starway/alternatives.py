"""Trajets alternatifs TC + marche (D-055, phase F) : logique pure, sans Java ni réseau.

Parmi les options d'un trajet : A le plus rapide (règle de 04h, la minute de la matrice), B le moins cher (règle des tickets D-028,
prix connu seulement), C le moins de montées. Deux options sont distinctes si leurs suites de lignes diffèrent.

Largeur de recherche de 15 min (`SUBOPTIMAL_MIN`) : réglage de l'équipe, à afficher comme tel (exception D-011), décision de Nicolas
du 09/11/2026. Un trajet non calculé n'est jamais présenté comme « pas d'alternative » : `coverage_state`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

from starway import itineraries as it

SUBOPTIMAL_MIN = 15  # réglage de l'équipe (D-055), mesuré au banc du 09/11, pas une donnée
EARLIER_DEPARTURE_STEPS = range(1, 7)  # départs de 5 à 30 min avant le départ publié, grille de 5 min
EARLIER_STEP_S = 5 * 60

CALCULATED_WITH = "calcule_avec_alternatives"
CALCULATED_WITHOUT = "calcule_sans_alternative"
NOT_YET = "pas_encore_calcule"
COVERAGE_STATES = (CALCULATED_WITH, CALCULATED_WITHOUT, NOT_YET)

PALIERS_BOTH_DIRECTIONS = (1, 3)  # aller et retour, sans départ plus tôt
PALIERS_EARLIER = (2, 4)  # allers seulement, avec les départs plus tôt


def lines_key(opt: Mapping[str, Any]) -> tuple[str, ...]:
    return tuple(str(g.get("route_id")) for g in opt["legs"] if g["kind"] == "transit")


def is_degenerate(opt: Mapping[str, Any]) -> bool:
    """R5 peut rendre un tronçon qui monte et descend au même arrêt : jamais montré (comme `degenerate_legs` à l'export)."""
    return any(g["kind"] == "transit" and g.get("from_stop") == g.get("to_stop") for g in opt["legs"])


def minutes(opt: Mapping[str, Any]) -> int:
    return it.trip_minutes(opt["arr_s"], opt["dep_s"])


def on_time(opt: Mapping[str, Any], direction: str, start_s: int, departure_s: int) -> bool:
    """Aller : la minute d'arrivée n'est pas après le début du poste (règle de la matrice : minutes entières, secondes tronquées).
    Retour : le départ n'est pas avant la fin du poste."""
    if direction == "out":
        return int(opt["arr_s"]) < start_s + 60
    return int(opt["legs"][0]["dep_s"]) >= departure_s


def distinct_by_lines(pool: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Une option par suite de lignes : la plus courte (à égalité, la première arrivée)."""
    best: dict[tuple[str, ...], Mapping[str, Any]] = {}
    for o in sorted(pool, key=lambda x: (minutes(x), x["arr_s"])):
        best.setdefault(lines_key(o), o)
    return list(best.values())


def select_abc(options: Sequence[Mapping[str, Any]], kept: Sequence[Mapping[str, Any]], departure_s: int, target_min: int,
               rate: Callable[[Mapping[str, Any]], dict[str, Any]]) -> dict[str, Any]:
    """A parmi toutes les options (règle de 04h), B et C parmi les options qui tiennent les horaires et la limite de durée.

    `rate(option)` rend au moins `min`, `rides`, `cost_eur` (None si inconnu). B n'existe que s'il a un prix connu."""
    if not options:
        return {"n_options": 0, "n_distinct": 0, "A": None, "B": None, "C": None}
    a, delta = it.select_option(options, departure_s, target_min)
    assert a is not None
    distinct = distinct_by_lines(kept)
    rated = [(o, rate(o)) for o in distinct]
    priced = [x for x in rated if x[1].get("cost_eur") is not None]
    b = min(priced, key=lambda x: (x[1]["cost_eur"], x[1]["min"])) if priced else None
    c = min(rated, key=lambda x: (x[1]["rides"], x[1]["min"])) if rated else None
    return {"n_options": len(options), "n_distinct": len(distinct), "delta_min": delta,
            "A": {"option": a, **rate(a)},
            "B": None if b is None else {"option": b[0], **b[1]},
            "C": None if c is None else {"option": c[0], **c[1]}}


def coverage_state(record: Mapping[str, Any] | None) -> str:
    """État d'une case (commune, astre, journée, sens). Absent = pas encore calculé, jamais « pas d'alternative »."""
    if record is None:
        return NOT_YET
    a = record.get("A")
    if a is None:
        return CALCULATED_WITHOUT
    ka = lines_key(a["option"])
    for name in ("B", "C"):
        alt = record.get(name)
        if alt is not None and lines_key(alt["option"]) != ka:
            return CALCULATED_WITH
    return CALCULATED_WITHOUT


def priority_rows(first: Sequence[str], others_ranked: Sequence[str]) -> list[tuple[int, str]]:
    """File des calculs, dans l'ordre : (1) `first` sans départ plus tôt ; (2) `first` avec ; (3) les autres sans ; (4) les autres avec."""
    seen: set[str] = set()
    head = [c for c in first if not (c in seen or seen.add(c))]
    tail = [c for c in others_ranked if c not in seen]
    return [(1, c) for c in head] + [(2, c) for c in head] + [(3, c) for c in tail] + [(4, c) for c in tail]
