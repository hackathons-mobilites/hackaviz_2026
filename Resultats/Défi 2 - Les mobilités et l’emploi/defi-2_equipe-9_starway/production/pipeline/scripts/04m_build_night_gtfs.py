"""04m - Fabrique le GTFS de nuit (D-040) : le GTFS IDFM (TRA01) + les courses de la veille codées 24:00 et plus.

Règle et raisons : starway/night_gtfs.py (reprise, avec ses tests, du script de la VM ~/b44/night/make_gtfs.py du 05/11).
Le GTFS d'origine n'est jamais modifié : le résultat est un AUTRE fichier (TRA01B dans le manifeste).

Usage :
    python scripts/04m_build_night_gtfs.py                       # data/raw/TRA01/IDFM-gtfs.zip -> data/raw/TRA01B/gtfs_nuit.zip
    python scripts/04m_build_night_gtfs.py --src X.zip --dst Y.zip
    python scripts/04m_build_night_gtfs.py --verify              # compare le fichier TRA01B à TRA01, ne construit rien
    python scripts/04m_build_night_gtfs.py --compare-to ~/b44/night/gtfs_nuit.zip   # construit puis compare au fichier de la VM

Écrit à côté du zip un fichier `<zip>.json` (comptes, sha256 de l'origine et du résultat). Le sha256 du zip lui-même dépend
de la compression : la comparaison entre deux zips se fait sur le CONTENU de chaque fichier (--compare-to).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

from starway import flux
from starway.night_gtfs import build_night_gtfs, verify_night_gtfs

SRC = flux.gtfs_path("TRA01")  # fichiers lus dans le manifeste (starway.flux)
DST = flux.gtfs_path("TRA01B")
_CHUNK = 1 << 20


def member_digests(path: Path) -> dict[str, str]:
    """sha256 du contenu (décompressé, sans BOM) de chaque fichier de l'archive."""
    out: dict[str, str] = {}
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            h = hashlib.sha256()
            with z.open(info) as f:
                first = True
                for chunk in iter(lambda f=f: f.read(_CHUNK), b""):
                    if first:
                        chunk = chunk.removeprefix(b"\xef\xbb\xbf")
                        first = False
                    h.update(chunk)
            out[info.filename] = h.hexdigest()
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--src", type=Path, default=SRC, help="GTFS d'origine (lecture seule)")
    p.add_argument("--dst", type=Path, default=DST, help="GTFS de nuit à écrire")
    p.add_argument("--verify", action="store_true", help="vérifie --dst contre --src, sans rien construire")
    p.add_argument("--compare-to", type=Path, default=None,
                   help="après la construction, compare le contenu de chaque fichier à celui de ce zip (ex. celui de la VM)")
    args = p.parse_args()
    if args.verify:
        problems = verify_night_gtfs(args.src, args.dst)
        print("GTFS de nuit conforme à l'origine plus les courses ajoutées" if not problems
              else "ÉCARTS :\n  " + "\n  ".join(problems))
        return 1 if problems else 0
    stats = build_night_gtfs(args.src, args.dst)
    print(f"{stats.trips_copied} courses ajoutées ({stats.stop_times_copied} arrêts) au service {stats.service_id} "
          f"({stats.target_day}), depuis les {stats.monday_services} services actifs le {stats.source_day} ; "
          f"{stats.trips_dropped_single_stop} courses écartées (moins de 2 arrêts à partir de 24:00)")
    print(f"{args.dst} : sha256 {stats.night_zip_sha256}")
    args.dst.with_name(args.dst.name + ".json").write_text(
        json.dumps(stats.as_dict(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    problems = verify_night_gtfs(args.src, args.dst)
    if problems:
        print("ÉCARTS à la relecture :\n  " + "\n  ".join(problems))
        return 1
    print("relecture : conforme (origine conservée, lignes ajoutées conformes à la règle)")
    if args.compare_to is not None:
        a, b = member_digests(args.dst), member_digests(args.compare_to)
        diff = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
        print("contenu identique au fichier comparé (fichier par fichier)" if not diff
              else f"CONTENU DIFFÉRENT : {diff}")
        return 1 if diff else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
