"""06h - Export des itinéraires TC détaillés (04h, D-028 adoptée le 03/11/2026) : un fichier par commune.

Format (04/11/2026) : `{insee}.json.gz`, JSON minifié du contrat `itineraries-*` compressé en gzip (starway.itin_sets).
Par défaut, aperçu dans data/processed/itineraries_preview[_walk1000]/ (toutes les communes présentes dans les lots).
`--publish` : écrit le dossier publié du réglage de marche (`itineraries/` pour « normal », `itineraries_walk1000/`
pour « confort ») pour les SEULES communes complètes (15 pôles x 3 journées x 2 sens dans les lots de 04h) dont le
fichier reprend exactement la matrice publiée (access/{insee}.json, `modes.transit` ou `variants.comfort.transit`),
supprime les autres fichiers du dossier (dont l'ancien format `.json`), puis réécrit les annonces de meta.json
(`itineraries_communes`, `itineraries_variants`, `itineraries_format`, `line_facts` : starway.itin_meta) et
rafraîchit sources.json depuis le manifeste (même fonction que 06). 06 relit les annonces dans les dossiers publiés.

Lit : data/interim/itineraries_walk{3000,1000}/batches/*.jsonl.gz (04h), offpeak_1100.csv (04h --offpeak, réglage
« normal » seulement), GTFS IDFM (routes, agency, stops, trips, transfers), poles.json, référentiel des lignes IDFM
(TRA03, climatisation) et ponctualité mensuelle Transilien (QS01). Applique tickets et carbone (starway.fares_carbon)
et les faits par ligne (starway.line_facts), contrôle chaque fichier (starway.itin_export.check_file) et échoue
(exit 1) au premier fichier incohérent.

Usage :
    python scripts/06h_export_itineraries.py                                    # aperçu, tous les lots présents
    python scripts/06h_export_itineraries.py --bench                            # bench_records.jsonl.gz (format)
    python scripts/06h_export_itineraries.py --publish                          # « normal » -> itineraries/
    python scripts/06h_export_itineraries.py --publish --walk-setting comfort   # -> itineraries_walk1000/

Après --publish, les fichiers du réglage ne portent plus le marquage des correspondances (D-031 c) : relancer 07h
puis 06t avec le même `--walk-setting`.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import zipfile
from pathlib import Path

import pandas as pd

from starway import fares_carbon as fc
from starway import flux, itin_meta
from starway import itin_export as ie
from starway import itin_sets as iss
from starway import itineraries as it
from starway import line_facts as lf
from starway import night_network as nn
from starway.config import (
    DAY_TYPES,
    FRONT_DATA_DIR,
    MAX_TRIP_MIN,
    PROCESSED_DIR,
    PROCESSING_VERSION,
    RAW_DIR,
    SERVICE_DATE,
    SKY_DEFAULT,
    WALK_SETTING_DEFAULT,
    WALK_SETTINGS_M,
    sky_front_dir,
    sky_poles_json,
)
from starway.export import build_sources, write_json
from starway.sources import read_manifest

GTFS = flux.gtfs_path("TRA01")  # fichier du manifeste (starway.flux), jamais un nom écrit en dur
ENV01 = RAW_DIR / "ENV01" / "emission-de-co2e-par-voyageur-kilometre-sur-le-reseau.csv"
TRA03 = RAW_DIR / "TRA03" / "referentiel-des-lignes.csv"
QS01 = RAW_DIR / "QS01" / "ponctualite-mensuelle-transilien.csv"


def load_line_facts() -> lf.LineFacts:
    """Tables TRA03 (climatisation) et QS01 (ponctualité) ; dates d'extraction lues dans le manifeste. Arrêt si une
    des deux sources n'a pas sa ligne de manifeste ou si son fichier manque."""
    man = {r["source_id"]: r for r in read_manifest()}
    for code, f in (("TRA03", TRA03), ("QS01", QS01)):
        if code not in man:
            raise SystemExit(f"{code} absent de data/sources_manifest.csv : ajouter sa ligne avant l'export")
        if not f.exists():
            raise SystemExit(f"{f} absent (voir data/raw/README.md)")
    return lf.from_files(TRA03, QS01, tra03_snapshot=(man["TRA03"].get("date_extraction") or "")[:10] or None,
                         qs01_updated=(man["QS01"].get("date_extraction") or "")[:10] or None)


