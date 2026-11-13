"""Graphe compact pour les isochrones calculées dans le navigateur (Dijkstra en JavaScript).
Sortie : web/data/graph.js  →  window.GR = {nz, nn, s, d, t, ivt, wait, walk, aj, cl, temp}"""
import json, gzip, csv
import numpy as np
g = np.load("data/processed/graph.npz", allow_pickle=True); E = g["E"]
temp = {}
with gzip.open("data/raw/H_75_latest-2025-2026.csv.gz", "rt", encoding="utf-8") as f:
    r = csv.reader(f, delimiter=";"); h = next(r); I = {k: h.index(k) for k in ["NUM_POSTE", "AAAAMMJJHH", "T"]}
    for x in r:
        if x[I["NUM_POSTE"]] == "75114001" and x[I["AAAAMMJJHH"]].startswith("20260625") and x[I["T"]]:
            temp[(int(x[I["AAAAMMJJHH"]][8:]) + 2) % 24] = float(x[I["T"]])       # heure locale (UTC + 2)
out = dict(nz=int(g["NZ"]), nn=int(g["NN"]), s=E[:, 0].astype(int).tolist(), d=E[:, 1].astype(int).tolist(), t=E[:, 2].astype(int).tolist(),
           ivt=np.round(E[:, 3] * 10).astype(int).tolist(), wait=np.round(E[:, 4] * 10).astype(int).tolist(), walk=np.round(E[:, 5] * 10).astype(int).tolist(),
           aj=np.round(np.clip(E[:, 6], 0, 17)).astype(int).tolist(), cl=E[:, 7].astype(int).tolist(), temp={str(k): v for k, v in sorted(temp.items())})
s = json.dumps(out, separators=(",", ":"))
open("web/data/graph.js", "w", encoding="utf-8").write("window.GR=" + s + ";")
print("graph.js", round(len(s) / 1e6, 1), "Mo · arcs", len(out["s"]), "· températures", out["temp"])
