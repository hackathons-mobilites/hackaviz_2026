"""07i - Durées de correspondance du calculateur officiel (Navitia, API PRIM « connections ») aux arrêts où le GTFS
n'en publie pas.

CONTRÔLE : rien n'est affiché ni corrigé. Constat qui motive ce script (04/11/2026) : `transfers.txt` du GTFS IDFM ne
relie jamais un arrêt à lui-même ; or dans le GTFS IDFM, les trains et RER d'une même gare s'arrêtent souvent au même
arrêt (`IDFM:monomodalStopPlace:...`, `location_type` 0). Une correspondance RER A <> train U à La Défense n'a donc
aucun minimum dans le GTFS, alors que Navitia en applique un (300 s à La Défense, lu ici). 07h a besoin de ces durées
pour dire si une correspondance « même arrêt » est plus courte que ce qu'applique le calculateur officiel.

Requêtes : `GET .../navitia/stop_points/{stop_point}/connections?count=1000`, une par arrêt, au plus une par seconde,
`--max-requests` au plus, cache partagé avec 07d (`data/interim/navitia_cache/`, clé `connections_{stop}`), clé PRIM
lue comme 07d (jamais écrite ni affichée). Arrêts demandés : ceux des correspondances « même arrêt » des itinéraires
publiés (sortie de 07h), par nombre de correspondances décroissant jusqu'à `--coverage` des correspondances « même
arrêt », plus tous les arrêts `monomodalStopPlace` ; avec `--no-line`, aussi les arrêts de départ des couples de quais
sans ligne `transfers.txt`.

Avec `--monomodal-missing N` (D-031 a2, 04/11) : en plus, les N premiers arrêts `monomodalStopPlace` du GTFS pas
encore en cache, rangés par nombre de lignes (`route_id`) qui les desservent puis par nombre de passages
(`stop_times.txt`, tous jours) : un minimum au même arrêt ne sert qu'entre deux courses, le plus souvent de deux
lignes. Ce rang est une priorité de relevé (quota PRIM), jamais une donnée du calcul. Tous les arrêts déjà en cache
sont relus (aucune requête).

Sorties : `data/processed/navitia_connections.csv` (une ligne par connexion Navitia : origine, destination, durée,
durée affichée, arrêt demandé), `data/processed/navitia_connections_summary.json` (couverture ; accord des durées
Navitia avec `min_transfer_time` pour les couples présents des deux côtés) et `data/processed/navitia_same_stop_min.csv`
(fichier dérivé lu par le moteur corrigé, D-031 a2 : un arrêt par ligne, durée Navitia de la connexion de l'arrêt vers
lui-même, date de la réponse ; un arrêt absent n'a aucune durée relevée et garde la règle d'origine de R5).

Usage : python scripts/07i_navitia_connections.py [--coverage 0.98] [--max-requests 300] [--no-line]
        [--monomodal-missing N] [--offline]
"""

from __future__ import annotations

import argparse
import importlib.util
import itertools
import json
import zipfile
from datetime import UTC, datetime

import pandas as pd

from starway import flux
from starway.config import INTERIM_DIR, PIPELINE_DIR, PROCESSED_DIR

TRANSFERS_ALL = INTERIM_DIR / "transfer_check" / "transfers_all.csv.gz"
OUT_CSV = PROCESSED_DIR / "navitia_connections.csv"
OUT_SUMMARY = PROCESSED_DIR / "navitia_connections_summary.json"
OUT_SAME_STOP = PROCESSED_DIR / "navitia_same_stop_min.csv"
GTFS = flux.gtfs_path("TRA01")  # fichier du manifeste (starway.flux), jamais un nom écrit en dur
SP = "stop_point:"
CACHE_DIR = INTERIM_DIR / "navitia_cache"


