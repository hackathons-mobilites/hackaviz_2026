"""06s - Tableau « Les données utilisées » du README du dépôt officiel (généré depuis le registre des sources).

Lit `data/sources_manifest.csv` et `starway/registry.py` (statut « utilisée et publiée ») et écrit
`docs/depot-officiel/sources-table.md`, à coller dans la section « Les données utilisées » du README officiel
au moment de la copie. À relancer après `06r` quand une fusion ajoute une source.

Usage : python scripts/06s_depot_readme_sources.py [--check]
"""

from __future__ import annotations

import argparse
import csv
import sys

from starway import depot_sources, registry
from starway.config import REPO_ROOT

MANIFEST = REPO_ROOT / "data" / "sources_manifest.csv"
OUT = REPO_ROOT / "docs" / "depot-officiel" / "sources-table.md"
HEADER = (
    "<!-- Fichier généré par pipeline/scripts/06s_depot_readme_sources.py depuis data/sources_manifest.csv et\n"
    "     starway/registry.py (sources « utilisées et publiées »). NE PAS MODIFIER À LA MAIN. -->\n\n"
)


def build() -> str:
    with MANIFEST.open(encoding="utf-8", newline="") as fh:
        groups = registry.group_manifest(csv.DictReader(fh))
    return HEADER + depot_sources.render_table(groups)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check", action="store_true", help="échoue si le fichier écrit n'est pas à jour")
    args = p.parse_args()
    text = build()
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT} n'est pas à jour : relancer 06s_depot_readme_sources.py", file=sys.stderr)
            return 1
        print("à jour")
        return 0
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"écrit : {OUT} ({text.count(chr(10)) - 5} sources)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
