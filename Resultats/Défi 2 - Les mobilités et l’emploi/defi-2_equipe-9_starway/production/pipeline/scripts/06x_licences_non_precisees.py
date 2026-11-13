"""06x - Bascule des licences sans réponse vers « licence non précisée par le producteur » (préparée, pas activée).

Décision de Nicolas : sans réponse le mercredi 11/11 à 18h, les sources en attente passent à ce texte. La liste est dans
`starway/licences_attente.py` ; une ligne déjà mise à jour (réponse reçue) est laissée telle quelle et signalée.

    python scripts/06x_licences_non_precisees.py                                       # montre, n'écrit rien
    python scripts/06x_licences_non_precisees.py --appliquer                           # péages : manifeste, 06r, 06u, 06s
    python scripts/06x_licences_non_precisees.py --appliquer --groupes peages france-travail

Après --appliquer : 07_quality_checks.py, puis corriger à la main les textes qui citent encore l'ancien état
(`docs/limites.md`, `frontend/src/components/SourcesDrawer.tsx`). Idempotent : une seconde exécution ne change rien.
"""

from __future__ import annotations

import argparse
import subprocess
import sys

from starway.config import MANIFEST_PATH, PIPELINE_DIR
from starway.licences_attente import GROUPE_PEAGES, GROUPES, HORS_BASCULE, basculer

REGENERATION = ("06r_sources_registry.py", "06u_tracabilite.py", "06s_depot_readme_sources.py")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--appliquer", action="store_true", help="écrit le manifeste et régénère les documents")
    ap.add_argument("--groupes", nargs="+", choices=GROUPES, default=[GROUPE_PEAGES],
                    help="groupes à basculer (par défaut : péages seulement)")
    args = ap.parse_args()

    with MANIFEST_PATH.open(encoding="utf-8", newline="") as f:
        contenu = f.read()
    nouveau, changements, non_trouvees = basculer(contenu, args.groupes)
    for c in changements:
        print(f"{c.source_id} ({c.groupe}) {c.fichier_local}\n  avant : {c.ancien}\n  après : {c.nouveau}")
    print(f"{len(changements)} lignes à changer, groupes : {', '.join(args.groupes)}")
    for b in non_trouvees:
        print(f"aucune ligne à changer pour {b.source_id} ({b.groupe}) : texte déjà différent, ligne gardée")
    for code, raison in HORS_BASCULE.items():
        print(f"hors bascule {code} : {raison}")
    if not args.appliquer:
        print("rien n'est écrit (ajouter --appliquer pour basculer)")
        return 0
    if not changements:
        print("rien à écrire")
        return 0
    with MANIFEST_PATH.open("w", encoding="utf-8", newline="") as f:
        f.write(nouveau)
    for script in REGENERATION:
        subprocess.run([sys.executable, str(PIPELINE_DIR / "scripts" / script)], check=True)
    print("fait. À suivre : 07_quality_checks.py, et les textes écrits à la main (docs/limites.md, SourcesDrawer.tsx)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
