"""07r - Lignes du flux GTFS sans service le jour de référence (17/11/2026) : liste, justification, code de sortie.

Lecture seule. Lit le GTFS du manifeste (TRA01, `starway.flux.gtfs_path`) ou le fichier donné par --gtfs, calcule l'état
de chaque ligne le jour de référence (`starway.gtfs_reference_day`) et le compare à `data/gtfs_lignes_sans_service.csv`.
Code de sortie 1 s'il reste une ligne sans service qui n'est ni justifiée automatiquement ni écrite pour CE flux.

    python scripts/07r_gtfs_reference_day.py                     # GTFS du manifeste
    python scripts/07r_gtfs_reference_day.py --gtfs <zip>        # un autre fichier (lecture seule), pour comparer deux flux
    python scripts/07r_gtfs_reference_day.py --write-report      # écrit data/processed/gtfs_lignes_sans_service_17_11.csv
                                                                 # (toutes les lignes sans service, une justification chacune)

`07_quality_checks.py` fait le même contrôle (P0). Aucune valeur d'effet n'est calculée : seulement des listes de lignes.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from starway import flux
from starway import gtfs_reference_day as gr
from starway.config import PROCESSED_DIR, SERVICE_DATE
from starway.sources import sha256_of

REPORT = PROCESSED_DIR / "gtfs_lignes_sans_service_17_11.csv"
REPORT_COLUMNS = ["route_id", "ligne", "nom", "type", "exploitant", "statut", "premier_jour", "dernier_jour", "justification"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--gtfs", type=Path, default=None, help="GTFS à contrôler (défaut : TRA01 du manifeste)")
    ap.add_argument("--write-report", action="store_true", help=f"écrit {REPORT.name} (flux du manifeste seulement)")
    args = ap.parse_args()
    path = args.gtfs or flux.gtfs_path("TRA01")
    digest = sha256_of(path)
    rows = gr.route_services(path, SERVICE_DATE)
    allow = gr.read_allowlist()
    bad = gr.unjustified(rows, digest, allow)
    lines = gr.report(rows, digest, allow)
    print(f"{path.name} sha256 {digest[:8]} : {len(rows)} lignes, jour de référence {SERVICE_DATE.isoformat()}, "
          f"états {gr.summary(rows)}")
    print(f"{len(lines)} lignes sans service, dont {len(bad)} sans justification")
    for r in bad:
        print(f"  SANS JUSTIFICATION : {r.route_id} {r.short_name!r} ({r.agency}) {r.status} {r.first_day}-{r.last_day}")
    if args.write_report:
        if args.gtfs is not None and digest != flux.manifest_sha().get("TRA01"):
            print("--write-report : le fichier n'est pas celui du manifeste, rien n'est écrit", file=sys.stderr)
            return 2
        with REPORT.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=REPORT_COLUMNS, lineterminator="\n")
            w.writeheader()
            w.writerows(lines)
        print(f"écrit : {REPORT}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
