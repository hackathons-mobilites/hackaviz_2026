"""08f - Tableau ANCIEN et NOUVEAU des découvertes publiées (insights.json), pour la publication du flux du 06/11/2026.

Lecture seule. L'ancien fichier vient d'un commit (`--old-ref`, défaut origin/main) ou d'un fichier (`--old-file`), le nouveau
est celui du dossier publié de l'arbre (ou `--new-file`). Écrit un tableau Markdown sur la sortie standard (ou `--out`, hors
du dépôt de préférence). Aucune interprétation, aucun chiffre ajouté.

    python scripts/08f_compare_published.py --old-ref origin/main > ..\\..\\logs-f06\\comparaison-decouvertes.md

Les chiffres de la visite et de la slide se relisent à l'écran sur le site publié en local ; ce tableau couvre les 30
découvertes.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from starway import compare_published as cp
from starway.config import FRONT_DATA_DIR, REPO_ROOT

REL = "frontend/public/data/insights.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--old-ref", default="origin/main", help="commit de l'ancien insights.json")
    ap.add_argument("--old-file", type=Path, default=None, help="ou un fichier insights.json ancien")
    ap.add_argument("--new-file", type=Path, default=FRONT_DATA_DIR / "insights.json")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    if args.old_file is not None:
        old = json.loads(args.old_file.read_text(encoding="utf-8"))
    else:
        raw = subprocess.run(["git", "show", f"{args.old_ref}:{REL}"], cwd=REPO_ROOT, check=True, capture_output=True).stdout
        old = json.loads(raw.decode("utf-8"))
    new = json.loads(args.new_file.read_text(encoding="utf-8"))
    text = cp.markdown(cp.compare(old, new))
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
