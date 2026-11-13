"""Table OD D-019 avec un réglage de marche D-024, calculée en parallèle (04c --walk-setting, tools/vm/queue.sh).

Logique pure (sans r5py ni Java), testée dans tests/test_od_variant.py :
- `variant_dir` / `variant_params` : dossier de sortie et paramètres figés d'une variante (jar, réglage, limites) ;
- `claim_lot` / `release_lot` : verrou par lot (fichier créé en exclusif) pour que plusieurs processus se partagent
  les lots d'une même table sans recouvrement ; un verrou dont le processus n'existe plus est repris ;
- `read_threads` : nombre de fils de calcul, relu entre deux lots dans un fichier de contrôle (montée en charge sans
  recharger le réseau R5) ;
- `base_compatible` : la table de base (od/, réglage R5 d'origine) et une variante décrivent-elles le même calcul
  (sources, points, grille, lots) à la limite de marche près ? (export 06d --walk-setting).

Rappel : les réglages « confort » 1 000 m et « normal » 3 000 m sont un CHOIX DE L'ÉQUIPE (D-024), pas une donnée.
"""

from __future__ import annotations

import json
import os
import socket
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from starway.config import INTERIM_DIR, WALK_SETTINGS_M

WALK_SETTING_NATURE = "choix de l'équipe (D-024), pas une donnée"
WALK_LIMIT_RULE = ("sortie : WALK_DISTANCE_LIMIT_METERS du jar ; accès : max_time_walking = distance / "
                   "SPEED_WALKING_KMH, arrondi à la minute supérieure")
# Modes d'une variante : seuls les modes avec TC dépendent du réglage de marche (routing.walk_leg_kwargs ne pose
# max_time_walking que pour eux ; la constante du jar ne sert qu'aux tables arrêt -> point des TC). Marche, vélo,
# voiture seuls : lus dans la table de base od/ (docs/methodologie.md § 5 quinquies, variantes).
VARIANT_MODES = ("transit",)
# Clés de run_params qui doivent être identiques entre la table de base et une variante (tout sauf la marche).
SHARED_KEYS = ("processing_version", "service_date", "gtfs_sha256", "osm_sha256", "departure_step_min",
               "outbound_lookback_min", "departure_window_min", "max_trip_min", "speed_walking_kmh",
               "speed_cycling_kmh", "batch_size", "departures", "origins_sha256", "n_origins",
               "origin_points_sha256", "dest_points_sha256", "n_destinations", "dest_point_rule", "storage")
MAX_THREADS = 64


def setting_limit_m(setting: str) -> int:
    if setting not in WALK_SETTINGS_M:
        raise ValueError(f"réglage de marche inconnu {setting!r} (attendu : {sorted(WALK_SETTINGS_M)})")
    return WALK_SETTINGS_M[setting]


def variant_dir(limit_m: int, root: Path = INTERIM_DIR) -> Path:
    """Dossier des lots d'une variante : data/interim/od_walk{L}/ (jamais od/, la table du réglage R5 d'origine)."""
    return root / f"od_walk{limit_m}"


def variant_params(base: Mapping[str, Any], jar: Mapping[str, Any], setting: str, walk_min: int) -> dict[str, Any]:
    """run_params d'une variante = paramètres de 04c + empreinte du jar + réglage (même rigueur que 04e)."""
    limit_m = setting_limit_m(setting)
    if jar.get("walk_distance_limit_meters") != limit_m:
        raise ValueError(f"jar {jar.get('r5_jar')} : WALK_DISTANCE_LIMIT_METERS = "
                         f"{jar.get('walk_distance_limit_meters')}, attendu {limit_m} (réglage {setting})")
    return {**base, "run": "04c_od_table_walk_setting (D-019 x D-024)", **jar, "walk_setting": setting,
            "walk_setting_nature": WALK_SETTING_NATURE, "walk_leg_limit_m": limit_m,
            "max_time_walking_min": walk_min, "walk_limit_rule": WALK_LIMIT_RULE}


