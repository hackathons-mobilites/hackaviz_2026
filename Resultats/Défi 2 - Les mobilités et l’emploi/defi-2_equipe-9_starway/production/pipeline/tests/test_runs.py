"""Second calcul vélo + TC (04b) : liste d'origines, communes limitrophes, dossiers séparés du calcul complet."""

from __future__ import annotations

from pathlib import Path

import pytest

from starway.config import INTERIM_DIR
from starway.runs import STORY_ACCESS_DIR, STORY_MATRIX_DIR, check_separate_dirs, read_origins_file, with_neighbours


def test_read_origins_text_and_csv(tmp_path: Path) -> None:
    txt = tmp_path / "o.txt"
    txt.write_text("# communes du récit (fixture de test)\n93048\n77284  # Meaux\n\n93048\n", encoding="utf-8")
    assert read_origins_file(txt) == ["77284", "93048"]
    csv_ = tmp_path / "o.csv"
    csv_.write_text("insee,name\n77222,Guignes\n75101,Paris 1er\n", encoding="utf-8")
    assert read_origins_file(csv_) == ["75101", "77222"]


@pytest.mark.parametrize("content", ["", "# rien\n", "9304\n", "abcde\n"])
def test_read_origins_rejects_empty_or_invalid(tmp_path: Path, content: str) -> None:
    f = tmp_path / "bad.txt"
    f.write_text(content, encoding="utf-8")
    with pytest.raises(ValueError):
        read_origins_file(f)


def test_with_neighbours_is_symmetric_and_one_ring_only() -> None:
    adj = [("A", "B"), ("B", "C"), ("D", "A")]
    assert with_neighbours(["A"], adj) == ["A", "B", "D"]  # C est voisin de B, pas de A : non ajouté
    assert with_neighbours(["C"], adj) == ["B", "C"]


def test_output_dirs_never_overlap_the_running_full_matrix(tmp_path: Path) -> None:
    check_separate_dirs(STORY_MATRIX_DIR, STORY_ACCESS_DIR)  # défauts : acceptés
    check_separate_dirs(tmp_path / "m", tmp_path / "a")
    for bad in (INTERIM_DIR / "matrix", INTERIM_DIR / "matrix" / "sub", INTERIM_DIR, INTERIM_DIR / "access"):
        with pytest.raises(SystemExit):
            check_separate_dirs(bad, tmp_path / "a")
    with pytest.raises(SystemExit):
        check_separate_dirs(tmp_path / "m", INTERIM_DIR / "access")
