"""04p - Contrôle de la livraison des calculs sur le flux du 06/11/2026, AVANT tout rapatriement (lecture seule, aucun écrasement).

NE PAS LANCER avant l'annonce de Claude Code. L'archive livrée est extraite par `tools/vm/rapatrier-flux-f06.ps1` dans un
dossier d'attente neuf (`--stage`) ; ce script vérifie qu'elle est complète et conforme (voir `starway/f06_delivery.py`) :
dossiers attendus sous les mêmes noms qu'aujourd'hui, aucun `.part`, structure égale à celle des anciens dossiers
(`--interim`), empreinte du GTFS de chaque dossier = celle du fichier GTFS livré de son réseau, trois GTFS aux empreintes de la
décision (`flux_manifest.problems`), liste sha256 par fichier de l'archive respectée.

    python scripts/04p_check_f06_delivery.py --stage <dossier extrait> [--interim <data/interim>] [--only matrix_story_d031_b44 ...]

Code de sortie 0 si tout est conforme, 1 sinon (le rapatriement est alors refusé).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from starway import f06_delivery as fd
from starway import flux_manifest as fm
from starway.config import INTERIM_DIR


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--stage", type=Path, required=True, help="archive extraite (dossier d'attente)")
    ap.add_argument("--interim", type=Path, default=INTERIM_DIR, help="data/interim actuel (anciens dossiers, comparés)")
    ap.add_argument("--only", nargs="*", default=None, help="limiter à ces dossiers (essai)")
    args = ap.parse_args()
    bad = 0

    digests: dict[str, str] = {}
    for filename, (sid, dest) in fd.GTFS_DELIVERY.items():
        found = fd.find_file(args.stage, filename)
        if len(found) != 1:
            print(f"ECHEC GTFS {sid} : {len(found)} fichier(s) nommé(s) {filename} dans l'archive (un seul attendu)")
            bad += 1
            continue
        digests[sid] = fd.sha256_file(found[0])
        print(f"GTFS {sid} : {digests[sid]} (sera rangé sous data/raw/{sid}/{dest})")
    errs = fm.problems(digests) if len(digests) == 3 else ["trois GTFS attendus"]
    for e in errs:
        print(f"ECHEC GTFS : {e}")
        bad += 1
    if errs:
        print("sans les trois GTFS conformes, les dossiers ne sont pas contrôlés")
        return 1

    sums = fd.find_sums(args.stage)
    if sums is None:
        print("NOTE : aucune liste sha256 par fichier dans l'archive : seule l'empreinte de l'archive a été vérifiée")
    else:
        errs = fd.check_sums(args.stage, fd.parse_sums(sums.read_text(encoding="utf-8", errors="replace")))
        print(f"liste sha256 {sums.name} : {len(errs)} écart(s)")
        for e in errs[:10]:
            print(f"ECHEC sha256 : {e}")
        bad += len(errs)

    for name in args.only or fd.EXPECTED_DIRS:
        new = fd.find_dir(args.stage, name)
        old = args.interim / name
        v = fd.check_dir(name, new, old if old.is_dir() else None, digests)
        print(f"{'OK   ' if v.ok else 'ECHEC'} {name} : " + ("; ".join(v.notes) if v.ok else "; ".join(v.problems)))
        bad += 0 if v.ok else 1
    print("LIVRAISON CONFORME" if not bad else f"LIVRAISON REFUSEE : {bad} écart(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
