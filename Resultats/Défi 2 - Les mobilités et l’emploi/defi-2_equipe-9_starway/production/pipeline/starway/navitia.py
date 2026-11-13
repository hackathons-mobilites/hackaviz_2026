"""Recoupement des temps de trajet TC de STARWAY avec Navitia (API PRIM d'IDFM) : logique pure, sans réseau.

Navitia est un CONTRÔLE, jamais une source : rien de ce qui est affiché ne vient d'ici, et aucune durée STARWAY n'est
corrigée à partir de Navitia. Le script `scripts/07d_navitia_crosscheck.py` fait les requêtes (cache local) ; ce module
construit l'échantillon, les paramètres de requête, lit les réponses et compare.

Définitions comparées (docs/methodologie.md § 5, « Recoupement avec Navitia ») :
- aller STARWAY : durée TT(t*) du départ t* le plus tardif de la grille de 5 min qui arrive avant le début S
  (attente initiale comprise) ;
- aller Navitia « aligné sur la grille » : t* = départ Navitia le plus tardif (arrivée <= S) ramené au multiple de
  5 min inférieur ; durée = arrivée la plus tôt parmi les trajets Navitia qui partent à t* ou après, moins t*.
  La durée « propre » de Navitia (arrivée - départ du dernier trajet, sans attente) est gardée à côté ;
- retour (même définition des deux côtés) : arrivée la plus tôt après un départ à la fin E, moins E (attente comprise).
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any

import numpy as np

from starway.gold import NO_COMMUNE_TRANSIT, CommuneParts, gold_delta

LEGS = ("out", "ret")
NAVITIA_DT_FORMAT = "%Y%m%dT%H%M%S"


# --------------------------------------------------------------------------- échantillon

@dataclass(frozen=True, order=True)
class Trip:
    """Un trajet TC : commune, pôle, journée-type, sens (`out` = aller vers le pôle, `ret` = retour vers la commune)."""

    insee: str
    pole_id: str
    day: str
    leg: str


@dataclass
class Sample:
    """Trajets uniques et groupes d'échantillon de chacun (tour, insight:<id>, random)."""

    groups: dict[Trip, list[str]] = field(default_factory=dict)
    strata: dict[Trip, str] = field(default_factory=dict)

    def add(self, trip: Trip, group: str, stratum: str | None = None) -> None:
        g = self.groups.setdefault(trip, [])
        if group not in g:
            g.append(group)
        if stratum is not None:
            self.strata[trip] = stratum

    def trips(self) -> list[Trip]:
        return sorted(self.groups)


def lit(out: int | None, ret: int | None, budget: int) -> bool:
    """Accessible = aller ET retour dans le budget (même règle que starway.insights.accessible_mask)."""
    return out is not None and ret is not None and out <= budget and ret <= budget


def failing_legs(out: int | None, ret: int | None, budget: int) -> list[str]:
    """Sens qui sortent du budget (ou sans trajet) ; vide si le pôle est allumé."""
    return [leg for leg, v in (("out", out), ("ret", ret)) if v is None or v > budget]


Series = Mapping[str, Sequence[Any]]  # {"out": [...], "ret": [...], "reason": [...], "dep": [...]}


def tour_trips(origins_days: Iterable[tuple[str, str]], pole_ids: Sequence[str]) -> list[Trip]:
    """Tous les trajets (15 pôles x 2 sens) des scénarios (commune, journée) joués par la visite."""
    return [Trip(o, p, d, leg) for o, d in origins_days for p in pole_ids for leg in LEGS]


def _pick_pole(candidates: Sequence[int], jobs: Sequence[int]) -> int | None:
    """Pôle qui pèse le plus dans l'écart (postes salariés les plus nombreux) ; égalité : ordre de poles.json."""
    if not candidates:
        return None
    return max(candidates, key=lambda i: (jobs[i], -i))


