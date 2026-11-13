"""04 vers les 44 astres (D-030) : marche, vélo, voiture, sans toucher au dossier des 15 pôles.

Lance 04_compute_matrix.py (mêmes fonctions, mêmes paramètres de routage, mêmes lots reprenables) avec :
    --poles       data/processed/poles_d030.json (les 44 arrêts d'affichage), sauf autre fichier donné
    sorties       data/interim/matrix_modes_b44/ (lots, {mode}_{day}.csv, run_params.json) et
                  data/interim/access_modes_b44/ (access/{insee}.json), jamais data/interim/matrix ni access

C'est le même rôle que la copie `~/b44/repo/pipeline/scripts/04_compute_matrix_b44.py` de la VM (04/11, première
version : variable STARWAY_POLES_JSON, retirée par la PR 29), reportée ici en `--poles`. Les dossiers déjà écrits par
cette copie restent repris sans --fresh : `r5_transfers.reconcile_poles_params` lit `poles_json` comme `poles_file`.

Usage (les options de 04 suivent telles quelles) :
    python scripts/04_compute_matrix_b44.py --origins all --modes walk bike car --days d09 --batch-size 100 \\
        --max-memory 16G
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

from starway import r5_transfers
from starway.config import INTERIM_DIR, PIPELINE_DIR, PROCESSED_DIR

OUT_DIR = INTERIM_DIR / "matrix_modes_b44"
ACCESS_DIR = INTERIM_DIR / "access_modes_b44"
DEFAULT_POLES = PROCESSED_DIR / "poles_d030.json"


def load_04():
    """Charge scripts/04_compute_matrix.py comme module (son nom commence par un chiffre)."""
    spec = importlib.util.spec_from_file_location("compute_matrix_04", PIPELINE_DIR / "scripts" / "04_compute_matrix.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def split_args(argv: list[str]) -> tuple[Path, list[str]]:
    """Retire `--poles X` des arguments (le reste va à 04) ; défaut : poles_d030.json."""
    p = argparse.ArgumentParser(add_help=False)
    r5_transfers.add_poles_cli(p)
    known, rest = p.parse_known_args(argv)
    return (known.poles or DEFAULT_POLES).expanduser().resolve(), rest


def main(argv: list[str] | None = None) -> int:
    poles, rest = split_args(sys.argv[1:] if argv is None else argv)
    if not poles.exists():
        raise SystemExit(f"{poles} absent : le produire par scripts/03b_sky_groups.py (D-030)")
    m04 = load_04()
    m04.POLES_FILE = poles
    m04.OUT_DIR = OUT_DIR
    m04.BATCH_DIR = OUT_DIR / "batches"
    m04.ACCESS_DIR = ACCESS_DIR
    sys.argv = ["04_compute_matrix.py", *rest]
    return m04.main()


if __name__ == "__main__":
    raise SystemExit(main())
