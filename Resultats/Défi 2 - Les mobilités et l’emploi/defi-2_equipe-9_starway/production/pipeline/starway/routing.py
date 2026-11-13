"""Temps de trajet aller / retour avec r5py (skill starway-routing-r5py).

Définitions (docs/methodologie.md) pour une journée-type [S, E] :
- aller : départ le plus tardif t* d'une grille de 5 min sur [S-120, S-5] tel que t + TT(t) <= S ;
  out = TT(t*) (porte à porte, attente initiale à l'arrêt comprise).
- retour : ret = TT(E), départ à la fin du poste (attente du prochain passage comprise).

La logique pure (`latest_feasible`, `assemble_access`) est testée sans Java ; les fonctions qui appellent
r5py importent le module à la demande, après `configure_java()`.
"""

from __future__ import annotations

import math
import os
import sys
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pandas as pd

from starway.config import (
    DAY_TYPES_BY_ID,
    DEPARTURE_WINDOW_MIN,
    JDK_DIR,
    MAX_TRIP_MIN,
    OUTBOUND_LOOKBACK_MIN,
    OUTBOUND_STEP_MIN,
    R5_MAX_MEMORY,
    SPEED_CYCLING_KMH,
    SPEED_WALKING_KMH,
)

if TYPE_CHECKING:  # pragma: no cover
    import geopandas as gpd

REASON_NO_TRIP = "no_trip_within_120"
REASON_NOT_SNAPPED = "origin_not_snapped"
REASON_NOT_COMPUTED = "not_computed"

# Réglage de marche D-024 (choix de l'équipe, starway.config.WALK_SETTINGS_M) : durée max (min) de chaque trajet à pied
# des modes TC, passée à r5py en `max_time_walking`. None = comportement de la matrice publiée (r5py : = max_time).
# Fixé seulement par 04e ; dans R5, ce plafond s'applique à l'accès, à la sortie, au trajet tout à pied du même
# calcul et au filtre des correspondances (methodologie.md § 5 octies).
WALK_LEG_MAX_MIN: int | None = None

# D-031 : règles de correspondance appliquées par `load_network` au réseau chargé (jar corrigé obligatoire, voir
# starway.r5_transfers). None = moteur d'origine (publié jusqu'au 04/11). Fixé par 04e, 04c, 04h, 04k
# (`r5_transfers.configure`) : {"rules", "gtfs_zip", "same_stop_csv", "log_path"}.
TRANSFER_RULES: dict[str, Any] | None = None
TRANSFER_RULES_STATS: dict[str, Any] | None = None


# --------------------------------------------------------------------------- logique pure
def outbound_departures(start: datetime) -> list[datetime]:
    """Grille des départs aller : S-120, S-115, …, S-5 (croissant)."""
    n = OUTBOUND_LOOKBACK_MIN // OUTBOUND_STEP_MIN
    return [start - timedelta(minutes=OUTBOUND_STEP_MIN * k) for k in range(n, 0, -1)]


def latest_feasible(samples: Mapping[datetime, float | None], start: datetime) -> tuple[int | None, datetime | None]:
    """Départ le plus tardif arrivant au plus tard à `start`.

    `samples` : départ -> durée en minutes (None/NaN = pas de trajet dans l'horizon de recherche).
    Renvoie (durée du trajet retenu, heure de départ retenue) ou (None, None).
    """
    best: tuple[int | None, datetime | None] = (None, None)
    for dep in sorted(samples):
        tt = samples[dep]
        if tt is None or (isinstance(tt, float) and math.isnan(tt)):
            continue
        if dep + timedelta(minutes=float(tt)) <= start:
            best = (round(tt), dep)
    return best


def assemble_access(
    pole_ids: Sequence[str],
    out: Mapping[str, int | None],
    ret: Mapping[str, int | None],
    snapped: bool = True,
) -> dict[str, list[Any]]:
    """Construit {out, ret, reason} indexés comme `pole_ids` (contrat access/{insee}.json)."""
    o_list: list[int | None] = []
    r_list: list[int | None] = []
    reasons: list[str | None] = []
    for pid in pole_ids:
        o = out.get(pid)
        r = ret.get(pid)
        o_list.append(None if o is None else int(o))
        r_list.append(None if r is None else int(r))
        if o is None or r is None:
            reasons.append(REASON_NOT_SNAPPED if not snapped else REASON_NO_TRIP)
        else:
            reasons.append(None)
    return {"out": o_list, "ret": r_list, "reason": reasons}


def day_bounds(service_date: date, day_type_id: str) -> tuple[datetime, datetime]:
    d = DAY_TYPES_BY_ID[day_type_id]
    return datetime.combine(service_date, d.start), datetime.combine(service_date, d.end)


