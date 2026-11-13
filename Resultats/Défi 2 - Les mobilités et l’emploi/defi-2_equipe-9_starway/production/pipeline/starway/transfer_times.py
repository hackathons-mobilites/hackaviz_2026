"""Temps de correspondance officiels (GTFS IDFM `transfers.txt`) et itinéraires TC détaillés (D-028).

Constat (code de R5 v7.5.1-r5py et de r5py 1.1.7, lu le 04/11/2026) : r5py construit le réseau avec
`GtfsTransferLoader(..., TransferConfig.OSM_ONLY)` : les lignes de `transfers.txt` ne sont pas chargées et une
correspondance ne coûte que la marche OSM entre les deux quais, plus les 60 s que R5 impose avant toute montée
(`FastRaptorWorker.MINIMUM_BOARD_WAIT_SEC`, `McRaptorSuboptimalPathProfileRouter.BOARD_SLACK`). Ce module contrôle,
sans Java, chaque correspondance des itinéraires calculés par 04h contre le `min_transfer_time` officiel du couple de
quais, et recale un itinéraire sur les mêmes lignes en respectant ces minimums (borne, pas un nouveau calcul).

Logique pure, testée dans tests/test_transfer_times.py. Le script est scripts/07h_transfer_times_check.py.

Règles (aucun minimum inventé) :
- le minimum d'une correspondance est la ligne `transfers.txt` du couple exact (quai de descente, quai de montée) ;
  les lignes IDFM relient toutes deux quais (`location_type` 0), aucune ne relie un quai à lui-même, aucune ne porte
  sur une station (vérifié le 04/11 : 191 484 lignes, toutes `transfer_type` 2) ;
- sans ligne pour le couple : statut `same_stop` (même quai) ou `no_line` (quais différents), sans minimum ; on dit
  seulement si d'autres couples de quais des mêmes arrêts parents ont une ligne (contexte, jamais utilisé comme
  minimum) ;
- temps disponible = départ du tronçon suivant - arrivée du tronçon précédent (horaires GTFS du jour, en secondes) ;
  il est « plus court que le minimum » s'il est strictement inférieur à `min_transfer_time` (spécification GTFS :
  « temps minimum qui doit être disponible »).
"""

from __future__ import annotations

import bisect
import itertools
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

FEED_PREFIX = "IDFM-gtfs:"  # identifiant de flux que R5 ajoute devant les identifiants GTFS (lots de 04h)
R5_BOARD_SLACK_S = 60  # R5 : la montée doit partir strictement plus de 60 s après l'arrivée au quai
GRID_S = 300  # grille de l'aller : départs toutes les 5 min avant le début du poste (config OUTBOUND_STEP_MIN)

OK = "ok"
SHORT = "short"
SAME_STOP = "same_stop"
NO_LINE = "no_line"

TRIP_NO_TRANSFER = "no_transfer"  # 0 ou 1 tronçon en TC
TRIP_SHORT = "short"  # au moins une correspondance plus courte que le minimum officiel
TRIP_VERIFIED = "verified"  # toutes les correspondances ont une ligne et la respectent
TRIP_UNVERIFIED = "partly_unverified"  # aucune trop courte, mais au moins une sans ligne officielle


def strip_feed(stop_id: str | None) -> str | None:
    if stop_id is None:
        return None
    return stop_id.removeprefix(FEED_PREFIX)