def load_gtfs(with_night: bool = False) -> tuple[it.GtfsLookup, dict[str, str], frozenset[tuple[str, str]]]:
    with zipfile.ZipFile(GTFS) as z:
        routes = pd.read_csv(z.open("routes.txt"), dtype=str)
        agency = pd.read_csv(z.open("agency.txt"), dtype=str)
        stops = pd.read_csv(z.open("stops.txt"), dtype=str,
                            usecols=["stop_id", "stop_name", "parent_station", "wheelchair_boarding"])
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "wheelchair_accessible"])
        tr = pd.read_csv(z.open("transfers.txt"), dtype=str, usecols=["from_stop_id", "to_stop_id"])
    if with_night:  # D-040 : les courses NUIT_ (6h-14h recalculé) ne sont que dans le GTFS de nuit
        trips = pd.concat([trips, nn.read_night_trips(["wheelchair_accessible"])], ignore_index=True)
    parents = {s: p for s, p in zip(stops["stop_id"], stops["parent_station"], strict=True) if isinstance(p, str) and p}
    transfers = frozenset(zip(tr["from_stop_id"], tr["to_stop_id"], strict=True))
    return it.GtfsLookup.from_frames(routes, agency, stops, trips), parents, transfers


def load_trip_stops(records: list[dict], gtfs: it.GtfsLookup) -> ie.TripStops:
    """Suite des arrêts des seules courses utilisées (stop_times.txt, environ 700 Mo, lu par morceaux), coordonnées
    des arrêts (stops.txt) et courses à la demande (spécification GTFS : pickup_type ou drop_off_type = 2, règle de
    réservation, fenêtre de prise en charge)."""
    used = {tid for r in records if r["status"] == it.STATUS_OK for lg in r["option"]["legs"]
            if lg["kind"] == "transit" and (tid := it.strip_feed(lg.get("trip"), gtfs.trips))}
    cols = ["trip_id", "stop_id", "stop_sequence", "pickup_type", "drop_off_type", "pickup_booking_rule_id",
            "drop_off_booking_rule_id", "start_pickup_drop_off_window"]
    parts: list[pd.DataFrame] = []
    # chaque course est lue dans SON GTFS : les NUIT_ dans celui de nuit (starway.night_network), les autres dans TRA01
    st = nn.read_stop_times(used, cols, GTFS, nn.NIGHT_GTFS, strict=False)
    parts.append(st)
    with zipfile.ZipFile(GTFS) as z:
        stops = pd.read_csv(z.open("stops.txt"), dtype=str, usecols=["stop_id", "stop_lat", "stop_lon"])
    st = pd.concat(parts)
    st["seq"] = st["stop_sequence"].astype(int)
    st = st.sort_values(["trip_id", "seq"])
    flag = ((st["pickup_type"] == "2") | (st["drop_off_type"] == "2") | st["pickup_booking_rule_id"].notna()
            | st["drop_off_booking_rule_id"].notna() | st["start_pickup_drop_off_window"].notna())
    seqs = {t: g.tolist() for t, g in st.groupby("trip_id", sort=False)["stop_id"]}
    coords = {sid: (float(a), float(b)) for sid, a, b in zip(stops["stop_id"], stops["stop_lat"], stops["stop_lon"],
                                                              strict=True)}
    return ie.TripStops(seqs, coords, frozenset(st.loc[flag, "trip_id"].unique()))


