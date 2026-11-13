"""Table origine-destination de la proposition D-019 (statut : proposée, non adoptée).

Destinations = les 1 285 communes et arrondissements (au lieu des 15 pôles). Pour les TC, la table stocke le temps
porte à porte TT(x vers y, t) pour chaque départ t d'une grille de OUTBOUND_STEP_MIN minutes sur une plage donnée.
- aller pour un début de poste S : départ le plus tardif t de [S - OUTBOUND_LOOKBACK_MIN, S - OUTBOUND_STEP_MIN]
  tel que t + TT(t) <= S (même règle que `starway.routing.latest_feasible`) ;
- retour pour une fin de poste E : TT(y vers x, E), lu dans la même table (le retour d'un couple est l'aller du
  couple inverse), à condition que les modes r5py de l'aller et du retour soient identiques (`symmetric_legs`).
Marche, vélo, voiture : un seul temps par couple orienté (indépendant de l'heure, comme `routing.direct`).

Stockage (`data/interim/od/{mode}/batch_NNNN.npz`, numpy compressé, pyarrow n'étant pas installé) :
- `tt` : uint8, forme (origines du lot, destinations, départs) ; minutes entières telles que rendues par r5py ;
- SENTINEL_NO_TRIP (255) : pas de trajet dans l'horizon de recherche (NaN r5py) ;
- SENTINEL_NOT_SNAPPED (254) : origine ou destination non accrochée au réseau ;
- les valeurs > MAX_TRIP_MIN (r5py rend parfois 121 ou 122) sont stockées telles quelles et traitées comme « pas de
  trajet » à la lecture (même règle que `matrix_io.cap_to_max_trip`).

Tout ce module est sans r5py ni Java (testé dans tests/test_od_table.py).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from starway.config import INTERIM_DIR, MAX_TRIP_MIN, OUTBOUND_LOOKBACK_MIN, OUTBOUND_STEP_MIN
from starway.routing import MODE_LEGS, REASON_NO_TRIP, REASON_NOT_SNAPPED

OD_DIR = INTERIM_DIR / "od"
SENTINEL_NOT_SNAPPED = 254
SENTINEL_NO_TRIP = 255
MAX_STORABLE = 253  # plus grande durée stockable sans collision avec les sentinelles
OD_MODES = ("transit", "walk", "bike", "car")
TIME_DEPENDENT = frozenset({"transit"})
MINUTES_PER_DAY = 24 * 60

if MAX_TRIP_MIN > MAX_STORABLE:  # pragma: no cover - garde-fou de configuration
    raise RuntimeError(f"MAX_TRIP_MIN={MAX_TRIP_MIN} ne tient pas dans uint8 avec les sentinelles 254/255")

_HHMM = re.compile(r"^(\d{1,2}):(\d{2})$")


# --------------------------------------------------------------------------- grille des départs
def parse_hhmm(text: str) -> int:
    """'06:05' -> 365 (minutes depuis minuit). Erreur si le format ou l'heure est invalide."""
    m = _HHMM.match(text.strip())
    if not m:
        raise ValueError(f"heure attendue au format HH:MM, reçu {text!r}")
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        raise ValueError(f"heure invalide {text!r}")
    return h * 60 + mi


def format_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def departure_grid(first: int, last: int, step: int = OUTBOUND_STEP_MIN) -> np.ndarray:
    """Départs first, first+step, ..., last (minutes depuis minuit, bornes comprises).

    Les bornes doivent être sur la grille du calcul (multiples de `step`) : on ne calcule jamais un départ hors grille.
    """
    if step <= 0:
        raise ValueError("pas de grille invalide")
    for name, v in (("premier départ", first), ("dernier départ", last)):
        if not 0 <= v < MINUTES_PER_DAY:
            raise ValueError(f"{name} hors de la journée : {v}")
        if v % step:
            raise ValueError(f"{name} {format_hhmm(v)} hors de la grille de {step} min")
    if first > last:
        raise ValueError(f"premier départ {format_hhmm(first)} après le dernier {format_hhmm(last)}")
    return np.arange(first, last + step, step, dtype=np.int32)


def _check_contiguous(grid: np.ndarray, step: int) -> None:
    if len(grid) == 0 or (len(grid) > 1 and not np.all(np.diff(grid) == step)):
        raise ValueError("grille de départs vide ou non contiguë")


