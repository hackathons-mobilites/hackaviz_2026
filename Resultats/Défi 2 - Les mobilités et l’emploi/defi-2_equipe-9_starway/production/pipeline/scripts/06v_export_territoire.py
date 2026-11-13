"""06v - Repères de territoire (lot T1 du plan docs/plan-contexte-territoire.md) : export du front.

Écrit :
    frontend/public/data/territoire.json   contrat `territoire-1` : chômage des 15 zones d'emploi d'Île-de-France (série
                                           trimestrielle), des 8 départements et de la région (dernier trimestre), parts des
                                           salariés qui travaillent le soir et la nuit (enquête Emploi, nationales), zone
                                           d'emploi et polarité SDRIF-E de chacune des 1 285 communes de départ

Entrées (lecture seule, data/raw n'est jamais modifié) : data/raw/SOC02, GEO05, GEO06 et EMP05 (fichiers bruts avec leur
PROVENANCE.txt, empreintes contrôlées contre la provenance ET contre data/sources_manifest.csv) et
data/processed/communes_idf_2026.csv (communes de départ). Aucun chiffre ni aucun nom n'est écrit dans le code : tout est lu
dans ces fichiers (starway/territoire.py). Rien d'autre dans frontend/public/data n'est lu ni écrit.

Échoue (code 1, rien n'est écrit) si une commune de départ n'a pas de zone, si une zone n'a pas de taux, si un nom de
polarité n'a pas de code, ou si une valeur manque.

Usage : python scripts/06v_export_territoire.py [--check-only]
Depuis un autre arbre de travail : STARWAY_DATA_ROOT=<dossier data de l'arbre principal> (data/raw n'est pas versionné).
"""

from __future__ import annotations

import argparse
import sys

from starway import territoire as tr
from starway.config import FRONT_DATA_DIR, IDF_DEPS, IDF_REGION, PROCESSED_DIR, RAW_DIR, REPO_ROOT, manifest_rel
from starway.export import write_json
from starway.sources import read_manifest

OUT = FRONT_DATA_DIR / tr.OUT_FILE


def manifest_errors(raw: dict[str, dict[str, tr.RawFile]]) -> list[str]:
    """Chaque fichier brut lu a une ligne de manifeste, avec la même empreinte."""
    rows = {r["fichier_local"]: r for r in read_manifest()}
    errs: list[str] = []
    for files in raw.values():
        for rf in files.values():
            rel = manifest_rel(rf.path)
            row = rows.get(rel)
            if row is None:
                errs.append(f"{rel} : aucune ligne au manifeste")
            elif row["sha256"] != rf.sha256:
                errs.append(f"{rel} : empreinte différente du manifeste")
            elif row["source_id"] != rf.source_id:
                errs.append(f"{rel} : code {row['source_id']} au manifeste, {rf.source_id} attendu")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-only", action="store_true", help="contrôles seulement, rien n'est écrit")
    args = ap.parse_args()

    try:
        raw = tr.locate_raw(RAW_DIR)
        errs = manifest_errors(raw)
        if errs:
            for e in errs:
                print(f"[ECHEC] {e}", file=sys.stderr)
            return 1
        communes = tr.read_communes(PROCESSED_DIR / "communes_idf_2026.csv")
        doc = tr.build_territoire(raw, communes, IDF_REGION, IDF_DEPS)
    except tr.TerritoireError as e:
        print(f"[ECHEC] {e}", file=sys.stderr)
        return 1
    errs = tr.check_territoire(doc, [c.code for c in communes.values() if c.is_origin], IDF_DEPS)
    for e in errs:
        print(f"[ECHEC] {e}", file=sys.stderr)
    if errs:
        return 1

    ch, wt = doc["chomage"], doc["temps_de_travail"]
    n_pol = sum(1 for v in doc["communes"].values() if v["polarity"] is not None)
    print(f"{len(doc['communes'])} communes de départ, {len(ch['zones'])} zones d'emploi ({len(ch['quarters'])} trimestres, "
          f"dernier {ch['quarter']}{' provisoire' if ch['provisional'] else ''}, paru le {ch['published']}), "
          f"{len(ch['departments'])} départements, région {ch['region']['name']} {ch['region']['rate']} % ; temps de travail "
          f"{wt['year']} : soir {wt['evening_pct']} %, nuit {wt['night_pct']} % ({wt['scope']}) ; {n_pol} communes avec une polarité")
    if args.check_only:
        return 0
    size = write_json(OUT, doc)
    print(f"{OUT.relative_to(REPO_ROOT).as_posix()} : {size / 1024:.1f} Ko")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
