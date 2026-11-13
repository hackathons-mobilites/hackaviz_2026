"""06i - Abonnements (D-032 proposée) : catalogue publié, durées des courses Vélib', effet sur les trajets publiés.

Écrit :
    frontend/public/data/subscriptions.json        contrat `subscriptions-1` (contrats-donnees.md) : abonnements TC,
                                                   Vélib', vélo, voiture, prise en charge employeur, textes, et
                                                   `velib.rides` (durée de la partie vélo de chaque trajet Vélib'
                                                   publié, minutes, alignée sur poles.json)
    data/processed/subscriptions_effects.json      effet mesuré sur les itinéraires TC publiés (D-028) et sur les
                                                   trajets Vélib' publiés (D-027)

Entrées : data/raw/SUB01 à SUB05, COST01, COST02 (citations retrouvées dans les fichiers gardés, sinon échec) ;
frontend/public/data/itineraries/*.json.gz et access/*.json (publiés) ; data/interim/matrix_velib/ (04d : stations
retenues et matrice des durées vélo entre stations). Lecture seule de tout le reste : meta.json n'est pas réécrit
(le front lit subscriptions.json à part ; 404 = zone « Mes abonnements » masquée).

Usage : python scripts/06i_export_subscriptions.py [--check-only]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from starway import itin_sets as iss
from starway.config import (
    FRONT_DATA_DIR,
    INTERIM_DIR,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    RAW_DIR,
    SERVICE_DATE,
    SKY_DEFAULT,
    sky_front_dir,
)
from starway.export import write_json
from starway.sources import sha256_of
from starway.subscription_catalog import build_catalog, check_quotes, to_json
from starway.subscriptions import CONTRACT, DECISION, leg_counts, transit_effects, velib_effects

VELIB_DIR = INTERIM_DIR / "matrix_velib"  # 15 pôles ; 44 astres : matrix_velib_b44 (voir main)
OUT = FRONT_DATA_DIR / "subscriptions.json"
EFFECTS = PROCESSED_DIR / "subscriptions_effects.json"


def published_itineraries(front: Path = FRONT_DATA_DIR) -> dict[str, dict]:
    """Itinéraires publiés (`{insee}.json.gz`, format du 04/11 : starway.itin_sets)."""
    return dict(iss.iter_docs(front / "itineraries"))


def velib_rides(pole_ids: list[str], velib_dir: Path = VELIB_DIR,
                front: Path = FRONT_DATA_DIR) -> tuple[dict[str, dict[str, list[int | None]]], list[str]]:
    """Durée de la partie vélo (minutes entières de R5) du trajet Vélib' publié, par origine et pôle, aller et retour.
    Contrôlée contre access/{insee}.json publié : une durée existe si et seulement si le sens publié existe, et elle
    ne dépasse pas la durée porte à porte."""
    z = np.load(velib_dir / "legs.npz", allow_pickle=False)
    stations = [str(s) for s in z["stations"]]
    idx = {s: i for i, s in enumerate(stations)}
    bike = z["bike_s_s"]
    v = pd.read_csv(velib_dir / "velib_any.csv", dtype=str)
    problems: list[str] = []
    rides: dict[str, dict[str, list[int | None]]] = {}
    for insee, g in v.groupby("from_id"):
        acc_path = front / "access" / f"{insee}.json"
        acc = json.loads(acc_path.read_text(encoding="utf-8")) if acc_path.exists() else {}
        pub = ((acc.get("modes") or {}).get("velib") or {}).get("any")
        if pub is None:
            problems.append(f"{insee} : Vélib' absent de access/ publié")
            continue
        by_pole = {r.to_id: r for r in g.itertuples(index=False)}
        rec: dict[str, list[int | None]] = {"out": [], "ret": []}
        for i, pid in enumerate(pole_ids):
            r = by_pole.get(pid)
            for leg, a, b in (("out", "out_s1", "out_s2"), ("ret", "ret_s1", "ret_s2")):
                total = pub[leg][i]
                s1, s2 = (getattr(r, a), getattr(r, b)) if r is not None else (None, None)
                if total is None or not isinstance(s1, str) or not isinstance(s2, str):
                    if total is not None:
                        problems.append(f"{insee} {pid} {leg} : durée publiée sans stations")
                    rec[leg].append(None)
                    continue
                if s1 not in idx or s2 not in idx:
                    problems.append(f"{insee} {pid} {leg} : station {s1} ou {s2} absente de legs.npz")
                    rec[leg].append(None)
                    continue
                t = float(bike[idx[s1], idx[s2]])
                if not np.isfinite(t) or t != int(t) or t > total:
                    problems.append(f"{insee} {pid} {leg} : durée vélo {t} incohérente (total {total})")
                    rec[leg].append(None)
                    continue
                rec[leg].append(int(t))
        rides[str(insee)] = rec
    return rides, problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-only", action="store_true", help="contrôles seulement, rien n'est écrit")
    ap.add_argument("--astres", choices=["44"], default=SKY_DEFAULT,
                    help="ciel des pôles : 44 astres (racine, Vélib' `_b44` ; seul ciel depuis D-054)")
    args = ap.parse_args()
    front = sky_front_dir(args.astres)
    out_path = front / "subscriptions.json"
    velib_dir = INTERIM_DIR / "matrix_velib_b44"

    poles = json.loads((front / "poles.json").read_text(encoding="utf-8"))
    pole_ids = [x["id"] for x in poles]
    itins = published_itineraries(front)
    ter_legs = 0
    pairs: list[tuple[dict | None, dict | None]] = []
    for insee, it in itins.items():
        if it.get("poles") != pole_ids:
            print(f"[ECHEC] itineraries/{insee}.json.gz : ordre des pôles différent de poles.json", file=sys.stderr)
            return 1
        for day in it["days"].values():
            for o, r in zip(day["out"], day["ret"], strict=True):
                pairs.append((o, r))
                for t in (o, r):
                    if t and t.get("status") == "ok":
                        ter_legs += leg_counts(t.get("legs") or [])["ter"]

    catalog = build_catalog(RAW_DIR, ter_legs)
    bad = check_quotes(catalog, RAW_DIR, sha256_of)
    for b in bad:
        print(f"[ECHEC] citation introuvable : {b}", file=sys.stderr)
    rides, problems = velib_rides(pole_ids, velib_dir, front)
    for pb in problems:
        print(f"[ECHEC] Vélib' : {pb}", file=sys.stderr)
    if bad or problems:
        return 1

    cat = to_json(catalog)
    options = cat["transit"]["options"]
    day_pass = next((o for o in options if o["id"] == "navigo_day"), None)
    effects = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "itineraries_communes": len(itins),
        "transit": transit_effects(pairs, options, cat["transit"]["extra_titles"], day_pass,
                                   cat["transit"]["unpriced_agencies"]),
        "velib": velib_effects(rides, cat["velib"]["offers"]),
    }
    out = {"contract": CONTRACT, "processing_version": PROCESSING_VERSION, "decision": DECISION,
           "generated_at": effects["generated_at"], "service_date": SERVICE_DATE.isoformat(),
           "price_validity": "tarifs IDFM au 1er janvier 2026 ; Vélib' : souscriptions à partir du 12 août 2025 ; en "
                             "vigueur le jour de service",
           **cat}
    out["velib"]["rides"] = rides
    out["velib"]["rides_rule"] = ("durée de la partie vélo (station de prise vers station de dépose retenues par 04d), "
                                  "minutes entières de R5 (secondes divisées par 60, arrondi inférieur) ; alignée sur "
                                  "poles.json ; null si le trajet Vélib' publié est null")
    print(json.dumps({k: v for k, v in effects["transit"].items() if k != "by_option"}, ensure_ascii=False))
    for k, v in effects["transit"]["by_option"].items():
        print(f"  {k:20} {v}")
    print(json.dumps(effects["velib"], ensure_ascii=False))
    if args.check_only:
        return 0
    size = write_json(out_path, out)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    effects_path = EFFECTS
    effects_path.write_text(json.dumps(effects, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out_path.name} : {size / 1024:.1f} Ko ; {effects_path.name} écrit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
