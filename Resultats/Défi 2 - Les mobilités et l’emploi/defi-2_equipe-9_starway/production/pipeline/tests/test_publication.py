"""Tests de starway.publication (dossiers lus par 06 selon le ciel) et de la fusion des parties de vélo + TC."""

from __future__ import annotations

import json

import pandas as pd
import pytest

from starway import matrix_io as mio
from starway import publication as pub


def test_sky_inputs_44_uses_b44_dirs_and_both_bike_transit_parts(tmp_path) -> None:
    inp = pub.sky_inputs("44", "gtfs_navitia", tmp_path / "interim", tmp_path / "processed")
    assert inp.poles_file.name == "poles_d030.json"
    assert inp.main_dir.name == "matrix_modes_b44" and inp.velib_dir.name == "matrix_velib_b44"
    assert inp.car_dir.name == "car_dist_carspeed_v2_b44"
    assert sorted(d.name for d in inp.walk_dirs.values()) == ["matrix_walk1000_d031_b44", "matrix_walk3000_d031_b44"]
    assert [d.name for d in inp.story_dirs] == [
        "matrix_story_d031_b44", *(f"matrix_bike_transit_all_d031_b44_{p}" for p in ("a", "b1", "b2", "b3", "b4", "b5"))]
    assert not any(d.name.endswith("_b44_b") for d in inp.story_dirs)  # plus de dossier `_b` unique


def test_sky_inputs_44_refuses_original_engine(tmp_path) -> None:
    with pytest.raises(SystemExit):
        pub.sky_inputs("44", "r5", tmp_path, tmp_path)


def _write_run(d, params, batches=None) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / "run_params.json").write_text(json.dumps(params), encoding="utf-8")
    for sub, n in (batches or {}).items():
        (d / "batches" / sub).mkdir(parents=True, exist_ok=True)
        for k in range(n):
            (d / "batches" / sub / f"batch_{k:04d}.csv").write_text("x", encoding="utf-8")


def test_matrix_state_absent_partial_complete(tmp_path) -> None:
    d = tmp_path / "m"
    assert pub.matrix_state(d, "r", True, 250, ["d06"]).status == "absent"
    _write_run(d, {"n_origins": 250, "batch_size": 100}, {"transit_d06": 3, "transit_d09": 2})
    s = pub.matrix_state(d, "r", True, 250, [])
    assert s.status == "partiel" and "5 journées-lots sur 6" in s.detail
    (d / "batches" / "transit_d09" / "batch_0002.csv").write_text("x", encoding="utf-8")
    (d / "batches" / "transit_d09" / "batch_0003.csv.part").write_text("x", encoding="utf-8")  # .part ignoré
    assert pub.matrix_state(d, "r", True, 250, []).status == "complet"


def test_engine_problems_flags_mixed_engines_and_poles() -> None:
    a = pub.DirState("a", "r", True, "complet", params={"transfer_rules": "gtfs_navitia", "same_stop_csv_sha256": "s1",
                                                       "transfer_rules_patch_version": 1, "poles_json_sha256": "P"})
    b = pub.DirState("b", "r", True, "complet", params={"transfer_rules": "gtfs_navitia", "same_stop_csv_sha256": "s1",
                                                       "transfer_rules_patch_version": 1, "poles_sha256": "P"})
    assert pub.engine_problems([a, b], "P", None, {}) == []
    c = pub.DirState("c", "r", True, "complet", params={"transfer_rules": "gtfs_navitia", "same_stop_csv_sha256": "s2",
                                                       "transfer_rules_patch_version": 1, "poles_sha256": "Q"})
    errs = pub.engine_problems([a, b, c], "P", None, {})
    assert any("same_stop_csv_sha256" in e for e in errs) and any("c : fichier de pôles" in e for e in errs)


def _batch(origins, poles, offset=0) -> pd.DataFrame:
    rows = [{"from_id": o, "to_id": p, "out": 10 + offset, "dep": "08:00", "ret": 12, "reason": None}
            for o in origins for p in poles]
    return pd.DataFrame(rows)


def test_merge_keeps_identical_overlap_and_refuses_different() -> None:
    poles = ["P1", "P2"]
    a = mio.MatrixLoad(matrices={("bike_transit", "d09"): _batch(["1", "2"], poles)}, coverage={"bike_transit": ["1", "2"]})
    b = mio.MatrixLoad(matrices={("bike_transit", "d09"): _batch(["2", "3"], poles)}, coverage={"bike_transit": ["2", "3"]})
    m = mio.merge([a, b])
    assert sorted(m.matrices[("bike_transit", "d09")]["from_id"].unique()) == ["1", "2", "3"]
    assert len(m.matrices[("bike_transit", "d09")]) == 6 and m.coverage["bike_transit"] == ["1", "2", "3"]
    c = mio.MatrixLoad(matrices={("bike_transit", "d09"): _batch(["2"], poles, offset=1)}, coverage={"bike_transit": ["2"]})
    with pytest.raises(ValueError):
        mio.merge([a, c])
