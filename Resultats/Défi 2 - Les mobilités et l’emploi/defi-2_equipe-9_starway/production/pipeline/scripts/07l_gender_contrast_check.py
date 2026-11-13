"""07l - Volet genre : contrôle descriptif du contraste femmes / hommes (modes domicile-travail, GEN01).

Lit en LECTURE SEULE `frontend/public/data/context/*.json` (publiés par 05 et 06) et `meta.json` (communes du récit
et communes du vélo + TC). Écrit `data/processed/gender_contrast_check.json` : pour chaque commune et chaque mode,
écart F - H, marge combinée à 95 % tirée des données, verdict (au-dessus de la marge, dans la marge, non évaluable),
et un résumé. Aucun seuil inventé, aucune cause tirée (voir `starway/gender_contrast.py`).

Usage : python scripts/07l_gender_contrast_check.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from starway import gender_contrast as gc
from starway.config import FRONT_DATA_DIR, PROCESSED_DIR


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--context-dir", type=Path, default=FRONT_DATA_DIR / "context")
    p.add_argument("--meta", type=Path, default=FRONT_DATA_DIR / "meta.json")
    p.add_argument("--out", type=Path, default=PROCESSED_DIR / "gender_contrast_check.json")
    p.add_argument("--full", action="store_true", help="écrire aussi le détail des 1 285 communes (environ 1 Mo)")
    args = p.parse_args()

    meta = json.loads(args.meta.read_text(encoding="utf-8"))
    focus = list(meta.get("story_communes") or [])
    bike = (meta.get("mode_coverage") or {}).get("bike_transit") or []
    if isinstance(bike, dict):
        bike = bike.get("origins") or bike.get("communes") or []
    for c in bike:
        if c not in focus:
            focus.append(c)

    results = gc.load_contexts(args.context_dir)
    summary = gc.summarize(results, focus)
    payload = {
        "note": (
            "Contrôle descriptif : l'écart F - H d'un mode dépasse-t-il la marge d'erreur à 95 % publiée ? "
            "Aucun seuil inventé ; pas de causalité ; 'not_evaluable' quand la marge n'est pas publiée."
        ),
        "source": "GEN01 (INSEE NAV2A 2023), marges : fiche INSEE sur la précision du recensement",
        "summary": summary,
    }
    if args.full:
        payload["communes"] = results
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"communes évaluées : {summary['communes_evaluated']}")
    for m, c in summary["per_mode"].items():
        print(f"  {m:8s} au-dessus de la marge {c['above_margin']:5d} | dans la marge {c['within_margin']:5d} | non évaluable {c['not_evaluable']:5d}")
    print(f"communes avec au moins un mode au-dessus de la marge : {summary['communes_with_any_mode_above_margin']}")
    print(f"transports en commun, communes au-dessus de la marge : sens des écarts {summary['transit_above_margin_direction']}")
    print(f"écrit : {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
