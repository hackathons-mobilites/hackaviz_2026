"""06j - Projets de recrutement BMO 2026 (France Travail, EMP03) par bassin d'emploi : export du front.

Écrit :
    frontend/public/data/bmo.json           contrat `bmo-1` (contrats-donnees.md) : par bassin d'emploi (clé = code GEO04,
                                            `bassin.code` des astres de poles.json), total et 8 familles de métiers,
                                            avec le nombre de cases « * » non comptées ; total officiel de la région
    frontend/public/data/bmo_metiers.json   contrat `bmo-metiers-1` : détail par métier (chargé à la demande ; aucune
                                            étape de la visite ne l'utilise tant que l'étape recrutement est désactivée)

Entrées : data/raw/EMP03/Base-open-data-BMO-2026.xlsx (sha256 contrôlé contre le manifeste), le PDF du total officiel
(même dossier), data/raw/GEO04 (libellés des bassins, contrôle de nom), poles.json publié
(contrôle : tout astre qui porte un bassin trouve ses données). Lecture seule de tout le reste : meta.json n'est pas
réécrit (le front lit bmo.json à part ; absent ou HTML : le bloc dit « non disponible », jamais une valeur inventée).

Usage : python scripts/06j_export_bmo.py [--check-only]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

from starway import bmo
from starway.config import FRONT_DATA_DIR
from starway.export import write_json
from starway.sky_groups import read_bassins
from starway.sources import read_manifest, sha256_of

OUT = FRONT_DATA_DIR / "bmo.json"
OUT_METIERS = FRONT_DATA_DIR / "bmo_metiers.json"


def manifest_errors() -> list[str]:
    """Les fichiers gardés ont l'empreinte du manifeste (EMP03 : classeur et PDF du total officiel)."""
    rows = {r["fichier_local"]: r for r in read_manifest() if r["source_id"] == "EMP03"}
    errs: list[str] = []
    for path in (bmo.BMO_XLSX, bmo.OFFICIAL_PDF):
        rel = path.relative_to(path.parents[3]).as_posix()
        row = rows.get(rel)
        if row is None:
            errs.append(f"{rel} : aucune ligne EMP03 au manifeste")
        elif sha256_of(path) != row["sha256"]:
            errs.append(f"{rel} : empreinte différente du manifeste")
    return errs


def bassin_name_errors(df) -> list[str]:
    """Les 25 bassins du classeur BMO sont ceux de GEO04 (même code, même libellé à la casse et aux accents près)."""
    geo = read_bassins()
    names = geo.drop_duplicates("bassin_code").set_index("bassin_code")["bassin_name"].to_dict()
    errs: list[str] = []
    for code, name in df.drop_duplicates("bassin").set_index("bassin")["bassin_name"].items():
        if code not in names:
            errs.append(f"bassin {code} ({name}) absent de GEO04")
        elif bmo.norm(names[code]) != bmo.norm(name):
            errs.append(f"bassin {code} : BMO « {name} » != GEO04 « {names[code]} »")
    missing = sorted(set(names) - set(df["bassin"]))
    if missing:
        errs.append(f"bassins GEO04 sans ligne BMO : {missing}")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-only", action="store_true", help="contrôles seulement, rien n'est écrit")
    args = ap.parse_args()

    errs = manifest_errors() + bmo.verify_official()
    df = bmo.read_bmo()
    evidence = bmo.mask_evidence()
    errs += bassin_name_errors(df)
    main_doc, detail = bmo.build_export(df, datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), evidence)
    errs += bmo.check_main(main_doc, df, evidence) + bmo.check_detail(detail, main_doc)
    for label, path in (("poles.json", FRONT_DATA_DIR / "poles.json"),):
        if path.exists():
            errs += bmo.check_poles(json.loads(path.read_text(encoding="utf-8")), main_doc, label)
    for e in errs:
        print(f"[ECHEC] {e}", file=sys.stderr)
    if errs:
        return 1

    reg = main_doc["region"]["published"]["met"]
    print(f"{len(df)} lignes IDF, {len(main_doc['bassins'])} bassins, {len(detail['metiers'])} métiers ; "
          f"projets publiés {reg['n']} (+ {reg['masked']} cases « * » non comptées), total officiel "
          f"{main_doc['region']['official']['projects']} ; « * » : {main_doc['masked']['label']} "
          f"(déduction, {evidence['rows']} lignes, minimum publié {evidence['min_published']})")
    if args.check_only:
        return 0
    size = write_json(OUT, main_doc)
    size_m = write_json(OUT_METIERS, detail)
    print(f"{OUT.name} : {size / 1024:.1f} Ko ; {OUT_METIERS.name} : {size_m / 1024:.1f} Ko")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
