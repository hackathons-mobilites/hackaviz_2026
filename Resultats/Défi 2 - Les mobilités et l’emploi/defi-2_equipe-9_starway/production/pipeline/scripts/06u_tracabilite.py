"""06u - Traçabilité : écrit docs/tracabilite.md (une ligne par composant affiché, source, sha256, formule, calcul, test).

Lit le registre du front (frontend/src/data/provenanceCoverage.ts), les composants, le manifeste, les run_params.json des
dossiers de calcul (data/interim, ou le dossier `data` de l'arbre principal si STARWAY_DATA_ROOT est posée) et le code ;
n'écrit RIEN à la main (voir starway/traceability.py). Sans Java ni réseau ; idempotent ; sans horodatage.

    python scripts/06u_tracabilite.py            # écrit docs/tracabilite.md
    python scripts/06u_tracabilite.py --check    # code 1 si le document n'est pas à jour ou si un contrôle P0 échoue
    python scripts/06u_tracabilite.py --problems # liste tous les écarts (P0 et P1), sans écrire

À relancer après 06r (sources.md) quand un chantier ajoute un composant au registre du front, une ligne au manifeste ou un
dossier de calcul. 07_quality_checks.py fait le même contrôle (P0).
"""

from __future__ import annotations

import argparse
import sys

from starway import traceability as tr
from starway.config import INTERIM_DIR, PROCESSED_DIR, RAW_DIR, REPO_ROOT


def roots() -> tr.DataRoots:
    return tr.DataRoots(REPO_ROOT, RAW_DIR, INTERIM_DIR, PROCESSED_DIR)


def stale(trace: tr.Trace) -> bool:
    doc = REPO_ROOT / tr.DOC_PATH
    return not doc.exists() or doc.read_text(encoding="utf-8").replace("\r\n", "\n") != tr.render(trace)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="vérifie seulement (code 1 si pas à jour ou P0 en échec)")
    ap.add_argument("--problems", action="store_true", help="liste les écarts sans écrire")
    args = ap.parse_args()
    trace = tr.collect(roots(), verify=args.check or args.problems)
    p0 = [p.message for p in trace.problems if p.level == "P0"]
    if args.problems or args.check:
        for p in trace.problems:
            print(f"[{p.level}] {p.kind} : {p.message}")
        old = stale(trace)
        print("à jour" if not old else f"{tr.DOC_PATH} pas à jour (relancer {tr.GENERATOR})")
        return 1 if (p0 or old) else 0
    text = tr.render(trace)
    out = REPO_ROOT / tr.DOC_PATH
    out.write_text(text, encoding="utf-8", newline="\n")
    n_rows = len(tr.parse_index(text))
    print(f"{tr.DOC_PATH} : {len(text.splitlines())} lignes, {n_rows} composants indexés, {len(trace.calc_dirs)} dossiers de calcul")
    return 0


if __name__ == "__main__":
    sys.exit(main())