def insight_trips(insight: Mapping[str, Any], series_of, pole_ids: Sequence[str],
                  jobs: Sequence[int], commune_parts_of: CommuneParts | None = None) -> tuple[list[Trip], str | None]:
    """Trajets TC qui décident d'une découverte, pour le pôle qui pèse le plus dans son écart.

    `series_of(insee, mode, day)` rend la série publiée ou None. Rend (trajets, motif si aucun trajet).
    - eclipse : le pôle change d'état entre `compare_day` et `d` ; sens qui échouent du côté éteint, dans les deux
      journées ;
    - territorial_gap : idem entre `o` et `vs` (même journée) ;
    - bike_gain : astre en or selon `starway.gold` (D-056, `commune_parts_of` donne la part TC commune par commune ;
      sans elle, aucun trajet et le motif `no_commune_transit`) ; sens TC qui échouent (seul le côté TC est recoupé) ;
    - late_return : aller dans le budget, retour hors budget ou nul ; l'aller et le retour.
    """
    sc = insight["scenario"]
    o, d, b = sc["o"], sc["d"], int(sc["b"])
    kind = insight["kind"]
    n = len(pole_ids)

    def states(insee: str, mode: str, day: str) -> Series | None:
        return series_of(insee, mode, day)

    if kind == "late_return":
        s = states(o, "transit", d)
        if s is None:
            return [], "series_missing"
        cand = [i for i in range(n) if s["out"][i] is not None and s["out"][i] <= b
                and (s["ret"][i] is None or s["ret"][i] > b)]
        i = _pick_pole(cand, jobs)
        if i is None:
            return [], "no_switching_pole"
        return [Trip(o, pole_ids[i], d, "out"), Trip(o, pole_ids[i], d, "ret")], None

    if kind == "bike_gain":
        tc, bt = states(o, "transit", d), states(o, sc["m"], d)
        if tc is None or bt is None:
            return [], "series_missing"
        parts = commune_parts_of(o, d, b) if commune_parts_of is not None else None
        cand, _ = gold_delta(tc, bt, b, parts)
        if cand is None:
            return [], NO_COMMUNE_TRANSIT
        i = _pick_pole(cand, jobs)
        if i is None:
            return [], "no_switching_pole"
        return [Trip(o, pole_ids[i], d, leg) for leg in failing_legs(tc["out"][i], tc["ret"][i], b)], None

    if kind == "eclipse":
        a_key, r_key = (o, d), (o, sc["compare_day"])
    elif kind == "territorial_gap":
        a_key, r_key = (o, d), (sc["vs"], d)
    else:
        return [], f"unknown_kind:{kind}"
    a, r = states(a_key[0], "transit", a_key[1]), states(r_key[0], "transit", r_key[1])
    if a is None or r is None:
        return [], "series_missing"
    cand = [i for i in range(n) if lit(a["out"][i], a["ret"][i], b) != lit(r["out"][i], r["ret"][i], b)]
    i = _pick_pole(cand, jobs)
    if i is None:
        return [], "no_switching_pole"
    dark = a if not lit(a["out"][i], a["ret"][i], b) else r
    legs = failing_legs(dark["out"][i], dark["ret"][i], b)
    trips = []
    for key in (a_key, r_key):
        trips += [Trip(key[0], pole_ids[i], key[1], leg) for leg in legs]
    return trips, None


def duration_bins(budgets: Sequence[int], max_trip: int) -> list[tuple[str, int, int]]:
    """Tranches de durée dérivées des budgets publiés (meta.budgets) et de la durée maximale (meta.max_trip_min)."""
    edges = [0, *sorted(budgets), max_trip]
    bins = []
    for lo, hi in itertools.pairwise(edges):
        bins.append((f"{lo if lo == 0 else lo + 1}-{hi}", lo, hi))
    return bins


def bin_of(minutes: int, bins: Sequence[tuple[str, int, int]]) -> str | None:
    for label, lo, hi in bins:
        if (minutes >= lo if lo == 0 else minutes > lo) and minutes <= hi:
            return label
    return None


