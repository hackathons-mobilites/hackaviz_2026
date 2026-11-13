"""07k - Recoupement des prix au ticket (D-028) avec le bloc `fare` du calculateur officiel (Navitia, API PRIM).

CONTRÔLE : rien n'est affiché ni corrigé. Pour chaque trajet publié (commune, pôle, journée-type, sens) dont une réponse
Navitia /journeys est en cache, on cherche le trajet Navitia qui prend EXACTEMENT les mêmes lignes dans le même ordre
(codes de ligne, `display_informations.code` contre `line` de l'itinéraire publié) et on compare son prix
(`fare.total`, centimes, plein tarif) au prix au ticket publié (`tickets.cost_eur`). Sans trajet aux mêmes lignes : pas de
comparaison (statut `no_same_lines`). Le prix Navitia n'est jamais repris dans le site.

Deux modes :
- `--offline` (DÉFAUT) : lit seulement le cache existant (`data/interim/navitia_cache/`, réponses de 07d et 07j :
  mêmes paramètres de requête). Aucune requête, aucun quota consommé ;
- `--online --max-requests N` : complète avec des requêtes pour un échantillon de trajets publiés choisis pour leur
  prix (ticket aéroport, Orlyval, TER, correspondance par la rue, bus puis train, trajet simple), mêmes paramètres et
  même client que 07d (clé PRIM lue dans l'environnement ou `.env`, jamais écrite ni affichée ; une requête par
  seconde au plus ; arrêt au premier HTTP 429 ; tout en cache). PAS LANCÉ le 04/11/2026 : le quota du jour est
  réservé au chantier D-031.

Sorties : `data/processed/navitia_fares_check.csv` (une ligne par trajet comparé) et
`data/processed/navitia_fares_check_summary.json` (comptes par statut, écarts).

Usage :
    python scripts/07k_navitia_fares.py                       # cache seul
    python scripts/07k_navitia_fares.py --online --max-requests 60 --per-kind 10
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import random
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from starway import itin_sets as iss
from starway.config import FRONT_DATA_DIR, INTERIM_DIR, PIPELINE_DIR, PROCESSED_DIR
from starway.subscriptions import leg_counts

CACHE_DIR = INTERIM_DIR / "navitia_cache"
OUT_CSV = PROCESSED_DIR / "navitia_fares_check.csv"
OUT_SUMMARY = PROCESSED_DIR / "navitia_fares_check_summary.json"
SKIP_PREFIXES = ("connections_", "probe_", "coverage", "diag_")


def norm_code(s: str | None) -> str:
    return (s or "").strip().upper()


def our_lines(trip: dict) -> tuple[str, ...]:
    return tuple(norm_code(lg.get("line")) for lg in trip.get("legs") or [] if lg.get("m") != "walk")


def navitia_options(body: dict) -> list[dict[str, Any]]:
    """Trajets Navitia d'une réponse : lignes (codes), prix (euros ou None) et `found`."""
    out = []
    for j in body.get("journeys") or []:
        lines = tuple(norm_code((s.get("display_informations") or {}).get("code"))
                      for s in j.get("sections") or [] if s.get("type") in ("public_transport", "on_demand_transport"))
        fare = j.get("fare") or {}
        total = (fare.get("total") or {}).get("value")
        eur = round(float(total) / 100, 2) if fare.get("found") and total not in (None, "") else None
        out.append({"lines": lines, "eur": eur, "found": bool(fare.get("found"))})
    return out


def compare(trip: dict, body: dict) -> dict[str, Any]:
    """Statut : `same_price`, `different_price`, `navitia_no_fare` (trajet aux mêmes lignes, prix non trouvé),
    `no_same_lines`, `starway_unknown` (prix publié null)."""
    lines = our_lines(trip)
    tk = trip.get("tickets") or {}
    ours = tk.get("cost_eur")
    same = [o for o in navitia_options(body) if o["lines"] == lines]
    row = {"lines": " > ".join(lines), "starway_eur": ours, "starway_status": tk.get("status"),
           "navitia_eur": None, "n_navitia": len(navitia_options(body))}
    if not same:
        return {**row, "status": "no_same_lines"}
    prices = sorted({o["eur"] for o in same if o["eur"] is not None})
    if not prices:
        return {**row, "status": "navitia_no_fare"}
    row["navitia_eur"] = prices[0] if len(prices) == 1 else "/".join(f"{p:.2f}" for p in prices)
    if ours is None:
        return {**row, "status": "starway_unknown"}
    return {**row, "status": "same_price" if any(abs(p - float(ours)) < 0.005 for p in prices) else "different_price"}


def fare_kind(trip: dict) -> str:
    """Famille de prix d'un trajet publié (pour l'échantillon en ligne)."""
    tk = trip.get("tickets") or {}
    c = leg_counts(trip.get("legs") or [])
    if c["orlyval"]:
        return "orlyval"
    if tk.get("airport"):
        return "airport"
    if c["ter"]:
        return "ter"
    if tk.get("status") == "street_transfer_unverified":
        return "street_transfer"
    if tk.get("bus_tram") and tk.get("metro_train_rer"):
        return "bus_and_rail"
    return "simple"


def published() -> dict[str, dict]:
    """Itinéraires publiés (`{insee}.json.gz`, format du 04/11 : starway.itin_sets)."""
    return dict(iss.iter_docs(FRONT_DATA_DIR / "itineraries"))


def trip_of(itins: dict[str, dict], insee: str, pole: str, day: str, leg: str) -> dict | None:
    it = itins.get(insee)
    if not it or pole not in it["poles"]:
        return None
    t = ((it["days"].get(day) or {}).get(leg) or [None] * len(it["poles"]))[it["poles"].index(pole)]
    return t if t and t.get("status") == "ok" else None


