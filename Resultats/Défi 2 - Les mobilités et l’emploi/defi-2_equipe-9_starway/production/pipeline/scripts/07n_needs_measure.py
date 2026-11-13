"""07n - Mesure de « Ce qu'il me faut sur mon trajet » (D-034, version finale du 05/11/2026) : pour chaque case, la part des
allers-retours dont le trajet le plus rapide est déclaré rempli sur TOUS les tronçons en TC, aller ET retour.

Lit les itinéraires publiés (`itineraries/` réglage normal, `itineraries_walk1000/` confort ; champs `wc_*` de 06h et
`a11y` de 06n) ; n'écrit que le JSON demandé par --out. Aucun appel externe. La règle est celle de `starway/needs.py`
(`box_state`, `star_marked`), la même que celle du ciel : si Sara la change, ce script suit.

Dénominateur : les couples (commune, pôle, journée) dont l'aller ET le retour ont un itinéraire détaillé (`status: ok`).
Parmi eux, ceux sans tronçon en TC (marche seule) sont comptés à part : leurs cases ne sont jamais remplies. Deuxième
mesure : la même, restreinte aux couples dont les deux sens tiennent dans le budget (--budget, 60 min par défaut), qui
est ce que le ciel marque. Non pondéré par les habitants ni par les postes.

Usage :
    python scripts/07n_needs_measure.py                                  # 44 astres ou 15 pôles selon FRONT_DATA_DIR
    python scripts/07n_needs_measure.py --data-dir <dossier public/data> --out data/processed/needs_measure_44.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from starway import needs as nd
from starway.config import FRONT_DATA_DIR

SETS = {"normal": "itineraries", "comfort": "itineraries_walk1000"}


def _minutes(t: Mapping[str, Any]) -> float | None:
    v = t.get("matrix_min", t.get("min"))
    return float(v) if isinstance(v, int | float) else None


def line_filled(legs: Sequence[Mapping[str, Any]]) -> bool:
    """Ancien critère (hors cases) : champ général de la ligne (TRA03) « true » sur tous les tronçons en TC."""
    rides = [lg for lg in legs if lg.get("m") not in (None, "walk")]
    return bool(rides) and all((lg.get("a11y") or {}).get("line") == "true" for lg in rides)


def measure_doc(doc: Mapping[str, Any], budget: int, acc: dict[str, Counter]) -> None:
    for day, dirs in doc["days"].items():
        outs, rets = dirs.get("out", []), dirs.get("ret", [])
        for out, ret in zip(outs, rets, strict=False):
            if out.get("status") != "ok" or ret.get("status") != "ok" or not out.get("legs") or not ret.get("legs"):
                continue
            mo, mr = _minutes(out), _minutes(ret)
            scopes = ["all"] + (["budget"] if mo is not None and mr is not None and mo <= budget and mr <= budget else [])
            ol, rl = out["legs"], ret["legs"]
            has_ride = bool(nd.tc_legs(ol)) and bool(nd.tc_legs(rl))
            for scope in scopes:
                c = acc[scope]
                c["pairs"] += 1
                c["with_ride"] += has_ride
                c["walk_only"] += not has_ride
                c["line_tra03"] += line_filled(ol) and line_filled(rl)
                both = {b: nd.box_state(b, ol) in (nd.FILLED, nd.NO_STATION) and nd.box_state(b, rl) in (nd.FILLED, nd.NO_STATION)
                        for b in nd.BOXES}
                for b in nd.BOXES:
                    c[f"box_{b}"] += both[b]
                c["no_station_both"] += nd.box_state("station", ol) == nd.NO_STATION and nd.box_state("station", rl) == nd.NO_STATION
                c["wc_trip+wc_stops"] += both["wc_trip"] and both["wc_stops"]
                c["wc_trip+wc_stops+station"] += both["wc_trip"] and both["wc_stops"] and both["station"]
                c["marked_1_2_3"] += nd.star_marked(ol, rl, nd.SKY_BOXES)
                c["audio+visual"] += both["audio"] and both["visual"]


def summarize(c: Counter) -> dict[str, Any]:
    n = c["pairs"]
    pct = lambda k: round(100 * c[k] / n, 1) if n else None  # noqa: E731
    return {
        "pairs": n, "with_ride": c["with_ride"], "walk_only": c["walk_only"],
        "pct": {
            "line_tra03_not_a_box": pct("line_tra03"),
            "1_wc_trip": pct("box_wc_trip"),
            "2_wc_stops": pct("box_wc_stops"),
            "3_station": pct("box_station"),
            "3_station_only_trips_without_rail_station": pct("no_station_both"),
            "4_audio": pct("box_audio"),
            "5_visual": pct("box_visual"),
            "1+2": pct("wc_trip+wc_stops"),
            "1+2+3": pct("wc_trip+wc_stops+station"),
            "marked_1_2_3": pct("marked_1_2_3"),
            "4+5": pct("audio+visual"),
        },
        "counts": {k: c[k] for k in sorted(c)},
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-dir", type=Path, default=FRONT_DATA_DIR, help="dossier public/data (itineraries*/ et meta.json)")
    p.add_argument("--budget", type=int, default=60, help="budget (min) de la mesure « dans le budget »")
    p.add_argument("--out", type=Path, help="écrit le résultat en JSON")
    args = p.parse_args()

    result: dict[str, Any] = {"data_dir": args.data_dir.name, "budget_min": args.budget, "rule": "starway.needs.star_marked"}
    for name, sub in SETS.items():
        files = nd.doc_files(args.data_dir / sub)
        if not files:
            continue
        acc: dict[str, Counter] = {"all": Counter(), "budget": Counter()}
        poles = None
        for f in files:
            doc = nd.read_doc(f)
            poles = len(doc.get("poles", []))
            if "needs_meta" not in doc:
                print(f"{f.name} : sans needs_meta, lancer 06n", file=sys.stderr)
                return 1
            measure_doc(doc, args.budget, acc)
        result[name] = {"dir": sub, "files": len(files), "poles": poles,
                        "all_pairs": summarize(acc["all"]), f"within_{args.budget}_min": summarize(acc["budget"])}
    if len(result) == 3:
        print("aucun itinéraire publié", file=sys.stderr)
        return 1
    text = json.dumps(result, ensure_ascii=False, indent=1)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
