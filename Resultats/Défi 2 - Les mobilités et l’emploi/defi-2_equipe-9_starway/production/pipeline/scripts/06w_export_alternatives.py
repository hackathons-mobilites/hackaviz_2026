"""06w - Export des trajets alternatifs (D-055, contrat `alternatives-1`), rejouable à tout moment sur ce qui est fini.

Lit les résultats de 04q (`<src>/{jour,nuit}/p<palier>/<insee>.jsonl.gz`), écrit `<out>/{insee}.json.gz` et `<out>/coverage.json`,
contrôle la cohérence et mesure le poids du site (alerte à 220 Mo). B et C ont la forme des trajets d'`itineraries/` (mêmes tickets,
même carbone, mêmes faits par ligne). Par défaut, GTFS du manifeste ; `--out` hors de `frontend/public/data` pour un essai.

`--walk-setting {normal,comfort}` (défaut normal, phase F inchangée). En « comfort » (phase G, au plus 1 km à pied) : dossier par
défaut `alternatives_comfort/`, `walk_setting: "comfort"` et `comfort_note: null` dans les en-têtes, et refus d'une source dont un
`<réseau>/run_params.json` est absent ou dit un autre réglage. Un réglage n'écrit jamais dans le dossier de l'autre. Quand
`run_params.json` donne `gtfs_sha256` (toujours en confort), le GTFS lu doit être celui du calcul. Refus : code 2, rien n'est écrit.

En confort, chaque fichier de commune dit aussi si la recherche de départs plus tôt a été faite (`earlier_departures`, {journée:
vrai, faux ou null}), déduit des paliers finis de la source (`p2`, `p4`) ; avec `--normal-src` (sources de la phase F, jamais une
liste écrite à la main), même chose pour le réglage normal (`earlier_departures_normal`). Le réglage normal n'a ni l'un ni l'autre.

    python scripts/06w_export_alternatives.py --src ../data/interim/alternatifs_vm --out ../frontend/public/data/alternatives
    python scripts/06w_export_alternatives.py --walk-setting comfort --src ../data/interim/<dossier>/sorties_confort
        (+ --normal-src ../data/interim/alternatifs_final_20261111T0910Z/sorties_f)
"""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd

from starway import alternatives_export as ax
from starway import fares_carbon as fc
from starway import flux
from starway import itin_export as ie
from starway import itin_sets as iss
from starway import itineraries as it
from starway import needs as nd
from starway import night_network as nn
from starway.config import DAY_TYPES, FRONT_DATA_DIR, FRONT_SKY44_DIR, PIPELINE_DIR, PROCESSED_DIR, RAW_DIR, REPO_ROOT

TRA03 = RAW_DIR / "TRA03" / "referentiel-des-lignes.csv"  # accessibilité des lignes (comme 06n)
TRA04 = RAW_DIR / "TRA04" / "accessibilite-en-gare.csv"  # niveaux des gares (comme 06n)
SITE_ALERT_MB = 220.0  # alerte du plan (limite Azure Static Web Apps : 250 Mo, 15 000 fichiers)
NETWORK_DAYS = {"jour": ("d09", "d14"), "nuit": ("d06",)}


