"""08g - Tableau ANCIEN / NOUVEAU des chiffres affichés, remis à Nicolas avant la décision de publier (plan, phase E, point 6).

Lecture seule, aucun appel réseau, jamais PRIM. Écrit un Markdown (`--sortie`, hors du dépôt de préférence) et, à côté, le CSV
de tous les écarts (`<sortie sans .md>.ecarts.csv`). Aucun seuil : voir `starway/tableau_ancien_nouveau.py`.

    python scripts/08g_tableau_ancien_nouveau.py --ancien <dossier data de main> --nouveau <dossier data de la phase D> \\
        --sortie ..\\..\\logs-f06\\tableau-ancien-nouveau.md --navitia <résumé 07d .json> --navitia <trajets .csv>

`--communes 78358,93066` limite le recalcul commune par commune à ces communes et à l'échantillon de référence (essai rapide) ;
sans cette option, les 1 285 communes sont recalculées des deux côtés (`--workers`, défaut 1 : chaque processus de plus charge pandas).
Code de retour 0 même s'il y a des écarts : le tableau ne juge pas.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from starway import tableau_ancien_nouveau as tan


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ancien", type=Path, required=True, help="dossier de données publiées de référence (frontend/public/data de main)")
    ap.add_argument("--nouveau", type=Path, required=True, help="dossier de données à comparer (export de la phase D)")
    ap.add_argument("--sortie", type=Path, required=True, help="fichier Markdown écrit")
    ap.add_argument("--navitia", type=Path, action="append", default=[], help="résumé JSON de 07d (insight_checks) ou CSV de trajets (répétable)")
    ap.add_argument("--communes", default=None, help="essai : codes INSEE séparés par des virgules (défaut : toutes les communes)")
    ap.add_argument("--workers", type=int, default=1, help="processus pour le recalcul commune par commune")
    ap.add_argument("--visite-resolue", type=Path, default=None,
                    help="tour.resolved.json de l'ancien dossier (défaut : <ancien>/../tour/lea/tour.resolved.json)")
    args = ap.parse_args()
    for d in (args.ancien, args.nouveau):
        if not d.is_dir():
            raise SystemExit(f"dossier introuvable : {d}")
    for f in args.navitia:
        if not f.is_file():
            raise SystemExit(f"fichier Navitia introuvable : {f}")
    communes = [c.strip() for c in args.communes.split(",") if c.strip()] if args.communes else None
    rapport = tan.construire(args.ancien, args.nouveau, args.navitia, communes, args.workers, args.visite_resolue)
    args.sortie.parent.mkdir(parents=True, exist_ok=True)
    args.sortie.write_text(tan.ecrire_markdown(rapport), encoding="utf-8")
    chemin_csv = args.sortie.with_suffix(".ecarts.csv")
    n = tan.ecrire_csv(rapport, chemin_csv)
    print(f"écrit : {args.sortie} et {chemin_csv} ({n} écarts au total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