def servable_starts(grid: np.ndarray, lookback: int = OUTBOUND_LOOKBACK_MIN,
                    step: int = OUTBOUND_STEP_MIN) -> list[int]:
    """Débuts de poste S (sur la grille de `step`) dont toute la fenêtre aller [S - lookback, S - step] est calculée.

    Une fenêtre incomplète donnerait un aller faux (un départ manquant peut être le plus tardif faisable) : ces S
    sont exclus, jamais approchés. Un début de poste reste dans la journée du mardi : pas de S à 24:00 ou après (la grille
    de D-040 va jusqu'à 23:55, donc le dernier début est 23:55 et non 24:00).
    """
    _check_contiguous(grid, step)
    lo, hi = int(grid[0]) + lookback, min(int(grid[-1]) + step, MINUTES_PER_DAY - step)
    return list(range(lo, hi + 1, step)) if lo <= hi else []


def servable_ends(grid: np.ndarray, step: int = OUTBOUND_STEP_MIN) -> list[int]:
    """Fins de poste E calculables : exactement les départs de la grille (retour = TT au départ E)."""
    _check_contiguous(grid, step)
    return [int(x) for x in grid]


def symmetric_legs(mode: str) -> bool:
    """Vrai si l'aller et le retour utilisent les mêmes modes r5py : une seule table couvre alors les deux sens."""
    legs = MODE_LEGS[mode]
    return legs["out"] == legs["ret"]


def bench_departures(grid: np.ndarray, n: int) -> list[int]:
    """`n` départs répartis régulièrement sur la grille (premier et dernier compris), sans doublon."""
    if n <= 0:
        raise ValueError("nombre de départs du banc d'essai invalide")
    if n >= len(grid):
        return [int(x) for x in grid]
    idx = np.unique(np.round(np.linspace(0, len(grid) - 1, n)).astype(int))
    return [int(grid[i]) for i in idx]


# --------------------------------------------------------------------------- encodage uint8
def encode_minutes(values: Any) -> np.ndarray:
    """Durées r5py (float, NaN = pas de trajet) -> uint8 ; NaN -> SENTINEL_NO_TRIP.

    Erreur si une durée est négative, non entière ou > MAX_STORABLE (jamais de troncature silencieuse).
    """
    a = np.asarray(values, dtype=np.float64)
    nan = np.isnan(a)
    v = a[~nan]
    if v.size:
        if (v < 0).any():
            raise ValueError("durée négative")
        if (v > MAX_STORABLE).any():
            raise ValueError(f"durée > {MAX_STORABLE} min, non stockable en uint8")
        if (v != np.round(v)).any():
            raise ValueError("durée non entière : r5py rend des minutes entières, valeur inattendue")
    out = np.full(a.shape, SENTINEL_NO_TRIP, dtype=np.uint8)
    out[~nan] = v.astype(np.uint8)
    return out


def decode_minutes(value: int, max_trip: int = MAX_TRIP_MIN) -> tuple[int | None, str | None]:
    """Valeur stockée -> (minutes, None) ou (None, raison du contrat access)."""
    v = int(value)
    if v == SENTINEL_NOT_SNAPPED:
        return None, REASON_NOT_SNAPPED
    if v == SENTINEL_NO_TRIP or v > max_trip:
        return None, REASON_NO_TRIP
    return v, None


def encode_pairs(times: pd.Series, from_ids: Sequence[str], to_ids: Sequence[str]) -> np.ndarray:
    """Série r5py indexée par (from_id, to_id) -> matrice uint8 (len(from_ids), len(to_ids)).

    Un couple absent de la série (origine non passée à r5py) vaut SENTINEL_NO_TRIP ici ; `mark_unsnapped` le
    remplace ensuite par SENTINEL_NOT_SNAPPED pour les points non accrochés.
    """
    if times.empty:
        return np.full((len(from_ids), len(to_ids)), SENTINEL_NO_TRIP, dtype=np.uint8)
    wide = times.astype("float64").unstack()
    wide.index = wide.index.astype(str)
    wide.columns = wide.columns.astype(str)
    unknown = (set(wide.index) - set(from_ids)) | (set(wide.columns) - set(to_ids))
    if unknown:
        raise ValueError(f"identifiants inattendus dans le résultat r5py : {sorted(unknown)[:5]}")
    wide = wide.reindex(index=list(from_ids), columns=list(to_ids))
    return encode_minutes(wide.to_numpy())


