"""06t - Marquage des correspondances trop courtes dans les itinéraires publiés (D-031, option c, 04/11/2026).

Aucun calcul de trajet : reporte dans chaque `frontend/public/data/itineraries/{insee}.json.gz` le contrôle de
`07h_transfer_times_check.py` (statut de chaque trajet, correspondances plus courtes que le minimum officiel, borne
recalée sur les mêmes lignes), puis écrit `meta.transfer_check` et rafraîchit `sources.json` depuis le manifeste.
Logique dans `starway/transfer_marks.py` (tests : tests/test_transfer_marks.py). Les durées publiées, le ciel et
`access/` ne changent pas.

Ordre (et relance après un recalcul des itinéraires, D-031 a1 / a2) :
    python scripts/06h_export_itineraries.py --publish   # si les itinéraires ont changé
    python scripts/07h_transfer_times_check.py           # contrôle des fichiers publiés
    python scripts/06t_export_transfer_check.py          # marquage (ce script)
    python scripts/07_quality_checks.py

Lit : `data/processed/transfer_check_walk3000_summary.json`, `data/interim/transfer_check/trips_all.csv.gz`,
`transfers_all.csv.gz`, `transfer_check_walk3000_short.csv.gz` (sorties de 07h), les fichiers publiés
`itineraries/` et `access/`. Échoue (exit 1) sans rien écrire si le contrôle de 07h ne porte pas exactement sur les
trajets publiés (durées, heures et quais de chaque correspondance), si un minimum ne se retrouve pas dans sa source
(`transfers.txt` du GTFS IDFM, `navitia_connections.csv` de 07i), si un statut diffère, ou si les verdicts à risque
recomptés diffèrent du résumé de 07h.

Réglage de marche (D-024) : `--walk-setting comfort` marque le jeu « confort » (`itineraries_walk1000/`) à partir
de `07h --walk-setting comfort` (résumé `transfer_check_walk1000_summary.json`, sorties dans
`data/interim/transfer_check_walk1000/`) ; l'annonce va dans `meta.itineraries_variants.comfort.transfer_check`.

Usage :
    python scripts/06t_export_transfer_check.py                  # règle « reference » (GTFS, puis Navitia)
    python scripts/06t_export_transfer_check.py --walk-setting comfort
    python scripts/06t_export_transfer_check.py --rule gtfs      # transfers.txt seul
    python scripts/06t_export_transfer_check.py --dry-run        # contrôles et volume, rien d'écrit
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from starway import flux, itin_meta
from starway import itin_sets as iss
from starway import transfer_marks as tm
from starway import transfer_times as tx
from starway.config import (
    FRONT_DATA_DIR,
    PROCESSED_DIR,
    SKY_DEFAULT,
    WALK_SETTING_DEFAULT,
    WALK_SETTINGS_M,
    sky_front_dir,
)
from starway.export import build_sources, write_json

GTFS = flux.gtfs_path("TRA01")  # fichier du manifeste (starway.flux), jamais un nom écrit en dur
NAV_CONNECTIONS = PROCESSED_DIR / "navitia_connections.csv"

def load_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rule", choices=tm.RULES, default=tm.DEFAULT_RULE)
    p.add_argument("--walk-setting", choices=sorted(WALK_SETTINGS_M), default=WALK_SETTING_DEFAULT)
    p.add_argument("--dry-run", action="store_true", help="contrôles et volume seulement, aucun fichier écrit")
    p.add_argument("--astres", choices=["44"], default=SKY_DEFAULT,
                   help="ciel des pôles : 44 astres (racine ; seul ciel depuis D-054)")
    args = p.parse_args()
    rule: str = args.rule
    front = sky_front_dir(args.astres)
    iset = iss.itin_set(args.walk_setting, sky=args.astres)
    itin_dir = iset.out_dir

    meta = load_json(front / "meta.json")
    if not iset.summary.exists():
        print(f"{iset.summary} absent : lancer 07h --walk-setting {iset.walk_setting}", file=sys.stderr)
        return 1
    summary = load_json(iset.summary)
    published = sorted((meta.get("itineraries_communes") or []) if iset.is_default else
                       (((meta.get("itineraries_variants") or {}).get(iset.walk_setting) or {}).get("communes") or []))
    files = iss.published_communes(itin_dir)
    errors: list[str] = []
    if published != files:
        errors.append(f"meta.itineraries_communes ({len(published)}) != fichiers publiés ({len(files)})")
    if summary.get("walk_setting", WALK_SETTING_DEFAULT) != iset.walk_setting:
        errors.append(f"résumé 07h du réglage {summary.get('walk_setting')}, pas {iset.walk_setting}")
    if summary.get("communes") != len(files) or summary.get("service_date") != meta.get("service_date"):
        errors.append(f"résumé 07h : {summary.get('communes')} communes, date {summary.get('service_date')} ; "
                      f"publié : {len(files)} communes, date {meta.get('service_date')} (relancer 07h)")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    by_trip, rows = tm.load_check_outputs(iset.trips_csv, iset.transfers_csv, iset.short_csv, rule)
    gmin, nmin = tm.load_minimum_sources(GTFS, NAV_CONNECTIONS)
    budgets = sorted(int(b) for b in meta["budgets"])
    checked_at = summary["generated_at"]

    # 1. marques calculées et contrôlées pour tous les fichiers, avant toute écriture
    marks: dict[str, dict[tuple[str, str, str], dict]] = {}
    seen: set[tm.Key] = set()
    status_count: Counter = Counter()
    short_count = 0
    lit: Counter = Counter()
    at_risk: Counter = Counter()
    walk_setting = None
    for insee in files:
        doc = iss.read_doc(iss.doc_path(itin_dir, insee))
        walk_setting = walk_setting or doc.get("walk_setting")
        acc = iss.transit_series(load_json(front / "access" / f"{insee}.json"), iset) or {}
        m_file: dict[tuple[str, str, str], dict] = {}
        for pid, d, direction, t in tm.iter_marked_trips(doc):
            k = (insee, pid, d, direction)
            info = by_trip.get(k)
            where = f"{insee} {pid} {d} {direction}"
            if info is None:
                errors.append(f"{where} : trajet publié absent du contrôle 07h")
                continue
            seen.add(k)
            r = rows.get(k, [])
            errors += [f"{where} : {e}" for e in tm.alignment_errors(t, r, info["itinerary_min"], info["matrix_min"],
                                                                      info["n_transfers"])]
            errors += [f"{where} : {e}" for e in tm.source_errors(r, rule, gmin, nmin)]
            try:
                mk = tm.trip_mark(r, rule, info["bound_min"], info["bound_method"])
            except ValueError as e:
                errors.append(f"{where} : {e}")
                continue
            if mk["status"] != info["status"]:
                errors.append(f"{where} : statut {mk['status']} recalculé, {info['status']} pour 07h")
            errors += [f"{where} : {e}" for e in tm.mark_errors(mk)]
            m_file[(pid, d, direction)] = mk
            status_count[mk["status"]] += 1
            short_count += len(mk.get("short", []))
        # verdicts à risque recomptés comme 07h (durées de la matrice publiée, borne du sens trop court)
        for d, series in acc.items():
            for i, pid in enumerate(doc["poles"]):
                o, rt = series["out"][i], series["ret"][i]
                for b in budgets:
                    if tx.verdict(o, rt, b):
                        lit[(d, b)] += 1
                        at_risk[(d, b)] += tm.verdict_at_risk(o, rt, m_file.get((pid, d, "out")),
                                                              m_file.get((pid, d, "ret")), b)
        marks[insee] = m_file
    missing = set(by_trip) - seen
    if missing:
        errors.append(f"{len(missing)} trajets du contrôle 07h absents des fichiers publiés, par exemple "
                      f"{sorted(missing)[:3]}")
    want_status = summary["trip_status"][rule]
    if dict(status_count) != want_status:
        errors.append(f"statuts {dict(status_count)} != résumé 07h {want_status}")
    want_short = summary[f"transfer_status_{rule}"].get(tx.SHORT, 0)
    if short_count != want_short:
        errors.append(f"{short_count} correspondances trop courtes publiées, {want_short} dans le résumé 07h")
    for d, v in summary["by_day"][rule].items():
        for b, x in v["verdicts"].items():
            got = (lit[(d, int(b))], at_risk[(d, int(b))])
            if got != (x["lit"], x["at_risk"]):
                errors.append(f"{d} {b} min : allumés / à risque {got} recomptés, {(x['lit'], x['at_risk'])} pour 07h")
    if errors:
        for e in errors[:30]:
            print("ERREUR", e, file=sys.stderr)
        print(f"{len(errors)} erreur(s) : rien n'est écrit (relancer 07h sur les fichiers publiés)", file=sys.stderr)
        return 1

    # 2. écriture (ou mesure du volume)
    block = tm.file_meta(rule, checked_at, meta["service_date"], walk_setting or iset.walk_setting)
    before = after = gz_after = 0
    for insee in files:
        path = iss.doc_path(itin_dir, insee)
        doc = iss.read_doc(path)
        before += iss.json_size(tm.strip_marks(doc))
        new = tm.annotate(doc, marks[insee], block)
        after += iss.json_size(new)
        gz_after += iss.write_doc(path, new) if not args.dry_run else len(iss.encode_doc(new))
    report = {"walk_setting": iset.walk_setting, "rule": rule, "files": len(files), "trips": sum(status_count.values()), "trip_status": dict(status_count),
              "short_transfers": short_count,
              "verdicts": {d: {str(b): f"{at_risk[(d, b)]}/{lit[(d, b)]}" for b in budgets}
                           for d in sorted({d for d, _ in lit})},
              "json_bytes_without_marks": before, "json_bytes_with_marks": after,
              "json_added_mb": round((after - before) / 1e6, 2), "gzip_bytes_with_marks": gz_after,
              "dry_run": args.dry_run}
    print(json.dumps(report, ensure_ascii=False))
    if not args.dry_run:
        meta = itin_meta.apply(meta, front)  # meta.transfer_check ou meta.itineraries_variants.{réglage}.transfer_check
        write_json(front / "meta.json", meta)
        write_json(FRONT_DATA_DIR / "sources.json", build_sources())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
