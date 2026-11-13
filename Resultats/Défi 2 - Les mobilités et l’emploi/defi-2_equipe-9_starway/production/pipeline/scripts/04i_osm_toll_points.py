"""04i - Points et chemins de péage de l'OSM déjà utilisé par R5 (CYC01), pour 04g (péages traversés).

Lit `data/raw/CYC01/ile-de-france-latest.osm.pbf` avec le pilote OSM de GDAL (pyogrio) :
- couche `points` : nœuds `barrier=toll_booth` ou `highway=toll_gantry` ;
- couche `lines` : chemins `highway=*` avec `toll=yes` (dans `other_tags`).
Écrit `data/processed/osm_toll_points.json` (identifiants OSM, étiquettes utiles au tarif : name, ref, operator,
coordonnées à 7 décimales, empreinte du PBF). Aucun tarif. Règle de rattachement : starway/tolls.py.

Usage : python scripts/04i_osm_toll_points.py
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import pyogrio

from starway import tolls
from starway.config import PROCESSED_DIR, RAW_DIR
from starway.sources import read_manifest, sha256_of

PBF = RAW_DIR / "CYC01" / "ile-de-france-latest.osm.pbf"
OUT = PROCESSED_DIR / "osm_toll_points.json"
KEEP = ("name", "ref", "operator", "toll", "access", "toll:hgv")


def main() -> int:
    manifest_sha = next((r["sha256"] for r in read_manifest() if r["source_id"] == "CYC01"), None)
    sha = sha256_of(PBF)
    if manifest_sha and sha != manifest_sha:
        raise SystemExit(f"le PBF ne correspond pas au manifeste CYC01 ({sha[:12]} != {manifest_sha[:12]})")
    t0 = time.time()
    where_n = " OR ".join(f"{k}='{v}'" for k, v in tolls.NODE_TAGS)
    pts = pyogrio.read_dataframe(PBF, layer="points", where=where_n, encoding="UTF-8")
    lines = pyogrio.read_dataframe(PBF, layer="lines", encoding="UTF-8",
                                   where="""highway IS NOT NULL AND other_tags LIKE '%"toll"=>"yes"%'""")
    nodes = []
    for r in pts.itertuples(index=False):
        other = tolls.parse_other_tags(getattr(r, "other_tags", None))
        tag = "barrier=toll_booth" if r.barrier == "toll_booth" else "highway=toll_gantry"
        lon, lat = tolls.key(r.geometry.x, r.geometry.y)
        nodes.append({"osm_id": int(r.osm_id), "tag": tag, "name": r.name if isinstance(r.name, str) else None,
                      **{k: other.get(k) for k in KEEP if k not in ("name",)}, "lon": lon, "lat": lat})
    ways = []
    for r in lines.itertuples(index=False):
        other = tolls.parse_other_tags(r.other_tags)
        if other.get("toll") != "yes":  # le LIKE peut attraper "toll"=>"yes" dans une autre clé : on revérifie
            continue
        ways.append({"osm_id": int(r.osm_id), "highway": r.highway,
                     "name": r.name if isinstance(r.name, str) else None,
                     "ref": other.get("ref"), "operator": other.get("operator"),
                     "coords": [list(tolls.key(x, y)) for x, y in r.geometry.coords]})
    nodes.sort(key=lambda n: n["osm_id"])
    ways.sort(key=lambda w: w["osm_id"])
    out = {"source_id": "CYC01", "osm_pbf_sha256": sha, "extracted_at": datetime.now(UTC).isoformat(timespec="seconds"),
           "tool": f"pyogrio {pyogrio.__version__}, GDAL {pyogrio.__gdal_version_string__}, pilote OSM",
           "rule_nodes": "nœuds barrier=toll_booth ou highway=toll_gantry (couche points de GDAL)",
           "rule_ways": "chemins highway=* étiquetés toll=yes (couche lines de GDAL)",
           "match_rule": "coordonnées arrondies à 7 décimales : nœud = sommet de la géométrie du chemin R5 ; "
                         "chemin toll=yes = au moins un segment commun (starway/tolls.py)",
           "n_nodes": len(nodes), "n_nodes_by_tag": {t: sum(n["tag"] == t for n in nodes)
                                                      for t in sorted({n["tag"] for n in nodes})},
           "n_ways": len(ways), "n_way_vertices": sum(len(w["coords"]) for w in ways),
           "nodes": nodes, "ways": ways}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(nodes)} nœuds de péage, {len(ways)} chemins toll=yes en {time.time() - t0:.0f} s -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
