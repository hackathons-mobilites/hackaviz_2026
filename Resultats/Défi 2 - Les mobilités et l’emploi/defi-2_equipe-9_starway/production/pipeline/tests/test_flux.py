"""Flux GTFS : empreintes lues dans le manifeste seul, réseau du vélo + TC, flux précédent accepté sans transport."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest

from starway import flux
from starway import matrix_io as mio
from starway import publication as pub
from starway.config import PROCESSING_VERSION

OLD = "1" * 64          # empreintes fictives de test
NEW_TRA01 = flux.F06_TRA01_SHA256
B_NEW = flux.F06_DERIVED_PREFIXES["TRA01B"] + "b" * 56
C_NEW = flux.F06_DERIVED_PREFIXES["TRA01C"] + "c" * 56
CYC = "9" * 64


def write_manifest(path: Path, tra01=OLD, tra01b="2" * 64, tra01c="3" * 64) -> Path:
    cols = ["source_id", "fichier_local", "sha256"]
    rows = [("TRA01", "data/raw/TRA01/IDFM-gtfs.zip", tra01), ("TRA01B", "data/raw/TRA01B/gtfs_nuit.zip", tra01b),
            ("TRA01C", "data/raw/TRA01C/gtfs_soir.zip", tra01c), ("CYC01", "data/raw/CYC01/x.pbf", CYC)]
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(cols)
        w.writerows(rows)
    return path


def test_hashes_and_files_come_from_the_manifest_only(tmp_path: Path) -> None:
    m = write_manifest(tmp_path / "m.csv")
    assert flux.manifest_sha(m) == {"TRA01": OLD, "TRA01B": "2" * 64, "TRA01C": "3" * 64}
    assert flux.gtfs_path("TRA01B", m, tmp_path / "raw") == tmp_path / "raw" / "TRA01B" / "gtfs_nuit.zip"
    with pytest.raises(KeyError):
        flux.gtfs_path("TRA09", m)


def test_a_manifest_path_outside_data_raw_is_refused(tmp_path: Path) -> None:
    m = tmp_path / "m.csv"
    m.write_text("source_id,fichier_local,sha256\nTRA01,ailleurs/IDFM-gtfs.zip," + OLD + "\n", encoding="utf-8")
    with pytest.raises(ValueError):
        flux.gtfs_path("TRA01", m)


def test_the_real_manifest_gives_existing_paths_names() -> None:
    for sid in flux.GTFS_SOURCES:
        assert flux.gtfs_path(sid).name.endswith(".zip")


def test_an_incomplete_hash_is_never_accepted() -> None:
    assert flux.incomplete_problems({"TRA01": OLD, "TRA01B": "3e38b797", "TRA01C": "3" * 64}) != []
    assert flux.incomplete_problems({"TRA01": ("ab" * 32).upper(), "TRA01B": "2" * 64, "TRA01C": "3" * 64}) != []  # minuscules
    assert flux.incomplete_problems({"TRA01": OLD, "TRA01B": "2" * 64, "TRA01C": "3" * 64}) == []
    assert not flux.is_complete_sha(None) and not flux.is_complete_sha("e990deba")


def test_the_f06_regime_needs_the_announced_prefixes_and_complete_hashes() -> None:
    good = {"TRA01": NEW_TRA01, "TRA01B": B_NEW, "TRA01C": C_NEW}
    assert flux.f06_active(good) and flux.f06_problems(good) == []
    assert not flux.f06_active({"TRA01": OLD}) and flux.f06_problems({"TRA01": OLD}) == []
    assert flux.f06_problems({**good, "TRA01B": "0" * 64})
    assert flux.f06_problems({**good, "TRA01C": flux.F06_DERIVED_PREFIXES["TRA01C"]})  # un début n'est pas une empreinte
    assert flux.f06_problems({**good, "TRA01C": B_NEW})  # trois empreintes distinctes


def test_the_frozen_flux_hash_is_the_one_of_the_decision() -> None:
    assert flux.F06_TRA01_SHA256.startswith("e990deba") and flux.is_complete_sha(flux.F06_TRA01_SHA256)
    assert flux.F06_DERIVED_PREFIXES == {"TRA01B": "3e38b797", "TRA01C": "bf02daf3"}


# --------------------------------------------------------------------------- méthode : le réseau de chaque dossier
def test_bike_transit_moves_to_the_night_network_only_with_the_new_flux() -> None:
    before, after = {"TRA01": OLD}, {"TRA01": NEW_TRA01}
    for name in ("matrix_story_d031_b44", "matrix_bike_transit_all_d031_b44_a", "matrix_bike_transit_all_d031_b44_b5"):
        assert pub.gtfs_source_of(name, before) == "TRA01"
        assert pub.gtfs_source_of(name, after) == "TRA01B"
    # le reste ne change pas : jour TRA01, nuit TRA01B, soir TRA01C
    for sha in (before, after):
        assert pub.gtfs_source_of("matrix_walk3000_d031_b44", sha) == "TRA01"
        assert pub.gtfs_source_of("itineraries_walk1000_d031_nuit_b44", sha) == "TRA01B"
        assert pub.gtfs_source_of("od_walk3000_d031_nuit_matin", sha) == "TRA01B"
        assert pub.gtfs_source_of("od_walk3000_d031_nuit_soir_v2", sha) == "TRA01C"


def test_non_transit_dirs_are_recognised() -> None:
    for name in ("matrix_modes_b44", "matrix_velib_b44", "car_dist_carspeed_v2_b44", "od"):
        assert flux.is_non_transit_dir(name) and not flux.is_bike_transit_dir(name)
    for name in ("matrix_walk3000_d031_b44", "od_walk3000_d031", "matrix_story_d031_b44"):
        assert not flux.is_non_transit_dir(name)


# --------------------------------------------------------------------------- flux précédent : sans transport seulement
@pytest.fixture
def previous(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    p = tmp_path / "precedents.csv"
    p.write_text(",".join(flux.PREVIOUS_COLUMNS) + f"\nTRA01,{OLD},2026-11-02T14:15Z,data/raw/TRA01/IDFM-gtfs.zip,2026-11-10,test\n"
                 f"TRA01B,{'4' * 64},2026-11-05T10:36Z,data/raw/TRA01B/gtfs_nuit.zip,2026-11-10,test\n", encoding="utf-8")
    monkeypatch.setattr(flux, "PREVIOUS_PATH", p)
    return p


def test_previous_flux_is_accepted_for_non_transit_only(previous: Path) -> None:
    sha = {"TRA01": NEW_TRA01, "TRA01B": B_NEW, "TRA01C": C_NEW}
    assert flux.previous_shas("TRA01") == {OLD}  # TRA01B n'est pas un flux accepté nulle part
    assert OLD in flux.accepted_gtfs_shas("TRA01", sha, non_transit=True)
    assert OLD not in flux.accepted_gtfs_shas("TRA01", sha)
    assert OLD not in flux.accepted_gtfs_shas("TRA01B", sha, non_transit=True)
    (row,) = [r for r in flux.previous_manifest_rows() if r["source_id"] == "TRA01"]
    assert row["fichier_local"].endswith(flux.PREVIOUS_FLAG) and row["sha256"] == OLD


def params(gtfs: str) -> dict:
    return {"processing_version": PROCESSING_VERSION, "gtfs_sha256": gtfs, "osm_sha256": CYC}


def test_run_params_check_per_kind_of_directory(previous: Path) -> None:
    sha = {"TRA01": NEW_TRA01, "TRA01B": B_NEW, "TRA01C": C_NEW, "CYC01": CYC}
    # transports de jour : seulement le flux du manifeste
    assert mio.check_run_params(params(NEW_TRA01), sha) == []
    assert mio.check_run_params(params(OLD), sha)
    # sans transport : le flux précédent reste accepté
    assert mio.check_run_params(params(OLD), sha, non_transit=True) == []
    # vélo + TC : réseau de nuit, jamais le flux de jour ni l'ancien
    assert mio.check_run_params(params(B_NEW), sha, flux.bike_transit_source(sha)) == []
    assert mio.check_run_params(params(NEW_TRA01), sha, flux.bike_transit_source(sha))
    assert mio.check_run_params(params(OLD), sha, flux.bike_transit_source(sha))


def write_run(d: Path, gtfs: str) -> None:
    (d / "batches" / "bike_transit_d06").mkdir(parents=True)
    (d / "run_params.json").write_text(json.dumps(params(gtfs) | {"n_origins": 1, "batch_size": 25}), encoding="utf-8")


def test_load_published_reads_bike_transit_on_the_network_of_the_method(previous: Path, tmp_path: Path) -> None:
    sha = {"TRA01": NEW_TRA01, "TRA01B": B_NEW, "TRA01C": C_NEW, "CYC01": CYC}
    main, story = tmp_path / "matrix_modes_b44", tmp_path / "matrix_story_d031_b44"
    write_run(main, OLD)       # marche, vélo, voiture : non relancés, flux précédent
    write_run(story, B_NEW)    # vélo + TC : réseau de nuit du nouveau flux
    assert mio.load_published(["P1"], ["75101"], sha, main_dir=main, story_dirs=[story]).problems == []
    story_old = tmp_path / "story_old" / "matrix_story_d031_b44"
    write_run(story_old, OLD)  # vélo + TC calculé sur l'ancien flux : refusé
    with pytest.raises(ValueError, match="incohérent"):
        mio.load_published(["P1"], ["75101"], sha, main_dir=main, story_dirs=[story_old])
    # avant le flux du 06/11, le même dossier sur l'ancien flux reste lu comme avant
    before = {"TRA01": OLD, "TRA01B": "2" * 64, "TRA01C": "3" * 64, "CYC01": CYC}
    assert mio.load_published(["P1"], ["75101"], before, main_dir=main, story_dirs=[story_old]).problems == []