def load_07d():
    spec = importlib.util.spec_from_file_location("m07d", PIPELINE_DIR / "scripts" / "07d_navitia_crosscheck.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def wanted_stops(coverage: float, with_no_line: bool) -> list[str]:
    t = pd.read_csv(TRANSFERS_ALL, dtype=str)
    same = t[t["status"] == "same_stop"]
    vc = same["from_stop"].value_counts()
    cum = vc.cumsum() / len(same)
    # arrêts jusqu'à la couverture voulue (le premier qui la dépasse compris), puis tous les monomodalStopPlace
    keep = list(vc.index[: int((cum < coverage).sum()) + 1])
    keep += [s for s in vc.index if "monomodalStopPlace" in s and s not in keep]
    if with_no_line:
        nl = t[t["status"] == "no_line"]["from_stop"].value_counts()
        keep += [s for s in nl.index if s not in keep]
    return keep


def cached_stops() -> list[str]:
    """Arrêts dont la réponse « connections » est déjà en cache (clé `connections_{stop}`, `:` remplacés par `_`)."""
    return sorted(f.stem.removeprefix("connections_").replace("_", ":") for f in CACHE_DIR.glob("connections_*.json"))


def monomodal_ranked() -> pd.DataFrame:
    """Arrêts `monomodalStopPlace` du GTFS, nombre de lignes et de passages (tous jours), rangés par priorité de
    relevé : lignes décroissantes, puis passages décroissants, puis identifiant."""
    with zipfile.ZipFile(GTFS) as z:
        st = pd.read_csv(z.open("stops.txt"), dtype=str, usecols=["stop_id", "stop_name"])
        mono = set(st.loc[st["stop_id"].str.contains("monomodalStopPlace", regex=False), "stop_id"])
        parts = [c[c["stop_id"].isin(mono)] for c in pd.read_csv(z.open("stop_times.txt"), dtype=str,
                                                                 usecols=["trip_id", "stop_id"], chunksize=2_000_000)]
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "route_id"])
    s = pd.concat(parts).merge(trips, on="trip_id")
    g = s.groupby("stop_id").agg(stop_times=("trip_id", "size"), routes=("route_id", "nunique")).reset_index()
    g = st[st["stop_id"].isin(mono)].merge(g, on="stop_id", how="left").fillna({"stop_times": 0, "routes": 0})
    return g.sort_values(["routes", "stop_times", "stop_id"], ascending=[False, False, True]).reset_index(drop=True)


def same_stop_rows(df: pd.DataFrame, fetched_at: dict[str, str]) -> pd.DataFrame:
    """Connexions d'un arrêt vers lui-même -> une ligne par arrêt (durée Navitia en secondes, date de la réponse).
    Durée absente ou non positive : arrêt écarté (aucune valeur inventée)."""
    self_ = df[df["origin"] == df["destination"]].copy()
    self_["duration_s"] = pd.to_numeric(self_["duration_s"], errors="coerce")
    self_ = self_[self_["duration_s"] > 0]
    out = pd.DataFrame({"stop_id": self_["origin"], "same_stop_min_s": self_["duration_s"].astype(int),
                        "source": "navitia_connections", "fetched_at": self_["queried_stop"].map(fetched_at)})
    return out.drop_duplicates("stop_id").sort_values("stop_id").reset_index(drop=True)