def mark_unsnapped(tt: np.ndarray, from_ids: Sequence[str], to_ids: Sequence[str],
                   from_unsnapped: Iterable[str], to_unsnapped: Iterable[str]) -> np.ndarray:
    """Lignes (origines) et colonnes (destinations) non accrochées -> SENTINEL_NOT_SNAPPED (copie)."""
    out = tt.copy()
    fu, tu = set(from_unsnapped), set(to_unsnapped)
    rows = [i for i, x in enumerate(from_ids) if x in fu]
    cols = [j for j, x in enumerate(to_ids) if x in tu]
    if rows:
        out[rows, ...] = SENTINEL_NOT_SNAPPED
    if cols:
        out[:, cols, ...] = SENTINEL_NOT_SNAPPED
    return out


# --------------------------------------------------------------------------- aller / retour depuis la table
def outbound_at(tt: np.ndarray, grid: np.ndarray, start: int, lookback: int = OUTBOUND_LOOKBACK_MIN,
                step: int = OUTBOUND_STEP_MIN, max_trip: int = MAX_TRIP_MIN) -> tuple[np.ndarray, np.ndarray]:
    """Aller pour un début de poste `start` (minutes) depuis la série TT(t) (dernier axe aligné sur `grid`).

    Départ retenu = le plus tardif t de [start - lookback, start - step] tel que t + TT(t) <= start.
    Renvoie (durées uint8 avec sentinelles, départ retenu en minutes ou -1). Erreur si la fenêtre n'est pas
    entièrement dans la grille.
    """
    if start not in servable_starts(grid, lookback, step):
        raise ValueError(f"début de poste {format_hhmm(start)} hors de la plage calculable par la grille")
    lo = int(np.searchsorted(grid, start - lookback))
    hi = int(np.searchsorted(grid, start - step)) + 1
    deps = grid[lo:hi]
    sub = np.asarray(tt)[..., lo:hi].astype(np.int32)
    valid = sub <= max_trip  # exclut 254, 255 et les durées au-delà de la borne de recherche
    feasible = valid & (deps + sub <= start)
    any_ok = feasible.any(axis=-1)
    last = feasible.shape[-1] - 1 - np.argmax(feasible[..., ::-1], axis=-1)
    chosen = np.take_along_axis(sub, last[..., None], axis=-1)[..., 0]
    not_snapped = (sub == SENTINEL_NOT_SNAPPED).all(axis=-1)
    out = np.where(any_ok, chosen, np.where(not_snapped, SENTINEL_NOT_SNAPPED, SENTINEL_NO_TRIP)).astype(np.uint8)
    dep = np.where(any_ok, deps[last], -1).astype(np.int32)
    return out, dep


def inbound_at(tt_reverse: np.ndarray, grid: np.ndarray, end: int,
               max_trip: int = MAX_TRIP_MIN) -> np.ndarray:
    """Retour pour une fin de poste `end` : TT au départ `end` lu dans la table du couple inverse (y vers x)."""
    pos = np.flatnonzero(grid == end)
    if pos.size == 0:
        raise ValueError(f"fin de poste {format_hhmm(end)} absente de la grille des départs")
    v = np.asarray(tt_reverse)[..., int(pos[0])]
    return np.where((v > max_trip) & (v < SENTINEL_NOT_SNAPPED), SENTINEL_NO_TRIP, v).astype(np.uint8)


# --------------------------------------------------------------------------- points et empreintes
DEST_POINT_RULE = ("D-017 réutilisé pour les destinations (point ouvert de D-019) : origin_lon/origin_lat de "
                   "communes_idf_2026.csv, centre de gravité de la population")


def destination_points(communes: pd.DataFrame) -> pd.DataFrame:
    """Point d'arrivée de chaque commune de destination (colonnes id, lon, lat).

    SEUL endroit où ce choix est fait (point ouvert de D-019) : aujourd'hui le point D-017 (centre de gravité de la
    population), identique au point de départ. Flores ne localise les postes qu'à la commune : ce point n'est pas
    forcément là où sont les postes. Pour changer de règle, modifier cette fonction et DEST_POINT_RULE ; l'empreinte
    `dest_points_sha256` de run_params.json refusera alors toute reprise avec les anciens points.
    """
    from starway.origin_points import ORIGIN_LAT, ORIGIN_LON

    df = communes[["insee", ORIGIN_LON, ORIGIN_LAT]].rename(columns={"insee": "id", ORIGIN_LON: "lon",
                                                                     ORIGIN_LAT: "lat"})
    if df[["lon", "lat"]].isna().any().any():
        raise ValueError("point de destination manquant : relancer 02_build_geo.py (D-017)")
    return df.sort_values("id").reset_index(drop=True)