# --------------------------------------------------------------------------- r5py
def r5py_argv(prog: str, max_memory: str, r5_classpath: Path | None = None) -> list[str]:
    """Options lues par r5py (configargparse sur sys.argv) : heap de la JVM et, si fourni, jar R5 externe
    (`--r5-classpath`, variante D-022 ; r5py retombe en silence sur son jar si le chemin n'existe pas, d'où
    la vérification d'existence ici et la vérification de la constante dans 04e)."""
    argv = [prog, "--max-memory", max_memory]
    if r5_classpath is not None:
        if not r5_classpath.is_file():
            raise FileNotFoundError(f"jar R5 introuvable : {r5_classpath}")
        argv += ["--r5-classpath", str(r5_classpath)]
    return argv


def configure_java(jdk_dir: Path = JDK_DIR, max_memory: str = R5_MAX_MEMORY, r5_classpath: Path | None = None) -> None:
    """À appeler AVANT `import r5py` : JAVA_HOME portable, limite mémoire de la JVM (`--max-memory`) et,
    pour une variante seulement, jar R5 externe (`--r5-classpath`). Sans `r5_classpath` : comportement inchangé."""
    if "r5py" in sys.modules:
        raise RuntimeError("configure_java() doit être appelé avant d'importer r5py")
    if jdk_dir.exists():
        os.environ["JAVA_HOME"] = str(jdk_dir)
        os.environ["PATH"] = str(jdk_dir / "bin") + os.pathsep + os.environ.get("PATH", "")
    # r5py lit ses options via configargparse sur sys.argv
    sys.argv = r5py_argv(sys.argv[0], max_memory, r5_classpath)


def load_network(osm_pbf: Path, gtfs_zip: Path):  # -> r5py.TransportNetwork
    import r5py

    # allow_errors=True : le GTFS IDFM contient des avertissements de validation R5 non bloquants ;
    # ils sont émis en RuntimeWarning et consignés par le script appelant.
    network = r5py.TransportNetwork(osm_pbf, [gtfs_zip], allow_errors=True)
    if TRANSFER_RULES is not None and TRANSFER_RULES["rules"] != "r5":
        from starway import r5_transfers

        global TRANSFER_RULES_STATS
        TRANSFER_RULES_STATS = r5_transfers.apply_configured(network, TRANSFER_RULES)
    return network


# Modes r5py par scénario et par sens ("out" = commune vers pôle, "ret" = pôle vers commune).
# r5py fixe les modes directs = access_modes + modes de rue de transport_modes (regional_task.py) :
# - transit : marche aux deux bouts, trajet tout à pied possible ;
# - bike_transit (« vélo jusqu'à la gare ») : aller = vélo jusqu'à l'arrêt, marche à l'arrivée ; retour = marche
#   depuis le pôle, vélo depuis l'arrêt de descente (le vélo est resté à la gare de départ). Conséquence r5py :
#   à l'aller, un trajet tout à vélo est aussi possible (limite documentée) ; au retour, seulement tout à pied ;
# - walk / bike / car : le mode seul (access = le mode lui-même, pour ne pas ajouter la marche en direct).
MODE_LEGS: dict[str, dict[str, dict[str, list[str]]]] = {
    "transit": {
        "out": {"transport": ["TRANSIT", "WALK"], "access": ["WALK"], "egress": ["WALK"]},
        "ret": {"transport": ["TRANSIT", "WALK"], "access": ["WALK"], "egress": ["WALK"]},
    },
    "bike_transit": {
        "out": {"transport": ["TRANSIT", "WALK"], "access": ["BICYCLE"], "egress": ["WALK"]},
        "ret": {"transport": ["TRANSIT", "WALK"], "access": ["WALK"], "egress": ["BICYCLE"]},
    },
    "walk": {d: {"transport": ["WALK"], "access": ["WALK"], "egress": []} for d in ("out", "ret")},
    "bike": {d: {"transport": ["BICYCLE"], "access": ["BICYCLE"], "egress": []} for d in ("out", "ret")},
    "car": {d: {"transport": ["CAR"], "access": ["CAR"], "egress": []} for d in ("out", "ret")},
}


def _modes(mode: str, direction: str):
    from r5py import TransportMode as TM

    legs = MODE_LEGS[mode][direction]
    return ([TM[m] for m in legs["transport"]], [TM[m] for m in legs["access"]],
            [TM[m] for m in legs["egress"]] or None)


