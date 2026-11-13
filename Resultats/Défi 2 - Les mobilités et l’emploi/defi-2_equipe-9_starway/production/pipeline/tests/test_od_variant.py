"""Variantes de marche de la table OD D-019 (04c --walk-setting) : verrous de lots, fils, paramètres (sans Java).

Les jars et paramètres manipulés ici sont des FIXTURES de test (dictionnaires synthétiques), pas des résultats r5py.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from starway import od_variant as ov
from starway.config import PIPELINE_DIR, WALK_SETTINGS_M

JAR_3000 = {"r5_jar": "r5-test-walk3000.jar", "r5_jar_sha256": "ab" * 32, "r5_version": "v-test",
            "r5_commit": "c0ffee", "walk_distance_limit_meters": 3000, "transfer_distance_limit_meters": 1000,
            "parkride_distance_limit_meters": 500}
BASE = {"run": "04c_od_table (D-019 proposée)", "processing_version": "0.1.0", "service_date": "2026-11-17",
        "gtfs_sha256": "g", "osm_sha256": "o", "departure_step_min": 5, "outbound_lookback_min": 120,
        "departure_window_min": 1, "max_trip_min": 120, "speed_walking_kmh": 3.6, "speed_cycling_kmh": 12.0,
        "batch_size": 100, "modes": ["transit"], "departures": {"first": "03:00", "last": "22:00", "count": 229},
        "origins_sha256": "x", "n_origins": 1285, "origin_points_sha256": "p", "dest_points_sha256": "p",
        "n_destinations": 1285, "dest_point_rule": "D-017", "storage": {"dtype": "uint8"}}


# --------------------------------------------------------------------------- réglages et paramètres
def test_setting_limits_follow_config() -> None:
    assert ov.setting_limit_m("normal") == WALK_SETTINGS_M["normal"] == 3000
    assert ov.setting_limit_m("comfort") == WALK_SETTINGS_M["comfort"] == 1000
    with pytest.raises(ValueError):
        ov.setting_limit_m("r5_default")


def test_variant_dir_is_never_the_base_table(tmp_path: Path) -> None:
    assert ov.variant_dir(3000, tmp_path) == tmp_path / "od_walk3000"
    assert ov.variant_dir(1000, tmp_path).name != "od"


def test_variant_params_carry_jar_and_setting() -> None:
    p = ov.variant_params(BASE, JAR_3000, "normal", 50)
    assert p["walk_setting"] == "normal"
    assert p["walk_setting_nature"] == "choix de l'équipe (D-024), pas une donnée"
    assert p["walk_leg_limit_m"] == 3000 and p["max_time_walking_min"] == 50
    assert p["r5_jar_sha256"] == JAR_3000["r5_jar_sha256"]
    assert p["run"].startswith("04c_od_table_walk_setting")
    assert all(p[k] == BASE[k] for k in ov.SHARED_KEYS)


def test_variant_params_refuse_wrong_jar() -> None:
    with pytest.raises(ValueError, match="attendu 1000"):
        ov.variant_params(BASE, JAR_3000, "comfort", 17)


def test_base_compatible() -> None:
    v = ov.variant_params(BASE, JAR_3000, "normal", 50)
    assert ov.base_compatible(BASE, v) == []
    other_grid = {**v, "departures": {"first": "05:00", "last": "22:00", "count": 205}}
    assert any(e.startswith("departures") for e in ov.base_compatible(BASE, other_grid))
    assert any("ce n'est pas od/" in e for e in ov.base_compatible(v, v))
    assert any("walk_setting absent" in e for e in ov.base_compatible(BASE, BASE))


# --------------------------------------------------------------------------- verrous de lots
def test_claim_is_exclusive_between_processes(tmp_path: Path) -> None:
    npz = tmp_path / "transit" / "batch_0003.npz"
    assert ov.claim_lot(npz, pid=111, host="vm", alive=lambda pid: True)
    owner = json.loads(ov.lock_path(npz).read_text(encoding="utf-8"))
    assert owner["pid"] == 111 and owner["host"] == "vm"
    assert not ov.claim_lot(npz, pid=222, host="vm", alive=lambda pid: True)  # 111 vivant : refusé
    ov.release_lot(npz, pid=222)  # pas le propriétaire : sans effet
    assert ov.lock_path(npz).exists()
    ov.release_lot(npz, pid=111)
    assert not ov.lock_path(npz).exists()
    assert ov.claim_lot(npz, pid=222, host="vm", alive=lambda pid: True)


def test_orphan_lock_is_taken_over(tmp_path: Path) -> None:
    npz = tmp_path / "batch_0000.npz"
    assert ov.claim_lot(npz, pid=111, host="vm", alive=lambda pid: True)
    # VM arrêtée puis relancée : le processus 111 n'existe plus
    assert ov.claim_lot(npz, pid=333, host="vm", alive=lambda pid: False)
    assert json.loads(ov.lock_path(npz).read_text(encoding="utf-8"))["pid"] == 333


def test_lock_of_other_host_is_kept(tmp_path: Path) -> None:
    npz = tmp_path / "batch_0000.npz"
    assert ov.claim_lot(npz, pid=111, host="poste", alive=lambda pid: False)
    assert not ov.claim_lot(npz, pid=333, host="vm", alive=lambda pid: False)


def test_written_lot_is_never_claimed(tmp_path: Path) -> None:
    npz = tmp_path / "batch_0000.npz"
    npz.write_bytes(b"lot complet")
    assert not ov.claim_lot(npz, pid=1, host="vm", alive=lambda pid: True)
    assert not ov.lock_path(npz).exists()


def test_pid_alive_on_this_process() -> None:
    import os

    assert ov.pid_alive(os.getpid())


# --------------------------------------------------------------------------- fils de calcul
def test_read_threads(tmp_path: Path) -> None:
    f = tmp_path / "threads"
    assert ov.read_threads(4, None) == 4
    assert ov.read_threads(4, f) == 4  # fichier absent
    f.write_text("9\n", encoding="utf-8")
    assert ov.read_threads(4, f) == 9
    f.write_text("beaucoup", encoding="utf-8")
    assert ov.read_threads(4, f) == 4
    f.write_text("0", encoding="utf-8")
    assert ov.read_threads(4, f) == 1
    f.write_text("1000", encoding="utf-8")
    assert ov.read_threads(4, f) == ov.MAX_THREADS


# --------------------------------------------------------------------------- garde-fous du script (sans Java)
def run_04c(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(PIPELINE_DIR / "scripts" / "04c_compute_od_table.py"), *args],
                          check=False, capture_output=True, text=True, encoding="utf-8", cwd=PIPELINE_DIR,
                          timeout=300)


def test_bike_transit_only_in_bench() -> None:
    r = run_04c("--first-departure", "03:00", "--last-departure", "22:00", "--modes", "bike_transit", "--dry-run")
    assert r.returncode != 0 and "--bench seulement" in r.stderr


def test_setting_needs_jar() -> None:
    r = run_04c("--first-departure", "03:00", "--last-departure", "22:00", "--walk-setting", "normal", "--dry-run")
    assert r.returncode != 0 and "vont ensemble" in r.stderr


def test_base_table_cannot_write_into_a_variant_dir() -> None:
    target = ov.variant_dir(3000)
    r = run_04c("--first-departure", "03:00", "--last-departure", "22:00", "--out-dir", str(target), "--dry-run")
    assert r.returncode != 0 and "protégé" in r.stderr