def stratified_sample(candidates: Sequence[tuple[Trip, str, int]], bins: Sequence[tuple[str, int, int]],
                      per_stratum: int, seed: int) -> tuple[list[tuple[Trip, str]], dict[str, int]]:
    """Tirage sans remise de `per_stratum` trajets par strate (département x tranche de durée), graine fixe.

    `candidates` : (trajet, département, durée STARWAY mesurée). Rend les trajets tirés avec leur strate, et
    l'effectif de chaque strate dans la population (pour les pondérations).
    """
    by: dict[str, list[Trip]] = {}
    for trip, dep, minutes in candidates:
        b = bin_of(minutes, bins)
        if b is None:
            continue
        by.setdefault(f"{dep}|{b}", []).append(trip)
    rng = np.random.default_rng(seed)
    picked: list[tuple[Trip, str]] = []
    sizes = {}
    for stratum in sorted(by):
        pop = sorted(by[stratum])
        sizes[stratum] = len(pop)
        k = min(per_stratum, len(pop))
        idx = rng.choice(len(pop), size=k, replace=False)
        picked += [(pop[j], stratum) for j in sorted(idx)]
    return picked, sizes


# --------------------------------------------------------------------------- requêtes

@dataclass(frozen=True)
class AlignedSettings:
    """Réglages Navitia alignés sur ceux de la matrice publiée (R5 v7.5.1 par r5py 1.1.7, starway.config)."""

    walking_speed_ms: float  # SPEED_WALKING_KMH / 3,6
    max_trip_s: int  # MAX_TRIP_MIN x 60
    egress_limit_s: int  # limite de marche finale de R5 (mètres) / vitesse de marche
    max_nb_transfers: int  # max_public_transport_rides de r5py (8) - 1
    access_limit_s: int = 0  # marche d'accès : max_time_walking de r5py (0 = max_trip_s, réglage R5 d'origine)

    @property
    def access_s(self) -> int:
        return self.access_limit_s or self.max_trip_s


def aligned_settings(speed_walking_kmh: float, max_trip_min: int, egress_limit_m: int,
                     max_rides: int, access_limit_min: int | None = None) -> AlignedSettings:
    """Réglages Navitia alignés sur un calcul R5.

    - réglage R5 d'origine (`access_limit_min` None) : accès borné par la durée maximale (r5py : max_time_walking =
      max_time), sortie par la constante de R5 (2 000 m) ;
    - réglages de marche D-024 : accès borné par `max_time_walking` = `access_limit_min` (17 ou 50 min), sortie par la
      distance du jar recompilé (1 000 ou 3 000 m). Dans R5, `max_time_walking` borne aussi le trajet tout à pied.
    """
    speed = speed_walking_kmh / 3.6
    return AlignedSettings(walking_speed_ms=round(speed, 6), max_trip_s=max_trip_min * 60,
                           egress_limit_s=math.ceil(egress_limit_m / speed), max_nb_transfers=max_rides - 1,
                           access_limit_s=(access_limit_min or 0) * 60)


def coord(lon: float, lat: float) -> str:
    return f"{lon};{lat}"


