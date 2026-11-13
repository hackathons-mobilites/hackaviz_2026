"""Export partiel des lots terminés (FIXTURE DE TEST synthétique dans tmp_path, jamais exportée)."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from starway.config import PROCESSING_VERSION
from starway.insights import kinds_status
from starway.matrix_io import check_run_params, load_published, partial_coverage, published, read_batches

POLES = ["P1", "P2"]
ORIGINS = ["A1", "A2", "B1", "B2", "C1"]  # lots de 2 : [A1, A2], [B1, B2], [C1]
SHA = {"TRA01": "g", "CYC01": "o"}


def _params(n: int = len(ORIGINS)) -> dict:
    return {"processing_version": PROCESSING_VERSION, "gtfs_sha256": "g", "osm_sha256": "o", "batch_size": 2,
            "n_origins": n}


def _lot(ids: list[str]) -> pd.DataFrame:
    rows = [{"from_id": i, "to_id": p, "out": 30, "dep": None, "ret": 40, "reason": None} for i in ids for p in POLES]
    return pd.DataFrame(rows)


def _run(tmp: Path, lots: dict[str, dict[int, list[str]]], params: dict | None = None) -> Path:
    run = tmp / "matrix"
    for scen, ks in lots.items():
        d = run / "batches" / scen
        d.mkdir(parents=True, exist_ok=True)
        for k, ids in ks.items():
            _lot(ids).to_csv(d / f"batch_{k:04d}.csv", index=False)
    run.mkdir(parents=True, exist_ok=True)
    (run / "run_params.json").write_text(json.dumps(params or _params()), encoding="utf-8")
    return run


def test_commune_published_only_when_all_days_present(tmp_path: Path) -> None:
    run = _run(tmp_path, {"transit_d06": {0: ["A1", "A2"], 1: ["B1", "B2"]}, "transit_d09": {0: ["A1", "A2"]},
                          "transit_d14": {0: ["A1", "A2"]}, "walk_any": {0: ["A1", "A2"]}})
    (run / "batches" / "transit_d09" / "batch_0001.part").write_text("from_id,to_id\nB1,P1\n", encoding="utf-8")
    ld = published(read_batches(run, POLES, ORIGINS))
    assert ld.coverage == {"transit": ["A1", "A2"], "walk": ["A1", "A2"]}  # B : d09 et d14 manquent, .part ignoré
    assert set(ld.matrices[("transit", "d06")]["from_id"]) == {"A1", "A2"}
    assert not ld.problems


def test_incomplete_or_misplaced_lot_is_ignored(tmp_path: Path) -> None:
    run = _run(tmp_path, {"walk_any": {0: ["A1", "A2"], 1: ["A1", "B2"]}})
    _lot(["C1"]).iloc[:1].to_csv(run / "batches" / "walk_any" / "batch_0002.csv", index=False)  # un pôle manque
    ld = read_batches(run, POLES, ORIGINS)
    assert ld.batches == {"walk_any": [0]} and len(ld.problems) == 2


def test_run_params_must_match_sources(tmp_path: Path) -> None:
    assert check_run_params(_params(), SHA) == []
    assert check_run_params({**_params(), "gtfs_sha256": "autre"}, SHA)
    _run(tmp_path, {"walk_any": {0: ["A1", "A2"]}}, {**_params(), "osm_sha256": "autre"})
    with pytest.raises(ValueError):
        load_published(POLES, ORIGINS, SHA, main_dir=tmp_path / "matrix", story_dir=tmp_path / "absent")


def test_partial_coverage_lists_every_incomplete_mode() -> None:
    cov = {"transit": ["A1", "A2"], "walk": ORIGINS}
    out = partial_coverage(cov, ["transit", "bike_transit", "walk"], ORIGINS)
    assert out == {"transit": ["A1", "A2"], "bike_transit": []}  # walk complet : absent


def test_insights_only_when_coverage_is_honest() -> None:
    partial = kinds_status({"transit": ["A1", "A2"]}, ORIGINS)
    assert all(v["status"] == "not_computed" and v["reason"] for v in partial.values())
    full = kinds_status({"transit": ORIGINS, "bike_transit": ["A1"]}, ORIGINS)
    assert full["eclipse"]["status"] == "ok" and full["bike_gain"]["status"] == "ok"
    assert kinds_status({"transit": ["A1"], "bike_transit": ["A1", "B1"]}, ORIGINS)["bike_gain"]["status"] \
        == "not_computed"


def test_durations_over_max_trip_become_no_trip_without_touching_the_lot(tmp_path: Path) -> None:
    from starway.matrix_io import cap_to_max_trip

    raw = pd.DataFrame({"from_id": ["75110", "75111", "75112"], "to_id": ["P_ORLY"] * 3,
                        "out": [122, 121, 40], "dep": [None, None, None], "ret": [None, 120, 41],
                        "reason": ["no_trip_within_120", None, None]})
    before = raw.copy()
    d = cap_to_max_trip(raw)
    assert raw.equals(before)  # copie : le lot lu n'est jamais modifié
    assert d["out"].isna().tolist() == [True, True, False]
    assert d["ret"].tolist()[1] == 120  # 120 = dans la borne, conservé
    assert d["reason"].tolist()[:2] == ["no_trip_within_120", "no_trip_within_120"] and pd.isna(d["reason"].iloc[2])


def test_build_access_exports_outbound_departure_as_hhmm() -> None:
    from starway.export import build_access, dep_hhmm

    assert dep_hhmm("2026-11-17 05:45:00") == "05:45" and dep_hhmm("08:05") == "08:05"
    assert dep_hhmm(None) is None and dep_hhmm(float("nan")) is None
    m = pd.DataFrame({"from_id": ["A", "A"], "to_id": ["P1", "P2"], "out": [14, None],
                      "dep": ["2026-11-17 05:45:00", None], "ret": [12, 30], "reason": [None, "no_trip_within_120"]})
    walk = m.assign(dep=None)
    a = build_access("A", POLES, {("transit", "d06"): m, ("walk", "any"): walk})["modes"]
    assert a["transit"]["d06"]["dep"] == ["05:45", None]
    assert "dep" not in a["walk"]["any"]  # modes sans horaire : pas de départ retenu


def test_insights_reason_is_plain_french_and_detail_is_separate() -> None:
    st = kinds_status({"transit": ["A1", "A2"]}, ORIGINS)["eclipse"]
    assert st["reason"] == "Les découvertes seront publiées quand toutes les communes seront calculées (2 sur 5 aujourd'hui)."
    assert "origines" not in st["reason"] and "INSEE" in st["detail"]


def _walk_params(limit: int = 3000) -> dict:
    return {**_params(), "origin_points_sha256": "pts", "walk_leg_limit_m": limit, "walk_distance_limit_meters": limit,
            "transfer_distance_limit_meters": 1000}


def test_load_walk_setting_checks_setting_and_jar(tmp_path: Path):
    from starway.matrix_io import load_walk_setting

    lots = {f"transit_{d}": {0: ["A1", "A2"], 1: ["B1", "B2"], 2: ["C1"]} for d in ("d06", "d09", "d14")}
    run = _run(tmp_path, lots, _walk_params())
    ld, params = load_walk_setting(run, POLES, ORIGINS, SHA, "pts", 3000)
    assert ld.coverage["transit"] == sorted(ORIGINS)
    assert params["walk_leg_limit_m"] == 3000
    with pytest.raises(ValueError):
        load_walk_setting(run, POLES, ORIGINS, SHA, "pts", 1000)  # autre réglage
    with pytest.raises(ValueError):
        load_walk_setting(run, POLES, ORIGINS, SHA, "autres_points", 3000)
    (run / "run_params.json").write_text(json.dumps({**_walk_params(), "walk_distance_limit_meters": 2000}),
                                         encoding="utf-8")
    with pytest.raises(ValueError):
        load_walk_setting(run, POLES, ORIGINS, SHA, "pts", 3000)  # jar différent du réglage


def test_load_velib_requires_complete_matrix_and_sources(tmp_path: Path):
    from starway.matrix_io import load_velib

    run = tmp_path / "matrix_velib"
    run.mkdir()
    rows = [{"from_id": o, "to_id": p, "out": 20, "dep": None, "ret": 25, "reason": None, "out_s1": "1"}
            for o in ("75101", "92007") for p in POLES]
    rows[0].update(out=130, ret=None, reason=None)  # > 120 : null + raison
    pd.DataFrame(rows).to_csv(run / "velib_any.csv", index=False)
    params = {"processing_version": PROCESSING_VERSION, "gtfs_sha256": "g", "osm_sha256": "o", "vel01_sha256": "v",
              "n_origins": 2}
    (run / "run_params.json").write_text(json.dumps(params), encoding="utf-8")
    ld, _ = load_velib(run, POLES, {**SHA, "VEL01": "v"})
    m = ld.matrices[("velib", "any")]
    assert ld.coverage["velib"] == ["75101", "92007"]
    first = m[(m.from_id == "75101") & (m.to_id == "P1")].iloc[0]
    assert pd.isna(first["out"]) and first["reason"] == "no_trip_within_120"
    with pytest.raises(ValueError):
        load_velib(run, POLES, {**SHA, "VEL01": "autre"})
