"""04o - Met à jour le manifeste pour le flux GTFS du 06/11/2026 (TRA01, TRA01B, TRA01C), à l'annonce de Claude Code.

NE PAS LANCER avant l'annonce de Claude Code (décision de Nicolas du 06/11 : rien n'est rapatrié ni publié avant). Les trois
fichiers livrés sont d'abord rangés par `tools/vm/rapatrier-flux-f06.ps1` dans `data/raw/<source>/` sous des NOMS NOUVEAUX
(l'ancien fichier de data/raw/TRA01 n'est ni modifié ni remplacé). Ce script calcule leurs empreintes, vérifie qu'elles sont
celles de la décision (TRA01 exacte, TRA01B et TRA01C commençant par les débuts annoncés), garde les lignes remplacées dans
data/flux_gtfs_precedents.csv, puis écrit le manifeste. Une empreinte incomplète n'est jamais écrite.

    python scripts/04o_update_flux_manifest.py --tra01 data/raw/TRA01/IDFM-gtfs-0611.zip \\
        --tra01b data/raw/TRA01B/gtfs_nuit-0611.zip --tra01c data/raw/TRA01C/gtfs_soir-0611.zip --dry-run
    (sans --dry-run : écrit) ; ensuite 06r puis 06s (sources.md et la copie publique : jamais à la main), 06d, 07.

`--stats-tra01b` et `--stats-tra01c` : texte mesuré dans le fichier livré (par exemple « 2 000 courses et 50 000 arrêts
ajoutés »), recopié tel quel dans le manifeste ; sans eux le manifeste n'écrit aucun nombre de courses ajoutées.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import UTC, date, datetime
from pathlib import Path

from starway import flux
from starway import flux_manifest as fm
from starway import gtfs_reference_day as gr
from starway.config import RAW_DIR, SERVICE_DATE
from starway.sources import read_manifest, sha256_of, write_manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for sid in ("tra01", "tra01b", "tra01c"):
        ap.add_argument(f"--{sid}", type=Path, required=True, help=f"fichier livré de {sid.upper()}, dans data/raw/{sid.upper()}/")
        if sid != "tra01":
            ap.add_argument(f"--built-{sid}", default=None,
                            help=f"date de construction de {sid.upper()} (AAAA-MM-JJTHH:MMZ) ; défaut : date du fichier")
            ap.add_argument(f"--stats-{sid}", default=None, help=f"nombres mesurés dans {sid.upper()}, texte libre")
    ap.add_argument("--date-tra01", default=fm.F06_DATE_TRA01, help="date d'extraction du flux figé (défaut : 06/11 à 16h11 Paris)")
    ap.add_argument("--replaced-on", default=date.today().isoformat(), help="date du remplacement (défaut : aujourd'hui)")
    ap.add_argument("--dry-run", action="store_true", help="ne rien écrire, tout contrôler")
    args = ap.parse_args()

    files = {"TRA01": args.tra01, "TRA01B": args.tra01b, "TRA01C": args.tra01c}
    for sid, f in files.items():
        if not f.is_file():
            print(f"{sid} : {f} absent", file=sys.stderr)
            return 2
    digests = {sid: sha256_of(f) for sid, f in files.items()}
    try:
        paths = {sid: fm.relative_to_raw(f, RAW_DIR, sid) for sid, f in files.items()}
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    mtime = {sid: datetime.fromtimestamp(f.stat().st_mtime, tz=UTC).strftime("%Y-%m-%dT%H:%MZ") for sid, f in files.items()}
    dates = {"TRA01": args.date_tra01, "TRA01B": args.built_tra01b or mtime["TRA01B"],
             "TRA01C": args.built_tra01c or mtime["TRA01C"]}
    trips = sum(r.trips_on_day for r in gr.route_services(files["TRA01"], SERVICE_DATE))
    try:
        rows, previous = fm.update_rows(read_manifest(), digests, paths, dates, replaced_on=args.replaced_on,
                                        trips_on_day=trips,
                                        stats={"TRA01B": args.stats_tra01b, "TRA01C": args.stats_tra01c})
    except ValueError as e:
        print(f"REFUS : {e}", file=sys.stderr)
        return 1
    for sid in flux.GTFS_SOURCES:
        print(f"{sid} : {digests[sid]} -> {paths[sid]}")
    print(f"{len(previous)} ligne(s) remplacée(s) gardée(s) dans {flux.PREVIOUS_PATH.name}")
    if args.dry_run:
        print("--dry-run : rien n'est écrit")
        return 0
    if previous:
        new_file = not flux.PREVIOUS_PATH.exists() or flux.PREVIOUS_PATH.stat().st_size == 0
        with flux.PREVIOUS_PATH.open("a", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=flux.PREVIOUS_COLUMNS, lineterminator="\n")
            if new_file:
                w.writeheader()
            w.writerows(previous)
    write_manifest(rows, keep_order=True)  # l'ordre du manifeste ne change pas (sources de tolls.json)
    print("manifeste écrit ; suite : 06r, 06s, 06d, 07 (jamais sources.md à la main)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