def request_params(origin: str, destination: str, when: datetime, represents: str, leg: str,
                   s: AlignedSettings) -> dict[str, str]:
    """Paramètres de /journeys. `origin`/`destination` au format Navitia « lon;lat ».

    Marche avant / après les TC (`max_walking_duration_to_pt`, même limite des deux côtés chez Navitia) :
    - aller (commune vers arrêt d'ancrage du pôle) : R5 ne borne l'accès qu'en temps (`max_time_walking` : 120 min
      avec le réglage d'origine, 50 min avec « normal » D-024) et la sortie se fait sur l'arrêt lui-même ;
    - retour (arrêt d'ancrage vers commune) : l'accès est l'arrêt lui-même, la sortie est bornée par la limite de
      marche finale de R5 (2 000 m d'origine, 3 000 m « normal »), d'où cette distance / vitesse de marche.
    Trajet tout à pied (`max_walking_direct_path_duration`) : même plafond que l'accès (`max_time_walking` de R5).
    """
    to_pt = s.access_s if leg == "out" else s.egress_limit_s
    return {
        "from": origin,
        "to": destination,
        "datetime": when.strftime(NAVITIA_DT_FORMAT),
        "datetime_represents": represents,
        "data_freshness": "base_schedule",
        "walking_speed": f"{s.walking_speed_ms:g}",
        "max_walking_duration_to_pt": str(to_pt),
        "max_walking_direct_path_duration": str(s.access_s),
        "max_nb_transfers": str(s.max_nb_transfers),
        "max_duration": str(s.max_trip_s),
        "min_nb_journeys": "3",
        "disable_geojson": "true",
    }


def cache_key(trip: Trip, params: Mapping[str, str]) -> str:
    h = hashlib.sha256(json.dumps(dict(params), sort_keys=True).encode("utf-8")).hexdigest()[:12]
    return f"{trip.insee}_{trip.pole_id}_{trip.day}_{trip.leg}_{h}"


# --------------------------------------------------------------------------- lecture des réponses

@dataclass(frozen=True)
class Journey:
    departure: datetime
    arrival: datetime
    duration_s: int
    nb_transfers: int
    walking_s: int
    waiting_s: int
    lines: tuple[str, ...]
    stops: tuple[str, ...]  # arrêts de montée et de descente, dans l'ordre
    type: str


def parse_dt(s: str) -> datetime:
    return datetime.strptime(s, NAVITIA_DT_FORMAT)


LONG_DASHES = {0x2013: "-", 0x2014: "-"}  # règle du projet : aucun tiret long, même dans les libellés repris


def clean_label(s: str) -> str:
    """Libellé Navitia (arrêt, ligne) avec les tirets longs remplacés par le tiret simple."""
    return s.translate(LONG_DASHES)


def _line_label(section: Mapping[str, Any]) -> str:
    di = section.get("display_informations") or {}
    mode = di.get("commercial_mode") or di.get("physical_mode") or section.get("type", "")
    code = di.get("code") or di.get("label") or ""
    return clean_label(f"{mode} {code}".strip())


def parse_journeys(body: Mapping[str, Any]) -> list[Journey]:
    out = []
    for j in body.get("journeys") or []:
        lines, stops, waiting = [], [], 0
        for sec in j.get("sections") or []:
            t = sec.get("type")
            if t in ("public_transport", "on_demand_transport"):
                lines.append(_line_label(sec))
                stops += [clean_label((sec.get(k) or {}).get("name", "")) for k in ("from", "to")]
            elif t == "waiting":
                waiting += int(sec.get("duration") or 0)
        durations = j.get("durations") or {}
        out.append(Journey(departure=parse_dt(j["departure_date_time"]), arrival=parse_dt(j["arrival_date_time"]),
                           duration_s=int(j.get("duration") or 0), nb_transfers=int(j.get("nb_transfers") or 0),
                           walking_s=int(durations.get("walking") or 0), waiting_s=waiting,
                           lines=tuple(lines), stops=tuple(stops), type=str(j.get("type", ""))))
    return out


