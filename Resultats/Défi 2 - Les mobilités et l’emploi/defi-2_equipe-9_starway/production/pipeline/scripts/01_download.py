"""01 - Télécharge les sources P0 dans data/raw/<source_id>/ et met à jour data/sources_manifest.csv.

Usage :
    python scripts/01_download.py                 # tout (les fichiers déjà présents sont conservés)
    python scripts/01_download.py --only GEO01 EMP01
    python scripts/01_download.py --force TRA01   # retélécharge (le GTFS IDFM change 3 fois par jour)
"""

from __future__ import annotations

import argparse
import sys

from starway.sources import SOURCES, download, upsert_manifest
from starway.subscription_sources import SUBSCRIPTION_SOURCES
from starway.ticket_sources import TICKET_SOURCES


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", nargs="*", default=None, help="source_id à traiter (défaut : toutes)")
    p.add_argument("--force", nargs="*", default=[], help="source_id à retélécharger")
    args = p.parse_args()

    failures = 0
    for src in SOURCES + SUBSCRIPTION_SOURCES + TICKET_SOURCES:
        if args.only and src.source_id not in args.only:
            continue
        force = src.source_id in args.force
        try:
            path, final_url = download(src, force=force)
        except Exception as exc:  # noqa: BLE001 - on continue avec les autres sources
            failures += 1
            print(f"[ECHEC] {src.source_id} {src.url} : {exc}", file=sys.stderr)
            continue
        row = upsert_manifest(src, path, final_url)
        size_mb = path.stat().st_size / 1e6
        print(f"[ok] {src.source_id:6} {path.name:40} {size_mb:9.1f} Mo sha256={row['sha256'][:12]}…")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