def walk_leg_kwargs(mode: str, direction: str, limit_min: int | None) -> dict[str, Any]:
    """`max_time_walking` pour les modes avec TC seulement (jamais pour marche, vélo, voiture seuls)."""
    if limit_min is None or "TRANSIT" not in MODE_LEGS[mode][direction]["transport"]:
        return {}
    if limit_min <= 0:
        raise ValueError("durée de marche max nulle ou négative")
    return {"max_time_walking": timedelta(minutes=limit_min)}


def snap_points(network, points: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, list[str], dict[str, float]]:
    """Accroche les points au réseau piéton (rayon R5 par défaut). Renvoie (points accrochés, ids non
    accrochés, distance d'accrochage en mètres par id)."""
    import shapely

    snapped = network.snap_to_network(points.geometry)
    empty = snapped.apply(lambda g: g is None or g.is_empty)
    unsnapped = points.loc[empty, "id"].tolist()
    l93_orig = points.geometry.to_crs("EPSG:2154")
    l93_snap = snapped.to_crs("EPSG:2154")
    dist = {
        pid: float(shapely.distance(a, b))
        for pid, a, b, e in zip(points["id"], l93_orig, l93_snap, empty)
        if not e
    }
    out = points.loc[~empty].copy()
    out["geometry"] = snapped.loc[~empty]
    return out, unsnapped, dist


def travel_times(network, origins: gpd.GeoDataFrame, destinations: gpd.GeoDataFrame,
                 departure: datetime, mode: str, direction: str) -> pd.Series:
    """Durées (min) indexées par (from_id, to_id) pour un départ précis (fenêtre 1 min). NaN = > 120 min."""
    import r5py

    transport_modes, access_modes, egress_modes = _modes(mode, direction)
    kwargs: dict[str, Any] = {
        "origins": origins, "destinations": destinations, "departure": departure,
        "departure_time_window": timedelta(minutes=DEPARTURE_WINDOW_MIN), "percentiles": [50],
        "max_time": timedelta(minutes=MAX_TRIP_MIN), "transport_modes": transport_modes,
        "speed_walking": SPEED_WALKING_KMH, "speed_cycling": SPEED_CYCLING_KMH,
        "snap_to_network": False,  # points déjà accrochés une fois pour toutes par snap_points()
    }
    kwargs.update(walk_leg_kwargs(mode, direction, WALK_LEG_MAX_MIN))
    if access_modes:
        kwargs["access_modes"] = access_modes
    if egress_modes:
        kwargs["egress_modes"] = egress_modes
    m = r5py.TravelTimeMatrix(network, **kwargs)
    df = pd.DataFrame(m)
    return df.set_index(["from_id", "to_id"])["travel_time"]


def outbound(network, origins, poles, start: datetime, mode: str) -> pd.DataFrame:
    """Aller : colonnes from_id (commune), to_id (pôle), out (min ou NA), dep (départ retenu)."""
    per_pair: dict[tuple[str, str], dict[datetime, float | None]] = {}
    for dep in outbound_departures(start):
        s = travel_times(network, origins, poles, dep, mode, "out")
        for pair, tt in s.items():
            per_pair.setdefault(pair, {})[dep] = None if pd.isna(tt) else float(tt)
    rows = []
    for (o, p), samples in per_pair.items():
        tt, dep = latest_feasible(samples, start)
        rows.append({"from_id": o, "to_id": p, "out": tt, "dep": dep})
    return pd.DataFrame(rows)


def inbound(network, poles, origins, end: datetime, mode: str) -> pd.DataFrame:
    """Retour : départ du pôle à `end` vers la commune. Colonnes from_id (pôle), to_id (commune), ret."""
    s = travel_times(network, poles, origins, end, mode, "ret")
    return pd.DataFrame(
        [{"from_id": p, "to_id": o, "ret": None if pd.isna(v) else round(v)} for (p, o), v in s.items()]
    )


def direct(network, origins, poles, departure: datetime, mode: str) -> pd.DataFrame:
    """Modes sans horaire (marche, vélo, voiture) : out = TT(commune -> pôle), ret = TT(pôle -> commune),
    un seul calcul par sens (le réseau viaire ne dépend pas de l'heure ; voiture sans congestion)."""
    o = travel_times(network, origins, poles, departure, mode, "out")
    r = travel_times(network, poles, origins, departure, mode, "ret")
    rows = [{"from_id": a, "to_id": b, "out": None if pd.isna(v) else round(v), "dep": None} for (a, b), v in o.items()]
    df = pd.DataFrame(rows)
    back = pd.DataFrame([{"from_id": b, "to_id": a, "ret": None if pd.isna(v) else round(v)} for (a, b), v in r.items()])
    return df.merge(back, how="outer", on=["from_id", "to_id"])

