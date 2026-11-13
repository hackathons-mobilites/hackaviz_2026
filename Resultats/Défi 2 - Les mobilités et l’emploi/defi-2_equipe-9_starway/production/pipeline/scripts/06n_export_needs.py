"""06n - Réglage « Mes besoins » : ajoute aux itinéraires publiés (06h) ce que disent les sources ouvertes sur
l'accessibilité de chaque tronçon en TC (starway/needs.py, tests/test_needs.py).

Par tronçon en TC, champ `a11y` : `line`, `audio`, `visual` (référentiel des lignes IDFM, TRA03, ODbL) et, pour un
tronçon ferré ou un quai présent dans le jeu, `st_from` / `st_to` (accessibilité en gare IDFM, TRA04, Licence Ouverte
2.0). Les champs `wc_trip`, `wc_from`, `wc_to` (GTFS IDFM, TRA01) sont déjà publiés par 06h. Par fichier : `needs_meta`.
Dans meta.json : `needs` (textes, libellés exacts des niveaux, sources). Jamais « trajet accessible » : seulement ce que
chaque source déclare ; absent = `null` affiché « non renseigné ». Aucun appel PRIM ni Navitia.

Lit : les fichiers publiés par 06h pour chaque jeu d'itinéraires (starway/itin_sets.py : `itineraries/` réglage normal,
`itineraries_walk1000/` réglage confort ; .json.gz), les lots de 04h qui les ont produits (data/interim/itineraries_walk*/batches), GTFS IDFM (TRA01), data/raw/TRA03 et data/raw/TRA04.
Chaque tronçon publié doit correspondre à un tronçon des lots (famille, heures, ligne) : sinon exit 1, rien n'est écrit.

Usage :
    python scripts/06n_export_needs.py --check    # contrôle et couverture, n'écrit rien
    python scripts/06n_export_needs.py            # écrit a11y, needs_meta et meta.needs (idempotent)
    python scripts/06n_export_needs.py --strip    # retire les champs de ce réglage (retour arrière)
    python scripts/06n_export_needs.py --meta-only  # réécrit seulement meta.needs (cases, libellés TRA04), sans lots

Après `06h --publish`, les fichiers sont réécrits sans ces champs : relancer 06n (puis 06t si le marquage D-031 c est
perdu aussi). 06_export_front.py recopie `meta.needs` depuis les fichiers publiés.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

import pandas as pd

from starway import flux
from starway import itin_sets as iss
from starway import itineraries as it
from starway import needs as nd
from starway import night_network as nn
from starway.config import (
    FRONT_DATA_DIR,
    RAW_DIR,
    SKY_DEFAULT,
    WALK_SETTINGS_M,
    sky_front_dir,
    sky_poles_json,
)
from starway.export import build_sources, write_json

GTFS = flux.gtfs_path("TRA01")  # fichier du manifeste (starway.flux), jamais un nom écrit en dur
TRA03 = RAW_DIR / "TRA03" / "referentiel-des-lignes.csv"
TRA04 = RAW_DIR / "TRA04" / "accessibilite-en-gare.csv"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_gtfs(with_night: bool = False) -> it.GtfsLookup:
    with zipfile.ZipFile(GTFS) as z:
        routes = pd.read_csv(z.open("routes.txt"), dtype=str)
        agency = pd.read_csv(z.open("agency.txt"), dtype=str)
        stops = pd.read_csv(z.open("stops.txt"), dtype=str,
                            usecols=["stop_id", "stop_name", "parent_station", "wheelchair_boarding"])
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "wheelchair_accessible"])
    if with_night:  # D-040 : véhicule déclaré des courses NUIT_ (lignes de la course d'origine, GTFS de nuit)
        trips = pd.concat([trips, nn.read_night_trips(["wheelchair_accessible"])], ignore_index=True)
    return it.GtfsLookup.from_frames(routes, agency, stops, trips)


def read_records(src: Path) -> dict[tuple[str, str, str, str], dict]:
    """Lots de 04h, par (commune, pôle, journée, sens)."""
    out: dict[tuple[str, str, str, str], dict] = {}
    for f in sorted((src / "batches").glob("batch_*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                out[(r["insee"], r["pole"], r["day"], r["dir"])] = r
    return out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--walk-setting", choices=sorted(WALK_SETTINGS_M), help="un seul jeu d'itinéraires (défaut : tous)")
    p.add_argument("--check", action="store_true", help="contrôle et couverture, n'écrit rien")
    p.add_argument("--meta-only", action="store_true",
                   help="réécrit seulement meta.needs (identifiants des cases, libellés TRA04) depuis les needs_meta des "
                        "fichiers déjà publiés : ni lots, ni GTFS ; a11y et needs_meta ne changent pas")
    p.add_argument("--strip", action="store_true", help="retire a11y, needs_meta et meta.needs")
    p.add_argument("--astres", choices=["44"], default=SKY_DEFAULT,
                   help="ciel des pôles : 44 astres (racine ; seul ciel depuis D-054)")
    args = p.parse_args()
    front = sky_front_dir(args.astres)

    sets = [s for s in iss.all_sets(sky=args.astres)
            if args.walk_setting in (None, s.walk_setting) and nd.doc_files(s.out_dir)]
    if not sets:
        print(f"aucun itinéraire publié dans {front}", file=sys.stderr)
        return 1
    meta_path = front / "meta.json"

    if args.strip:
        n = 0
        for s in sets:
            for f in nd.doc_files(s.out_dir):
                nd.write_doc(f, nd.strip_needs(nd.read_doc(f)))
                n += 1
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.pop("needs", None) is not None:
            write_json(meta_path, meta)
        print(json.dumps({"stripped": n}))
        return 0

    if args.meta_only:
        # Version finale du 05/11 (D-034) : les cases et les textes changent, pas les champs a11y des tronçons
        docs = [nd.read_doc(f) for s in sets for f in nd.doc_files(s.out_dir)]
        pm = nd.published_from_docs(docs, TRA04)
        if pm is None:
            print("needs_meta absent ou différent d'un fichier à l'autre : lancer 06n sans --meta-only", file=sys.stderr)
            return 1
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        changed = meta.get("needs") != pm
        if not args.check:
            meta["needs"] = pm
            write_json(meta_path, meta)
            write_json(FRONT_DATA_DIR / "sources.json", build_sources())
        print(json.dumps({"meta_only": True, "files": len(docs), "needs": pm["needs"], "changed": changed}))
        return 0

    facts = nd.from_files(TRA03, TRA04)
    gtfs = load_gtfs(with_night=nn.NIGHT_GTFS.exists())
    block = nd.file_meta(sha256(TRA03)[:16], sha256(TRA04)[:16])
    errors: list[str] = []
    out_docs: dict[Path, dict] = {}
    n_trips = 0
    for s in sets:
        records = read_records(s.src)
        if not records:
            print(f"aucun lot de 04h dans {s.src}", file=sys.stderr)
            return 1
        nsrc = nn.night_dir(s.src) if ("_d031" in s.src.name) else None
        if nsrc is not None and (nsrc / "run_params.json").exists():  # D-040 : même fusion du 6h-14h que 06h
            pole_ids = [x["id"] for x in json.loads(sky_poles_json(args.astres).read_text(encoding="utf-8"))]
            merged, _info, why = nn.merge_itinerary_records(list(records.values()), list(read_records(nsrc).values()), pole_ids)
            records = {(r["insee"], r["pole"], r["day"], r["dir"]): r for r in merged}
            print(f"{s.dir_name} 6h-14h : {why}")
        for f in nd.doc_files(s.out_dir):
            doc = nd.read_doc(f)
            insee = nd.insee_of(f)
            for day, dirs in doc["days"].items():
                for direction, row in dirs.items():
                    for i, trip in enumerate(row):
                        if trip.get("status") != it.STATUS_OK:
                            continue
                        pole = doc["poles"][i]
                        rec = records.get((insee, pole, day, direction))
                        where = f"{s.dir_name} {insee} {day} {direction} {pole}"
                        if rec is None or rec["status"] != it.STATUS_OK:
                            errors.append(f"{where} : absent des lots de 04h")
                            continue
                        enriched = [it.enrich_leg(lg, gtfs) for lg in rec["option"]["legs"]]
                        try:
                            row[i] = nd.annotate_trip(trip, enriched, facts, it.s_to_hhmm)
                        except ValueError as e:
                            errors.append(f"{where} : {e}")
                            continue
                        n_trips += 1
            out_docs[f] = nd.with_meta(doc, block)
    for e in errors[:20]:
        print("ERREUR", e, file=sys.stderr)
    stats = {"sets": [s.dir_name for s in sets], "files": len(out_docs), "trips": n_trips, "errors": len(errors),
             "legs": facts.seen["legs"], **{k: v for k, v in sorted(facts.seen.items()) if k != "legs"}}
    print(json.dumps(stats, ensure_ascii=False))
    if errors:
        print("rien n'est écrit", file=sys.stderr)
        return 1
    if args.check:
        return 0
    n_bytes = n_before = 0
    for f, doc in out_docs.items():
        n_before += len(nd.encode_doc(f, nd.strip_needs(doc)))
        n_bytes += nd.write_doc(f, doc)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    pm = nd.published_meta((d["needs_meta"] for d in out_docs.values()), facts.levels)
    if pm is None:
        print("needs_meta différent d'un fichier à l'autre", file=sys.stderr)
        return 1
    meta["needs"] = pm
    write_json(meta_path, meta)
    write_json(FRONT_DATA_DIR / "sources.json", build_sources())  # TRA03 et TRA04 du manifeste
    print(json.dumps({"published": len(out_docs), "bytes": n_bytes, "bytes_before": n_before,
                      "added_kb_per_file": round((n_bytes - n_before) / len(out_docs) / 1024, 1)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
