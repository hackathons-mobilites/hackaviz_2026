"""08d - Chiffres du pitch relus dans les fichiers publiés (frontend/public/data/), tableau Markdown et JSON.

Écrit `data/processed/pitch_figures.json` et affiche le tableau à comparer avec `docs/pitch.md` (« Chiffres
prononcés et leur source »). Lecture seule de `frontend/`. À relancer après chaque publication (D-031, 44 astres).

Usage : python scripts/08d_pitch_figures.py [--origin 78358] [--neighbour 78418] [--budget 60]
"""

from __future__ import annotations

import argparse
import json

from starway import pitch_figures as pf
from starway.config import FRONT_DATA_DIR, PROCESSED_DIR


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--origin", default="78358")
    p.add_argument("--neighbour", default="78418")
    p.add_argument("--budget", type=int, default=60)
    args = p.parse_args()
    f = pf.figures(FRONT_DATA_DIR, args.origin, args.neighbour, args.budget)
    out = PROCESSED_DIR / "pitch_figures.json"
    out.write_text(json.dumps(f, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(pf.to_markdown(f))
    print(f"écrit : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
