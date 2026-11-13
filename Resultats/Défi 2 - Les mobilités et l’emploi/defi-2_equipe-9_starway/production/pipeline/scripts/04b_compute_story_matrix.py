"""04b - Second calcul r5py (décision D-014) : vélo + TC pour les communes du récit et leurs communes limitrophes.

Réutilise la logique de 04_compute_matrix.py (mêmes fonctions, mêmes paramètres de routage, même reprise par lots)
mais écrit dans des dossiers SÉPARÉS, pour ne jamais mélanger ses lots avec ceux du calcul complet :
    data/interim/matrix_story/   batches/, {mode}_{day}.csv, run_params.json (propre à ce calcul), run_log.jsonl
    data/interim/access_story/   access/{insee}.json de ce calcul (modes calculés ici seulement)
06_export_front.py fusionne ensuite les deux matrices (le vélo + TC n'existe que pour ces origines).

Usage (ne PAS lancer pendant le calcul complet : la mémoire du poste ne permet pas deux JVM R5, cf. D-014) :
    python scripts/04b_compute_story_matrix.py --origins-file data/processed/story_communes.txt --dry-run
    python scripts/04b_compute_story_matrix.py --origins-file data/processed/story_communes.txt
Fichier d'origines : un code INSEE par ligne (`#` = commentaire) ou CSV avec une colonne `insee`.
Par défaut, les communes limitrophes (data/processed/adjacency_2026.csv) sont ajoutées ; --no-neighbours pour
ne calculer que la liste fournie.
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import importlib.util
import os
import sys
from pathlib import Path

import pandas as pd
import psutil

from starway import r5_transfers
from starway.config import DAY_TYPES_BY_ID, PIPELINE_DIR, PROCESSED_DIR, R5_MAX_MEMORY, REPO_ROOT
from starway.r5jar import jar_info
from starway.runs import (
    STORY_ACCESS_DIR,
    STORY_MATRIX_DIR,
    check_separate_dirs,
    read_adjacency,
    read_origins_file,
    with_neighbours,
)


def load_04():
    """Charge scripts/04_compute_matrix.py comme module (son nom commence par un chiffre)."""
    spec = importlib.util.spec_from_file_location("compute_matrix_04", PIPELINE_DIR / "scripts" / "04_compute_matrix.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def other_r5_runs() -> list[int]:
    """PID des autres processus qui exécutent 04_compute_matrix.py (calcul complet en cours)."""
    pids = []
    for p in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmd = " ".join(p.info["cmdline"] or [])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if "04_compute_matrix.py" in cmd and p.info["pid"] != os.getpid():
            pids.append(p.info["pid"])
    return pids


def heap_bytes(spec: str) -> int:
    units = {"K": 1 << 10, "M": 1 << 20, "G": 1 << 30}
    return int(float(spec[:-1]) * units[spec[-1].upper()]) if spec[-1].upper() in units else int(spec)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--origins-file", type=Path, required=True)
    p.add_argument("--no-neighbours", action="store_true", help="n'ajoute pas les communes limitrophes")
    p.add_argument("--modes", nargs="*", default=["bike_transit"])
    p.add_argument("--days", nargs="*", default=["d06", "d09", "d14"], choices=list(DAY_TYPES_BY_ID))
    p.add_argument("--out-dir", type=Path, default=STORY_MATRIX_DIR)
    p.add_argument("--access-dir", type=Path, default=STORY_ACCESS_DIR)
    p.add_argument("--batch-size", type=int, default=100, help="origines par lot (même valeur que 04)")
    p.add_argument("--max-memory", default=R5_MAX_MEMORY)
    p.add_argument("--fresh", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--allow-concurrent", action="store_true",
                   help="autorise le lancement alors qu'un 04_compute_matrix.py tourne (déconseillé, mémoire)")
    p.add_argument("--r5-jar", type=Path, default=None,
                   help="jar R5 externe (D-031 : r5-v7.5.1-r5py-walk2000-d031-all.jar, même marche que le jar r5py)")
    p.add_argument("--cache-home", type=Path, default=None, help="XDG_CACHE_HOME du réseau de ce jar (cache copié à part)")
    r5_transfers.add_cli(p)
    r5_transfers.add_poles_cli(p)
    args = p.parse_args()
    if args.transfer_rules != "r5" and (args.r5_jar is None or args.cache_home is None):
        raise SystemExit("--transfer-rules : donner --r5-jar (jar corrigé) et --cache-home (cache séparé)")
    new_dirs = {(REPO_ROOT / args.out_dir).resolve(), (REPO_ROOT / args.access_dir).resolve()}
    if (args.transfer_rules != "r5" or r5_transfers.poles_params(args.poles)) and (
            {STORY_MATRIX_DIR.resolve(), STORY_ACCESS_DIR.resolve()} & new_dirs):
        raise SystemExit("--transfer-rules ou --poles : donner --out-dir et --access-dir (dossiers neufs)")

    out_dir = args.out_dir if args.out_dir.is_absolute() else REPO_ROOT / args.out_dir
    access_dir = args.access_dir if args.access_dir.is_absolute() else REPO_ROOT / args.access_dir
    check_separate_dirs(out_dir, access_dir)
    origins_file = args.origins_file if args.origins_file.is_absolute() else REPO_ROOT / args.origins_file
    base = read_origins_file(origins_file)
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    valid = set(communes[communes["is_origin"]]["insee"])
    unknown = sorted(set(base) - valid)
    if unknown:
        raise SystemExit(f"origines inconnues (ni commune hors Paris ni arrondissement) : {unknown}")
    origins = base if args.no_neighbours else with_neighbours(base, read_adjacency(PROCESSED_DIR / "adjacency_2026.csv"))
    print(f"{len(base)} communes fournies -> {len(origins)} origines"
          + ("" if args.no_neighbours else " (avec les communes limitrophes)"))

    if not args.dry_run:
        running = other_r5_runs()
        if running and not args.allow_concurrent:
            raise SystemExit(f"calcul complet en cours (PID {running}) : attendre sa fin (D-014, mémoire)")
        avail = psutil.virtual_memory().available
        if avail < heap_bytes(args.max_memory):
            raise SystemExit(f"{avail / 2**30:.1f} Go disponibles < heap JVM demandée {args.max_memory}")

    jar = None if args.r5_jar is None else args.r5_jar.expanduser().resolve()
    tr_params = r5_transfers.run_params(args.transfer_rules, jar, args.same_stop_csv.expanduser().resolve())
    jinfo = {} if jar is None else jar_info(jar)
    if args.cache_home is not None:  # à fixer AVANT tout import de r5py
        ch = args.cache_home.expanduser().resolve()
        ch.mkdir(parents=True, exist_ok=True)
        os.environ["XDG_CACHE_HOME"] = str(ch)
        if "LOCALAPPDATA" in os.environ:
            os.environ["LOCALAPPDATA"] = str(ch)
    m04 = load_04()
    if args.poles is not None:
        m04.POLES_FILE = args.poles.expanduser().resolve()
    if jar is not None:
        from starway import routing

        m04.configure_java = functools.partial(routing.configure_java, r5_classpath=jar)
    r5_transfers.configure(args.transfer_rules, m04.GTFS, args.same_stop_csv.expanduser().resolve(),
                           out_dir / "transfer_rules_log.jsonl")
    m04.OUT_DIR = out_dir
    m04.BATCH_DIR = out_dir / "batches"
    m04.ACCESS_DIR = access_dir
    base_params = m04.run_params

    def run_params(a: argparse.Namespace, o: list[str], points_sha: str | None = None) -> dict:
        return {**base_params(a, o, points_sha), "run": "04b_story",
                "origins_file": origins_file.relative_to(REPO_ROOT).as_posix()
                if origins_file.is_relative_to(REPO_ROOT) else str(origins_file),
                "origins_file_sha256": hashlib.sha256(origins_file.read_bytes()).hexdigest(),
                "with_neighbours": not args.no_neighbours,
                **({} if jar is None else {"r5_jar": jinfo["r5_jar"], "r5_jar_sha256": jinfo["r5_jar_sha256"],
                                           "r5_version": jinfo["r5_version"]}), **tr_params}
    m04.run_params = run_params

    argv = ["04_compute_matrix.py", "--origins", *origins, "--days", *args.days, "--modes", *args.modes,
            "--batch-size", str(args.batch_size), "--max-memory", args.max_memory]
    argv += ["--fresh"] if args.fresh else []
    argv += ["--dry-run"] if args.dry_run else []
    sys.argv = argv
    return m04.main()


if __name__ == "__main__":
    raise SystemExit(main())