def cached_bodies() -> list[tuple[tuple[str, str, str, str], dict]]:
    """(commune, pôle, journée, sens) et corps de réponse des fichiers /journeys du cache (nom de 07d :
    `{insee}_{pole}_{day}_{leg}_{hash}.json`)."""
    out = []
    for f in sorted(CACHE_DIR.glob("*.json")):
        if f.name.startswith(SKIP_PREFIXES):
            continue
        parts = f.stem.split("_")
        if len(parts) < 5:
            continue
        insee, day, leg = parts[0], parts[-3], parts[-2]
        pole = "_".join(parts[1:-3])
        rec = json.loads(f.read_text(encoding="utf-8"))
        if rec.get("status_code") != 200 or not rec.get("body"):
            continue
        out.append(((insee, pole, day, leg), rec["body"]))
    return out


def load_07d():
    spec = importlib.util.spec_from_file_location("m07d", PIPELINE_DIR / "scripts" / "07d_navitia_crosscheck.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def online_requests(itins: dict[str, dict], have: set[tuple[str, str, str, str]], per_kind: int, max_requests: int,
                    seed: int) -> list[tuple[tuple[str, str, str, str], dict]]:
    """Requêtes Navitia pour un échantillon de trajets publiés par famille de prix (mêmes paramètres que 07d)."""
    m = load_07d()  # mêmes réglages, paramètres, clé de cache et client que 07d (réglage de marche par défaut)
    sw = m.Starway(m.WALK_SETTING_DEFAULT)
    lim = m.WALK_SETTINGS_M[m.WALK_SETTING_DEFAULT]
    settings = m.aligned_settings(m.SPEED_WALKING_KMH, m.MAX_TRIP_MIN, lim, m.R5_MAX_PUBLIC_TRANSPORT_RIDES,
                                  m.walk_time_limit_min(lim, m.SPEED_WALKING_KMH))
    client = m.Client(False, max_requests)

    def request(insee: str, pole: str, day: str, leg: str) -> tuple[str, dict[str, str]]:
        dt = m.DAY_TYPES_BY_ID[day]
        start, end = m.day_bounds(m.SERVICE_DATE, dt.start, dt.end)
        c, p = sw.communes[insee], sw.pole_by_id[pole]
        here, there = m.coord(c["origin"]["lon"], c["origin"]["lat"]), m.coord(p["point"]["lon"], p["point"]["lat"])
        params = (m.request_params(here, there, start, "arrival", "out", settings) if leg == "out"
                  else m.request_params(there, here, end, "departure", "ret", settings))
        return m.cache_key(m.Trip(insee, pole, day, leg), params), params

    by_kind: dict[str, list[tuple[str, str, str, str]]] = {}
    for insee, it in itins.items():
        for day, v in it["days"].items():
            for leg in ("out", "ret"):
                for i, t in enumerate(v[leg]):
                    if t and t.get("status") == "ok":
                        key = (insee, it["poles"][i], day, leg)
                        if key not in have:
                            by_kind.setdefault(fare_kind(t), []).append(key)
    rnd = random.Random(seed)
    picked = [k for kind in sorted(by_kind) for k in rnd.sample(by_kind[kind], min(per_kind, len(by_kind[kind])))]
    out = []
    for key in picked:
        name, params = request(*key)
        rec = client.get(name, "/journeys", params)
        if rec is None:
            print(f"arrêt : {client.stopped}")
            break
        if rec.get("status_code") == 200 and rec.get("body"):
            out.append((key, rec["body"]))
    print(f"{client.sent} requêtes envoyées")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", default=True, help="cache seul (défaut)")
    mode.add_argument("--online", action="store_true", help="complète avec des requêtes PRIM (quota)")
    ap.add_argument("--max-requests", type=int, default=0, help="plafond de requêtes de ce lancement (en ligne)")
    ap.add_argument("--per-kind", type=int, default=10, help="trajets par famille de prix (en ligne)")
    ap.add_argument("--seed", type=int, default=20261117)
    args = ap.parse_args()

    itins = published()
    bodies = cached_bodies()
    if args.online:
        if args.max_requests <= 0:
            sys.exit("--online demande --max-requests > 0")
        bodies += online_requests(itins, {k for k, _ in bodies}, args.per_kind, args.max_requests, args.seed)
    rows = []
    for (insee, pole, day, leg), body in bodies:
        t = trip_of(itins, insee, pole, day, leg)
        if t is None:
            continue
        rows.append({"insee": insee, "pole_id": pole, "day": day, "leg": leg, "fare_kind": fare_kind(t),
                     **compare(t, body)})
    df = pd.DataFrame(rows).drop_duplicates(subset=["insee", "pole_id", "day", "leg", "lines"])
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_CSV, index=False, encoding="utf-8")
    counts = Counter(df["status"]) if len(df) else Counter()
    diff = df[df["status"] == "different_price"] if len(df) else df
    summary = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": "online" if args.online else "offline",
        "cache_files_read": len(bodies), "trips_compared": len(df),
        "statuses": dict(counts),
        "by_fare_kind": {k: dict(Counter(g["status"])) for k, g in df.groupby("fare_kind")} if len(df) else {},
        "different_examples": diff.head(15).to_dict(orient="records") if len(diff) else [],
        "rule": "même suite de codes de ligne ; prix Navitia fare.total (centimes, plein tarif) contre tickets.cost_eur",
    }
    Path(OUT_SUMMARY).write_text(json.dumps(summary, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("mode", "cache_files_read", "trips_compared", "statuses", "by_fare_kind")},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
