"""Chiffres du pitch relus dans les fichiers publiés (jamais de mémoire).

Le tableau « Chiffres prononcés et leur source » de `docs/pitch.md` donne, pour la visite de Léa, des valeurs lues
le 03/11. Ce module les recalcule depuis `frontend/public/data/` (`poles.json`, `access/{insee}.json`,
`meta.json`, `insights.json`) avec la règle du site : un pôle est allumé si l'aller ET le retour valent chacun
au plus le temps de trajet choisi. Aucune valeur n'est écrite à la main ; si les fichiers ne sont pas alignés sur
`poles.json` (nombre de pôles différent), le calcul s'arrête au lieu de deviner.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from starway.gold import NO_COMMUNE_TRANSIT, CommuneParts, CommuneTransit, gold_delta


def lit_poles(series: dict[str, Any], budget: int) -> list[bool]:
    """États allumés (aller et retour mesurés, chacun <= budget) pour une série `{out, ret, ...}`."""
    return [
        o is not None and r is not None and o <= budget and r <= budget
        for o, r in zip(series["out"], series["ret"], strict=True)
    ]


def reach(poles: list[dict[str, Any]], lit: list[bool]) -> dict[str, Any]:
    if len(poles) != len(lit):
        raise ValueError(f"{len(lit)} états pour {len(poles)} pôles : fichiers non alignés sur poles.json")
    on = [p for p, ok in zip(poles, lit, strict=True) if ok]
    return {"poles": len(on), "jobs": sum(int(p["jobs"]) for p in on), "ids": [p["id"] for p in on]}


def scenario(poles: list[dict[str, Any]], access: dict[str, Any], mode: str, day: str, budget: int) -> dict[str, Any]:
    return reach(poles, lit_poles(access["modes"][mode][day], budget))


def figures(data_dir: Path, origin: str = "78358", neighbour: str = "78418", budget: int = 60,
            commune_parts: CommuneParts | None = None) -> dict[str, Any]:
    """`commune_parts` : part TC commune par commune (D-056) ; par défaut, la table publiée dans `data_dir`."""
    poles = json.loads((data_dir / "poles.json").read_text(encoding="utf-8"))
    meta = json.loads((data_dir / "meta.json").read_text(encoding="utf-8"))
    a = json.loads((data_dir / "access" / f"{origin}.json").read_text(encoding="utf-8"))
    b = json.loads((data_dir / "access" / f"{neighbour}.json").read_text(encoding="utf-8"))
    d09 = scenario(poles, a, "transit", "d09", budget)
    d14 = scenario(poles, a, "transit", "d14", budget)
    out: dict[str, Any] = {
        "origin": origin,
        "neighbour": neighbour,
        "budget_min": budget,
        "processing_version": meta.get("processing_version"),
        "poles_in_sky": len(poles),
        "communes": len(meta.get("access_communes") or []),
        "origin_d09_transit": d09,
        "origin_d14_transit": d14,
        "neighbour_d09_transit": scenario(poles, b, "transit", "d09", budget),
        "eclipse": {
            "poles_delta": d14["poles"] - d09["poles"],
            "jobs_delta": d14["jobs"] - d09["jobs"],
        },
    }
    if "bike_transit" in (a.get("modes") or {}):
        bt = scenario(poles, a, "bike_transit", "d14", budget)
        out["origin_d14_bike_transit"] = bt
        if commune_parts is None and (table := CommuneTransit.from_front(data_dir)) is not None:
            commune_parts = table.parts
        parts = commune_parts(origin, "d14", budget) if commune_parts is not None else None
        gold, lost = gold_delta(a["modes"]["transit"]["d14"], a["modes"]["bike_transit"]["d14"], budget, parts)
        if gold is None:
            # Sans ciel TC commune par commune, aucun or (même règle que le site) : jamais un 0, jamais l'ancien calcul
            out["gain_bike_transit_d14"] = {"poles_gained": None, "jobs_gained": None, "ids": None,
                                            "poles_lost": len(lost), "status": NO_COMMUNE_TRANSIT}
        else:
            out["gain_bike_transit_d14"] = {
                "poles_gained": len(gold),
                "jobs_gained": sum(int(poles[i]["jobs"]) for i in gold),
                "ids": [poles[i]["id"] for i in gold],
                "poles_lost": len(lost),
            }
    return out


def _n(value: int) -> str:
    """Entier avec des espaces entre les milliers."""
    return f"{value:,}".replace(",", " ")


def to_markdown(f: dict[str, Any]) -> str:
    rows = [
        ("Maisons-Laffitte, 9h-17h, transports en commun", f["origin_d09_transit"]),
        ("Maisons-Laffitte, 14h-22h, transports en commun", f["origin_d14_transit"]),
        ("Montesson, 9h-17h, transports en commun", f["neighbour_d09_transit"]),
    ]
    if "origin_d14_bike_transit" in f:
        rows.append(("Maisons-Laffitte, 14h-22h, vélo + TC", f["origin_d14_bike_transit"]))
    lines = [
        f"Valeurs relues dans les fichiers publiés (version de traitement {f['processing_version']}), "
        f"{f['poles_in_sky']} astres, {f['budget_min']} min par sens, {f['communes']} communes.",
        "",
        "| Scénario | Astres allumés | Postes salariés (INSEE) |",
        "|---|---|---|",
    ]
    lines += [f"| {name} | {r['poles']} | {_n(r['jobs'])} |" for name, r in rows]
    e = f["eclipse"]
    lines.append("")
    lines.append(f"Éclipse (14h-22h moins 9h-17h) : {e['poles_delta']} astres, {_n(e['jobs_delta'])} postes.")
    if "gain_bike_transit_d14" in f:
        g = f["gain_bike_transit_d14"]
        if g["poles_gained"] is None:
            lines.append("Gain du vélo + TC à 14h-22h : non calculable (ciel TC commune par commune illisible, D-056).")
        else:
            lines.append(
                f"Gain du vélo + TC à 14h-22h (or, D-056) : {g['poles_gained']} astres de plus, "
                f"{_n(g['jobs_gained'])} postes ; astres perdus : {g['poles_lost']}."
            )
    return "\n".join(lines) + "\n"