def read_records(src: Path, bench: bool) -> list[dict]:
    files = [src / "bench_records.jsonl.gz"] if bench else sorted((src / "batches").glob("batch_*.jsonl.gz"))
    recs: list[dict] = []
    for f in files:
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            recs += [json.loads(line) for line in fh]
    return recs


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--walk-setting", choices=sorted(WALK_SETTINGS_M), default=WALK_SETTING_DEFAULT)
    p.add_argument("--src", type=Path, default=None, help="lots de 04h (défaut : ceux du réglage de marche)")
    p.add_argument("--out", type=Path, default=None, help="dossier d'aperçu (défaut : data/processed/...)")
    p.add_argument("--offpeak", default="11:00")
    p.add_argument("--bench", action="store_true")
    p.add_argument("--publish", action="store_true",
                   help="communes complètes seulement, vers le dossier publié du réglage + annonces de meta.json")
    p.add_argument("--astres", choices=["44"], default=SKY_DEFAULT,
                   help="ciel des pôles : 44 astres (lots `_d031_b44`, publié à la racine ; seul ciel depuis D-054)")
    args = p.parse_args()
    front = sky_front_dir(args.astres)
    iset = iss.itin_set(args.walk_setting, sky=args.astres)
    args.src = args.src or iset.src
    args.out = args.out or PROCESSED_DIR / ("itineraries_preview" if iset.is_default
                                            else f"itineraries_preview_walk{iset.leg_limit_m}")
    if args.publish:
        if args.bench:
            print("--publish et --bench sont incompatibles", file=sys.stderr)
            return 1
        args.out = iset.out_dir

    recs = read_records(args.src, args.bench)
    if not recs:
        print(f"aucun enregistrement dans {args.src}", file=sys.stderr)
        return 1
    poles = [x["id"] for x in json.loads(sky_poles_json(args.astres).read_text(encoding="utf-8"))]
    rp = args.src / "run_params.json"
    params = json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else {}
    if params.get("walk_setting", WALK_SETTING_DEFAULT) != iset.walk_setting:
        print(f"lots de {args.src} calculés pour le réglage {params.get('walk_setting')}, pas {iset.walk_setting}",
              file=sys.stderr)
        return 1
    # D-040 : le 6h-14h vient du recalcul sur le réseau de nuit (itineraries_..._nuit_b44) s'il existe et couvre toutes les
    # communes ; la journée d06 y est alors remplacée en entier, jamais mélangée
    night_used = False
    night_src = nn.night_dir(args.src) if (not args.bench and "_d031" in args.src.name) else None
    if night_src is not None and (night_src / "run_params.json").exists():
        man = {r["source_id"]: r["sha256"] for r in read_manifest() if r["source_id"] == "TRA01B"}
        nparams = json.loads((night_src / "run_params.json").read_text(encoding="utf-8"))
        bad = nn.itineraries_engine_problems(params, nparams, man)
        if bad:
            print(f"{night_src.name} : moteur ou GTFS différent de {args.src.name} : {bad[:3]}", file=sys.stderr)
            return 1
        recs, night_info, why = nn.merge_itinerary_records(recs, read_records(night_src, False), poles)
        night_used = night_info is not None
        print(f"6h-14h : {why}")
    gtfs, parents, transfers = load_gtfs(with_night=night_used)
    co2f = fc.co2_factors(pd.read_csv(ENV01, sep=";", encoding="utf-8-sig", dtype=str))
    facts = load_line_facts()
    hh, mm = args.offpeak.split(":")
    op_file = args.src / f"offpeak_{hh}{mm}.csv"
    offpeak = None
    if op_file.exists():
        op = pd.read_csv(op_file, dtype={"insee": str})
        offpeak = {(r.insee, r.pole): {"out": r.out, "ret": r.ret, "reason": r.reason if isinstance(r.reason, str)
                                       else None} for r in op.itertuples(index=False)}
    meta = {"processing_version": PROCESSING_VERSION, "service_date": SERVICE_DATE.isoformat(),
            "walk_setting": iset.walk_setting}
    by_insee: dict[str, list[dict]] = {}
    for r in recs:
        by_insee.setdefault(r["insee"], []).append(r)
    day_ids = [d.id for d in DAY_TYPES]
    trip_stops = load_trip_stops(recs, gtfs)
    skipped: list[str] = []
    if args.publish:
        complete = set(ie.complete_communes(recs, poles, day_ids))
        skipped = sorted(set(by_insee) - complete)
        by_insee = {k: v for k, v in by_insee.items() if k in complete}
    args.out.mkdir(parents=True, exist_ok=True)
    n_bytes = n_gz = n_files = 0
    errors: list[str] = []
    stats = {"ok": 0, "tickets_status": {}, "co2_status": {}, "on_demand_legs": 0, "tc_legs_without_distance": 0}
    for insee, rs in sorted(by_insee.items()):
        doc = ie.commune_file(insee, rs, poles, day_ids, gtfs, parents, transfers, offpeak,
                              args.offpeak, meta, co2f, trip_stops, facts)
        errors += ie.check_file(doc, MAX_TRIP_MIN)
        if args.publish:
            acc = front / "access" / f"{insee}.json"
            errors += (ie.check_against_access(doc, json.loads(acc.read_text(encoding="utf-8")), poles, day_ids,
                                               iset)
                       if acc.exists() else [f"{insee} : access/{insee}.json absent"])
        for dirs in doc["days"].values():
            for row in dirs.values():
                for t in row:
                    if t["status"] == it.STATUS_OK:
                        stats["ok"] += 1
                        for k, v in (("tickets_status", t["tickets"]["status"]), ("co2_status", t["co2_g"]["status"])):
                            stats[k][v] = stats[k].get(v, 0) + 1
                        for lg in t["legs"]:
                            stats["on_demand_legs"] += bool(lg.get("on_demand"))
                            stats["tc_legs_without_distance"] += lg["m"] != "walk" and lg["dist_m"] is None
        n_bytes += iss.json_size(doc)
        n_gz += iss.write_doc(iss.doc_path(args.out, insee), doc)
        n_files += 1
    print(json.dumps({"walk_setting": iset.walk_setting, "files": n_files, "json_bytes": n_bytes,
                      "gzip_bytes": n_gz, "mean_gzip_kb": round(n_gz / max(1, n_files) / 1024, 1),
                      "gzip_ratio": round(n_gz / max(1, n_bytes), 3), "offpeak": offpeak is not None,
                      "errors": len(errors), **stats, "line_facts": dict(sorted(facts.seen.items())),
                      "punctuality_month": facts.month}, ensure_ascii=False))
    for e in errors[:20]:
        print("ERREUR", e, file=sys.stderr)
    if args.publish:
        if errors:  # rien d'annoncé : on retire ce qui vient d'être écrit
            for insee in by_insee:
                iss.doc_path(args.out, insee).unlink(missing_ok=True)
            publish_meta(front)
            print("publication annulée (fichiers retirés, annonces de meta.json recalculées)", file=sys.stderr)
            return 1
        for f in iss.stale_files(args.out, set(by_insee)):
            f.unlink()
        publish_meta(front)
        print(json.dumps({"published": len(by_insee), "incomplete_skipped": skipped}, ensure_ascii=False))
    return 1 if errors else 0


def publish_meta(front: Path = FRONT_DATA_DIR) -> None:
    """Annonces lues par le front (starway.itin_meta : communes publiées par réglage, marquage D-031 de chaque jeu,
    retiré tant que 06t n'a pas remarqué les fichiers, format, faits par ligne) et sources.json à jour du manifeste
    (ENV01, COST02, TRA03, QS01). Seules ces clés de meta.json changent ; 06 les réécrit de même. `front` : dossier
    publié du ciel (racine) ; sources.json reste à la racine."""
    path = front / "meta.json"
    meta = itin_meta.apply(json.loads(path.read_text(encoding="utf-8")), front)
    write_json(path, meta)
    write_json(FRONT_DATA_DIR / "sources.json", build_sources())


if __name__ == "__main__":
    raise SystemExit(main())
