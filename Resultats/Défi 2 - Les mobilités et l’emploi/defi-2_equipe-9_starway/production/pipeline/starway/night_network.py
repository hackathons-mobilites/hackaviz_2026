"""Réseau de nuit (D-040) : ce qu'il faut pour lire le 6h-14h recalculé et pour retrouver une course ajoutée.

Le 6h-14h (journée-type d06) est recalculé sur le GTFS de nuit (TRA01B : GTFS IDFM + courses de la veille codées 24:00 et
plus, `starway.night_gtfs`) dans des dossiers à part :

    matrix_walk{L}_d031_nuit_b44, access_walk{L}_d031_nuit_b44   matrice TC du 6h-14h (04e --days d06)
    itineraries_walk{L}_d031_nuit_b44                            itinéraires du 6h-14h (04h)

9h-17h (d09) et 14h-22h (d14) restent ceux des dossiers `_d031_b44` : le réseau de nuit n'y change presque rien (mesure
de la VM du 05/11 : à 9h, 1 trajet sur 24 896 change d'1 min), ils ne sont pas recalculés.

Ce module est PRÉPARÉ pour 06, 06h, 06t et 06n sans les modifier (ils sont adaptés aux 44 astres par la PR 33) : ils n'ont
qu'à appeler `d06_dir`, `merge_d06`, `read_trips` et `read_stop_times` à la place de leur lecture directe de TRA01.

Règle de sûreté : le réseau de nuit n'est accepté QUE pour le 6h-14h et les tables du matin et du soir (`matrix_io.
check_run_params(..., gtfs_source="TRA01B")`) ; partout ailleurs le GTFS attendu reste TRA01, sans exception.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

import pandas as pd

from starway import flux
from starway import matrix_io as mio
from starway.night_gtfs import NIGHT_TRIP_PREFIX, split_trip_ids

NIGHT_SOURCE = "TRA01B"
BASE_SOURCE = "TRA01"
NIGHT_DAY = "d06"  # la seule journée-type recalculée (6h-14h)
BASE_GTFS = flux.gtfs_path(BASE_SOURCE)  # fichiers lus dans le manifeste : jamais un nom écrit en dur (flux du 06/11)
NIGHT_GTFS = flux.gtfs_path(NIGHT_SOURCE)
# Clés de run_params qui décrivent le MOTEUR (réseau routier, jar R5, règles de correspondance, réglages, points) : elles
# doivent être égales entre un calcul de jour et son recalcul de nuit. Seuls le GTFS et les journées calculées diffèrent.
ENGINE_KEYS = (
    "processing_version", "service_date", "osm_sha256", "r5_jar", "r5_jar_sha256", "r5_version", "walk_setting",
    "walk_leg_limit_m", "walk_distance_limit_meters", "max_time_walking_min", "transfer_distance_limit_meters",
    "parkride_distance_limit_meters", "transfer_rules", "transfer_rules_patch_version", "transfer_rules_rule",
    "same_stop_csv_sha256", "same_stop_rule", "departure_step_min", "outbound_lookback_min", "departure_window_min",
    "max_trip_min", "speed_walking_kmh", "speed_cycling_kmh", "r5py_defaults", "origin_points_sha256",
    "dest_points_sha256", "origins_sha256", "n_origins", "batch_size", "poles_sha256", "poles_file", "poles_json",
    "poles_json_sha256")


def night_dir(base_dir: Path) -> Path:
    """Dossier du 6h-14h recalculé qui correspond à un dossier de base : `..._d031_b44` -> `..._d031_nuit_b44`
    (matrice, accès, itinéraires, de la même façon)."""
    name = base_dir.name
    if "_d031_nuit" in name:
        raise ValueError(f"{name} est déjà un dossier de nuit")
    if "_d031" not in name:
        raise ValueError(f"{name} : pas un dossier D-031 (suffixe _d031 attendu)")
    return base_dir.with_name(name.replace("_d031", "_d031_nuit", 1))


def engine_diff(base: Mapping[str, Any], night: Mapping[str, Any]) -> list[str]:
    """Écarts de moteur entre les run_params d'un calcul de jour et ceux de son recalcul de nuit (liste vide = même
    moteur ; seuls le GTFS et les journées diffèrent). Une clé de moteur présente d'un côté seulement est un écart."""
    errs = [f"{k} : jour {base.get(k)!r} != nuit {night.get(k)!r}" for k in ENGINE_KEYS
            if (k in base or k in night) and base.get(k) != night.get(k)]
    if base.get("gtfs_sha256") == night.get("gtfs_sha256"):
        errs.append("même GTFS dans le calcul de jour et dans son recalcul de nuit")
    return errs