@dataclass(frozen=True)
class OfficialTransfers:
    """`transfers.txt` en dictionnaires : minimum par couple de quais, arrêt parent de chaque quai, et couples
    d'arrêts parents qui ont au moins une ligne (nombre, minimum et maximum : contexte seulement)."""

    min_s: Mapping[tuple[str, str], int]
    parent: Mapping[str, str]
    parent_pairs: Mapping[tuple[str, str], tuple[int, int, int]]
    # durées de correspondance du calculateur officiel (Navitia, API « connections », 07i) pour les couples SANS ligne
    # transfers.txt (même arrêt surtout) ; vide si 07i n'a pas tourné. Jamais mélangées au minimum du GTFS.
    navitia_s: Mapping[tuple[str, str], int] = field(default_factory=dict)

    def with_navitia(self, connections: Iterable[tuple[str, str, int]]) -> OfficialTransfers:
        nav = {(a, b): int(d) for a, b, d in connections if (a, b) not in self.min_s}
        return OfficialTransfers(self.min_s, self.parent, self.parent_pairs, nav)

    @classmethod
    def from_rows(cls, transfers: Iterable[tuple[str, str, int]], parents: Mapping[str, str]) -> OfficialTransfers:
        min_s: dict[tuple[str, str], int] = {}
        pp: dict[tuple[str, str], list[int]] = {}
        for a, b, m in transfers:
            m = int(m)
            min_s[(a, b)] = min(m, min_s.get((a, b), m))
            key = (parents.get(a, a), parents.get(b, b))
            pp.setdefault(key, []).append(m)
        return cls(min_s, dict(parents), {k: (len(v), min(v), max(v)) for k, v in pp.items()})

    def lookup(self, from_stop: str, to_stop: str) -> tuple[int | None, str]:
        """(minimum officiel en s ou None, statut si aucune ligne)."""
        m = self.min_s.get((from_stop, to_stop))
        if m is not None:
            return m, OK
        return None, SAME_STOP if from_stop == to_stop else NO_LINE

    def parent_context(self, from_stop: str, to_stop: str) -> tuple[int, int, int] | None:
        return self.parent_pairs.get((self.parent.get(from_stop, from_stop), self.parent.get(to_stop, to_stop)))


@dataclass(frozen=True)
class TransferCheck:
    from_stop: str
    to_stop: str
    arr_s: int  # arrivée du tronçon précédent
    dep_s: int  # départ du tronçon suivant
    walk_s: int  # marche de correspondance (R5), 0 si même quai
    official_min_s: int | None
    status: str  # ok | short | same_stop | no_line
    same_parent: bool
    parent_pairs: tuple[int, int, int] | None  # lignes entre les mêmes arrêts parents (n, min, max), si aucune ligne
    navitia_min_s: int | None = None  # durée Navitia du couple, seulement s'il n'a pas de ligne transfers.txt

    @property
    def reference_min_s(self) -> int | None:
        """Minimum de référence : la ligne transfers.txt, sinon la durée Navitia (calculateur officiel), sinon None."""
        return self.official_min_s if self.official_min_s is not None else self.navitia_min_s

    @property
    def reference_status(self) -> str:
        """ok | short contre le minimum de référence ; sinon le statut sans ligne (same_stop, no_line)."""
        ref = self.reference_min_s
        if ref is None:
            return self.status
        return SHORT if self.available_s < ref else OK

    @property
    def available_s(self) -> int:
        return self.dep_s - self.arr_s

    @property
    def missing_s(self) -> int | None:
        """Secondes manquantes pour atteindre le minimum officiel (None sans ligne, 0 si respecté)."""
        if self.official_min_s is None:
            return None
        return max(self.official_min_s - self.available_s, 0)


