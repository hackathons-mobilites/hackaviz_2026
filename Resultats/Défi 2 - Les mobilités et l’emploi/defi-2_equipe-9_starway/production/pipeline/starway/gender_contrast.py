"""Contrôle du volet genre (plan d'origine) : l'écart femmes / hommes des modes domicile-travail dépasse-t-il la marge ?

Le plan n'active le volet « modes par sexe » (GEN01, INSEE NAV2A) que si quelques communes montrent un contraste
robuste. Ce module ne tranche pas : il compte, commune par commune et mode par mode, si l'écart F - H (en points de %)
dépasse la marge d'erreur à 95 % **publiée dans les données** (`margin95`, calculée d'après la fiche INSEE sur la
précision du recensement). Aucun seuil n'est inventé : la seule règle est « l'écart est plus grand que la marge
combinée sqrt(marge_F^2 + marge_H^2) » (deux estimations indépendantes). Une marge absente (`null`) rend le mode
« non évaluable », jamais « sans écart ».

Limite : un écart supérieur à la marge dit que la différence des parts n'est pas due au seul échantillonnage du
recensement. Il ne dit rien de la cause (âge, emploi, ménage, offre de transport...) : pas de causalité.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

MODES = ("transit", "car", "bike", "walk", "other")


def mode_contrast(f: float | None, h: float | None, mf: float | None, mh: float | None) -> dict[str, Any]:
    """Écart F - H d'un mode et son verdict (`above_margin`, `within_margin` ou `not_evaluable`)."""
    if f is None or h is None:
        return {"diff": None, "margin": None, "verdict": "not_evaluable", "reason": "part absente"}
    diff = round(f - h, 2)
    if mf is None or mh is None:
        return {"diff": diff, "margin": None, "verdict": "not_evaluable", "reason": "marge d'erreur absente"}
    margin = round(math.sqrt(mf * mf + mh * mh), 2)
    verdict = "above_margin" if abs(f - h) > margin else "within_margin"
    return {"diff": diff, "margin": margin, "verdict": verdict, "reason": None}


def commune_contrast(context: dict[str, Any]) -> dict[str, Any] | None:
    """Contraste d'une commune d'après son fichier `context/{insee}.json` ; None si GEN01 n'est pas publié."""
    block = context.get("commute_mode_by_sex")
    if not block or block.get("status") != "ok":
        return None
    women, men = block.get("F") or {}, block.get("H") or {}
    margins = block.get("margin95") or {}
    mw, mm = margins.get("F") or {}, margins.get("H") or {}
    totals = block.get("totals") or {}
    modes = {m: mode_contrast(women.get(m), men.get(m), mw.get(m), mm.get(m)) for m in MODES}
    return {
        "insee": context.get("insee"),
        "actifs_F": totals.get("F"),
        "actifs_H": totals.get("H"),
        "modes": modes,
        "above_margin": [m for m, v in modes.items() if v["verdict"] == "above_margin"],
    }


def load_contexts(context_dir: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(context_dir.glob("*.json")):
        res = commune_contrast(json.loads(path.read_text(encoding="utf-8")))
        if res is not None:
            out[path.stem] = res
    return out


def summarize(results: dict[str, dict[str, Any]], focus: list[str]) -> dict[str, Any]:
    """Comptes par mode (toutes communes) et détail des communes de `focus` (communes du récit)."""
    per_mode: dict[str, dict[str, int]] = {
        m: {"above_margin": 0, "within_margin": 0, "not_evaluable": 0} for m in MODES
    }
    for res in results.values():
        for m, v in res["modes"].items():
            per_mode[m][v["verdict"]] += 1
    transit_above = sorted(c for c, r in results.items() if "transit" in r["above_margin"])
    direction = {"F_higher": 0, "H_higher": 0}
    for c in transit_above:
        direction["F_higher" if results[c]["modes"]["transit"]["diff"] > 0 else "H_higher"] += 1
    return {
        "communes_evaluated": len(results),
        "per_mode": per_mode,
        "communes_with_any_mode_above_margin": sum(1 for r in results.values() if r["above_margin"]),
        "transit_above_margin_communes": len(transit_above),
        "transit_above_margin_direction": direction,
        "focus": {c: results[c] for c in focus if c in results},
        "focus_missing": [c for c in focus if c not in results],
    }
