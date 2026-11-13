"""Calculs r5py complémentaires (décision D-014) : vélo + TC sur les communes du récit et leurs communes limitrophes.

Logique pure (sans r5py) utilisée par scripts/04b_compute_story_matrix.py, testée dans tests/test_runs.py.
"""

from __future__ import annotations

import csv
from collections.abc import Iterable
from pathlib import Path

from starway.config import INTERIM_DIR

MAIN_MATRIX_DIR = INTERIM_DIR / "matrix"  # calcul complet (04) : ne jamais y écrire depuis 04b
STORY_MATRIX_DIR = INTERIM_DIR / "matrix_story"
STORY_ACCESS_DIR = INTERIM_DIR / "access_story"


def read_origins_file(path: Path) -> list[str]:
    """Codes INSEE d'un fichier texte (un code par ligne, `#` = commentaire) ou CSV avec une colonne `insee`."""
    text = path.read_text(encoding="utf-8-sig")
    lines = [ln.split("#", 1)[0].strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    if lines and "insee" in [c.strip() for c in lines[0].split(",")]:
        rows = csv.DictReader(ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#"))
        codes = [r["insee"].strip() for r in rows if r.get("insee", "").strip()]
    else:
        codes = lines
    if not codes:
        raise ValueError(f"{path} : aucun code INSEE")
    bad = [c for c in codes if not (len(c) == 5 and c[:2].isdigit())]
    if bad:
        raise ValueError(f"{path} : codes INSEE invalides {bad[:5]}")
    return sorted(set(codes))


def with_neighbours(codes: Iterable[str], adjacency: Iterable[tuple[str, str]]) -> list[str]:
    """Codes + leurs communes limitrophes (couples de contiguïté GEO01, `data/processed/adjacency_2026.csv`)."""
    base = set(codes)
    out = set(base)
    for a, b in adjacency:
        if a in base:
            out.add(b)
        if b in base:
            out.add(a)
    return sorted(out)


def read_adjacency(path: Path) -> list[tuple[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return [(r["insee_a"], r["insee_b"]) for r in csv.DictReader(f)]


def check_separate_dirs(out_dir: Path, access_dir: Path) -> None:
    """Refuse toute sortie dans (ou au-dessus de) le dossier du calcul complet ou de ses access/."""
    protected = [MAIN_MATRIX_DIR.resolve(), (INTERIM_DIR / "access").resolve()]
    for d in (out_dir.resolve(), access_dir.resolve()):
        for p in protected:
            if d == p or p.is_relative_to(d) or d.is_relative_to(p):
                raise SystemExit(f"dossier de sortie {d} confondu avec le calcul complet ({p}) : choisir un autre "
                                 "dossier (défaut : data/interim/matrix_story)")
