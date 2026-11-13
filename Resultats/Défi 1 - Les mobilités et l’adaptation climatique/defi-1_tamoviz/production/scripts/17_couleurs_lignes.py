"""Couleur et tracé de chaque ligne, pour « La journée de Nadia ».

Couleur : GTFS IDFM (route_color). Tracé : tracés officiels des lignes IDFM (le GTFS IDFM n'a pas de shapes.txt),
data/raw/traces.geojson (pleine précision), fusionnés en lignes continues puis simplifiés à environ 3 m.
Clé : « type|nom court », comme les motifs de web/data/raptor.js (champs ty et nm).
Sorties : web/data/couleurs_lignes.js (window.LCOL) et web/data/traces_lignes.js (window.TRL :
pour chaque ligne, liste de parties ; chaque partie = coordonnées × 100 000, la première absolue, les suivantes en écarts)."""
import json
import os
import pandas as pd
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge

G = "data/raw/gtfs/" if os.path.exists("data/raw/gtfs/routes.txt") else "../hackaviz_idf/data/raw/gtfs/"
r = pd.read_csv(G + "routes.txt", dtype=str).fillna("")
col = {}
for _, x in r.iterrows():
    k = f"{int(x.route_type)}|{x.route_short_name}"
    if x.route_color and k not in col:
        col[k] = "#" + x.route_color.upper()
open("web/data/couleurs_lignes.js", "w", encoding="utf-8").write("window.LCOL=" + json.dumps(col, ensure_ascii=False, separators=(",", ":")) + ";")
print(len(col), "lignes colorées")

TY = {"Bus": 3, "Rail": 2, "Tram": 0, "Subway": 1, "CableWay": 6, "Funicular": 7}
RAWT = "data/raw/traces.geojson" if os.path.exists("data/raw/traces.geojson") else "../hackaviz_idf/data/raw/traces.geojson"
tr = json.load(open(RAWT, encoding="utf-8"))["features"]
groupes = {}
for f in tr:
    p = f["properties"]
    k = f"{TY.get(p['route_type'], 3)}|{p['route_short_name']}"
    if not f.get("geometry"):
        continue
    parts = f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiLineString" else [f["geometry"]["coordinates"]]
    # extrémités arrondies au mètre pour que les morceaux jointifs se raccordent
    groupes.setdefault(k, []).extend([[(round(x, 5), round(y, 5)) for x, y in c] for c in parts if len(c) >= 2])
out, npts = {}, 0
for k, parts in groupes.items():
    m = linemerge(MultiLineString(parts))
    lines = list(m.geoms) if m.geom_type == "MultiLineString" else [m]
    for ln in lines:
        c = list(ln.simplify(0.00003).coords)
        q = [(round(x * 1e5), round(y * 1e5)) for x, y in c]
        enc = [q[0][0], q[0][1]]
        for a, b in zip(q, q[1:]):
            enc += [b[0] - a[0], b[1] - a[1]]
        out.setdefault(k, []).append(enc)
        npts += len(q)
open("web/data/traces_lignes.js", "w", encoding="utf-8").write("window.TRL=" + json.dumps(out, separators=(",", ":")) + ";")
print(len(out), "lignes tracées,", npts, "points,", round(os.path.getsize("web/data/traces_lignes.js") / 1e6, 1), "Mo")
