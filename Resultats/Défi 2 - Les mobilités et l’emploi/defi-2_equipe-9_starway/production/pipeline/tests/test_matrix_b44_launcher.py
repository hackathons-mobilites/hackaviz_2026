"""Tests sans Java du lanceur 04_compute_matrix_b44.py (44 astres : `--poles`, dossiers `_b44`)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "04_compute_matrix_b44.py"


def load():
    spec = importlib.util.spec_from_file_location("compute_matrix_b44", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_split_args_default_and_explicit_poles(tmp_path) -> None:
    m = load()
    poles, rest = m.split_args(["--origins", "all", "--modes", "walk"])
    assert poles == m.DEFAULT_POLES.resolve() and rest == ["--origins", "all", "--modes", "walk"]
    f = tmp_path / "p.json"
    poles, rest = m.split_args(["--poles", str(f), "--days", "d09"])
    assert poles == f.resolve() and rest == ["--days", "d09"]


def test_output_dirs_are_never_the_published_ones() -> None:
    m = load()
    assert m.OUT_DIR.name == "matrix_modes_b44" and m.ACCESS_DIR.name == "access_modes_b44"