def d06_load(run_dir: Path, pole_ids: Sequence[str], all_origins: Sequence[str], manifest_sha: Mapping[str, str],
             points_sha: str | None, limit_m: int) -> tuple[mio.MatrixLoad, dict]:
    """Lots TC du 6h-14h recalculé : GTFS attendu = TRA01B ; seule la journée d06 existe (refus de toute autre). Les lots sont
    lus SANS `published` (qui exigerait les trois journées) : la couverture est celle de d06 seule."""
    params = json.loads((run_dir / "run_params.json").read_text(encoding="utf-8"))
    errs = mio.walk_setting_errors(params, dict(manifest_sha), points_sha, limit_m, gtfs_source=NIGHT_SOURCE)
    if errs:
        raise ValueError(f"{run_dir.name}/run_params.json incohérent : {errs}")
    ld = mio.read_batches(run_dir, pole_ids, all_origins)
    other = sorted({d for _, d in ld.matrices if d != NIGHT_DAY} | {m for m, _ in ld.matrices if m != "transit"})
    if other:
        raise ValueError(f"{run_dir.name} : {other} inattendus (seule la matrice TC {NIGHT_DAY} est recalculée)")
    key = ("transit", NIGHT_DAY)
    if key in ld.matrices:
        ld.coverage["transit"] = sorted(set(ld.matrices[key]["from_id"]))
    return ld, params


def merge_d06(base: mio.MatrixLoad, night: mio.MatrixLoad, mode: str = "transit") -> mio.MatrixLoad:
    """Matrice du jour (d06, d09, d14) où d06 vient du recalcul de nuit. Une origine n'est publiée que si elle est dans les
    trois journées (`published`) : une origine pas encore recalculée en 6h-14h n'est pas publiée avec l'ancien 6h-14h."""
    if (mode, NIGHT_DAY) not in night.matrices:
        raise ValueError(f"recalcul de nuit sans {mode}_{NIGHT_DAY}")
    matrices = {k: v for k, v in base.matrices.items() if k != (mode, NIGHT_DAY)}
    matrices[(mode, NIGHT_DAY)] = night.matrices[(mode, NIGHT_DAY)]
    batches = {**base.batches, **{k: v for k, v in night.batches.items()}}
    raw = mio.MatrixLoad(matrices=matrices, batches=batches, problems=[*base.problems, *night.problems])
    return mio.published(raw)


# --------------------------------------------------------------------------- recherche d'une course
def _zip_for(trip_id: str, base_zip: Path, night_zip: Path) -> Path:
    return night_zip if trip_id.startswith(NIGHT_TRIP_PREFIX) else base_zip


def read_trips(trip_ids: Iterable[str], columns: Sequence[str], base_zip: Path = BASE_GTFS,
               night_zip: Path = NIGHT_GTFS) -> pd.DataFrame:
    """Lignes de trips.txt des courses demandées. Une course NUIT_ n'existe pas dans le GTFS d'origine : elle est cherchée
    dans le GTFS de nuit, jamais dans TRA01 (sans quoi elle serait « introuvable »). Erreur si une course reste introuvable."""
    regular, night = split_trip_ids(trip_ids)
    cols = list(dict.fromkeys(["trip_id", *columns]))
    parts = []
    for ids, z in ((regular, base_zip), (night, night_zip)):
        if not ids:
            continue
        with zipfile.ZipFile(z) as zf, zf.open("trips.txt") as f:
            df = pd.read_csv(f, dtype=str, usecols=cols, encoding="utf-8-sig")
        parts.append(df[df["trip_id"].isin(set(ids))])
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
    missing = sorted((set(regular) | set(night)) - set(out["trip_id"]))
    if missing:
        raise KeyError(f"courses introuvables dans leur GTFS : {missing[:5]}")
    return out.drop_duplicates("trip_id").reset_index(drop=True)