def load_06h() -> Any:
    spec = importlib.util.spec_from_file_location("export_06h", PIPELINE_DIR / "scripts" / "06h_export_itineraries.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_results(src: Path, network: str) -> dict[str, list[dict[str, Any]]]:
    """{insee: enregistrements} d'un réseau, tous paliers finis confondus."""
    out: dict[str, list[dict[str, Any]]] = {}
    for f in sorted((src / network).glob("p*/*.jsonl.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as g:
            out.setdefault(f.name.split(".")[0], []).extend(json.loads(line) for line in g)
    return out


def lookups(gtfs_zip: Path) -> tuple[it.GtfsLookup, dict[str, str], frozenset[tuple[str, str]]]:
    with zipfile.ZipFile(gtfs_zip) as z:
        routes = pd.read_csv(z.open("routes.txt"), dtype=str)
        agency = pd.read_csv(z.open("agency.txt"), dtype=str)
        stops = pd.read_csv(z.open("stops.txt"), dtype=str, usecols=["stop_id", "stop_name", "parent_station", "wheelchair_boarding"])
        trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["trip_id", "wheelchair_accessible"])
        tr = pd.read_csv(z.open("transfers.txt"), dtype=str, usecols=["from_stop_id", "to_stop_id"])
    parents = {s: p for s, p in zip(stops["stop_id"], stops["parent_station"], strict=True) if isinstance(p, str) and p}
    return it.GtfsLookup.from_frames(routes, agency, stops, trips), parents, frozenset(zip(tr["from_stop_id"], tr["to_stop_id"], strict=True))


def site_bytes(root: Path) -> tuple[int, int]:
    files = [p for p in root.rglob("*") if p.is_file()]
    return sum(p.stat().st_size for p in files), len(files)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--src", type=Path, required=True)
    p.add_argument("--walk-setting", choices=sorted(ax.OUT_DIRS), default="normal",
                   help="réglage de marche de la source (D-024) : normal = phase F, comfort = phase G (au plus 1 km à pied)")
    p.add_argument("--normal-src", type=Path, default=None,
                   help="confort seulement : sources de la phase F (réglage normal), pour écrire earlier_departures_normal")
    p.add_argument("--out", type=Path, default=None, help="défaut : frontend/public/data/alternatives (normal) ou alternatives_comfort")
    p.add_argument("--gtfs-jour", type=Path, default=None, help="défaut : TRA01 du manifeste")
    p.add_argument("--gtfs-nuit", type=Path, default=None, help="défaut : TRA01B du manifeste")
    p.add_argument("--site", type=Path, default=REPO_ROOT / "frontend" / "public", help="dossier dont on mesure le poids")
    args = p.parse_args()
    args.out = args.out or FRONT_DATA_DIR / ax.OUT_DIRS[args.walk_setting]
    refused = ax.source_setting_errors(args.src, NETWORK_DAYS, args.walk_setting) + ax.out_dir_errors(args.out, args.walk_setting)
    if args.normal_src is not None:
        if args.walk_setting == "normal":
            refused.append("--normal-src : seulement avec --walk-setting comfort")
        elif not any(ax.earlier_flags(args.normal_src, NETWORK_DAYS).values()):
            refused.append(f"--normal-src : aucun résultat de 04q dans {args.normal_src}")
        else:
            refused += [f"--normal-src {e}" for e in ax.source_setting_errors(args.normal_src, NETWORK_DAYS, "normal")]
    for e in refused:
        print("REFUS", e, file=sys.stderr)
    if refused:
        return 2
    gtfs_paths = {"jour": args.gtfs_jour or flux.gtfs_path("TRA01"), "nuit": args.gtfs_nuit or flux.gtfs_path("TRA01B")}
    refused = ax.gtfs_errors(args.src, gtfs_paths)
    for e in refused:
        print("REFUS", e, file=sys.stderr)
    if refused:
        return 2
    poles = [x["id"] for x in json.loads((FRONT_SKY44_DIR / "poles.json").read_text(encoding="utf-8"))]
    day_ids = [d.id for d in DAY_TYPES]
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str})
    codes = sorted(communes.loc[communes["is_origin"], "insee"])
    h = load_06h()
    co2f = fc.co2_factors(pd.read_csv(h.ENV01, sep=";", encoding="utf-8-sig", dtype=str))
    facts = h.load_line_facts()
    # « Mes besoins » : B et C portent le champ `a11y` de chaque tronçon en TC, comme le trajet retenu (06n), pour que les trois onglets
    # disent la même chose (demande de Nicolas du 12/11). Un tronçon qui ne correspond pas aux lots de 04q lève une erreur : rien n'est deviné.
    needs_facts = nd.from_files(TRA03, TRA04)
    nn.NIGHT_GTFS = gtfs_paths["nuit"]
    jsonifiers: dict[str, Any] = {}
    results = {n: read_results(args.src, n) for n in NETWORK_DAYS}
    for net, data in results.items():
        if not data:
            continue
        h.GTFS = gtfs_paths[net]
        gtfs, parents, transfers = lookups(gtfs_paths[net])
        used = [{"status": it.STATUS_OK, "option": r[k]["option"]} for rs in data.values() for r in rs for k in ("B", "C") if r.get(k)]
        stops = h.load_trip_stops(used, gtfs)

        def jsonify(option: dict, gtfs: Any = gtfs, parents: Any = parents, transfers: Any = transfers, stops: Any = stops) -> dict | None:
            rec = {"status": it.STATUS_OK, "option": option, "dep_s": option["dep_s"], "target_min": None, "delta_min": None}
            t = ie.trip_json(rec, gtfs, parents, transfers, co2f, stops, facts)
            if t.get("status") != it.STATUS_OK:
                return None
            enriched = [it.enrich_leg(lg, gtfs) for lg in option["legs"]]
            return nd.annotate_trip(t, enriched, needs_facts, it.s_to_hhmm)

        jsonifiers[net] = jsonify
    meta = ax.export_meta(args.walk_setting)
    args.out.mkdir(parents=True, exist_ok=True)
    comfort = args.walk_setting != "normal"
    earlier = ax.earlier_flags(args.src, NETWORK_DAYS) if comfort else None
    earlier_normal = ax.earlier_flags(args.normal_src, NETWORK_DAYS) if comfort and args.normal_src is not None else None
    docs = ax.assemble_docs(results, poles, day_ids, NETWORK_DAYS, jsonifiers, meta, earlier, earlier_normal)
    n_gz = n_raw = 0
    for insee, doc in docs.items():
        n_raw += iss.json_size(doc)
        n_gz += iss.write_doc(iss.doc_path(args.out, insee), doc)
    cov = ax.coverage_doc(codes, docs, poles, day_ids, meta)
    (args.out / "coverage.json").write_text(json.dumps(cov, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    errs = ax.check_published(cov, docs, codes)
    site, n_files = site_bytes(args.site)
    site_mb = site / 1048576
    print(json.dumps({"walk_setting": args.walk_setting, "communes_by_network": {n: len(d) for n, d in results.items()}, "communes_with_file": len(docs), "json_bytes": n_raw, "gzip_bytes": n_gz, "mean_gzip_kb": round(n_gz / max(1, len(docs)) / 1024, 1),
                      "coverage_bytes": (args.out / "coverage.json").stat().st_size, "counts": cov["counts"], "errors": len(errs),
                      **({"earlier_departures_by_network": {n: sum(f.values()) for n, f in earlier.items()}} if earlier is not None else {}),
                      **({"earlier_gap_communes": ax.earlier_gaps(docs)} if earlier_normal is not None else {}),
                      "site_mb": round(site_mb, 1), "site_files": n_files, "out": str(args.out)}, ensure_ascii=False))
    for e in errs[:20]:
        print("ERREUR", e, file=sys.stderr)
    if site_mb >= SITE_ALERT_MB:
        print(f"ALERTE : site à {site_mb:.1f} Mo, seuil {SITE_ALERT_MB} Mo", file=sys.stderr)
    return 1 if errs else 0


if __name__ == "__main__":
    raise SystemExit(main())
