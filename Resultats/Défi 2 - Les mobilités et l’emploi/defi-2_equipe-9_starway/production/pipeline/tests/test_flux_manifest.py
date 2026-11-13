"""Mise à jour du manifeste pour le flux du 06/11 et contrôle de la livraison : fichiers synthétiques, constantes du flux
substituées par des valeurs de test (les vraies empreintes ne se fabriquent pas)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from starway import f06_delivery as fd
from starway import flux
from starway import flux_manifest as fm

NEW = {"TRA01": "a" * 64, "TRA01B": "b" * 64, "TRA01C": "c" * 64}
OLD = {"TRA01": "1" * 64, "TRA01B": "2" * 64, "TRA01C": "3" * 64}
PATHS = {"TRA01": "data/raw/TRA01/IDFM-gtfs-0611.zip", "TRA01B": "data/raw/TRA01B/gtfs_nuit-0611.zip",
         "TRA01C": "data/raw/TRA01C/gtfs_soir-0611.zip"}
DATES = {"TRA01": "2026-11-06T15:11Z", "TRA01B": "2026-11-09T08:00Z", "TRA01C": "2026-11-09T08:30Z"}


@pytest.fixture(autouse=True)
def f06_constants(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(flux, "F06_TRA01_SHA256", NEW["TRA01"])
    monkeypatch.setattr(flux, "F06_DERIVED_PREFIXES", {"TRA01B": "bbbb", "TRA01C": "cccc"})


def manifest_rows() -> list[dict[str, str]]:
    old_files = {"TRA01": "data/raw/TRA01/IDFM-gtfs.zip", "TRA01B": "data/raw/TRA01B/gtfs_nuit.zip",
                 "TRA01C": "data/raw/TRA01C/gtfs_soir.zip"}
    return [{"source_id": s, "sha256": OLD[s], "fichier_local": old_files[s], "date_extraction": "2026-11-02T14:15Z",
             "titre": "t", "traitements": "2 705 courses ajoutées", "controles": "c", "limites": "l"} for s in flux.GTFS_SOURCES]


def test_update_keeps_the_replaced_rows_and_writes_the_new_ones() -> None:
    rows, previous = fm.update_rows(manifest_rows(), NEW, PATHS, DATES, replaced_on="2026-11-10", trips_on_day=1234)
    by = {r["source_id"]: r for r in rows}
    assert {s: by[s]["sha256"] for s in flux.GTFS_SOURCES} == NEW
    assert {s: by[s]["fichier_local"] for s in flux.GTFS_SOURCES} == PATHS
    assert by["TRA01"]["date_extraction"] == "2026-11-06T15:11Z" and "1234 courses actives" in by["TRA01"]["date_service_transport"]
    assert {p["source_id"]: p["sha256"] for p in previous} == OLD          # rien n'est perdu
    assert all(p["fichier_local"].endswith(".zip") and "-0611" not in p["fichier_local"] for p in previous)
    # les anciens nombres du flux du 02/11 ne restent pas dans les lignes dérivées
    assert "2 705" not in by["TRA01B"]["traitements"] and "2 705" not in by["TRA01C"]["traitements"]


def test_no_course_count_is_written_unless_measured() -> None:
    rows, _ = fm.update_rows(manifest_rows(), NEW, PATHS, DATES, replaced_on="d")
    b = next(r for r in rows if r["source_id"] == "TRA01B")
    assert "voir le journal des contrôles" in b["traitements"] and "mesuré" not in b["traitements"]
    rows, _ = fm.update_rows(manifest_rows(), NEW, PATHS, DATES, replaced_on="d", stats={"TRA01B": "10 courses et 20 arrêts"})
    assert "mesuré dans le fichier livré : 10 courses et 20 arrêts" in next(r for r in rows if r["source_id"] == "TRA01B")["traitements"]


def test_update_is_idempotent() -> None:
    rows, _ = fm.update_rows(manifest_rows(), NEW, PATHS, DATES, replaced_on="d")
    again, previous = fm.update_rows(rows, NEW, PATHS, DATES, replaced_on="d")
    assert again == rows and previous == []


@pytest.mark.parametrize("bad", [
    {"TRA01": "d" * 64},                           # pas le flux figé
    {"TRA01B": "bbbb" + "0" * 10},                 # début seulement : jamais une empreinte incomplète
    {"TRA01C": "e" * 64},                          # ne commence pas par le début annoncé
    {"TRA01C": "b" * 64},                          # empreintes non distinctes
])
def test_refuses_a_wrong_or_incomplete_hash(bad: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        fm.update_rows(manifest_rows(), {**NEW, **bad}, PATHS, DATES, replaced_on="d")


def test_refuses_to_reuse_the_name_of_the_old_file() -> None:
    same_name = {**PATHS, "TRA01": "data/raw/TRA01/IDFM-gtfs.zip"}
    with pytest.raises(ValueError, match="nom de l'ancien"):
        fm.update_rows(manifest_rows(), NEW, same_name, DATES, replaced_on="d")


def test_relative_to_raw_refuses_files_outside_the_source_folder(tmp_path: Path) -> None:
    (tmp_path / "TRA01").mkdir()
    ok = tmp_path / "TRA01" / "IDFM-gtfs-0611.zip"
    ok.write_bytes(b"x")
    assert fm.relative_to_raw(ok, tmp_path, "TRA01") == "data/raw/TRA01/IDFM-gtfs-0611.zip"
    with pytest.raises(ValueError):
        fm.relative_to_raw(tmp_path / "ailleurs.zip", tmp_path, "TRA01")


# --------------------------------------------------------------------------- livraison
def make_dir(root: Path, name: str, gtfs: str, extra: list[str] = (), batches: int | None = None) -> Path:
    d = root / name
    d.mkdir(parents=True)
    params = {"gtfs_sha256": gtfs, "n_origins": 50, "batch_size": 25}
    (d / "run_params.json").write_text(json.dumps(params), encoding="utf-8")
    if batches is not None:
        for day in ("bike_transit_d06", "bike_transit_d09", "bike_transit_d14"):
            (d / "batches" / day).mkdir(parents=True)
            for k in range(batches):
                (d / "batches" / day / f"batch_{k:04d}.csv").write_text("x", encoding="utf-8")
    for e in extra:
        (d / e).parent.mkdir(parents=True, exist_ok=True)
        (d / e).write_text("x", encoding="utf-8")
    return d


def test_the_expected_dirs_keep_today_s_names() -> None:
    assert "matrix_walk3000_d031_b44" in fd.EXPECTED_DIRS and "od_walk1000_d031_nuit_soir_v2" in fd.EXPECTED_DIRS
    assert "matrix_story_d031_b44" in fd.EXPECTED_DIRS and "matrix_bike_transit_all_d031_b44_b5" in fd.EXPECTED_DIRS
    assert len(fd.EXPECTED_DIRS) == len(set(fd.EXPECTED_DIRS)) == 21
    assert all(not n.endswith(("_new", "_f06", "_0611")) for n in fd.EXPECTED_DIRS)


def test_a_complete_dir_on_its_network_is_accepted(tmp_path: Path) -> None:
    old = make_dir(tmp_path / "old", "matrix_walk3000_d031_b44", OLD["TRA01"], ["transit_d06.csv"])
    new = make_dir(tmp_path / "new", "matrix_walk3000_d031_b44", NEW["TRA01"], ["transit_d06.csv", "plus.txt"])
    assert fd.check_dir("matrix_walk3000_d031_b44", new, old, NEW).ok


def test_an_incomplete_dir_or_a_part_file_is_refused(tmp_path: Path) -> None:
    old = make_dir(tmp_path / "old", "matrix_walk3000_d031_b44", OLD["TRA01"], ["transit_d06.csv", "batches/x/batch_0001.csv"])
    missing = make_dir(tmp_path / "n1", "matrix_walk3000_d031_b44", NEW["TRA01"], ["transit_d06.csv"])
    assert any("absents du nouveau" in p for p in fd.check_dir("matrix_walk3000_d031_b44", missing, old, NEW).problems)
    part = make_dir(tmp_path / "n2", "matrix_walk3000_d031_b44", NEW["TRA01"],
                    ["transit_d06.csv", "batches/x/batch_0001.csv", "batches/x/batch_0002.csv.part"])
    assert any("en cours d'écriture" in p for p in fd.check_dir("matrix_walk3000_d031_b44", part, old, NEW).problems)
    assert not fd.check_dir("matrix_walk3000_d031_b44", None, old, NEW).ok


def test_each_dir_must_carry_the_hash_of_its_own_network(tmp_path: Path) -> None:
    day_on_old = make_dir(tmp_path / "a", "matrix_walk3000_d031_b44", OLD["TRA01"])
    assert any("gtfs_sha256" in p for p in fd.check_dir("matrix_walk3000_d031_b44", day_on_old, None, NEW).problems)
    night = make_dir(tmp_path / "b", "itineraries_walk3000_d031_nuit_b44", NEW["TRA01B"])
    assert fd.check_dir("itineraries_walk3000_d031_nuit_b44", night, None, NEW).ok
    evening = make_dir(tmp_path / "c", "od_walk3000_d031_nuit_soir_v2", NEW["TRA01B"])  # soir sur le réseau de nuit : refusé
    assert not fd.check_dir("od_walk3000_d031_nuit_soir_v2", evening, None, NEW).ok


def test_bike_transit_is_expected_on_the_night_network_with_all_its_lots(tmp_path: Path) -> None:
    full = make_dir(tmp_path / "a", "matrix_bike_transit_all_d031_b44_a", NEW["TRA01B"], batches=2)
    assert fd.check_dir("matrix_bike_transit_all_d031_b44_a", full, None, NEW).ok
    short = make_dir(tmp_path / "b", "matrix_bike_transit_all_d031_b44_b1", NEW["TRA01B"], batches=1)
    assert any("1 lots sur 2" in p for p in fd.check_dir("matrix_bike_transit_all_d031_b44_b1", short, None, NEW).problems)
    on_day = make_dir(tmp_path / "c", "matrix_story_d031_b44", NEW["TRA01"], batches=2)  # ni TRA01 ni l'ancien flux
    assert not fd.check_dir("matrix_story_d031_b44", on_day, None, NEW).ok


def test_sha256_list_of_the_archive(tmp_path: Path) -> None:
    f = tmp_path / "dossier" / "a.csv"
    f.parent.mkdir()
    f.write_bytes(b"abc")
    good = fd.sha256_file(f)
    assert fd.check_sums(tmp_path, fd.parse_sums(f"{good}  dossier/a.csv\n{good} *dossier/a.csv\n# note\n")) == []
    assert fd.check_sums(tmp_path, fd.parse_sums("0" * 64 + "  dossier/a.csv\n" + good + "  absent.csv\n")) == [
        "sha256 différent : dossier/a.csv", "absent : absent.csv"]


def test_find_dir_accepts_the_usual_archive_layouts(tmp_path: Path) -> None:
    (tmp_path / "interim" / "x").mkdir(parents=True)
    (tmp_path / "data" / "interim" / "y").mkdir(parents=True)
    assert fd.find_dir(tmp_path, "x") == tmp_path / "interim" / "x"
    assert fd.find_dir(tmp_path, "y") == tmp_path / "data" / "interim" / "y"
    assert fd.find_dir(tmp_path, "z") is None
