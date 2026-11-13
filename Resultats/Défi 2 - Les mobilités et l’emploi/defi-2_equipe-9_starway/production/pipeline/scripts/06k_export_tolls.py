"""06k - Met à jour les péages publiés SANS refaire tout l'export : tolls.json, `car_trip.toll` de chaque
access/{insee}.json et le décompte `meta.car_costs.tolls.cells`. Aucune autre clé n'est réécrite.

Pourquoi un script à part : après un changement de grille (04j, par exemple les grilles Sanef du 05/11/2026), seules les
cellules de péage changent. 06 refait tout l'export et lit les matrices de data/interim ; sur un poste qui n'a pas tous
les calculs (le dépôt n'en versionne pas), il perdrait des modes publiés. 06k ne lit que ce qu'il faut : les distances
voiture corrigées (04g v2, data/interim/car_dist_carspeed_v2), le registre et les grilles (04i, 04j) et les fichiers déjà
publiés. La règle est la même que celle de 06 (`starway.toll_publish.trip_cells`, `toll_sources` et `manifest_sha`
de 06 sont réutilisés).

Garde-fous : avant d'écrire, 06k relit chaque fichier à modifier et vérifie qu'il se réécrit à l'identique (même
sérialisation que 06) ; s'il y a un octet de différence hors des cellules de péage, il s'arrête sans rien écrire.
Usage : python scripts/06k_export_tolls.py [--dry-run]
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys

import pandas as pd

from starway import car_dist as cdist
from starway import toll_publish as tpub
from starway.config import FRONT_DATA_DIR, INTERIM_DIR, PIPELINE_DIR, PROCESSED_DIR, PROCESSING_VERSION, SERVICE_DATE
from starway.export import _clean, write_json
from starway.origin_points import ORIGIN_LAT, ORIGIN_LON, origin_points_sha256
from starway.sources import sha256_of


def load_06():
    spec = importlib.util.spec_from_file_location("m06", PIPELINE_DIR / "scripts" / "06_export_front.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def dumps(obj) -> str:
    """Même sérialisation que `starway.export.write_json`."""
    return json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="calcule et compare, n'écrit rien")
    args = ap.parse_args()
    m06 = load_06()

    poles = json.loads((PROCESSED_DIR / "poles.json").read_text(encoding="utf-8"))
    pole_ids = [x["id"] for x in poles]
    pole_pts = {x["id"]: (x["point"]["lon"], x["point"]["lat"]) for x in poles}
    communes = pd.read_csv(PROCESSED_DIR / "communes_idf_2026.csv", dtype={"insee": str, "dep": str})
    origins = communes[communes["is_origin"]]
    origin_ids = origins["insee"].tolist()
    matrix_csv = INTERIM_DIR / "matrix" / "car_any.csv"
    matrix = pd.read_csv(matrix_csv, dtype={"from_id": str}) if matrix_csv.exists() else None
    osm_path = PROCESSED_DIR / "osm_toll_points.json"
    dist, info = cdist.load_corrected(INTERIM_DIR / cdist.CORRECTED_DIR_NAME, pole_ids, origin_ids, m06.manifest_sha(),
                                      origin_points_sha256(origins), matrix, tolls_sha=sha256_of(osm_path))
    if info["status"] != "ok":
        print(f"distances voiture corrigées : {info['status']} ({info.get('reason')}) : rien n'est écrit")
        return 1
    tariffs = pd.read_csv(PROCESSED_DIR / "toll_tariffs.csv", dtype={"heure_debut": str, "heure_fin": str},
                          keep_default_na=False, na_values=[""])
    osm = json.loads(osm_path.read_text(encoding="utf-8"))
    com = communes.set_index("insee")
    tolls_json = tpub.build_tolls_json(tariffs, SERVICE_DATE, PROCESSING_VERSION, m06.toll_sources())
    index = {p["id"]: i for i, p in enumerate(tolls_json["points"])}
    origin_pts = {i: (float(com.at[i, ORIGIN_LON]), float(com.at[i, ORIGIN_LAT])) for i in dist}
    cells, counts = tpub.trip_cells(dist, tariffs, osm, index, origin_pts, pole_pts, pole_ids, cdist.DIRECTIONS)
    print("péages par sens : " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))

    # 1. tout relire et vérifier la réécriture à l'identique AVANT d'écrire quoi que ce soit
    access_dir = FRONT_DATA_DIR / "access"
    plan: dict = {}
    skipped = changed = 0
    for insee in sorted(cells):
        path = access_dir / f"{insee}.json"
        if not path.exists():
            skipped += 1
            continue
        text = path.read_text(encoding="utf-8")
        a = json.loads(text)
        if dumps(a) != text:
            print(f"{path.name} : ne se réécrit pas à l'identique, arrêt sans rien écrire")
            return 1
        if "car_trip" not in a:
            skipped += 1
            continue
        if a["car_trip"]["toll"] != cells[insee]:
            changed += 1
            a["car_trip"]["toll"] = cells[insee]
            plan[path] = a
    meta_path = FRONT_DATA_DIR / "meta.json"
    meta_text = meta_path.read_text(encoding="utf-8")
    meta = json.loads(meta_text)
    if dumps(meta) != meta_text:
        print("meta.json ne se réécrit pas à l'identique, arrêt sans rien écrire")
        return 1
    old_cells = meta["car_costs"]["tolls"]["cells"]
    meta["car_costs"]["tolls"]["cells"] = counts
    tolls_path = FRONT_DATA_DIR / "tolls.json"
    old_tolls = tolls_path.read_text(encoding="utf-8") if tolls_path.exists() else ""
    print(f"access/ : {changed} fichiers à modifier, {skipped} sans car_trip ou absents ; meta.car_costs.tolls.cells "
          f"{old_cells} -> {counts} ; tolls.json {'modifié' if dumps(tolls_json) != old_tolls else 'identique'}")
    if args.dry_run:
        print("--dry-run : rien n'est écrit")
        return 0

    # 2. écrire
    write_json(tolls_path, tolls_json)
    for path, a in plan.items():
        write_json(path, a)
    write_json(meta_path, meta)
    print(f"écrit : tolls.json, {len(plan)} fichiers access/, meta.json (car_costs.tolls.cells seulement)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