def points_sha256(points: pd.DataFrame, id_col: str = "id", lon: str = "lon", lat: str = "lat") -> str:
    """Empreinte : identifiant + coordonnées arrondies à 6 décimales, triés (même règle qu'origin_points_sha256)."""
    rows = sorted(f"{i}:{x:.6f},{y:.6f}" for i, x, y in zip(points[id_col], points[lon], points[lat], strict=True))
    return hashlib.sha256(";".join(rows).encode()).hexdigest()


# --------------------------------------------------------------------------- lots
def batches_of(ids: Sequence[str], size: int) -> list[list[str]]:
    """Découpage déterministe (identifiants triés), identique à 04 : la reprise retrouve les mêmes lots."""
    if size <= 0:
        raise ValueError("taille de lot invalide")
    s = sorted(ids)
    return [s[i:i + size] for i in range(0, len(s), size)]


def lot_path(root: Path, mode: str, k: int) -> Path:
    return root / mode / f"batch_{k:04d}.npz"


def write_lot(path: Path, tt: np.ndarray, from_ids: Sequence[str], to_ids: Sequence[str],
              departures: Sequence[int]) -> None:
    """Écriture atomique (fichier .part puis renommage) : un lot présent est un lot complet."""
    if tt.dtype != np.uint8 or tt.shape != (len(from_ids), len(to_ids), len(departures)):
        raise ValueError(f"table de forme {tt.shape} / {tt.dtype} incohérente avec les identifiants")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    with tmp.open("wb") as f:
        np.savez_compressed(f, tt=tt, from_ids=np.asarray(from_ids, dtype="U"),
                            to_ids=np.asarray(to_ids, dtype="U"),
                            departures_min=np.asarray(departures, dtype=np.int32))
    os.replace(tmp, path)


@dataclass(frozen=True)
class Lot:
    tt: np.ndarray
    from_ids: list[str]
    to_ids: list[str]
    departures: np.ndarray


def read_lot(path: Path) -> Lot:
    with np.load(path, allow_pickle=False) as z:
        return Lot(z["tt"], z["from_ids"].tolist(), z["to_ids"].tolist(), z["departures_min"])


def params_diff(old: Mapping[str, Any], new: Mapping[str, Any]) -> dict[str, tuple[Any, Any]]:
    keys = set(old) | set(new)
    return {k: (old.get(k), new.get(k)) for k in sorted(keys) if old.get(k) != new.get(k)}


# --------------------------------------------------------------------------- estimation de durée (run_log de 04)
def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def latest_entries(entries: Iterable[Mapping[str, Any]]) -> dict[tuple[int, str, str], Mapping[str, Any]]:
    """Dernière entrée par (lot, mode, journée) : celle du lot actuellement sur disque (les relances --fresh
    successives laissent des entrées plus anciennes dans run_log.jsonl)."""
    out: dict[tuple[int, str, str], Mapping[str, Any]] = {}
    for e in entries:
        out[(int(e["batch"]), str(e["mode"]), str(e["day"]))] = e
    return out


def searches_in_04_entry(entry: Mapping[str, Any], n_poles: int, n_out_departures: int) -> int:
    """Nombre de recherches r5py (une par point de départ et par appel) d'une ligne de run_log de 04.

    TC : n_out_departures appels aller (origines du lot -> pôles) + 1 appel retour (pôles -> origines).
    Modes sans horaire : 1 appel aller (origines) + 1 appel retour (pôles).
    """
    n = int(entry["origins"])
    if entry["day"] == "any":
        return n + n_poles
    return n * n_out_departures + n_poles


def rates_from_04(entries: Iterable[Mapping[str, Any]], n_poles: int,
                  n_out_departures: int) -> dict[str, dict[int, float]]:
    """Secondes par recherche r5py mesurées par 04, par mode puis par lot (moyenne des journées pour les TC)."""
    acc: dict[str, dict[int, list[float]]] = {}
    for (k, mode, _day), e in latest_entries(entries).items():
        rate = float(e["seconds"]) / searches_in_04_entry(e, n_poles, n_out_departures)
        acc.setdefault(mode, {}).setdefault(k, []).append(rate)
    return {m: {k: statistics.fmean(v) for k, v in sorted(d.items())} for m, d in acc.items()}