def base_compatible(base: Mapping[str, Any], variant: Mapping[str, Any], *, ignore_gtfs: bool = False) -> list[str]:
    """Écarts (liste vide = compatible) entre les run_params de od/ et ceux d'une variante, hors réglage de marche.
    `ignore_gtfs` : table de base sans transport en commun, non relancée avec le flux du 06/11 (son empreinte est contrôlée à part
    contre `data/flux_gtfs_precedents.csv` : `flux.accepted_gtfs_shas`)."""
    errs = [f"{k} : base {base.get(k)!r} != variante {variant.get(k)!r}" for k in SHARED_KEYS
            if base.get(k) != variant.get(k) and not (ignore_gtfs and k == "gtfs_sha256")]
    if "walk_setting" in base:
        errs.append(f"la table de base porte un réglage de marche ({base['walk_setting']}) : ce n'est pas od/")
    if "walk_setting" not in variant:
        errs.append("la variante ne porte pas de réglage de marche (walk_setting absent)")
    return errs


R5_DEFAULT_EGRESS_M = 2000  # TransitLayer.WALK_DISTANCE_LIMIT_METERS du jar r5py d'origine (D-023)


def walk_setting_block(rp: Mapping[str, Any]) -> dict[str, Any]:
    """Bloc `walk_setting` de od*/index.json (contrat D-019) : quel réglage de marche décrit la table TC exportée.
    Lu dans les run_params de la table TC (jamais déduit du nom de dossier)."""
    if "walk_setting" not in rp:
        return {"id": "r5_default", "nature": "réglage d'origine de R5 (aucun choix de l'équipe)",
                "egress_limit_m": R5_DEFAULT_EGRESS_M, "access_limit_min": None, "applies_to": list(VARIANT_MODES),
                "r5_jar": None, "r5_jar_sha256": None}
    return {"id": rp["walk_setting"], "nature": rp["walk_setting_nature"], "limit_m": rp["walk_leg_limit_m"],
            "egress_limit_m": rp["walk_distance_limit_meters"], "access_limit_min": rp["max_time_walking_min"],
            "applies_to": list(VARIANT_MODES), "rule": rp["walk_limit_rule"], "r5_jar": rp["r5_jar"],
            "r5_jar_sha256": rp["r5_jar_sha256"], "r5_version": rp["r5_version"]}


# --------------------------------------------------------------------------- verrous de lots (plusieurs processus)
def lock_path(npz: Path) -> Path:
    return npz.with_suffix(".lock")


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:  # le processus existe (autre utilisateur)
        return True
    return True


def claim_lot(npz: Path, pid: int | None = None, host: str | None = None,
              alive: Callable[[int], bool] = pid_alive) -> bool:
    """Réserve le lot `npz` pour ce processus. Faux si le lot est déjà écrit ou réservé par un processus vivant.
    Un verrou orphelin (processus disparu sur cette machine, ex. arrêt de la VM) est repris."""
    if npz.exists():
        return False
    pid = os.getpid() if pid is None else pid
    host = socket.gethostname() if host is None else host
    lock = lock_path(npz)
    lock.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"pid": pid, "host": host, "at": datetime.now(UTC).isoformat(timespec="seconds")})
    for _ in range(2):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            try:
                owner = json.loads(lock.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                owner = {}
            same_host = owner.get("host") == host
            if same_host and isinstance(owner.get("pid"), int) and not alive(owner["pid"]):
                lock.unlink(missing_ok=True)  # orphelin : on retente une fois
                continue
            return False  # réservé par un processus vivant (ou verrou en cours d'écriture : laissé à son auteur)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        if npz.exists():  # écrit entre-temps par un autre processus
            lock.unlink(missing_ok=True)
            return False
        return True
    return False


def release_lot(npz: Path, pid: int | None = None) -> None:
    """Retire le verrou s'il appartient à ce processus."""
    lock = lock_path(npz)
    pid = os.getpid() if pid is None else pid
    try:
        owner = json.loads(lock.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if owner.get("pid") == pid:
        lock.unlink(missing_ok=True)


# --------------------------------------------------------------------------- montée en charge
def read_threads(default: int, control: Path | None) -> int:
    """Fils de calcul : entier du fichier de contrôle s'il existe et est valide, sinon `default` ; borné à
    [1, MAX_THREADS]."""
    n = default
    if control is not None and control.is_file():
        try:
            n = int(control.read_text(encoding="utf-8").strip())
        except ValueError:
            n = default
    return max(1, min(MAX_THREADS, n))