def read_stop_times(trip_ids: Iterable[str], columns: Sequence[str], base_zip: Path = BASE_GTFS,
                    night_zip: Path = NIGHT_GTFS, chunksize: int = 2_000_000, strict: bool = True) -> pd.DataFrame:
    """Arrêts des courses demandées (stop_times.txt lu par morceaux), chaque course dans SON GTFS (NUIT_ dans celui de nuit).
    `strict` faux : une course sans arrêt est simplement absente du résultat (comportement historique de 06h)."""
    regular, night = split_trip_ids(trip_ids)
    cols = list(dict.fromkeys(["trip_id", *columns]))
    parts = []
    for ids, z in ((regular, base_zip), (night, night_zip)):
        if not ids:
            continue
        want = set(ids)
        with zipfile.ZipFile(z) as zf, zf.open("stop_times.txt") as f:
            for ch in pd.read_csv(f, dtype=str, usecols=cols, chunksize=chunksize, encoding="utf-8-sig"):
                parts.append(ch[ch["trip_id"].isin(want)])
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
    missing = sorted((set(regular) | set(night)) - set(out["trip_id"]))
    if missing and strict:
        raise KeyError(f"courses sans arrêts dans leur GTFS : {missing[:5]}")
    return out


def read_night_trips(columns: Sequence[str], night_zip: Path = NIGHT_GTFS) -> pd.DataFrame:
    """Lignes de trips.txt des seules courses ajoutées (NUIT_), pour compléter la table des courses du GTFS d'origine."""
    cols = list(dict.fromkeys(["trip_id", *columns]))
    with zipfile.ZipFile(night_zip) as zf, zf.open("trips.txt") as f:
        df = pd.read_csv(f, dtype=str, usecols=cols, encoding="utf-8-sig")
    return df[df["trip_id"].str.startswith(NIGHT_TRIP_PREFIX)].reset_index(drop=True)


def original_trip_id(trip_id: str) -> str:
    """NUIT_<id> -> <id> (la course d'origine du lundi, d'où la ligne, le véhicule et l'accessibilité sont repris)."""
    return trip_id.removeprefix(NIGHT_TRIP_PREFIX)


def has_night_trips(trip_ids: Iterable[str]) -> bool:
    return bool(split_trip_ids(trip_ids)[1])


# --------------------------------------------------------------------------- brancher le 6h-14h recalculé (06, 06h, 06n, 07h)
def apply_night_d06(base: mio.MatrixLoad, base_params: Mapping[str, Any], base_dir: Path, pole_ids: Sequence[str],
                    origin_ids: Sequence[str], manifest_sha: Mapping[str, str], points_sha: str | None,
                    limit_m: int) -> tuple[mio.MatrixLoad, dict[str, Any] | None, str]:
    """6h-14h d'une matrice TC remplacé par son recalcul sur le réseau de nuit, s'il existe et s'il est COMPLET.

    Rend (matrices, info, raison). `info` (None si rien n'est appliqué) : dossier, source du GTFS (TRA01B), journée, origines.
    Refus de publier un mélange : un recalcul absent ou qui ne couvre pas toutes les origines laisse le 6h-14h d'origine
    (raison dite) ; un recalcul calculé avec un autre moteur que la matrice de jour est une ERREUR (ValueError)."""
    nd = night_dir(base_dir)
    if not (nd / "run_params.json").exists():
        return base, None, f"{nd.name} absent : 6h-14h d'origine"
    night, params = d06_load(nd, pole_ids, origin_ids, manifest_sha, points_sha, limit_m)
    problems = engine_diff(base_params, params)
    if problems:
        raise ValueError(f"{nd.name} : moteur différent de {base_dir.name} : {problems[:3]}")
    got = set(night.coverage.get("transit", []))
    if got != set(origin_ids):
        return base, None, f"{nd.name} : {len(got)} origines sur {len(origin_ids)} : 6h-14h d'origine gardé"
    merged = merge_d06(base, night)
    info = {"dir": nd.name, "day": NIGHT_DAY, "gtfs_source": NIGHT_SOURCE, "gtfs_sha256": params.get("gtfs_sha256"),
            "origins": len(origin_ids)}
    return merged, info, f"{nd.name} appliqué au {NIGHT_DAY}"