def journey_sections(j: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Tronçons d'un trajet Navitia brut, pour décomposer une durée (marche, attente, véhicule, correspondance).

    Un dictionnaire par tronçon : `kind` (`walk`, `transfer`, `wait`, `ride`, `other`), `line` (mode et code, pour un
    véhicule), `from`, `to`, `dep`, `arr` (HH:MM:SS) et `s` (durée en secondes, telle que Navitia la donne). Aucune
    durée n'est recalculée ni corrigée.
    """
    kinds = {"street_network": "walk", "crow_fly": "walk", "transfer": "transfer", "waiting": "wait",
             "public_transport": "ride", "on_demand_transport": "ride"}
    out = []
    for sec in j.get("sections") or []:
        t = str(sec.get("type", ""))
        row: dict[str, Any] = {"kind": kinds.get(t, "other"), "type": t, "s": int(sec.get("duration") or 0)}
        if row["kind"] == "transfer":
            row["transfer_type"] = sec.get("transfer_type")
        if row["kind"] == "ride":
            row["line"] = _line_label(sec)
        row["from"] = clean_label((sec.get("from") or {}).get("name", ""))
        row["to"] = clean_label((sec.get("to") or {}).get("name", ""))
        for k, src in (("dep", "departure_date_time"), ("arr", "arrival_date_time")):
            v = sec.get(src)
            row[k] = parse_dt(v).strftime("%H:%M:%S") if v else None
        out.append(row)
    return out


def floor_to_grid(t: datetime, step_min: int) -> datetime:
    m = t.hour * 60 + t.minute
    m -= m % step_min
    return t.replace(hour=m // 60, minute=m % 60, second=0, microsecond=0)


@dataclass(frozen=True)
class NavitiaValue:
    minutes: float | None  # définition comparable à celle de STARWAY
    native_minutes: float | None  # durée propre de Navitia (arrivée - départ, sans attente initiale)
    grid_departure: datetime | None  # aller : t* ramené à la grille
    journey: Journey | None  # trajet qui donne `minutes`
    reason: str | None
    uncapped_minutes: float | None = None  # même définition, au-delà de la durée maximale (information seulement)


def outbound_value(journeys: Sequence[Journey], start: datetime, step_min: int, lookback_min: int,
                   max_trip_min: int) -> NavitiaValue:
    """Aller : même définition que STARWAY (départ le plus tardif de la grille qui arrive avant `start`)."""
    lo = start - timedelta(minutes=lookback_min)
    ok = [j for j in journeys if j.arrival <= start and j.departure >= lo]
    if not ok:
        return NavitiaValue(None, None, None, None, "navitia_no_journey_arriving_in_time")
    latest = max(j.departure for j in ok)
    native = min((j for j in ok if j.departure == latest), key=lambda j: j.arrival)
    t_star = floor_to_grid(latest, step_min)
    if t_star < lo:
        return NavitiaValue(None, None, None, None, "navitia_latest_departure_before_window")
    best = min((j for j in ok if j.departure >= t_star), key=lambda j: j.arrival)
    minutes = (best.arrival - t_star).total_seconds() / 60
    native_min = (native.arrival - native.departure).total_seconds() / 60
    if minutes > max_trip_min:
        return NavitiaValue(None, round(native_min, 2), t_star, best, "navitia_over_max_trip", round(minutes, 2))
    return NavitiaValue(round(minutes, 2), round(native_min, 2), t_star, best, None)


def inbound_value(journeys: Sequence[Journey], end: datetime, max_trip_min: int) -> NavitiaValue:
    """Retour : arrivée la plus tôt après un départ à `end`, moins `end` (attente comprise), comme STARWAY."""
    ok = [j for j in journeys if j.departure >= end]
    if not ok:
        return NavitiaValue(None, None, None, None, "navitia_no_journey")
    best = min(ok, key=lambda j: (j.arrival, -j.departure.timestamp()))
    minutes = (best.arrival - end).total_seconds() / 60
    native_min = (best.arrival - best.departure).total_seconds() / 60
    if minutes > max_trip_min:
        return NavitiaValue(None, round(native_min, 2), None, best, "navitia_over_max_trip", round(minutes, 2))
    return NavitiaValue(round(minutes, 2), round(native_min, 2), None, best, None)


def navitia_error(body: Mapping[str, Any] | None, status_code: int | None) -> str | None:
    """Identifiant d'erreur Navitia (`no_solution`, `date_out_of_bounds`...) ou code HTTP ; None si réponse exploitable."""
    if body is None:
        return f"http_{status_code}" if status_code else "no_response"
    err = body.get("error")
    if isinstance(err, Mapping):
        return f"navitia_{err.get('id', 'error')}"
    if status_code and status_code >= 400:
        return f"http_{status_code}"
    return None


# --------------------------------------------------------------------------- comparaison

def compare_status(starway: int | None, navitia: float | None) -> str:
    if starway is not None and navitia is not None:
        return "both"
    if starway is not None:
        return "starway_only"
    if navitia is not None:
        return "navitia_only"
    return "neither"


def diff(starway: int | None, navitia: float | None) -> float | None:
    """Écart STARWAY - Navitia en minutes (positif : STARWAY plus long)."""
    if starway is None or navitia is None:
        return None
    return round(starway - navitia, 2)


def over_budget(minutes: float | None, budget: int) -> bool:
    """Un sens sort du budget s'il n'a pas de trajet (dans la durée maximale) ou s'il dépasse le budget."""
    return minutes is None or minutes > budget


def same_verdict(starway: int | None, navitia: float | None, budget: int) -> bool:
    """STARWAY et Navitia classent-ils ce sens du même côté du budget ?"""
    return over_budget(starway, budget) == over_budget(navitia, budget)


@dataclass(frozen=True)
class LegCheck:
    """Un sens recoupé : scénario (commune, journée), sens, durée STARWAY, durée Navitia (None = aucun trajet)."""

    scenario: tuple[str, str]
    leg: str
    starway: int | None
    navitia: float | None


def _rounded(v: float | None, how: str) -> float | None:
    if v is None:
        return None
    return float(math.floor(v) if how == "floor" else math.ceil(v))


def _insight_holds(kind: str, budget: int, checks: Sequence[LegCheck], how: str) -> bool:
    nav = [_rounded(c.navitia, how) for c in checks]
    if kind == "late_return":  # aller dans le budget, retour hors budget, sens par sens
        return all(over_budget(n, budget) == (c.leg == "ret") for c, n in zip(checks, nav, strict=True))
    ok = True
    for sc in {c.scenario for c in checks}:
        idx = [i for i, c in enumerate(checks) if c.scenario == sc]
        dark = any(over_budget(checks[i].starway, budget) for i in idx)
        if dark:  # côté éteint : au moins un des sens décisifs reste hors budget
            ok &= any(over_budget(nav[i], budget) for i in idx)
        else:  # côté allumé : les mêmes sens restent dans le budget (les autres sens ne sont pas recoupés)
            ok &= all(not over_budget(nav[i], budget) for i in idx)
    return ok


def insight_verdict(kind: str, budget: int, checks: Sequence[LegCheck]) -> str:
    """`confirmed`, `contradicted`, ou `within_one_minute` si le verdict dépend de l'arrondi à la minute des durées
    Navitia (STARWAY publie des minutes entières, Navitia des secondes)."""
    lo, hi = _insight_holds(kind, budget, checks, "floor"), _insight_holds(kind, budget, checks, "ceil")
    if lo and hi:
        return "confirmed"
    if not lo and not hi:
        return "contradicted"
    return "within_one_minute"


def pole_verdict(out: LegCheck, ret: LegCheck, budget: int) -> str:
    """`same`, `different` ou `within_one_minute` : état du pôle (allumé si aller ET retour <= budget)."""
    lit_sw = not (over_budget(out.starway, budget) or over_budget(ret.starway, budget))
    res = set()
    for how in ("floor", "ceil"):
        lit_nv = not (over_budget(_rounded(out.navitia, how), budget) or over_budget(_rounded(ret.navitia, how), budget))
        res.add(lit_nv == lit_sw)
    return "same" if res == {True} else "different" if res == {False} else "within_one_minute"


def weighted_quantile(values: Sequence[float], weights: Sequence[float], q: float) -> float:
    """Quantile pondéré (plus petite valeur dont le poids cumulé atteint q du poids total)."""
    order = np.argsort(values, kind="stable")
    v = np.asarray(values, dtype=float)[order]
    w = np.asarray(weights, dtype=float)[order]
    cum = np.cumsum(w) / w.sum()
    return float(v[int(np.searchsorted(cum, q, side="left"))])


def describe_diffs(diffs: Sequence[float], weights: Sequence[float] | None = None) -> dict[str, Any]:
    """Écart médian (signé et absolu), 90e centile de l'écart absolu, parts à +/-1, 5 et 10 min."""
    if not diffs:
        return {"n": 0}
    d = np.asarray(diffs, dtype=float)
    a = np.abs(d)
    res: dict[str, Any] = {
        "n": int(d.size),
        "median_signed_min": round(float(np.median(d)), 2),
        "median_abs_min": round(float(np.median(a)), 2),
        "p90_abs_min": round(float(np.percentile(a, 90)), 2),
        "max_abs_min": round(float(a.max()), 2),
        "mean_signed_min": round(float(d.mean()), 2),
        "share_within_1_min": round(float((a <= 1).mean()), 4),
        "share_within_5_min": round(float((a <= 5).mean()), 4),
        "share_within_10_min": round(float((a <= 10).mean()), 4),
        "share_starway_longer": round(float((d > 0).mean()), 4),
    }
    if weights is not None:
        w = np.asarray(weights, dtype=float)
        res["weighted"] = {
            "median_signed_min": round(weighted_quantile(list(d), list(w), 0.5), 2),
            "median_abs_min": round(weighted_quantile(list(a), list(w), 0.5), 2),
            "p90_abs_min": round(weighted_quantile(list(a), list(w), 0.9), 2),
            "share_within_5_min": round(float(w[a <= 5].sum() / w.sum()), 4),
        }
    return res


def day_bounds(service_date: date, start: time, end: time) -> tuple[datetime, datetime]:
    return datetime.combine(service_date, start), datetime.combine(service_date, end)


# --------------------------------------------------------------------------- statut publié des découvertes

CROSSCHECK_STATUSES = ("confirmed", "within_one_minute", "contradicted", "not_checked")


def insight_scenario_key(item: Mapping[str, Any]) -> tuple:
    """Identité d'une découverte d'un export à l'autre (même clé que `starway.insights.scenario_key`)."""
    sc = item["scenario"]
    return (item["kind"], sc["o"], sc["d"], int(sc["b"]), sc["m"], sc.get("vs"), sc.get("compare_day"))


def published_crosscheck(item: Mapping[str, Any], checks: Mapping[tuple, Mapping[str, Any]], series_of,
                         pole_ids: Sequence[str], jobs: Sequence[int]) -> tuple[str, Mapping[str, Any] | None]:
    """Statut de recoupement d'une découverte (`CROSSCHECK_STATUSES`) et le recoupement qui le fonde.

    `checks` : recoupements de 07d (`insight_checks` du résumé) indexés par `insight_scenario_key`. Le verdict n'est
    repris que s'il porte sur les MÊMES trajets décisifs, avec les MÊMES durées STARWAY que la série publiée
    (`series_of`) : sinon le recoupement est périmé et la découverte est `not_checked`. Un verdict `unknown`
    (trajet non demandé à Navitia) vaut aussi `not_checked`."""
    chk = checks.get(insight_scenario_key(item))
    if chk is None:
        return "not_checked", None
    trips, why = insight_trips(item, series_of, pole_ids, jobs)
    checked = [(t["insee"], t["pole_id"], t["day"], t["leg"]) for t in chk.get("trips", [])]
    if why or [(t.insee, t.pole_id, t.day, t.leg) for t in trips] != checked:
        return "not_checked", None
    for t, c in zip(trips, chk["trips"], strict=True):
        s = series_of(t.insee, "transit", t.day)
        if s is None or s[t.leg][pole_ids.index(t.pole_id)] != c.get("starway_min"):
            return "not_checked", None
    v = chk.get("verdict")
    return (v, chk) if v in ("confirmed", "within_one_minute", "contradicted") else ("not_checked", None)
