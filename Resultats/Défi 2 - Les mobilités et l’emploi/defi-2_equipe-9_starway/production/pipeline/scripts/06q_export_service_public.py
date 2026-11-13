"""06q - Offres diffusées sur « Choisir le service public » (DGAFP, EMP04, D-036) : export du front.

Écrit :
    frontend/public/data/service_public.json         contrat `service-public-1` (contrats-donnees.md) : offres EN LIGNE à la date
                                                     du fichier, comptes par commune, par département et pour l'Île-de-France,
                                                     méthode et écart de métadonnées
    frontend/public/data/service_public_offres.json  contrat `service-public-offres-1` : les offres rattachées à une commune
                                                     (référence, intitulé, versant, employeur, dates), chargé à la demande

Entrées : data/raw/EMP04/offres-datagouv-AAAAMMJJ.csv (sha256 contrôlé contre le manifeste), data/raw/GEO01 (codes postaux
des communes d'Île-de-France et des arrondissements de Paris, API Géo), poles.json (44 astres)
(communes des astres : une commune hors astres n'est jamais rattachée). Lecture seule de tout le reste : meta.json n'est
pas réécrit (le front lit ces fichiers à part ; absents ou HTML : le bloc dit « non disponible », jamais une valeur
inventée). Le fichier du jeu n'est pas versionné (133 Mo) : seuls ces extraits dérivés le sont.

Usage : python scripts/06q_export_service_public.py [--check-only] [--csv chemin]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from starway import service_public as sp
from starway.config import FRONT_DATA_DIR, PROCESSING_VERSION, RAW_DIR, REPO_ROOT
from starway.export import write_json
from starway.sources import read_manifest, sha256_of

OUT = FRONT_DATA_DIR / "service_public.json"
OUT_OFFERS = FRONT_DATA_DIR / sp.OFFERS_FILE
RAW = RAW_DIR / "EMP04"
GEO = RAW_DIR / "GEO01"
GEO_FILES = ("communes_idf_codes_postaux.json", "arrondissements_paris_codes_postaux.json")


def astre_communes() -> frozenset[str]:
    """Communes des 44 astres publiés."""
    path = FRONT_DATA_DIR / "poles.json"
    if not path.exists():
        return frozenset()
    return frozenset(c for p in json.loads(path.read_text(encoding="utf-8")) for c in p["communes"])


def manifest_errors(csv_path) -> tuple[list[str], dict[str, str] | None]:
    """Les fichiers lus ont l'empreinte du manifeste (EMP04 : le CSV ; GEO01 : les deux fichiers de codes postaux)."""
    rows = {r["fichier_local"]: r for r in read_manifest()}
    errs: list[str] = []
    targets = [csv_path, *(GEO / n for n in GEO_FILES)]
    for path in targets:
        rel = path.relative_to(REPO_ROOT).as_posix()
        row = rows.get(rel)
        if row is None:
            errs.append(f"{rel} : aucune ligne au manifeste")
        elif sha256_of(path) != row["sha256"]:
            errs.append(f"{rel} : empreinte différente du manifeste")
    return errs, rows.get(csv_path.relative_to(REPO_ROOT).as_posix())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-only", action="store_true", help="contrôles seulement, rien n'est écrit")
    ap.add_argument("--csv", default=None, help="fichier des offres (défaut : le seul offres-datagouv-*.csv de data/raw/EMP04)")
    args = ap.parse_args()

    if args.csv:
        csv_path = Path(args.csv) if Path(args.csv).parent != Path(".") else RAW / args.csv
    else:
        found = sorted(RAW.glob("offres-datagouv-*.csv"))
        if len(found) != 1:
            print(f"[ECHEC] attendu un seul offres-datagouv-*.csv dans {RAW}, trouvé {len(found)}", file=sys.stderr)
            return 1
        csv_path = found[0]
    errs, row = manifest_errors(csv_path)
    if errs or row is None:
        for e in errs:
            print(f"[ECHEC] {e}", file=sys.stderr)
        return 1

    as_of = sp.file_date(csv_path.name)
    index = sp.read_postal_index(GEO / GEO_FILES[0], GEO / GEO_FILES[1])
    communes = astre_communes()
    df = sp.read_offers(csv_path)
    offers, stats = sp.build_offers(df, as_of, index, communes)
    main_doc, detail = sp.build_export(
        offers, stats, as_of=as_of, file_name=csv_path.name, file_sha256=row["sha256"], extracted_at=row["date_extraction"],
        span=sp.file_span(df), processing_version=PROCESSING_VERSION,
        generated_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"))
    errs = sp.check_export(main_doc, detail, communes)
    for e in errs:
        print(f"[ECHEC] {e}", file=sys.stderr)
    if errs:
        return 1

    r, c = main_doc["region"], main_doc["counts"]
    print(f"{c['file_rows']} lignes, {c['file_rows_without_publication_dates']} sans dates de publication ; en ligne au "
          f"{as_of.isoformat()} : {c['online_rows']} lignes, {c['online_references']} références ; Île-de-France : "
          f"{r['offers']} offres, dont {r['commune']} rattachées à une commune ({len(main_doc['communes'])} communes) et "
          f"{r['departement']} au département seulement {r['departement_reasons']}")
    if args.check_only:
        return 0
    size = write_json(OUT, main_doc)
    size_o = write_json(OUT_OFFERS, detail)
    print(f"{OUT.name} : {size / 1024:.1f} Ko ; {OUT_OFFERS.name} : {size_o / 1024:.1f} Ko")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
