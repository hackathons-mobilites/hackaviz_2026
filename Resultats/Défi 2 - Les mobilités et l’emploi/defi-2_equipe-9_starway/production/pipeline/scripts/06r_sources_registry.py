"""06r - Référentiel des sources : écrit docs/sources.md et frontend/public/data/sources.json depuis le manifeste.

Entrées (toutes versionnées) : data/sources_manifest.csv, pipeline/starway/registry.py (statuts, devenir du
catalogue), docs/reference/STARWAY_Referentiel_Donnees_FINAL_EQUIPE_2026.xlsx (onglet « Catalogue »), le code
(pipeline/starway, pipeline/scripts, frontend/src) et les fichiers publiés (frontend/public/data/).

Sorties : docs/sources.md (généré, jamais modifié à la main) ; sources.json (même fonction que 06 et 06h,
`starway.export.build_sources`). Sans Java ni réseau, quelques secondes. Idempotent.

À relancer après chaque fusion d'une branche qui ajoute ou modifie une source :
    python scripts/06r_sources_registry.py            # écrit
    python scripts/06r_sources_registry.py --check    # code 1 si un des deux fichiers n'est pas à jour
07_quality_checks.py fait le même contrôle (P0).
"""

from __future__ import annotations

import argparse
import json
import sys

from starway.config import FRONT_DATA_DIR, REPO_ROOT
from starway.export import build_sources, write_json
from starway.registry import (
    CATALOGUE_PATH,
    DOC_PATH,
    GENERATOR,
    Usage,
    read_catalogue,
    render,
    scan_code,
    scan_published,
)
from starway.sources import read_manifest

CODE_ROOTS = ("pipeline/starway", "pipeline/scripts", "frontend/src")
# Ces deux fichiers citent tous les codes (tables du référentiel) : ils ne disent pas où la source est utilisée
EXCLUDE = ("pipeline/starway/registry.py", GENERATOR)


def build_doc() -> str:
    usage = Usage(published=scan_published(FRONT_DATA_DIR), code=scan_code(REPO_ROOT, CODE_ROOTS, EXCLUDE))
    return render(read_manifest(), usage, read_catalogue(REPO_ROOT / CATALOGUE_PATH))


def stale() -> list[str]:
    """Fichiers qui ne sont pas à jour (vide si tout est à jour)."""
    out = []
    doc = REPO_ROOT / DOC_PATH
    if not doc.exists() or doc.read_text(encoding="utf-8").replace("\r\n", "\n") != build_doc():
        out.append(DOC_PATH)
    sj = FRONT_DATA_DIR / "sources.json"
    want = json.loads(json.dumps(build_sources(), ensure_ascii=False))
    if not sj.exists() or json.loads(sj.read_text(encoding="utf-8")) != want:
        out.append("frontend/public/data/sources.json")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="vérifie seulement (code 1 si un fichier n'est pas à jour)")
    args = ap.parse_args()
    if args.check:
        bad = stale()
        print("à jour" if not bad else "pas à jour : " + ", ".join(bad) + f" (relancer {GENERATOR})")
        return 1 if bad else 0
    text = build_doc()
    doc = REPO_ROOT / DOC_PATH
    doc.write_text(text, encoding="utf-8", newline="\n")
    n = write_json(FRONT_DATA_DIR / "sources.json", build_sources())
    print(f"{DOC_PATH} : {len(text.splitlines())} lignes ; sources.json : {len(build_sources())} lignes, {n} octets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