def merge_itinerary_records(base: Sequence[dict], night: Sequence[dict], pole_ids: Sequence[str],
                            day: str = NIGHT_DAY, directions: Sequence[str] = ("out", "ret")
                            ) -> tuple[list[dict], dict[str, Any] | None, str]:
    """Enregistrements de 04h (clés insee, pole, day, dir) où la journée `day` vient du recalcul de nuit. Même règle que
    pour la matrice : appliqué seulement si le recalcul couvre TOUTES les communes du calcul de jour (chaque couple pôle x
    sens), sinon le calcul d'origine est gardé en entier et la raison est dite ; jamais de mélange à moitié."""
    communes = {r["insee"] for r in base}
    want = {(p, day, d) for p in pole_ids for d in directions}
    seen: dict[str, set[tuple[str, str, str]]] = {}
    for r in night:
        if r["day"] == day:
            seen.setdefault(r["insee"], set()).add((r["pole"], r["day"], r["dir"]))
    covered = {i for i, k in seen.items() if want <= k}
    if not night or not communes <= covered:
        return list(base), None, f"recalcul de nuit : {len(communes & covered)} communes sur {len(communes)} : d'origine gardé"
    out = [r for r in base if r["day"] != day] + [r for r in night if r["day"] == day and r["insee"] in communes]
    return out, {"day": day, "gtfs_source": NIGHT_SOURCE, "communes": len(communes),
                 "records_replaced": sum(r["day"] == day for r in base)}, f"{day} remplacé pour {len(communes)} communes"


def itineraries_engine_problems(base_params: Mapping[str, Any], night_params: Mapping[str, Any],
                                manifest_sha: Mapping[str, str]) -> list[str]:
    """Itinéraires du 6h-14h recalculé : GTFS = TRA01B (jamais TRA01) et même moteur que les itinéraires de jour."""
    errs = []
    if night_params.get("gtfs_sha256") != manifest_sha.get(NIGHT_SOURCE):
        errs.append(f"gtfs_sha256 différent du manifeste ({NIGHT_SOURCE})")
    return errs + engine_diff(base_params, night_params)


def gtfs_zip_for(records: Iterable[Mapping[str, Any]], night_zip: Path = NIGHT_GTFS, base_zip: Path = BASE_GTFS) -> Path:
    """GTFS à lire pour retrouver les courses de ces enregistrements : celui de nuit (superset exact du GTFS d'origine,
    `night_gtfs.verify_night_gtfs`) dès qu'une course NUIT_ y figure, sinon TRA01."""
    for r in records:
        for lg in (r.get("option") or {}).get("legs", []):
            trip = lg.get("trip") or ""
            if trip.startswith(NIGHT_TRIP_PREFIX) or f":{NIGHT_TRIP_PREFIX}" in trip:
                return night_zip
    return base_zip


def night_trips_header(night_zip: Path = NIGHT_GTFS) -> list[str]:
    with zipfile.ZipFile(night_zip) as z:
        return next(csv.reader(io.TextIOWrapper(z.open("trips.txt"), encoding="utf-8-sig", newline="")))
