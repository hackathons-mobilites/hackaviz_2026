"""04r - File des calculs de trajets alternatifs (D-055) : écrit `palier,insee`, relue par 04q à chaque commune.

Ordre décidé par Nicolas le 09/11/2026 : communes de la visite et des découvertes, puis toutes les autres par nombre d'actifs résidents
décroissant (actifs_F + actifs_H de context_communes_2023.csv, RP de l'Insee, jamais un classement à la main ; à égalité, code INSEE).
Une commune sans donnée d'actifs passe après les autres. `--previous` : garde après les nouvelles communes de tête celles d'une file
existante (quand 08e a produit les découvertes finales).

    python scripts/04r_alternatives_priority.py --out priorite.csv [--previous priorite.csv]
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

import pandas as pd

from starway import alternatives as alt
from starway.config import FRONT_DATA_DIR, PROCESSED_DIR, REPO_ROOT

TOUR_FILE = REPO_ROOT / "frontend/src/tour/tours/lea.tour.ts"


def visit_communes(text: str) -> list[str]:
    """Commune de Léa et commune comparée, lues dans le script de la visite ; échoue si le script change de forme."""
    m1 = re.search(r"origin:\s*'(\d{5})'", text)
    m2 = re.search(r"HORIZON_B\s*=\s*'(\d{5})'", text)
    if not m1 or not m2:
        raise SystemExit("communes de la visite introuvables dans lea.tour.ts")
    return [m1.group(1), m2.group(1)]


def discovery_communes(insights: list[dict]) -> list[str]:
    """Origine et commune comparée de chaque découverte, dans l'ordre publié."""
    out: list[str] = []
    for x in insights:
        out.append(x["scenario"]["o"])
        if x["scenario"].get("vs"):
            out.append(x["scenario"]["vs"])
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--insights", type=Path, default=FRONT_DATA_DIR / "insights.json")
    p.add_argument("--previous", type=Path, default=None)
    args = p.parse_args()
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    valid = set(communes.loc[communes["is_origin"], "insee"])
    head = [c for c in [*visit_communes(TOUR_FILE.read_text(encoding="utf-8")),
                        *discovery_communes(json.loads(args.insights.read_text(encoding="utf-8")))] if c in valid]
    if args.previous is not None:
        old = pd.read_csv(args.previous, dtype={"insee": str})
        head += old.loc[old["palier"] == 1, "insee"].tolist()
    ctx = pd.read_csv(PROCESSED_DIR / "context_communes_2023.csv", dtype={"insee": str})
    ctx["actifs"] = pd.to_numeric(ctx["actifs_F"], errors="coerce") + pd.to_numeric(ctx["actifs_H"], errors="coerce")
    ranked = ctx[ctx["insee"].isin(valid)].sort_values(["actifs", "insee"], ascending=[False, True], na_position="last")["insee"].tolist()
    missing = sorted(valid - set(ranked))
    rows = alt.priority_rows(head, [*ranked, *missing])
    tmp = args.out.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["palier", "insee"])
        w.writerows(rows)
    tmp.replace(args.out)
    print(f"{len(rows)} lignes, {len(dict.fromkeys(head))} communes en tête, {len(valid)} communes de départ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