def journeys_vs_gtfs(min_s: dict[tuple[str, str], int]) -> dict:
    """Correspondances des trajets Navitia déjà en cache (réponses /journeys de 07d, 07e, 07j) : écart entre l'arrivée
    d'un tronçon en TC et le départ du suivant, comparé au min_transfer_time du couple d'arrêts. Une correspondance
    vue dans plusieurs réponses n'est comptée qu'une fois (arrêts et heures identiques)."""
    def ts(v: str) -> datetime:
        return datetime.strptime(v, "%Y%m%dT%H%M%S")

    seen: set[tuple[str, str, str, str]] = set()
    ok = short = no_line = 0
    same: list[float] = []
    for f in sorted(CACHE_DIR.glob("*.json")):
        if f.name.startswith(("connections_", "probe_", "coverage")):
            continue
        body = (json.loads(f.read_text(encoding="utf-8")).get("body") or {})
        for j in body.get("journeys") or []:
            secs = j["sections"]
            pt = [i for i, x in enumerate(secs) if x["type"] == "public_transport"]
            for i, k in itertools.pairwise(pt):
                a, b = secs[i], secs[k]
                fa, fb = a["to"]["id"].removeprefix(SP), b["from"]["id"].removeprefix(SP)
                key = (fa, fb, a["arrival_date_time"], b["departure_date_time"])
                if key in seen:
                    continue
                seen.add(key)
                gap = (ts(b["departure_date_time"]) - ts(a["arrival_date_time"])).total_seconds()
                if fa == fb:
                    same.append(gap)
                elif (fa, fb) in min_s:
                    ok += gap >= min_s[(fa, fb)]
                    short += gap < min_s[(fa, fb)]
                else:
                    no_line += 1
    sm = pd.Series(same, dtype=float)
    return {"transfers_with_gtfs_line": ok + short, "shorter_than_gtfs_min": short, "no_gtfs_line": no_line,
            "same_stop": len(same), "same_stop_gap_s": {"min": None if sm.empty else float(sm.min()),
                                                    "median": None if sm.empty else float(sm.median())}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--coverage", type=float, default=0.98)
    ap.add_argument("--max-requests", type=int, default=300)
    ap.add_argument("--no-line", action="store_true", help="aussi les arrêts des couples sans ligne transfers.txt")
    ap.add_argument("--monomodal-missing", type=int, default=0,
                    help="aussi les N premiers arrêts monomodalStopPlace pas encore en cache (D-031 a2)")
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    m07d = load_07d()
    stops = wanted_stops(args.coverage, args.no_line)
    print(f"{len(stops)} arrêts à demander (couverture {args.coverage}, sans ligne : {args.no_line})")
    ranked = monomodal_ranked()
    have = set(cached_stops())
    missing_mono = [s for s in ranked["stop_id"] if s not in have and s not in stops]
    extra = missing_mono[: max(args.monomodal_missing, 0)]
    stops += extra + [s for s in sorted(have) if s not in stops and s not in extra]
    print(f"monomodalStopPlace : {len(ranked)} dans le GTFS, {len(missing_mono)} ni en cache ni demandés,"
          f" {len(extra)} ajoutés (--monomodal-missing {args.monomodal_missing}) ; {len(stops)} arrêts au total")
    client = m07d.Client(args.offline, args.max_requests)
    rows, missing, paged = [], [], []
    fetched_at: dict[str, str] = {}
    for k, sid in enumerate(stops, 1):
        rec = client.get(f"connections_{sid.replace(':', '_')}", f"/stop_points/{SP}{sid}/connections",
                         {"count": "1000"})
        body = (rec or {}).get("body") or {}
        if rec is None or rec.get("status_code") != 200:
            missing.append(sid)
            continue
        fetched_at[sid] = rec.get("fetched_at") or ""
        pg = body.get("pagination") or {}
        if pg.get("total_result", 0) > pg.get("items_on_page", 0):
            paged.append(sid)
        for c in body.get("connections") or []:
            rows.append({"queried_stop": sid, "origin": c["origin"]["id"].removeprefix(SP),
                         "destination": c["destination"]["id"].removeprefix(SP),
                         "duration_s": c.get("duration"), "display_duration_s": c.get("display_duration")})
        if k % 50 == 0:
            print(f"  {k}/{len(stops)} arrêts, {client.sent} requêtes envoyées")
    df = pd.DataFrame(rows, columns=["queried_stop", "origin", "destination", "duration_s", "display_duration_s"])
    df = df.drop_duplicates(["origin", "destination"])
    df.to_csv(OUT_CSV, index=False, encoding="utf-8")
    same_min = same_stop_rows(df, fetched_at)
    same_min.to_csv(OUT_SAME_STOP, index=False, encoding="utf-8")
    mono_known = ranked["stop_id"].isin(set(same_min["stop_id"]))

    with zipfile.ZipFile(GTFS) as z:
        tr = pd.read_csv(z.open("transfers.txt"), dtype=str)
    tr["min_s"] = tr["min_transfer_time"].astype(int)
    both = df.merge(tr, left_on=["origin", "destination"], right_on=["from_stop_id", "to_stop_id"], how="inner")
    self_ = df[df["origin"] == df["destination"]]
    t = pd.read_csv(TRANSFERS_ALL, dtype=str)
    same = t[t["status"] == "same_stop"]
    known_self = set(self_["origin"])
    summary = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stops_wanted": len(stops), "stops_answered": len(stops) - len(missing), "stops_missing": missing,
        "stops_paginated_incomplete": paged, "connections": len(df),
        "self_connections": len(self_),
        "self_duration_s": {str(k): int(v) for k, v in self_["duration_s"].value_counts().sort_index().items()},
        "same_stop_transfers_covered": int(same["from_stop"].isin(known_self).sum()),
        "same_stop_transfers_total": len(same),
        "gtfs_pairs_compared": len(both),
        "gtfs_pairs_equal_duration": int((both["duration_s"] == both["min_s"]).sum()),
        "gtfs_pairs_navitia_minus_gtfs_s": {"min": None if both.empty else int((both["duration_s"] - both["min_s"]).min()),
                                            "max": None if both.empty else int((both["duration_s"] - both["min_s"]).max())},
        "journeys_vs_gtfs": journeys_vs_gtfs(dict(zip(zip(tr["from_stop_id"], tr["to_stop_id"]), tr["min_s"],
                                                           strict=True))),
        "same_stop_min_file": {
            "stops": len(same_min), "monomodal_in_gtfs": len(ranked),
            "monomodal_with_duration": int(mono_known.sum()),
            "monomodal_without_duration": int((~mono_known).sum()),
            "monomodal_without_duration_multi_route": int((~mono_known & (ranked["routes"] >= 2)).sum()),
            "duration_s": {str(k): int(v) for k, v in same_min["same_stop_min_s"].value_counts().sort_index().items()}},
        "requests_sent_this_run": client.sent, "x_ratelimit_remaining_day": client.remaining_day,
        "stopped": client.stopped,
    }
    OUT_SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print({k: v for k, v in summary.items() if k not in ("stops_missing",)})
    print(f"Écrit : {OUT_CSV} ({len(df)} lignes), {OUT_SUMMARY}, {OUT_SAME_STOP} ({len(same_min)} arrêts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