@dataclass(frozen=True)
class Estimate:
    mode: str
    seconds: float
    seconds_per_departure_by_lot: list[float]  # temps d'un appel r5py (un départ) pour chaque lot
    method: str


def estimate_mode(mode: str, lot_sizes: Sequence[int], n_departures: int, rates: Mapping[int, float],
                  same_lots: bool) -> Estimate:
    """Durée estimée d'un mode pour la table OD, à partir des secondes par recherche mesurées par 04.

    Hypothèse explicite (non vérifiée, mesurée par --bench) : le coût d'une recherche ne dépend pas du nombre de
    destinations (15 pôles dans 04, 1 285 communes ici).
    """
    if not rates:
        raise ValueError(f"aucune mesure de 04 pour le mode {mode}")
    mean_rate = statistics.fmean(rates.values())
    per_dep = []
    for k, n in enumerate(lot_sizes):
        r = rates.get(k, mean_rate) if same_lots else mean_rate
        per_dep.append(r * n)
    total = sum(per_dep) * n_departures
    method = ("secondes par recherche du même lot dans 04" if same_lots
              else "secondes par recherche moyennes de 04 (découpage différent)")
    return Estimate(mode, total, per_dep, method)


# --------------------------------------------------------------------------- volume d'export par commune
def publication_times(servable: Sequence[int], pub_step: int, grid_step: int = OUTBOUND_STEP_MIN) -> list[int]:
    """Heures publiées : celles de `servable` multiples de `pub_step` (lui-même multiple du pas de calcul)."""
    if pub_step <= 0 or pub_step % grid_step:
        raise ValueError(f"pas de publication {pub_step} non multiple du pas de calcul {grid_step}")
    return [t for t in servable if t % pub_step == 0]


def export_payload(out_by_start: Mapping[int, np.ndarray], ret_by_end: Mapping[int, np.ndarray]) -> dict[str, Any]:
    """Format CANDIDAT (non contractuel) d'un fichier par commune d'origine et par mode : pour chaque heure publiée,
    la liste des durées vers chaque destination, dans l'ordre d'un index de communes partagé ; null = pas de durée
    (la raison serait portée par un code, à définir dans le contrat). Sert à MESURER un volume, pas à exporter."""
    def col(a: np.ndarray) -> list[int | None]:
        return [decode_minutes(int(v))[0] for v in a]

    return {"out": {format_hhmm(s): col(a) for s, a in out_by_start.items()},
            "ret": {format_hhmm(e): col(a) for e, a in ret_by_end.items()}}


def payload_bytes(payload: Mapping[str, Any]) -> tuple[int, int]:
    """(octets JSON minifié, octets après gzip niveau 9) : mesure, pas estimation."""
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return len(raw), len(gzip.compress(raw, compresslevel=9, mtime=0))


def json_upper_bound(n_values: int, max_trip: int = MAX_TRIP_MIN) -> int:
    """Borne haute exacte des valeurs d'un tableau JSON minifié : chaque valeur pèse au plus max(len('null'),
    nombre de chiffres de max_trip) octets plus une virgule. Les clés et crochets sont en sus (négligeables)."""
    return n_values * (max(len("null"), len(str(max_trip))) + 1)


def commune_export_volume(tt_from: np.ndarray, tt_to: np.ndarray, grid: np.ndarray, starts: Sequence[int],
                          ends: Sequence[int]) -> dict[str, int]:
    """Mesure le volume du fichier candidat d'UNE commune x.

    tt_from : (destinations, départs) = TT(x vers y, t) ; tt_to : (destinations, départs) = TT(y vers x, t).
    """
    out = {s: outbound_at(tt_from, grid, s)[0] for s in starts}
    ret = {e: inbound_at(tt_to, grid, e) for e in ends}
    raw, gz = payload_bytes(export_payload(out, ret))
    return {"n_starts": len(starts), "n_ends": len(ends), "n_values": tt_from.shape[0] * (len(starts) + len(ends)),
            "raw_bytes": raw, "gzip_bytes": gz}