def transit_legs(option: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [lg for lg in option["legs"] if lg["kind"] == "transit"]


def check_option(option: Mapping[str, Any], official: OfficialTransfers) -> list[TransferCheck]:
    """Une ligne par correspondance entre deux tronçons en TC consécutifs de l'itinéraire."""
    legs = list(option["legs"])
    out: list[TransferCheck] = []
    idx = [i for i, lg in enumerate(legs) if lg["kind"] == "transit"]
    for i, j in itertools.pairwise(idx):
        a, b = legs[i], legs[j]
        fa, fb = strip_feed(a["to_stop"]), strip_feed(b["from_stop"])
        assert fa is not None and fb is not None
        walk = sum(int(x["arr_s"]) - int(x["dep_s"]) for x in legs[i + 1:j] if x["kind"] == "walk")
        m, st = official.lookup(fa, fb)
        avail = int(b["dep_s"]) - int(a["arr_s"])
        if m is not None:
            st = SHORT if avail < m else OK
        same_parent = official.parent.get(fa, fa) == official.parent.get(fb, fb)
        ctx = official.parent_context(fa, fb) if m is None else None
        nav = official.navitia_s.get((fa, fb)) if m is None else None
        out.append(TransferCheck(fa, fb, int(a["arr_s"]), int(b["dep_s"]), walk, m, st, same_parent, ctx, nav))
    return out


def trip_status(checks: Sequence[TransferCheck], reference: bool = False) -> str:
    """Statut d'un itinéraire : contre le seul GTFS (défaut) ou contre le minimum de référence (GTFS, puis Navitia)."""
    sts = [c.reference_status if reference else c.status for c in checks]
    if not sts:
        return TRIP_NO_TRANSFER
    if SHORT in sts:
        return TRIP_SHORT
    if all(x == OK for x in sts):
        return TRIP_VERIFIED
    return TRIP_UNVERIFIED


# --------------------------------------------------------------------------- recalage sur les mêmes lignes

@dataclass(frozen=True)
class Run:
    dep_s: int  # départ du quai de montée
    arr_s: int  # arrivée au quai de descente
    trip_id: str


class Timetable:
    """Courses du jour par (ligne, quai de montée, quai de descente), triées par départ : de quoi reprendre un
    itinéraire sur les mêmes lignes avec d'autres courses."""

    def __init__(self, runs: Mapping[tuple[str, str, str], Sequence[Run]]) -> None:
        self.runs = {k: sorted(v, key=lambda r: (r.dep_s, r.arr_s)) for k, v in runs.items()}
        self._deps = {k: [r.dep_s for r in v] for k, v in self.runs.items()}

    def first_after(self, key: tuple[str, str, str], earliest_dep_s: int) -> Run | None:
        """Course qui arrive le plus tôt parmi celles qui partent à `earliest_dep_s` ou après."""
        v = self.runs.get(key)
        if not v:
            return None
        i = bisect.bisect_left(self._deps[key], earliest_dep_s)
        cands = v[i:]
        return min(cands, key=lambda r: (r.arr_s, r.dep_s)) if cands else None

    def last_before(self, key: tuple[str, str, str], latest_arr_s: int) -> Run | None:
        """Course qui part le plus tard parmi celles qui arrivent à `latest_arr_s` ou avant."""
        v = self.runs.get(key)
        if not v:
            return None
        cands = [r for r in v if r.arr_s <= latest_arr_s]
        return max(cands, key=lambda r: (r.dep_s, -r.arr_s)) if cands else None


def leg_key(leg: Mapping[str, Any]) -> tuple[str, str, str]:
    a, b = strip_feed(leg["from_stop"]), strip_feed(leg["to_stop"])
    assert a is not None and b is not None
    return (str(leg["route_id"]), a, b)


def required_gaps(option: Mapping[str, Any], official: OfficialTransfers, reference: bool = False) -> list[int]:
    """Écart minimal exigé entre arrivée et départ, par correspondance : le minimum officiel s'il existe (avec
    `reference`, la durée Navitia à défaut) ; sinon la règle du moteur (marche + plus de 60 s, soit marche + 61 s)."""
    out = []
    for c in check_option(option, official):
        m = c.reference_min_s if reference else c.official_min_s
        out.append(m if m is not None else c.walk_s + R5_BOARD_SLACK_S + 1)
    return out


def _walk_around(option: Mapping[str, Any]) -> tuple[int, int]:
    """(marche avant le premier tronçon en TC, marche après le dernier), en secondes."""
    legs = list(option["legs"])
    idx = [i for i, lg in enumerate(legs) if lg["kind"] == "transit"]
    acc = sum(int(x["arr_s"]) - int(x["dep_s"]) for x in legs[:idx[0]] if x["kind"] == "walk")
    egr = sum(int(x["arr_s"]) - int(x["dep_s"]) for x in legs[idx[-1] + 1:] if x["kind"] == "walk")
    return acc, egr


def forward(option: Mapping[str, Any], gaps: Sequence[int], tt: Timetable, first_dep_s: int | None = None
            ) -> int | None:
    """Arrivée à destination (s) en reprenant les mêmes lignes, chaque correspondance respectant `gaps`.
    `first_dep_s` : départ au plus tôt du premier tronçon (None : la course d'origine est gardée)."""
    tl = transit_legs(option)
    _, egr = _walk_around(option)
    if first_dep_s is None:
        arr = int(tl[0]["arr_s"])
    else:
        r = tt.first_after(leg_key(tl[0]), first_dep_s)
        if r is None:
            return None
        arr = r.arr_s
    for leg, gap in zip(tl[1:], gaps, strict=True):
        r = tt.first_after(leg_key(leg), arr + gap)
        if r is None:
            return None
        arr = r.arr_s
    return arr + egr


def backward_departure(option: Mapping[str, Any], gaps: Sequence[int], tt: Timetable, arrive_by_s: int
                       ) -> int | None:
    """Départ le plus tardif du point d'origine (s) pour arriver à `arrive_by_s` par les mêmes lignes, chaque
    correspondance respectant `gaps` et la première montée la règle du moteur (plus de 60 s après l'arrivée au quai)."""
    tl = transit_legs(option)
    acc, egr = _walk_around(option)
    latest_arr = arrive_by_s - egr
    dep = None
    for k in range(len(tl) - 1, -1, -1):
        r = tt.last_before(leg_key(tl[k]), latest_arr)
        if r is None:
            return None
        dep = r.dep_s
        if k > 0:
            latest_arr = dep - gaps[k - 1]
    assert dep is not None
    return dep - R5_BOARD_SLACK_S - 1 - acc


@dataclass(frozen=True)
class Retimed:
    minutes: int | None  # borne haute de la durée qui respecte les minimums, sur les mêmes lignes (None : introuvable)
    method: str  # forward | backward | over_max (borne > max_min) | no_run (aucune course) | over_lookback (aller)


def retime(rec: Mapping[str, Any], official: OfficialTransfers, tt: Timetable, day_start_s: int,
           lookback_s: int, max_min: int, reference: bool = False) -> Retimed:
    """Durée du même itinéraire (mêmes lignes, mêmes quais) quand chaque correspondance respecte le minimum officiel.

    Retour : départ à la fin du poste (`dep_s`), courses suivantes au besoin ; durée = arrivée - fin du poste.
    Aller : même départ de la grille si l'arrivée reste avant le début du poste (borne exacte de la règle du ciel) ;
    sinon départ le plus tardif par les mêmes lignes, ramené à la grille de 5 min (t'), et borne
    max(arrivée depuis t' - t', début - t' - 5 min) : le départ de la grille qui respecte les minimums est t' ou plus
    tard, et arrive avant le début du poste. Minutes tronquées (règle de R5). Ce n'est pas un nouveau calcul : un
    autre itinéraire peut être plus rapide."""
    opt = rec["option"]
    gaps = required_gaps(opt, official, reference)
    dep = int(rec["dep_s"])
    if rec["dir"] == "ret":
        arr = forward(opt, gaps, tt)
        if arr is None:
            return Retimed(None, "no_run")
        m = (arr - dep) // 60
        return Retimed(m, "forward") if m <= max_min else Retimed(None, "over_max")
    arr = forward(opt, gaps, tt)
    if arr is not None and arr <= day_start_s:
        return Retimed((arr - dep) // 60, "forward")
    latest = backward_departure(opt, gaps, tt, day_start_s)
    if latest is None:
        return Retimed(None, "no_run")
    t1 = day_start_s - ((day_start_s - latest + GRID_S - 1) // GRID_S) * GRID_S  # multiple de 5 min <= latest
    if t1 < day_start_s - lookback_s:
        return Retimed(None, "over_lookback")
    acc, _ = _walk_around(opt)
    arr1 = forward(opt, gaps, tt, first_dep_s=t1 + acc + R5_BOARD_SLACK_S + 1)
    if arr1 is None or arr1 > day_start_s:
        return Retimed(None, "no_run")
    m = max(arr1 - t1, day_start_s - t1 - GRID_S) // 60
    return Retimed(m, "backward") if m <= max_min else Retimed(None, "over_max")


def verdict(out_min: int | None, ret_min: int | None, budget: int) -> bool:
    return out_min is not None and ret_min is not None and out_min <= budget and ret_min <= budget


def apply_gtfs_min_gap(min_transfer_s: int) -> int:
    """Valeur à charger dans `TransitLayer.gtfsTransfers` pour que R5 exige exactement le minimum officiel : R5 ajoute
    à l'heure d'arrivée au quai la valeur chargée, puis n'accepte qu'un départ strictement postérieur de plus de 60 s
    (`departure > bestTime + 60`) ; écart exigé = valeur + 61 s. Jamais négatif."""
    return max(int(min_transfer_s) - R5_BOARD_SLACK_S - 1, 0)

